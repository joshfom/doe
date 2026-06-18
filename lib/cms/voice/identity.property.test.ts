import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/pg-proxy";
import fc from "fast-check";

import * as schema from "../schema";
import { partyIdentities } from "../schema";
import type { Database } from "../db";
import {
  normalizePhoneToE164,
  computePhoneHash,
  resolveParty,
  DEFAULT_COUNTRY_CODE,
} from "./identity";

/**
 * Unit + property tests for the DOE voice identity module (task 6.3).
 *
 *   Unit — `normalizePhoneToE164` maps arbitrary free-form input to E.164 with
 *     the +971 (UAE) default-region behaviour (Requirement 3.2).
 *
 *   Property 9 — Phone privacy: `party_identities` stores the phone ONLY as a
 *     salted `phone_hash` (64-char hex); the raw E.164 number never appears in
 *     any `party_identities` value, and the stored hash equals
 *     `computePhoneHash(e164, salt)`. Re-resolving the same caller is
 *     idempotent — no duplicate identity rows (Requirement 14.5).
 *
 * **Validates: Requirements 14.5, 3.2**
 *
 * The privacy property runs `resolveParty` against a REAL Drizzle instance
 * backed by an in-memory Postgres (pg-mem), applying migration 0029
 * statement-by-statement exactly as the migration runner does (mirroring
 * events.property.test.ts / schema.migration.test.ts). pg-mem ships no
 * `gen_random_uuid()`, so it is registered. `resolveParty` does plain
 * inserts/selects (no transaction / NOTIFY), so no transaction shim is needed.
 */

// Reduced fast-check budget — the privacy property stands up a fresh in-memory
// DB per generated case, so keep run counts and sequence sizes small for speed.
const NUM_RUNS = 25;
const MAX_SEQUENCE = 8;

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// Pre-existing tables migration 0029 ALTERs / references. `resolveParty` calls
// `resolveIdentityByEmail`, which reads `email` / `first_name` from these — so
// they carry those columns and resolve cleanly to "visitor" (no soft link).
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" text,
    "first_name" text
  );
  CREATE TABLE "ai_tenants"  (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" text,
    "first_name" text
  );
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
function buildIdentityDb(): { db: Database; mem: IMemoryDb } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationPath = join(process.cwd(), "drizzle", MIGRATION_FILE);
  const migrationSql = readFileSync(migrationPath, "utf-8");
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

/** Read every persisted party_identities row as plain objects. */
async function readAllIdentities(db: Database) {
  return db
    .select({
      id: partyIdentities.id,
      partyId: partyIdentities.partyId,
      kind: partyIdentities.kind,
      value: partyIdentities.value,
    })
    .from(partyIdentities);
}

// ── Unit: normalizePhoneToE164 (Requirement 3.2) ─────────────────────────────

