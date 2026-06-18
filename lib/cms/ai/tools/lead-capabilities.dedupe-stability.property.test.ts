import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import fc from "fast-check";

/**
 * Property test for lead-engine dedupe stability (task 4.3).
 *
 *   **Feature: lead-engine, Property 4: Resolving the same parsed lead over
 *   unchanged data returns the same DedupeResult each time.**
 *
 * **Validates: Requirements 5.6**
 *
 * The lead-engine resolution step does not re-implement identity resolution —
 * the `record_inbound_lead` capability (`lib/cms/ai/tools/lead-capabilities.ts`)
 * resolves a parsed lead's contact identity by passing its `{ phone, email,
 * sfLeadId }` straight through to the reused S2 `resolveLeadByMatchKeys`
 * (`lib/cms/tickets/crm/dedupe.ts`). That read-only lookup is the only thing
 * that decides `match` / `new` / `conflict` / `error`. Requirement 5.6 demands
 * that resolving the SAME parsed lead against UNCHANGED data returns the SAME
 * `DedupeResult` every time — the same `match` party + `sf_lead_id`, the same
 * `conflict` candidate set, the same `new`, or the same typed `error`.
 *
 * This test stands up an arbitrary slice of the party graph (parties + their
 * `party_identities` / `leads_mirror` rows via the real `upsertLead` helper),
 * builds a parsed-lead identity exactly the way `record_inbound_lead` forwards
 * it into the resolver, then asserts that resolving it three times with NO
 * intervening data change yields deeply-equal results — order-stable and
 * idempotent (Req 5.6).
 *
 * ── Harness ──────────────────────────────────────────────────────────────────
 *
 * `pg-mem` (node-postgres adapter) with migrations `0029` (parties /
 * party_identities / leads_mirror / reps …) and `0036` (inbound_leads) applied
 * statement-by-statement over stub FK tables — mirroring the sibling
 * `lead-capabilities.resolution.test.ts`. `gen_random_uuid` / `pg_notify` are
 * stubbed (pg-mem ships neither). The resolver runs against the REAL Drizzle
 * instance; nothing is mocked.
 */

// `computePhoneHash` reads PHONE_HASH_SALT from the environment; set a stable
// test salt so hashing is deterministic across the suite.
process.env.PHONE_HASH_SALT ??= "lead-dedupe-stability-test-salt";

// Property 4 is NOT in the non-optional set (P1, P2, P5, P7, P8, P10, P11), so a
// reduced run count keeps local runs fast while still exercising a broad input
// space. Override with PBT_NUM_RUNS for a deeper sweep — CI sets it to >=100.
const NUM_RUNS = Number(process.env.PBT_NUM_RUNS ?? 10);

const MIGRATIONS = ["0029_demonic_mandrill.sql", "0036_inbound_leads.sql"];

// Migration 0029 ALTERs / references these pre-existing tables; stub them so it
// applies cleanly under pg-mem.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

import * as schema from "../../schema";
import type { Database } from "../../db";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";
import {
  resolveLeadByMatchKeys,
  upsertLead,
  type MatchInput,
  type MatchKey,
} from "../../tickets/crm/dedupe";

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .flatMap((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .split(";")
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Stand up pg-mem with 0029 + 0036 applied and a drizzle handle bound to it. */
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

  for (const file of MIGRATIONS) {
    const migrationSql = readFileSync(
      join(process.cwd(), "drizzle", file),
      "utf-8"
    );
    for (const stmt of splitStatements(migrationSql)) {
      mem.public.none(stmt);
    }
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both and convert object rows back to positional
  // arrays when drizzle asked for array mode.
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

/**
 * Build the resolver input exactly the way `record_inbound_lead` forwards a
 * parsed lead's identity — its `{ phone, email, sfLeadId }` passed straight
 * through to `resolveLeadByMatchKeys` (no re-implementation).
 */
function parsedLeadMatchInput(lead: {
  phone?: string;
  email?: string;
  sfLeadId?: string;
}): MatchInput {
  const input: MatchInput = {};
  if (lead.phone !== undefined) input.phone = lead.phone;
  if (lead.email !== undefined) input.email = lead.email;
  if (lead.sfLeadId !== undefined) input.sfLeadId = lead.sfLeadId;
  return input;
}

// ── Identity pools ───────────────────────────────────────────────────────────
//
// A fixed pool of DISTINCT identity triples. Each value (phone/email/sfLeadId)
// is unique to its slot, so any identity value maps to at most one Party. Pool
// slots beyond the seeded count are deliberate "misses" (resolve to no Party);
// combining identities from different seeded slots in one lookup is what yields
// a `conflict`.
const POOL_SIZE = 8;
const poolPhone = (i: number) => `+9715${String(1000000 + i).padStart(7, "0")}`;
const poolEmail = (i: number) => `lead${i}@example.com`; // already normalized
const poolSfId = (i: number) => `00Q00000000${i}AAA`;

/** Optional pool index in [0, POOL_SIZE) or `undefined` (field absent). */
const optionalPoolIndex = fc.option(
  fc.integer({ min: 0, max: POOL_SIZE - 1 }),
  { nil: undefined }
);

describe("record_inbound_lead resolution — Property 4: dedupe stability (Req 5.6)", () => {
  it("resolving the same parsed lead over unchanged data returns the same DedupeResult each time", async () => {
    await fc.assert(
      fc.asyncProperty(
        // How many pool slots are seeded as real parties (0..6). Slots >= this
        // count are never seeded → guaranteed lookup misses.
        fc.integer({ min: 0, max: 6 }),
        // For each seeded slot, whether it also carries a linked sf_lead_id.
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        // The parsed-lead identity: each Match_Key is an optional pool index.
        fc.record({
          phoneIdx: optionalPoolIndex,
          emailIdx: optionalPoolIndex,
          sfIdx: optionalPoolIndex,
        }),
        async (seedCount, withSfFlags, parsed) => {
          const { db } = buildDb();

          // Seed `seedCount` distinct parties, each with a unique phone_hash and
          // email identity, optionally a linked sf_lead_id + leads_mirror row.
          for (let i = 0; i < seedCount; i++) {
            const e164 = normalizePhoneToE164(poolPhone(i));
            const identities: MatchKey[] = [
              { kind: "phone_hash", value: computePhoneHash(e164) },
              { kind: "email", value: poolEmail(i) },
            ];
            await upsertLead(db, {
              party: { type: "person", demo: true },
              identities,
              sfLeadId: withSfFlags[i] ? poolSfId(i) : undefined,
            });
          }

          // Build the parsed lead's identity from the (possibly unseeded) slots,
          // then forward it the way record_inbound_lead does.
          const lead: { phone?: string; email?: string; sfLeadId?: string } = {};
          if (parsed.phoneIdx !== undefined) lead.phone = poolPhone(parsed.phoneIdx);
          if (parsed.emailIdx !== undefined) lead.email = poolEmail(parsed.emailIdx);
          if (parsed.sfIdx !== undefined) lead.sfLeadId = poolSfId(parsed.sfIdx);
          const input = parsedLeadMatchInput(lead);

          // The property: repeated resolution over unchanged data is stable —
          // same kind, same partyId / candidate set, every time (Req 5.6).
          const first = await resolveLeadByMatchKeys(db, input);
          const second = await resolveLeadByMatchKeys(db, input);
          const third = await resolveLeadByMatchKeys(db, input);

          expect(second).toEqual(first);
          expect(third).toEqual(first);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
