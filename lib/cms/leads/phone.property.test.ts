// Configure the phone-hash salt BEFORE anything reads it, so the salted hash
// the pre-emit guard emits is deterministic and environment-independent
// (computePhoneHash/getPhoneHashSalt read PHONE_HASH_SALT at call time).
process.env.PHONE_HASH_SALT ??= "lead-engine-phone-privacy-property-test-salt";

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../schema";
import { inboundLeads, sfOutbox } from "../schema";
import type { Database } from "../db";
import { purgeInboundPhones, redactPhonesForEmit } from "./phone";
import { findPhoneShaped, isPhoneShaped } from "../crm/phone-privacy";
import { computePhoneHash, normalizePhoneToE164 } from "../voice/identity";

/**
 * Property test for phone privacy (Lead Engine S3, task 7.2, NOT optional —
 * this protects a non-negotiable privacy boundary).
 *
 * **Feature: lead-engine, Property 11: No raw phone appears in any events payload, audit entry, or agent-memory record; raw phone exists only in the Salesforce-bound outbox payload (and the transient inbound_leads.raw_phone, purged ≤24h).**
 *
 * **Validates: Requirements 13.2, 13.3**
 *
 * The platform's privacy invariant (roadmap P9 / CC-Privacy, Req 13) is that a
 * phone lives only as a salted `phone_hash`, never raw in `events`, the
 * `audit_log`, or agent memory; raw phone is permitted in exactly one place —
 * the Salesforce-bound outbox payload — and even the transient
 * `inbound_leads.raw_phone` copy used to populate that payload must be purged
 * ≤24h after the lead is forwarded. Property 11 has the two clauses
 * `lib/cms/leads/phone.ts` (task 7.1) enforces, each exercised here over ≥100
 * generated worlds:
 *
 *   1. **No raw phone survives the pre-emit guard.** Every payload bound for the
 *      SSE event bus / audit log / agent memory passes through
 *      `redactPhonesForEmit`. For arbitrary payloads carrying raw phones in
 *      various nestings (bare strings, phones embedded in prose, arrays, nested
 *      objects) mixed with UUIDs/ids that must NOT be redacted, the redacted
 *      output contains NO raw phone-shaped string anywhere — only the salted
 *      `phone_hash:` token — while every UUID/id token is preserved verbatim.
 *
 *   2. **Raw phone in `inbound_leads.raw_phone` is purged ≤24h after Salesforce
 *      forwarding.** For arbitrary worlds of `inbound_leads` + `sf_outbox`
 *      (delivered `lead_upsert`) rows with varying delivery ages and statuses,
 *      `purgeInboundPhones` clears `raw_phone` EXACTLY for leads whose
 *      `lead_upsert` was forwarded (`status='sent'`) ≥24h ago, leaves
 *      recent / pending / never-forwarded leads' `raw_phone` intact, and is a
 *      no-op on re-run (idempotent).
 *
 * Clause 1 is pure (no DB). Clause 2 runs against real SQL under `pg-mem`
 * (migration 0036's `inbound_leads` DDL + the `sf_outbox` schema), following the
 * sibling harness conventions (`gen_random_uuid` registration, the node-postgres
 * adapter, schema seeding) of `lib/cms/crm/phone-privacy.property.test.ts` and
 * `lib/cms/metrics/lead-engine-figures.property.test.ts`.
 */

const NUM_RUNS = Number(process.env.PBT_NUM_RUNS ?? 100);

// ── pg-mem harness (clause 2) ────────────────────────────────────────────────

// Minimal `parties` root (FK target of inbound_leads.party_id).
const PARTIES_DDL = `
  CREATE TABLE "parties" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
  );`;

// inbound_leads DDL copied verbatim from drizzle/0036_inbound_leads.sql.
const INBOUND_LEADS_DDL = `
  CREATE TABLE "inbound_leads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "source" text NOT NULL,
    "idempotency_key" text NOT NULL,
    "status" text NOT NULL DEFAULT 'received',
    "name" text,
    "email" text,
    "phone_hash" text,
    "raw_phone" text,
    "content" text NOT NULL DEFAULT '',
    "raw_payload" jsonb,
    "attribution" jsonb,
    "structured" jsonb,
    "party_id" uuid REFERENCES "parties"("id") ON DELETE SET NULL,
    "attempts" integer NOT NULL DEFAULT 0,
    "last_error" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );`;

// sf_outbox DDL matching lib/cms/schema.ts (the only permitted raw-phone home).
const SF_OUTBOX_DDL = `
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
  );`;

