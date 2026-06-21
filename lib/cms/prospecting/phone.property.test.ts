// `redactPhonesForEmit` reaches `computePhoneHash`, which reads PHONE_HASH_SALT
// at call time; pin a stable salt so the emitted hash is deterministic and the
// expected `phone_hash:` token can be computed with the same salt in-test.
process.env.PHONE_HASH_SALT ??= "prospecting-phone-property-test-salt";

import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import { targets, sfOutbox } from "../schema";
import type { Database } from "../db";
import { purgeTargetPhones, redactPhonesForEmit } from "./phone";
import { isPhoneShaped } from "../crm/phone-privacy";
import { computePhoneHash, normalizePhoneToE164 } from "../voice/identity";

/**
 * Property test for phone privacy (task 8.2, NOT optional).
 *
 * **Feature: prospecting-workspace, Property 8: No raw phone appears in any events payload, audit entry, or agent-memory record; raw phone exists only in the Salesforce-bound outbox payload (and the transient targets.raw_phone, purged <=24h).**
 *
 * **Validates: Requirements 9.2**
 *
 * Property 8 protects the platform's phone-privacy invariant (roadmap P9 /
 * CC-Privacy, Req 9.2): a phone number lives only as a salted `phone_hash`, and
 * a raw number is permitted in exactly one place — the Salesforce-bound outbox
 * payload (plus the transient `targets.raw_phone` that populates it, purged
 * within 24h of forwarding). The two enforcement primitives in
 * `lib/cms/prospecting/phone.ts` (task 8.1) carry the invariant:
 *
 *   A. {@link redactPhonesForEmit} is the pre-emit guard every event payload,
 *      audit entry, and agent-memory record passes through before it reaches
 *      the SSE bus / Audit_Log / memory store. For ANY nested payload mixing
 *      raw phone-shaped values with ids/UUIDs/hashes/numbers, the redacted copy
 *      must contain NO raw phone substring, must replace each phone with its
 *      salted `phone_hash`, must preserve every non-phone leaf, and must never
 *      mutate the input. This half is pure and DB-free, so it carries the
 *      pinned property at exactly 100 iterations.
 *
 *   B. {@link purgeTargetPhones} clears the transient `targets.raw_phone` only
 *      AFTER the Salesforce-bound `lead_upsert` outbox row has been delivered
 *      >=24h ago; never-forwarded and recently-forwarded Targets retain it, and
 *      the sweep is idempotent. This half stands up real SQL (pg-mem), so it
 *      runs a smaller, DB-backed budget over one shared in-memory db.
 *
 * The pure-redaction harness needs no DB; the purge harness reuses the lean
 * pg-mem setup from the task 8.1 smoke test (`phone.test.ts`) and the sibling
 * `crm/phone-privacy.property.test.ts`.
 */

// The pinned, non-optional property runs at EXACTLY the 100-iteration floor.
const NUM_RUNS = 100;
// The purge half stands up real SQL per case, so it runs a small DB-backed budget.
const PURGE_NUM_RUNS = 30;

// ── Generators ────────────────────────────────────────────────────────────────

/** A run of N decimal digits as a string, with N in [min, max]. */
function digitsOfLength(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .integer({ min, max })
    .chain((n) =>
      fc
        .array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n })
        .map((a) => a.join(""))
    );
}

/**
 * An E.164 number with 9–14 dialable digits (e.g. `+97150...`). Always within
 * the guard's 7–15 digit window, never a 16+ contiguous run, and always
 * normalisable by {@link normalizePhoneToE164} — so it is a genuine raw
 * phone-shaped value and a valid input to {@link computePhoneHash}.
 */
const e164Arb: fc.Arbitrary<string> = digitsOfLength(9, 14).map((d) => `+${d}`);

/** A tagged leaf the structure builder embeds and the assertions track. */
type TaggedLeaf =
  | { kind: "phone"; value: string; raw: string } // standalone raw phone string
  | { kind: "phoneProse"; value: string; raw: string } // raw phone inside prose
  | { kind: "cleanStr"; value: string; raw: string } // preserved string token
  | { kind: "num"; value: number }; // preserved number leaf

