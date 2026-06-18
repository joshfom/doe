import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";
import * as schema from "@/lib/cms/schema";
import { parties, partyIdentities, leadsMirror } from "@/lib/cms/schema";
import type { Database } from "@/lib/cms/db";
import {
  resolveLeadByMatchKeys,
  upsertLead,
  type MatchInput,
  type MatchKey,
} from "@/lib/cms/tickets/crm/dedupe";
import { computePhoneHash, normalizePhoneToE164 } from "@/lib/cms/voice/identity";

/**
 * Property test for conservative dedupe (task 3.4).
 *
 * **Feature: salesforce-lead-core, Property 3: For any MatchInput, parties merge only on an exact phone_hash, normalized email, or sf_lead_id; name similarity never merges; and distinct keys resolving to different parties always yield a conflict with no auto-merge.**
 *
 * **Validates: Requirements 3.1, 3.4**
 *
 * Setup mirrors `lib/cms/jobs/idempotency.property.test.ts` and
 * `lib/cms/schema.salesforce-lead-core.migration.test.ts`: the full migration
 * chain (0000–0031) cannot be replayed under pg-mem because earlier migrations
 * enable the `vector` (pgvector) extension, which pg-mem does not support. This
 * property only concerns `resolveLeadByMatchKeys` over the party graph, so we
 * stand up minimal `parties` / `party_identities` / `leads_mirror` stub tables
 * (matching their true column shapes from `lib/cms/schema.ts`) and wire a real
 * drizzle handle onto the same pg-mem instance so the lookup runs against
 * genuine SQL (exact `(kind,value)` index match, ON CONFLICT upsert).
 *
 * pg-mem ships no `gen_random_uuid()` (needed by DEFAULTs); it is registered as
 * an impure stub so each row gets a fresh uuid.
 */

// Salt for the salted phone hash — set before any computePhoneHash call.
process.env.PHONE_HASH_SALT = process.env.PHONE_HASH_SALT ?? "test-salt-dedupe";

// ≥100 iterations per the non-optional PBT directive for the dedupe boundary.
const NUM_RUNS = 100;

// Minimal PRE-migration stubs for the three tables the dedupe touches, in their
// real column shapes (lib/cms/schema.ts §Parties / §Party Identities / §Leads
// Mirror). The `assigned_rep_id` FK to `reps` is dropped to a plain column so we
// don't have to stand up the whole rep graph for a read-only lookup test.
const STUB_SQL = `
  CREATE TABLE "parties" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL DEFAULT 'person',
    "name" text,
    "language" text DEFAULT 'en',
    "client_id" uuid,
    "tenant_id" uuid,
    "consent_at" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now()
  );
  CREATE TABLE "party_identities" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "party_id" uuid NOT NULL REFERENCES "parties"("id") ON DELETE CASCADE,
    "kind" text NOT NULL,
    "value" text NOT NULL,
    "verified_at" timestamp
  );
  CREATE INDEX "party_identities_value_idx" ON "party_identities" ("kind", "value");
  CREATE TABLE "leads_mirror" (
    "party_id" uuid PRIMARY KEY REFERENCES "parties"("id") ON DELETE CASCADE,
    "sf_lead_id" text,
    "stage" text,
    "tier" text,
    "score_reason" text,
    "project_interest" text,
    "unit_interest" text,
    "budget_band" text,
    "source" text,
    "campaign" text,
    "assigned_rep_id" uuid,
    "last_interaction_at" timestamp,
    "last_interaction_summary" text,
    "sla_due_at" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "updated_at" timestamp NOT NULL DEFAULT now()
  );
`;

/** Stand up pg-mem with the stub party graph and return a drizzle handle. */
function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // DEFAULTs reference gen_random_uuid(); pg-mem does not ship it. Mark impure
  // so each row receives a fresh uuid rather than a cached single value.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.none(STUB_SQL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"` that this drizzle version sends; strip both and, when
  // array-mode rows were requested, convert pg-mem's object rows back into
  // positional arrays so drizzle's row mapper stays happy. (Verbatim from
  // lib/cms/jobs/idempotency.property.test.ts.)
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

// ── Key generation ──────────────────────────────────────────────────────────
// A monotonic sequence guarantees every generated key is globally unique across
// all parties and all fast-check iterations, so iterations never interfere via
// the shared accumulating database.
let seq = 0;

type KeyKind = "phone" | "email" | "sfLeadId";

/**
 * Build a fresh, globally-unique Match_Key:
 *   - `input`  — the raw MatchInput field the lookup is queried with.
 *   - `stored` — the normalized {kind,value} actually persisted in
 *                `party_identities` (phone → salted hash; email → lower+trim).
 */