/** Stand up a fresh pg-mem with parties + inbound_leads + sf_outbox. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.none(PARTIES_DDL);
  mem.public.none(INBOUND_LEADS_DDL);
  mem.public.none(SF_OUTBOX_DDL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects the `types.getTypeParser` and
  // `rowMode: "array"` this drizzle version sends; strip both and rebuild
  // positional rows when array-mode was requested (mirrors the S2 harness).
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

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
}

// ── Generators ────────────────────────────────────────────────────────────────

/** A run of exactly N decimal digits as a string. */
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
 * An E.164 number with 9–14 dialable digits, e.g. `+97150...`. Always within
 * the guard's 7–15 digit window and never a 16+ contiguous run, so it is a
 * genuine raw "phone-shaped" string and a valid input to
 * {@link normalizePhoneToE164}/{@link computePhoneHash}.
 */
const e164Arb: fc.Arbitrary<string> = digitsOfLength(9, 14).map((d) => `+${d}`);

/**
 * A raw phone embedded in a value at various positions: bare, inside prose, or
 * trailed by an annotation — always whitespace/punctuation-delimited so the
 * guard treats it as a phone (a letter-adjacent run is, by design, an id).
 * `bare` is tracked so the test can compute the expected salted hash.
 */
const phoneEntryArb: fc.Arbitrary<{ bare: string; display: string }> =
  e164Arb.chain((bare) =>
    fc
      .constantFrom(
        bare,
        `Called ${bare} about the unit`,
        `${bare} (new lead)`,
        `contact: ${bare}`
      )
      .map((display) => ({ bare, display }))
  );

/** A UUID/id token that must be preserved verbatim (never phone-shaped). */
const uuidArb: fc.Arbitrary<string> = fc
  .uuid()
  .filter((u) => !isPhoneShaped(u));

/** Plausible non-phone filler strings (never phone-shaped). */
const cleanArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => !isPhoneShaped(s));

/**
 * Nest a flat list of string leaves into a binary tree of objects/arrays, so
 * the markers land at various depths inside strings, arrays, and nested
 * objects.
 */
function nestLeaves(values: string[]): fc.Arbitrary<unknown> {
  const build = (items: string[]): fc.Arbitrary<unknown> => {
    if (items.length === 0) return fc.constant(null);
    if (items.length === 1) return fc.constant(items[0]);
    return fc.integer({ min: 1, max: items.length - 1 }).chain((k) =>
      fc.boolean().chain((asObject) =>
        fc
          .tuple(build(items.slice(0, k)), build(items.slice(k)))
          .map(([l, r]) => (asObject ? { left: l, right: r } : [l, r]))
      )
    );
  };
  return build(values);
}

/** Interleave arrays round-robin so phones and ids are mixed in the tree. */
function interleave<T>(...lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}

/** A redaction world: a nested payload + the phones/ids it embeds. */
const redactionCaseArb = fc
  .record({
    phones: fc.array(phoneEntryArb, { minLength: 1, maxLength: 4 }),
    uuids: fc.array(uuidArb, { minLength: 0, maxLength: 4 }),
    cleans: fc.array(cleanArb, { minLength: 0, maxLength: 3 }),
  })
  .chain(({ phones, uuids, cleans }) => {
    const values = interleave(
      phones.map((p) => p.display),
      uuids,
      cleans
    );
    return nestLeaves(values).map((structure) => ({ structure, phones, uuids }));
  });

/** A purge world: one inbound lead + its Salesforce-forwarding scenario. */
type Scenario =
  | "forwarded_old" // lead_upsert, sent, >24h ago  → MUST purge
  | "forwarded_recent" // lead_upsert, sent, <24h ago  → keep
  | "pending_old" // lead_upsert, pending, >24h ago → keep (not delivered)
  | "not_forwarded"; // no outbox row                → keep

const leadSpecArb = fc.record({
  scenario: fc.constantFrom<Scenario>(
    "forwarded_old",
    "forwarded_recent",
    "pending_old",
    "not_forwarded"
  ),
  phone: e164Arb,
  oldAgeHours: fc.integer({ min: 25, max: 240 }), // strictly older than 24h
  recentAgeHours: fc.integer({ min: 0, max: 23 }), // strictly within 24h
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Collect every string leaf in a value (recursively). */
function collectStrings(value: unknown, acc: string[]): void {
  if (typeof value === "string") {
    acc.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, acc);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, acc);
    }
  }
}

// ── The property ───────────────────────────────────────────────────────────────