/** Standalone raw phone leaf — the whole string is the phone (match === raw). */
const phoneLeafArb: fc.Arbitrary<TaggedLeaf> = e164Arb.map((p) => ({
  kind: "phone",
  value: p,
  raw: p,
}));

/** Raw phone embedded in prose, alongside ordinary words. */
const phoneProseLeafArb: fc.Arbitrary<TaggedLeaf> = e164Arb.map((p) => ({
  kind: "phoneProse",
  value: `ring ${p} tomorrow`,
  raw: p,
}));

/** A UUID leaf — a non-phone identifier that must be preserved verbatim. */
const uuidLeafArb: fc.Arbitrary<TaggedLeaf> = fc
  .constant(null)
  .map(() => randomUUID())
  .filter((u) => !isPhoneShaped(u))
  .map((u) => ({ kind: "cleanStr", value: u, raw: u }));

/** An existing salted `phone_hash` leaf — already-hashed, must be preserved. */
const hashLeafArb: fc.Arbitrary<TaggedLeaf> = e164Arb
  .map((p) => computePhoneHash(normalizePhoneToE164(p)))
  .filter((h) => !isPhoneShaped(h))
  .map((h) => ({ kind: "cleanStr", value: h, raw: h }));

/** A short clean string leaf that is not phone-shaped. */
const cleanStrLeafArb: fc.Arbitrary<TaggedLeaf> = fc
  .string({ maxLength: 12 })
  .filter((s) => !isPhoneShaped(s))
  .map((s) => ({ kind: "cleanStr", value: s, raw: s }));

/**
 * A number leaf — both small (<=6 digits) and large (phone-length) numbers,
 * which {@link redactPhonesForEmit} must preserve untouched because it never
 * rewrites non-string leaves (Req 9.2 concerns raw phone STRINGS).
 */
const numLeafArb: fc.Arbitrary<TaggedLeaf> = fc
  .oneof(
    fc.integer({ min: 0, max: 999_999 }),
    fc.integer({ min: 10_000_000, max: 9_999_999_999 })
  )
  .map((n) => ({ kind: "num", value: n }));

const leafArb: fc.Arbitrary<TaggedLeaf> = fc.oneof(
  phoneLeafArb,
  phoneProseLeafArb,
  uuidLeafArb,
  hashLeafArb,
  cleanStrLeafArb,
  numLeafArb
);

/**
 * Fold a list of tagged leaves into a deeply nested payload mixing plain
 * objects and arrays (mirroring an events payload / audit entry / agent-memory
 * record), so the recursive guard is exercised across nesting and sibling
 * shapes. The leaf VALUES are what the guard inspects; the tags travel with the
 * caller for tracking.
 */
function buildPayload(leaves: TaggedLeaf[]): unknown {
  let node: unknown = null;
  leaves.forEach((leaf, i) => {
    const v = leaf.value;
    switch (i % 3) {
      case 0:
        node = { value: v, child: node, kind: "phone_hash" };
        break;
      case 1:
        node = [v, node];
        break;
      default:
        node = { items: [v, { nested: node }] };
        break;
    }
  });
  return node;
}

/** Collect every string and number leaf reachable in a payload (values only). */
function collectLeaves(
  node: unknown,
  acc: { strings: string[]; numbers: number[] } = { strings: [], numbers: [] }
): { strings: string[]; numbers: number[] } {
  if (node === null || node === undefined) return acc;
  if (typeof node === "string") {
    acc.strings.push(node);
    return acc;
  }
  if (typeof node === "number") {
    acc.numbers.push(node);
    return acc;
  }
  if (typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const v of node) collectLeaves(v, acc);
    return acc;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    collectLeaves(v, acc);
  }
  return acc;
}

// ── A. Pre-emit redaction guard (pinned property, pure, 100 runs) ──────────────

