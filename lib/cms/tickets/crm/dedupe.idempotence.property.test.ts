import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

import * as schema from "../../schema";
import type { Database } from "../../db";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";
import {
  resolveLeadByMatchKeys,
  upsertLead,
  type MatchInput,
  type MatchKey,
} from "./dedupe";

/**
 * Property test for dedupe idempotence (task 3.3).
 *
 * **Feature: salesforce-lead-core, Property 2: For any MatchInput evaluated repeatedly against unchanged data, resolveLeadByMatchKeys returns the same result every time.**
 *
 * **Validates: Requirements 2.6**
 *
 * `resolveLeadByMatchKeys` is a read-only lookup: the same lookup input over
 * unchanged party-graph data must return the same `DedupeResult` every time —
 * the same `match` party + `sf_lead_id`, the same `conflict` candidate set, the
 * same `new`, or the same typed `error`. This test seeds an arbitrary slice of
 * the party graph (parties + their `party_identities` / `leads_mirror` rows via
 * the real `upsertLead` helper), then asserts that calling the resolver two more
 * times with NO intervening data change yields deeply-equal results.
 *
 * The resolver runs against a REAL Drizzle instance backed by an in-memory
 * Postgres (pg-mem), applying migration 0029 (which creates `parties`,
 * `party_identities`, `leads_mirror`, `reps`) statement-by-statement exactly as
 * the migration runner does — mirroring `voice/identity.property.test.ts`. The
 * full migration chain cannot be replayed under pg-mem because earlier
 * migrations enable the `vector` (pgvector) extension, so we apply only 0029
 * over minimal prerequisite stub tables for its FK targets.
 */

// `computePhoneHash` reads PHONE_HASH_SALT from the environment; set a stable
// test salt so hashing is deterministic across the suite.
process.env.PHONE_HASH_SALT ??= "dedupe-idempotence-test-salt";

// ≥100 iterations as mandated for the non-optional dedupe property. Each
// generated case stands up a fresh in-memory DB, so the seeded graph per run is
// kept small for speed.
const NUM_RUNS = 100;

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Tables migration 0029 references via FK but does not itself create. Stubbed in
// their minimal shape so 0029's ADD CONSTRAINT statements resolve cleanly.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

/** Split a Drizzle migration into individual statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Stand up a fresh in-memory Postgres with migration 0029 applied and return a
 * Drizzle handle (shaped like the production `Database`) bound to it. Uses
 * Drizzle's pg-proxy driver over pg-mem (node-postgres' type parsing + array
 * row-mode are rejected by pg-mem); the proxy lets Drizzle's generated SQL run
 * straight against pg-mem and shape results ourselves.
 */
function buildDedupeDb(): { db: Database; mem: IMemoryDb } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  const { Client } = mem.adapters.createPg();
  const client = new Client();

  const executor = async (
    sql: string,
    params: unknown[],
    method: "all" | "execute"
  ): Promise<{ rows: unknown[] }> => {
    const res = await client.query({ text: sql, values: params });
    const objectRows = (res.rows ?? []) as Record<string, unknown>[];
    return {
      rows:
        method === "all"
          ? objectRows.map((row) => Object.values(row))
          : objectRows,
    };
  };

  const db = drizzle(executor as never, { schema }) as unknown as Database;

  return { db, mem };
}

// ── Identity pools ───────────────────────────────────────────────────────────
//
// A fixed pool of DISTINCT identity triples. Each value (phone/email/sfLeadId)
// is unique to its slot, so any identity value maps to at most one Party — the
// realistic conservative-dedupe invariant. Pool slots beyond the seeded count
// are deliberate "misses" (resolve to no Party). Combining identities from
// different seeded slots in one lookup is what produces a `conflict`.
const POOL_SIZE = 8;
const poolPhone = (i: number) => `+9715${String(1000000 + i).padStart(7, "0")}`;
const poolEmail = (i: number) => `person${i}@example.com`; // already normalized
const poolSfId = (i: number) => `00Q00000000${i}AAA`;

/** Optional pool index in [0, POOL_SIZE) or `undefined` (field absent). */
const optionalPoolIndex = fc.option(
  fc.integer({ min: 0, max: POOL_SIZE - 1 }),
  { nil: undefined }
);

describe("resolveLeadByMatchKeys — Property 2: dedupe idempotence (Req 2.6)", () => {
  it("returns the same result every time for the same MatchInput over unchanged data", async () => {
    await fc.assert(
      fc.asyncProperty(
        // How many pool slots are seeded as real parties (0..6). Slots >= this
        // count are never seeded → guaranteed lookup misses.
        fc.integer({ min: 0, max: 6 }),
        // For each seeded slot, whether it also carries a linked sf_lead_id.
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        // The lookup input: each Match_Key is an optional pool index.
        fc.record({
          phoneIdx: optionalPoolIndex,
          emailIdx: optionalPoolIndex,
          sfIdx: optionalPoolIndex,
        }),
        async (seedCount, withSfFlags, lookup) => {
          const { db } = buildDedupeDb();

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

          // Build the lookup input from the (possibly unseeded) pool slots.
          const input: MatchInput = {};
          if (lookup.phoneIdx !== undefined)
            input.phone = poolPhone(lookup.phoneIdx);
          if (lookup.emailIdx !== undefined)
            input.email = poolEmail(lookup.emailIdx);
          if (lookup.sfIdx !== undefined)
            input.sfLeadId = poolSfId(lookup.sfIdx);

          // The property: repeated evaluation over unchanged data is stable.
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