describe("normalizePhoneToE164 — E.164 normalisation with +971 default (Req 3.2)", () => {
  const cases: Array<[string, string]> = [
    // National trunk-prefixed local numbers → +971, leading 0 dropped.
    ["050 123 4567", "+971501234567"],
    ["0501234567", "+971501234567"],
    ["(050) 123-4567", "+971501234567"],
    ["050-123-4567", "+971501234567"],
    ["050.123.4567", "+971501234567"],
    // Already E.164 — kept verbatim (punctuation stripped).
    ["+971501234567", "+971501234567"],
    ["+971 50 123 4567", "+971501234567"],
    // International access-code form (00) → drop 00, keep country code.
    ["00971501234567", "+971501234567"],
    ["0097150 123 4567", "+971501234567"],
    // Bare local number with no prefix → default country code prepended.
    ["501234567", "+971501234567"],
    ["50 123 4567", "+971501234567"],
    // Bare digits already including the country code.
    ["971501234567", "+971501234567"],
    // A different explicit country code is preserved.
    ["+14155552671", "+14155552671"],
  ];

  it.each(cases)("normalises %j to %j", (input, expected) => {
    expect(normalizePhoneToE164(input)).toBe(expected);
  });

  it("defaults the country code to UAE (+971)", () => {
    expect(DEFAULT_COUNTRY_CODE).toBe("971");
    expect(normalizePhoneToE164("501234567")).toMatch(/^\+971/);
  });

  it("honours an explicit defaultCountryCode override for local numbers", () => {
    expect(
      normalizePhoneToE164("501234567", { defaultCountryCode: "44" })
    ).toBe("+44501234567");
  });

  const invalid: Array<[string, string]> = [
    ["empty string", ""],
    ["whitespace only", "   "],
    ["punctuation only (no digits)", "()- ."],
    ["too short", "+12345"],
    ["too long", "+1234567890123456"],
  ];

  it.each(invalid)("throws on invalid input: %s", (_label, input) => {
    expect(() => normalizePhoneToE164(input)).toThrow();
  });

  it("property: any local digit string (no country code) normalises to +971…", () => {
    // Local numbers: first digit 1–8 (never 0 → no trunk prefix; never 9 → can
    // never coincidentally form a "971" country-code prefix), 7–8 more digits.
    const localDigits = fc
      .tuple(
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 7, maxLength: 8 })
      )
      .map(([first, rest]) => `${first}${rest.join("")}`);

    fc.assert(
      fc.property(localDigits, (digits) => {
        const e164 = normalizePhoneToE164(digits);
        expect(e164).toMatch(/^\+\d{8,15}$/);
        expect(e164.startsWith("+971")).toBe(true);
        // The local digits are preserved verbatim after the +971 prefix.
        expect(e164).toBe(`+971${digits}`);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Property 9: phone privacy (Requirement 14.5) ─────────────────────────────

const TEST_PHONE_HASH_SALT = "doe-voice-test-salt";

describe("resolveParty — Property 9: phone privacy (Req 14.5)", () => {
  it("party_identities stores only the salted phone_hash; raw phone never persisted; re-resolution is idempotent", async () => {
    // Small pools so the same caller recurs → exercises idempotent
    // re-resolution and cross-identity matching (same phone/new email, etc.).
    const phonePool = [
      "+971501234567",
      "+971502223344",
      "+971559876543",
      "+14155552671",
    ];
    const emailPool = [
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
      "dave@example.com",
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            phone: fc.constantFrom(...phonePool),
            email: fc.constantFrom(...emailPool),
            name: fc.option(fc.string({ minLength: 1, maxLength: 16 }), {
              nil: undefined,
            }),
          }),
          { minLength: 1, maxLength: MAX_SEQUENCE }
        ),
        async (callers) => {
          const { db } = buildIdentityDb();

          const rawPhones = new Set<string>();

          for (const c of callers) {
            rawPhones.add(c.phone);
            const result = await resolveParty(db, {
              e164: c.phone,
              email: c.email,
              name: c.name,
              salt: TEST_PHONE_HASH_SALT,
            });
            // The result surfaces the salted hash, never the raw number.
            expect(result.phoneHash).toMatch(/^[0-9a-f]{64}$/);
            expect(result.phoneHash).toBe(
              computePhoneHash(c.phone, TEST_PHONE_HASH_SALT)
            );
          }

          const rows = await readAllIdentities(db);

          for (const row of rows) {
            // (a) phone_hash rows hold ONLY a 64-char hex hash …
            if (row.kind === "phone_hash") {
              expect(row.value).toMatch(/^[0-9a-f]{64}$/);
            }
            // (b) … and no raw phone ever appears in ANY identity value.
            for (const raw of rawPhones) {
              expect(row.value).not.toContain(raw);
            }
          }

          // (c) each persisted phone_hash equals computePhoneHash(e164, salt).
          const validHashes = new Set(
            [...rawPhones].map((p) =>
              computePhoneHash(p, TEST_PHONE_HASH_SALT)
            )
          );
          for (const row of rows) {
            if (row.kind === "phone_hash") {
              expect(validHashes.has(row.value)).toBe(true);
            }
          }

          // Idempotent re-resolution: no duplicate (partyId, kind, value) rows.
          const seen = new Set<string>();
          for (const row of rows) {
            const key = `${row.partyId}|${row.kind}|${row.value}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("links a known caller's new email onto the party matched by phone_hash (no duplicate phone_hash)", async () => {
    const { db } = buildIdentityDb();
    const phone = "+971501234567";

    const first = await resolveParty(db, {
      e164: phone,
      email: "first@example.com",
      salt: TEST_PHONE_HASH_SALT,
    });
    expect(first.known).toBe(false);

    // Same phone, different email → matches by phone_hash, links the new email.
    const second = await resolveParty(db, {
      e164: phone,
      email: "second@example.com",
      salt: TEST_PHONE_HASH_SALT,
    });
    expect(second.known).toBe(true);
    expect(second.partyId).toBe(first.partyId);

    const rows = await readAllIdentities(db);
    const phoneHashRows = rows.filter(
      (r) => r.partyId === first.partyId && r.kind === "phone_hash"
    );
    const emailRows = rows.filter(
      (r) => r.partyId === first.partyId && r.kind === "email"
    );

    // Exactly one phone_hash (no duplicate) and both emails linked.
    expect(phoneHashRows).toHaveLength(1);
    expect(phoneHashRows[0].value).toBe(
      computePhoneHash(phone, TEST_PHONE_HASH_SALT)
    );
    expect(emailRows.map((r) => r.value).sort()).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
    // And nowhere is the raw phone stored.
    for (const row of rows) {
      expect(row.value).not.toContain(phone);
    }
  });
});
