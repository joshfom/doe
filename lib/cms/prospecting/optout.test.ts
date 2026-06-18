import { describe, it, expect, beforeEach } from "vitest";
import { newDb, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

import type { Database } from "../db";
import * as schema from "../schema";
import { isOptedOut, recordOptout, removeOptout } from "./optout";

/**
 * Unit tests for the prospecting opt-out / do-not-contact store (task 2.3).
 *
 * Exercises `isOptedOut` / `recordOptout` / `removeOptout` against real SQL
 * (pg-mem) using the `prospect_optouts` DDL from migration 0038. The table has
 * no foreign keys, so it is stood up standalone with its unique
 * `(match_kind, match_value)` index.
 *
 * pg-mem harness mirrors the node-postgres adapter pattern used across
 * `lib/cms/**` tests.
 */

const PROSPECT_OPTOUTS_DDL = `
  CREATE TABLE "prospect_optouts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "match_kind" text NOT NULL,
    "match_value" text NOT NULL,
    "reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "prospect_optouts_match_ux"
    ON "prospect_optouts" ("match_kind", "match_value");
`;

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  // pg-mem does not ship `gen_random_uuid()`; register it so DEFAULTs resolve.
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });

  mem.public.none(PROSPECT_OPTOUTS_DDL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, but honour drizzle's positional row mapping
  // by converting rows to arrays when `rowMode: "array"` was requested.
  const originalQuery = pool.query.bind(pool);
  pool.query = ((config: unknown, values?: unknown, cb?: unknown) => {
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
  }) as typeof pool.query;

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
}

describe("prospecting opt-out store", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("returns false for keys with no recorded opt-out", async () => {
    expect(
      await isOptedOut(db, { emailHash: "nobody@example.com" })
    ).toBe(false);
    expect(await isOptedOut(db, { phoneHash: "deadbeef" })).toBe(false);
  });

  it("matches a recorded email opt-out (normalized)", async () => {
    await recordOptout(db, { emailHash: "  Jane.Doe@Example.COM  " });

    // Stored normalized → matched regardless of caller casing/whitespace.
    expect(await isOptedOut(db, { emailHash: "jane.doe@example.com" })).toBe(
      true
    );
    expect(await isOptedOut(db, { emailHash: "JANE.DOE@EXAMPLE.COM" })).toBe(
      true
    );
    expect(await isOptedOut(db, { emailHash: "someone@else.com" })).toBe(false);
  });

  it("matches a recorded phone-hash opt-out verbatim", async () => {
    await recordOptout(db, { phoneHash: "abc123hash" });

    expect(await isOptedOut(db, { phoneHash: "abc123hash" })).toBe(true);
    expect(await isOptedOut(db, { phoneHash: "other" })).toBe(false);
  });

  it("matches when ANY supplied key is opted out", async () => {
    await recordOptout(db, { phoneHash: "phash" });

    // email not opted out, but phone is → true.
    expect(
      await isOptedOut(db, { emailHash: "ok@example.com", phoneHash: "phash" })
    ).toBe(true);
  });

  it("records email and phone keys as separate rows", async () => {
    await recordOptout(db, {
      emailHash: "lead@example.com",
      phoneHash: "phash",
    });

    const rows = await db
      .select({ matchKind: schema.prospectOptouts.matchKind })
      .from(schema.prospectOptouts);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.matchKind).sort()).toEqual([
      "email",
      "phone_hash",
    ]);
  });

  it("is idempotent — recording the same opt-out twice adds no duplicate", async () => {
    await recordOptout(db, { emailHash: "dupe@example.com" });
    await recordOptout(db, { emailHash: "DUPE@example.com" }, "unsubscribed");

    const rows = await db
      .select({ reason: schema.prospectOptouts.reason })
      .from(schema.prospectOptouts);
    expect(rows).toHaveLength(1);
    // The supplied reason refreshed the existing row.
    expect(rows[0].reason).toBe("unsubscribed");
    expect(await isOptedOut(db, { emailHash: "dupe@example.com" })).toBe(true);
  });

  it("preserves an existing reason when re-recorded without one", async () => {
    await recordOptout(db, { phoneHash: "phash" }, "manual block");
    await recordOptout(db, { phoneHash: "phash" }); // no reason

    const rows = await db
      .select({ reason: schema.prospectOptouts.reason })
      .from(schema.prospectOptouts);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("manual block");
  });

  it("removes an opt-out so it no longer matches", async () => {
    await recordOptout(db, { emailHash: "gone@example.com" });
    expect(await isOptedOut(db, { emailHash: "gone@example.com" })).toBe(true);

    await removeOptout(db, { emailHash: "GONE@example.com" });
    expect(await isOptedOut(db, { emailHash: "gone@example.com" })).toBe(false);
  });

  it("removeOptout is a no-op for an absent opt-out", async () => {
    await expect(
      removeOptout(db, { emailHash: "never@example.com" })
    ).resolves.toBeUndefined();
  });

  it("treats empty/blank keys as matching nothing", async () => {
    await recordOptout(db, { emailHash: "real@example.com" });

    expect(await isOptedOut(db, {})).toBe(false);
    expect(await isOptedOut(db, { emailHash: "   " })).toBe(false);
    expect(await isOptedOut(db, { phoneHash: "" })).toBe(false);

    // recordOptout with no usable keys writes nothing.
    await recordOptout(db, {});
    await recordOptout(db, { emailHash: "  " });
    const rows = await db
      .select({ id: schema.prospectOptouts.id })
      .from(schema.prospectOptouts);
    expect(rows).toHaveLength(1); // only the real one above
  });
});
