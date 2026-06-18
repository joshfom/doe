import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "@/lib/cms/schema";
import { sfOutbox } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import {
  assertNoRawPhone,
  RawPhoneError,
  isPhoneShaped,
  purgeDeliveredOutboxPhones,
} from "@/lib/cms/crm/phone-privacy";
import {
  assertValidNote,
  NotePrivacyViolationError,
} from "@/lib/cms/tickets/notes";
import { computePhoneHash } from "@/lib/cms/voice/identity";

/**
 * Property test for phone privacy across the Salesforce integration (task 6.4).
 *
 * **Feature: salesforce-lead-core, Property 9: For any payload containing a phone-shaped string, the integration rejects it from party_identities, events, audit, the sync ledger, and note content; raw phone appears only in the Salesforce-bound outbox payload and is purged within 24h of confirmed delivery.**
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.5, 14.6, 14.7**
 *
 * The protected stores (`party_identities`, event payloads, `audit_log`, the
 * `crm_sync_log` sync ledger, and `ticket_notes` content) all funnel their
 * writes through the same {@link assertNoRawPhone} guard before persisting, so
 * the guard is the conceptual representative of "the writer a protected store
 * would call" — a phone-bearing payload it rejects is a payload none of those
 * stores will ever persist (Req 7.1–7.3, 7.5, 14.7). The note write-path is
 * tested through its own {@link assertValidNote} guard (Req 14.6 + 14.7). The
 * 24h purge of the only permitted raw-phone location — the Salesforce-bound
 * `sf_outbox` payload — is exercised against real SQL (pg-mem + migration 0029).
 *
 * pg-mem harness mirrors `lib/cms/jobs/idempotency.property.test.ts`
 * (migration 0029, which creates `sf_outbox`).
 */

// Phone-bearing / hash-only properties are pure and cheap — run a wide budget.
const NUM_RUNS = 200;
// The purge property stands up real SQL per case, so keep its budget small.
const PURGE_NUM_RUNS = 25;

// A fixed, test-only salt so hashes are deterministic and env-independent.
const TEST_SALT = "phone-privacy-property-test-salt";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Pre-existing tables migration 0029 ALTERs / references.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up pg-mem with migration 0029 applied and return a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"` that this drizzle version sends; strip both and rebuild
  // positional rows when array-mode was requested (mirrors the jobs harness).
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
 * genuine "phone-shaped" string and a valid input to {@link computePhoneHash}.
 */
const e164Arb: fc.Arbitrary<string> = digitsOfLength(9, 14).map((d) => `+${d}`);

/**
 * A common human-typed phone format (E.164, national, or grouped with
 * separators). Used only for the rejection direction.
 */
const formattedPhoneArb: fc.Arbitrary<string> = digitsOfLength(7, 12).chain(
  (d) =>
    fc.constantFrom(
      d, // bare run: 5551234567
      `+${d}`, // E.164
      // grouped with separators, e.g. 555 123 4567 / 555-123-4567 / (555) 123.4567
      `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`,
      `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`,
      `(${d.slice(0, 3)}) ${d.slice(3, 6)}.${d.slice(6)}`
    )
);

/** Plausible non-phone string leaves (ids, words, short numbers). */
const cleanLeafArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(() => randomUUID()).map((f) => f()),
  fc.string({ maxLength: 12 }).filter((s) => !isPhoneShaped(s)),
  fc.integer({ min: 0, max: 999999 }), // ≤6-digit numbers never trip the guard
  fc.boolean(),
  fc.constant(null)
);

/**
 * Embed `marker` (a phone or a hash string) inside an arbitrary object/array
 * structure at a random nesting depth, alongside clean sibling fields.
 */
function embedAt(
  marker: string,
  clean: fc.Arbitrary<unknown>
): fc.Arbitrary<unknown> {
  const leaf = fc.constant(marker);
  const node: fc.Memo<unknown> = fc.memo((depth) => {
    if (depth <= 0) return leaf;
    return fc.oneof(
      // wrap in an object with a clean sibling
      fc.tuple(node(depth - 1), clean).map(([inner, sib]) => ({
        marker: inner,
        sibling: sib,
        kind: "phone_hash",
      })),
      // wrap in an array with clean neighbours
      fc.tuple(clean, node(depth - 1), clean).map(([a, inner, b]) => [
        a,
        inner,
        b,
      ])
    );
  });
  return fc.integer({ min: 0, max: 4 }).chain((depth) => node(depth));
}

// ── Pure guard properties ──────────────────────────────────────────────────────