function buildKey(kind: KeyKind): { input: Partial<MatchInput>; stored: MatchKey } {
  const n = seq++;
  if (kind === "phone") {
    const e164 = `+97150${String(n).padStart(7, "0")}`;
    return {
      input: { phone: e164 },
      stored: {
        kind: "phone_hash",
        value: computePhoneHash(normalizePhoneToE164(e164)),
      },
    };
  }
  if (kind === "email") {
    // Mixed-case + namespaced so normalization (lower+trim) is also exercised.
    const raw = `User.${n}@Example.COM`;
    return {
      input: { email: raw },
      stored: { kind: "email", value: raw.trim().toLowerCase() },
    };
  }
  const id = `00Q${String(n).padStart(12, "0")}`;
  return { input: { sfLeadId: id }, stored: { kind: "sf_lead_id", value: id } };
}

/** Snapshot row counts of every mutable table to prove a lookup mutates nothing. */
async function snapshot(db: Database) {
  const p = await db.select({ id: parties.id }).from(parties);
  const pi = await db.select({ id: partyIdentities.id }).from(partyIdentities);
  const lm = await db.select({ partyId: leadsMirror.partyId }).from(leadsMirror);
  return { parties: p.length, identities: pi.length, mirror: lm.length };
}

const ALL_KINDS: KeyKind[] = ["phone", "email", "sfLeadId"];
// Ordered pairs of DISTINCT kinds — a conflict needs two keys in different
// MatchInput fields (each field holds at most one key).
const DISTINCT_KIND_PAIRS: Array<[KeyKind, KeyKind]> = [
  ["phone", "email"],
  ["phone", "sfLeadId"],
  ["email", "sfLeadId"],
  ["email", "phone"],
  ["sfLeadId", "phone"],
  ["sfLeadId", "email"],
];
const NAME_POOL = ["John Smith", "Jane Doe", "Sam Lee", "أحمد", ""];

describe("Dedupe — Property 3: conservative dedupe, no false merges (Req 3.1, 3.4)", () => {
  let db: Database;

  beforeAll(() => {
    ({ db } = buildDb());
  });

  it("distinct exact keys resolving to DIFFERENT parties always yield a conflict with no auto-merge (Req 3.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...DISTINCT_KIND_PAIRS),
        fc.constantFrom(...NAME_POOL),
        fc.constantFrom(...NAME_POOL),
        async ([kindA, kindB], nameA, nameB) => {
          const a = buildKey(kindA);
          const b = buildKey(kindB);

          // Party A holds key A; Party B holds the (different) key B.
          const partyA = await upsertLead(db, {
            party: { name: nameA },
            identities: [a.stored],
          });
          const partyB = await upsertLead(db, {
            party: { name: nameB },
            identities: [b.stored],
          });

          // One MatchInput carrying BOTH keys (different fields).
          const input: MatchInput = { ...a.input, ...b.input };

          const before = await snapshot(db);
          const result = await resolveLeadByMatchKeys(db, input);
          const after = await snapshot(db);

          // Conflict — never an auto-merge.
          expect(result.kind).toBe("conflict");
          if (result.kind === "conflict") {
            // Both candidate parties surfaced for human resolution.
            expect([...result.candidatePartyIds].sort()).toEqual(
              [partyA.partyId, partyB.partyId].sort()
            );
          }

          // No party (or identity / mirror) was created or modified.
          expect(after).toEqual(before);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("matches ONLY on an exact key; identical names never cause a merge (Req 3.1)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_KINDS),
        fc.constantFrom(...ALL_KINDS),
        fc.constantFrom(...NAME_POOL),
        fc.constantFrom(...ALL_KINDS),
        async (kindA, kindB, sharedName, freshKind) => {
          const a = buildKey(kindA);
          const b = buildKey(kindB);

          // Two parties with the SAME name but different (or no shared) keys.
          const partyA = await upsertLead(db, {
            party: { name: sharedName },
            identities: [a.stored],
          });
          await upsertLead(db, {
            party: { name: sharedName },
            identities: [b.stored],
          });

          // Querying with only A's key resolves to A — B's identical name never
          // makes it a candidate (no name-based match, no conflict).
          const resA = await resolveLeadByMatchKeys(db, a.input);
          expect(resA.kind).toBe("match");
          if (resA.kind === "match") {
            expect(resA.partyId).toBe(partyA.partyId);
          }

          // A brand-new, unlinked key matches no one — sharing only a name with
          // existing parties never produces a match/merge; the result is `new`.
          const fresh = buildKey(freshKind);
          const resNew = await resolveLeadByMatchKeys(db, fresh.input);
          expect(resNew.kind).toBe("new");
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("when all resolvable keys point to the SAME single party, the result is a match to that party (Req 3.1/3.4)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .subarray(ALL_KINDS, { minLength: 1, maxLength: 3 })
          .filter((ks) => ks.length > 0),
        fc.constantFrom(...NAME_POOL),
        async (kinds, name) => {
          const built = kinds.map((k) => buildKey(k));

          // One party holding every generated key.
          const party = await upsertLead(db, {
            party: { name },
            identities: built.map((b) => b.stored),
          });

          // Querying with all of them resolves (no conflict) to that one party.
          const input: MatchInput = Object.assign({}, ...built.map((b) => b.input));
          const result = await resolveLeadByMatchKeys(db, input);

          expect(result.kind).toBe("match");
          if (result.kind === "match") {
            expect(result.partyId).toBe(party.partyId);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