describe("Feature: lead-engine, Property 11: No raw phone appears in any events payload, audit entry, or agent-memory record; raw phone exists only in the Salesforce-bound outbox payload (and the transient inbound_leads.raw_phone, purged ≤24h). (Req 13.2, 13.3)", () => {
  it("redacts every raw phone (preserving ids) from emit-bound payloads, and purges inbound_leads.raw_phone exactly for leads forwarded ≥24h ago (idempotently)", async () => {
    const H = 60 * 60 * 1000;

    // ── Clause 1: no raw phone survives the pre-emit guard (Req 13.2) ────────
    fc.assert(
      fc.property(redactionCaseArb, ({ structure, phones, uuids }) => {
        const redacted = redactPhonesForEmit(structure);

        const outStrings: string[] = [];
        collectStrings(redacted, outStrings);

        // (a) Sanity: the INPUT genuinely carried a raw phone — the guard is
        //     actually being exercised, not handed phone-free data.
        const inStrings: string[] = [];
        collectStrings(structure, inStrings);
        expect(inStrings.some((s) => findPhoneShaped(s) !== null)).toBe(true);

        // (b) NO raw phone-shaped string survives anywhere in the output (the
        //     core privacy guarantee for events/audit/agent-memory payloads).
        for (const s of outStrings) {
          expect(findPhoneShaped(s)).toBeNull();
        }

        // (c) Each raw phone was replaced by its salted phone_hash — the only
        //     permitted representation outside the SF-bound outbox.
        for (const { bare } of phones) {
          const token = `phone_hash:${computePhoneHash(normalizePhoneToE164(bare))}`;
          expect(outStrings.some((s) => s.includes(token))).toBe(true);
        }

        // (d) Non-phone tokens (UUIDs/ids) are preserved verbatim, never redacted.
        for (const u of uuids) {
          expect(outStrings.some((s) => s.includes(u))).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS }
    );

    // ── Clause 2: transient raw phone purged ≤24h after forwarding (Req 13.3) ─
    await fc.assert(
      fc.asyncProperty(
        fc.array(leadSpecArb, { minLength: 1, maxLength: 8 }),
        async (specs) => {
          const { db } = buildDb();
          const now = new Date("2025-06-01T12:00:00.000Z");

          // Seed each lead's inbound_leads row + its forwarding scenario.
          const leads = specs.map((spec) => ({
            spec,
            partyId: randomUUID(),
            shouldPurge: spec.scenario === "forwarded_old",
          }));

          for (const { spec, partyId } of leads) {
            await db.execute(
              sql`INSERT INTO parties (id) VALUES (${partyId})`
            );
            await db.insert(inboundLeads).values({
              source: "web_form",
              idempotencyKey: `idem-${partyId}`,
              status: "received",
              rawPhone: spec.phone, // transient SF-ingress copy
              partyId,
            });

            if (spec.scenario === "not_forwarded") continue;

            const sent =
              spec.scenario === "forwarded_old" ||
              spec.scenario === "forwarded_recent";
            const ageHours =
              spec.scenario === "forwarded_recent"
                ? spec.recentAgeHours
                : spec.oldAgeHours;

            await db.insert(sfOutbox).values({
              kind: "lead_upsert",
              jobKey: `job-${partyId}`,
              payload: { partyId, sObject: "Lead", phone: spec.phone },
              status: sent ? "sent" : "pending",
              updatedAt: new Date(now.getTime() - ageHours * H),
            });
          }

          const rawPhoneOf = async (partyId: string): Promise<string | null> => {
            const [row] = await db
              .select({ rawPhone: inboundLeads.rawPhone })
              .from(inboundLeads)
              .where(eq(inboundLeads.partyId, partyId));
            return row?.rawPhone ?? null;
          };

          // First sweep — clears raw_phone for exactly the forwarded≥24h leads.
          const expectedPurged = leads.filter((l) => l.shouldPurge).length;
          const first = await purgeInboundPhones(db, now);
          expect(first.purged).toBe(expectedPurged);

          for (const { partyId, shouldPurge, spec } of leads) {
            const raw = await rawPhoneOf(partyId);
            if (shouldPurge) {
              expect(raw).toBeNull();
            } else {
              expect(raw).toBe(spec.phone); // recent / pending / never-forwarded
            }
          }

          // Idempotent: re-running purges nothing more and changes nothing.
          const second = await purgeInboundPhones(db, now);
          expect(second.purged).toBe(0);

          for (const { partyId, shouldPurge, spec } of leads) {
            const raw = await rawPhoneOf(partyId);
            if (shouldPurge) {
              expect(raw).toBeNull();
            } else {
              expect(raw).toBe(spec.phone);
            }
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