describe("Property 9 — no raw phone in protected stores (Req 7.1, 7.2, 7.3, 7.5, 14.6, 14.7)", () => {
  it("rejects every phone-bearing payload bound for a protected store (party_identities/events/audit/ledger/note content)", () => {
    fc.assert(
      fc.property(
        formattedPhoneArb.filter(isPhoneShaped).chain((phone) =>
          fc.oneof(
            fc.constant(phone as unknown), // bare string (e.g. note content)
            embedAt(phone, cleanLeafArb) // nested in object/array structure
          )
        ),
        (payload) => {
          // The guard the party_identities / event / audit / sync-ledger / note
          // writers all call MUST reject this write (Req 7.1, 7.2, 7.3, 7.5,
          // 14.7) — and surface it as a RawPhoneError privacy violation.
          expect(() => assertNoRawPhone(payload)).toThrow(RawPhoneError);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("permits the salted Phone_Hash everywhere — the hash is the only stored form (Req 7.1)", () => {
    fc.assert(
      fc.property(
        e164Arb.chain((e164) => {
          const hash = computePhoneHash(e164, TEST_SALT);
          return fc.oneof(
            fc.constant(hash as unknown), // bare hash
            embedAt(hash, cleanLeafArb) // hash nested among clean fields
          );
        }),
        (payloadWithHash) => {
          // A payload that references a phone only as its salted hash must NOT
          // be rejected — storing the hash is exactly what Req 7.1 requires.
          expect(() => assertNoRawPhone(payloadWithHash)).not.toThrow();
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("note write-path: raw phone in content is rejected; the salted hash passes the privacy check (Req 14.6, 14.7)", () => {
    fc.assert(
      fc.property(formattedPhoneArb.filter(isPhoneShaped), (phone) => {
        const leadPartyId = randomUUID();

        // (a) A note whose content carries a raw phone is rejected as a privacy
        //     violation and NOT persisted (Req 14.7).
        expect(() =>
          assertValidNote({
            actorType: "system",
            leadPartyId,
            content: `Called the lead at ${phone} about the unit.`,
          })
        ).toThrow(NotePrivacyViolationError);

        // (b) The same note with the phone replaced by its salted hash passes
        //     the privacy check — the hash is the permitted form (Req 14.6).
        const hash = computePhoneHash(
          phone.startsWith("+") ? phone : `+${phone.replace(/\D/g, "")}`,
          TEST_SALT
        );
        expect(() =>
          assertValidNote({
            actorType: "system",
            leadPartyId,
            content: `Called the lead (ref ${hash}) about the unit.`,
          })
        ).not.toThrow();
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── 24h outbox purge (real SQL) ────────────────────────────────────────────────

describe("Property 9 — raw phone in the Salesforce-bound outbox is purged within 24h of delivery (Req 7.5)", () => {
  let db: Database;

  beforeAll(() => {
    ({ db } = buildDb());
  });

  const H = 60 * 60 * 1000;

  it("strips the phone field from delivered (sent) rows older than 24h and leaves recent / other fields intact", async () => {
    let iter = 0;

    await fc.assert(
      fc.asyncProperty(
        e164Arb,
        // age (hours) of the delivered row whose phone should be purged
        fc.integer({ min: 25, max: 240 }),
        // age (hours) of a delivered row that is still inside the 24h window
        fc.integer({ min: 0, max: 23 }),
        async (e164, oldAgeHours, freshAgeHours) => {
          const now = new Date("2025-06-01T12:00:00.000Z");
          const ns = `purge-it-${iter++}`;

          // Row A: delivered > 24h ago — its raw phone MUST be purged.
          const oldKey = `${ns}-old`;
          const oldPayload = {
            sObject: "Contact",
            phone: e164,
            email: "lead@example.com",
            lastName: "Khan",
          };
          await db.insert(sfOutbox).values({
            kind: "lead_upsert",
            jobKey: oldKey,
            payload: oldPayload,
            status: "sent",
            sfId: "00Q000000000001",
            updatedAt: new Date(now.getTime() - oldAgeHours * H),
          });

          // Row B: delivered < 24h ago — its raw phone MUST remain (still inside
          // the retention window).
          const freshKey = `${ns}-fresh`;
          const freshPayload = {
            sObject: "Contact",
            phone: e164,
            email: "fresh@example.com",
            lastName: "Ali",
          };
          await db.insert(sfOutbox).values({
            kind: "lead_upsert",
            jobKey: freshKey,
            payload: freshPayload,
            status: "sent",
            sfId: "00Q000000000002",
            updatedAt: new Date(now.getTime() - freshAgeHours * H),
          });

          const result = await purgeDeliveredOutboxPhones(db, now);
          expect(result.purged).toBeGreaterThanOrEqual(1);

          // Row A: phone removed, every other field preserved verbatim.
          const [oldRow] = await db
            .select({ payload: sfOutbox.payload })
            .from(sfOutbox)
            .where(eq(sfOutbox.jobKey, oldKey));
          const oldOut = oldRow.payload as Record<string, unknown>;
          expect(oldOut).not.toHaveProperty("phone");
          expect(oldOut.sObject).toBe("Contact");
          expect(oldOut.email).toBe("lead@example.com");
          expect(oldOut.lastName).toBe("Khan");

          // Row B: still inside 24h → untouched, phone intact.
          const [freshRow] = await db
            .select({ payload: sfOutbox.payload })
            .from(sfOutbox)
            .where(eq(sfOutbox.jobKey, freshKey));
          const freshOut = freshRow.payload as Record<string, unknown>;
          expect(freshOut.phone).toBe(e164);
        }
      ),
      { numRuns: PURGE_NUM_RUNS }
    );
  });
});