describe("Feature: prospecting-workspace, Property 8: no raw phone in emitted payloads", () => {
  it("redacts every raw phone to its salted hash, preserves non-phone leaves, and never mutates the input", () => {
    fc.assert(
      fc.property(fc.array(leafArb, { minLength: 1, maxLength: 14 }), (leaves) => {
        const payload = buildPayload(leaves);
        const snapshot = structuredClone(payload);

        const redacted = redactPhonesForEmit(payload);
        const redactedStrings = collectLeaves(redacted).strings;

        // (0) The input is never mutated.
        expect(payload).toEqual(snapshot);

        // (1) NO raw phone substring survives in ANY string leaf of the redacted
        //     payload — the core no-raw-phone clause (events/audit/agent-memory).
        for (const leaf of leaves) {
          if (leaf.kind === "phone" || leaf.kind === "phoneProse") {
            expect(redactedStrings.some((s) => s.includes(leaf.raw))).toBe(false);
          }
        }

        // (2) Each standalone raw phone is replaced by its salted phone_hash —
        //     the same hash the Target stores (computed with the env salt).
        for (const leaf of leaves) {
          if (leaf.kind === "phone") {
            const expected = `phone_hash:${computePhoneHash(
              normalizePhoneToE164(leaf.raw)
            )}`;
            expect(redactedStrings.some((s) => s.includes(expected))).toBe(true);
          }
        }

        // (3) Non-phone string leaves (UUIDs, existing hashes, clean strings)
        //     are preserved verbatim as exact leaves.
        for (const leaf of leaves) {
          if (leaf.kind === "cleanStr") {
            expect(redactedStrings.includes(leaf.raw)).toBe(true);
          }
        }

        // (4) Number leaves are preserved untouched (same multiset in == out),
        //     even when phone-length — the guard rewrites only phone STRINGS.
        const before = collectLeaves(snapshot).numbers.sort((a, b) => a - b);
        const after = collectLeaves(redacted).numbers.sort((a, b) => a - b);
        expect(after).toEqual(before);

        // (5) No string leaf in the redacted payload is still phone-shaped — a
        //     belt-and-braces check that nothing dialable lingers as a string.
        for (const s of redactedStrings) {
          expect(isPhoneShaped(s)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("treats an events payload, an audit entry, and an agent-memory record identically — none retains a raw phone", () => {
    // The guard is shape-agnostic: the same redaction applies to whichever
    // store the payload is bound for. This pins the invariant's scope (Req 9.2)
    // across the three record shapes named by Property 8.
    const phone = "+971501234567";
    const expected = `phone_hash:${computePhoneHash(normalizePhoneToE164(phone))}`;

    const eventPayload = { type: "prospecting.target.recorded", data: { phone } };
    const auditEntry = { action: "record_target", detail: `phone=${phone}` };
    const memoryRecord = { key: "target:abc", note: `caller ${phone}` };

    for (const record of [eventPayload, auditEntry, memoryRecord]) {
      const serialized = JSON.stringify(redactPhonesForEmit(record));
      expect(serialized.includes(phone)).toBe(false);
      expect(serialized.includes("phone_hash:")).toBe(true);
    }
    // The standalone-phone event still pins the exact salted hash.
    expect(JSON.stringify(redactPhonesForEmit(eventPayload))).toContain(expected);
  });
});

// ── B. Transient targets.raw_phone purge (DB-backed, small budget) ─────────────

// Minimal DDL — only the two tables the purge sweep touches (mirrors the task
// 8.1 smoke harness).
const DDL = `
  CREATE TABLE "sf_outbox" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "kind" text NOT NULL,
    "job_key" text NOT NULL UNIQUE,
    "payload" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "attempts" integer NOT NULL DEFAULT 0,
    "sf_id" text,
    "last_error" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "brief_id" uuid,
    "target_type" text NOT NULL,
    "display_name" text,
    "company_name" text,
    "title" text,
    "email" text,
    "phone_hash" text,
    "raw_phone" text,
    "country" text,
    "attributes" jsonb,
    "source_provider" text NOT NULL,
    "source_ref" text,
    "lawful_basis" text NOT NULL,
    "status" text NOT NULL DEFAULT 'new',
    "party_id" uuid,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
`;

function buildDb(): Database {
  const mem: IMemoryDb = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();
  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both and rebuild positional rows when array-mode
  // was requested (mirrors the sibling harnesses).
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;
      const result = originalQuery(clean, values, cb);
      if (
        wantArray &&
        result &&
        typeof (result as Promise<unknown>).then === "function"
      ) {
        return (result as Promise<{ rows: Record<string, unknown>[] }>).then(
          (r) => ({ ...r, rows: r.rows.map((row) => Object.values(row)) })
        );
      }
      return result;
    }
    return originalQuery(config, values, cb);
  };
  return drizzle(pool, { schema }) as unknown as Database;
}

async function seedTarget(
  db: Database,
  partyId: string | null,
  rawPhone: string
): Promise<string> {
  const [row] = await db
    .insert(targets)
    .values({
      targetType: "person",
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
      partyId,
      rawPhone,
      status: partyId ? "promoted" : "new",
    })
    .returning({ id: targets.id });
  return row.id;
}

async function seedDeliveredForward(
  db: Database,
  partyId: string,
  updatedAt: Date
): Promise<void> {
  await db.insert(sfOutbox).values({
    kind: "lead_upsert",
    jobKey: `lead:${partyId}:${randomUUID()}`,
    payload: { partyId, sObject: "Lead" },
    status: "sent",
    updatedAt,
  });
}

describe("Feature: prospecting-workspace, Property 8: transient raw_phone is purged <=24h after forwarding", () => {
  let db: Database;

  beforeAll(() => {
    db = buildDb();
  });

  const H = 60 * 60 * 1000;

  it("clears raw_phone only for Targets forwarded >=24h ago; never/recently-forwarded retain it; the sweep is idempotent", async () => {
    await fc.assert(
      fc.asyncProperty(
        e164Arb,
        e164Arb,
        e164Arb,
        // age (hours) of the delivered forward that MUST be purged
        fc.integer({ min: 25, max: 240 }),
        // age (hours) of a delivered forward still inside the 24h window
        fc.integer({ min: 0, max: 23 }),
        async (oldPhone, freshPhone, neverPhone, oldAgeHours, freshAgeHours) => {
          const now = new Date("2026-02-01T00:00:00.000Z");

          // Forwarded > 24h ago → raw phone MUST be purged.
          const oldParty = randomUUID();
          const oldTarget = await seedTarget(db, oldParty, oldPhone);
          await seedDeliveredForward(
            db,
            oldParty,
            new Date(now.getTime() - oldAgeHours * H)
          );

          // Forwarded < 24h ago → raw phone MUST be retained.
          const freshParty = randomUUID();
          const freshTarget = await seedTarget(db, freshParty, freshPhone);
          await seedDeliveredForward(
            db,
            freshParty,
            new Date(now.getTime() - freshAgeHours * H)
          );

          // Never forwarded (no outbox row) → raw phone MUST be retained.
          const neverParty = randomUUID();
          const neverTarget = await seedTarget(db, neverParty, neverPhone);

          const readPhone = async (id: string): Promise<string | null> =>
            (
              await db
                .select({ rawPhone: targets.rawPhone })
                .from(targets)
                .where(eq(targets.id, id))
            )[0].rawPhone;

          await purgeTargetPhones(db, now);

          // Old forward purged; fresh + never retained.
          expect(await readPhone(oldTarget)).toBeNull();
          expect(await readPhone(freshTarget)).toBe(freshPhone);
          expect(await readPhone(neverTarget)).toBe(neverPhone);

          // Idempotent: re-running leaves the purged row null and the retained
          // rows untouched (the IS NOT NULL predicate makes the sweep a no-op).
          await purgeTargetPhones(db, now);
          expect(await readPhone(oldTarget)).toBeNull();
          expect(await readPhone(freshTarget)).toBe(freshPhone);
          expect(await readPhone(neverTarget)).toBe(neverPhone);
        }
      ),
      { numRuns: PURGE_NUM_RUNS }
    );
  });
});
