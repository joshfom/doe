// `computePhoneHash` (reached by the pre-emit guard) reads PHONE_HASH_SALT at
// call time; set a stable salt so the emitted hash is deterministic.
process.env.PHONE_HASH_SALT ??= "prospecting-phone-smoke-test-salt";

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "../schema";
import { targets, sfOutbox } from "../schema";
import type { Database } from "../db";
import { purgeTargetPhones, redactPhonesForEmit } from "./phone";
import { isPhoneShaped } from "../crm/phone-privacy";

/**
 * Lean unit smoke test for the Target raw-phone privacy guards (task 8.1).
 * The exhaustive coverage lives in the Property 8 test (task 8.2); this only
 * confirms the two primitives behave on representative inputs.
 */

// Minimal DDL — only the two tables the purge sweep touches.
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
  rawPhone: string | null
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
    jobKey: `lead:${partyId}`,
    payload: { partyId, sObject: "Lead" },
    status: "sent",
    updatedAt,
  });
}

describe("redactPhonesForEmit", () => {
  it("replaces a raw phone with its salted hash and preserves ids/UUIDs", () => {
    const uuid = randomUUID();
    const payload = {
      partyId: uuid,
      note: "call me on +971 50 123 4567 tomorrow",
      phone: "+971501234567",
      count: 7,
    };

    const redacted = redactPhonesForEmit(payload);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("+971501234567");
    expect(serialized).not.toContain("971501234567");
    expect(serialized).toContain("phone_hash:");
    // Non-phone leaves are untouched.
    expect(serialized).toContain(uuid);
    expect(redacted.count).toBe(7);
    // The input is never mutated.
    expect(payload.phone).toBe("+971501234567");
  });

  it("leaves a payload with no raw phone unchanged in substance", () => {
    const payload = { id: randomUUID(), phone_hash: "deadbeefcafe1234", n: 3 };
    const redacted = redactPhonesForEmit(payload);
    expect(redacted).toEqual(payload);
    expect(isPhoneShaped(JSON.stringify(redacted))).toBe(false);
  });
});

describe("purgeTargetPhones", () => {
  it("clears raw_phone only for targets forwarded ≥24h ago, and is idempotent", async () => {
    const db = buildDb();
    const now = new Date("2026-02-01T00:00:00Z");

    // Old forward (>24h) → should be purged.
    const oldParty = randomUUID();
    const oldTarget = await seedTarget(db, oldParty, "+971500000001");
    await seedDeliveredForward(
      db,
      oldParty,
      new Date(now.getTime() - 25 * 60 * 60 * 1000)
    );

    // Recent forward (<24h) → retained.
    const freshParty = randomUUID();
    const freshTarget = await seedTarget(db, freshParty, "+971500000002");
    await seedDeliveredForward(
      db,
      freshParty,
      new Date(now.getTime() - 1 * 60 * 60 * 1000)
    );

    // Never forwarded (no outbox row) → retained.
    const neverParty = randomUUID();
    const neverTarget = await seedTarget(db, neverParty, "+971500000003");

    const result = await purgeTargetPhones(db, now);
    expect(result.purged).toBe(1);

    const read = async (id: string) =>
      (
        await db
          .select({ rawPhone: targets.rawPhone })
          .from(targets)
          .where(eq(targets.id, id))
      )[0].rawPhone;

    expect(await read(oldTarget)).toBeNull();
    expect(await read(freshTarget)).toBe("+971500000002");
    expect(await read(neverTarget)).toBe("+971500000003");

    // Re-running is a no-op (nothing left to clear for the old forward).
    const second = await purgeTargetPhones(db, now);
    expect(second.purged).toBe(0);
  });
});
