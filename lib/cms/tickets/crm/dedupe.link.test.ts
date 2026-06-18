import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";

/**
 * Unit tests for the mutating link helpers in `dedupe.ts` (task 3.2):
 * `linkIdentities`, `linkSfLeadId`, and `upsertLead`.
 *
 * Exercises real SQL against pg-mem with migration 0029 (which creates
 * `parties`, `party_identities`, `leads_mirror`, `reps`). The harness mirrors
 * `lib/cms/jobs/post-call-processing.test.ts`.
 *
 * Properties covered:
 *   • linkIdentities is idempotent — re-linking adds no duplicate
 *     `(party_id, kind, value)` row (Req 2.7).
 *   • linkSfLeadId writes BOTH a `party_identities` sf_lead_id row AND
 *     `leads_mirror.sf_lead_id` (Req 2.8), and is idempotent.
 *   • upsertLead creates a new Party + mirror on `new`, reuses an existing
 *     Party on `match`, and links identities idempotently.
 */

import * as schema from "../../schema";
import { leadsMirror, parties, partyIdentities } from "../../schema";
import type { Database } from "../../db";
import {
  linkIdentities,
  linkSfLeadId,
  upsertLead,
  type MatchKey,
} from "./dedupe";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

// parties references ai_clients / ai_tenants via soft FK; stub them.
const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    // Skip statements that touch tables not relevant here and that pg-mem
    // cannot create (none expected in 0029 for our tables); let real ones run.
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

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

async function makeParty(db: Database, name = "Test"): Promise<string> {
  const [row] = await db
    .insert(parties)
    .values({ type: "person", name })
    .returning({ id: parties.id });
  return row.id;
}

async function countIdentities(
  db: Database,
  partyId: string,
  kind: MatchKey["kind"],
  value: string
): Promise<number> {
  const rows = await db
    .select({ id: partyIdentities.id })
    .from(partyIdentities)
    .where(
      and(
        eq(partyIdentities.partyId, partyId),
        eq(partyIdentities.kind, kind),
        eq(partyIdentities.value, value)
      )
    );
  return rows.length;
}

describe("dedupe link helpers (task 3.2)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  describe("linkIdentities", () => {
    it("links the supplied identities to the Party", async () => {
      const partyId = await makeParty(db);
      await linkIdentities(db, partyId, [
        { kind: "phone_hash", value: "hash-abc" },
        { kind: "email", value: "a@b.com" },
      ]);

      expect(await countIdentities(db, partyId, "phone_hash", "hash-abc")).toBe(
        1
      );
      expect(await countIdentities(db, partyId, "email", "a@b.com")).toBe(1);
    });

    it("is idempotent — re-linking adds no duplicate row (Req 2.7)", async () => {
      const partyId = await makeParty(db);
      const keys: MatchKey[] = [{ kind: "phone_hash", value: "hash-xyz" }];

      await linkIdentities(db, partyId, keys);
      await linkIdentities(db, partyId, keys);
      await linkIdentities(db, partyId, keys);

      expect(await countIdentities(db, partyId, "phone_hash", "hash-xyz")).toBe(
        1
      );
    });

    it("links the same (kind,value) to different Parties independently", async () => {
      const p1 = await makeParty(db, "One");
      const p2 = await makeParty(db, "Two");

      // Same value but different parties — both rows are legitimate.
      await linkIdentities(db, p1, [{ kind: "email", value: "shared@x.com" }]);
      await linkIdentities(db, p2, [{ kind: "email", value: "shared@x.com" }]);

      expect(await countIdentities(db, p1, "email", "shared@x.com")).toBe(1);
      expect(await countIdentities(db, p2, "email", "shared@x.com")).toBe(1);
    });
  });

  describe("linkSfLeadId", () => {
    it("writes BOTH a party_identities row AND leads_mirror.sf_lead_id (Req 2.8)", async () => {
      const partyId = await makeParty(db);
      await linkSfLeadId(db, partyId, "00Q123");

      // party_identities row of kind sf_lead_id
      expect(await countIdentities(db, partyId, "sf_lead_id", "00Q123")).toBe(
        1
      );

      // leads_mirror.sf_lead_id
      const [mirror] = await db
        .select({ sfLeadId: leadsMirror.sfLeadId })
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, partyId));
      expect(mirror?.sfLeadId).toBe("00Q123");
    });

    it("is idempotent across repeated calls", async () => {
      const partyId = await makeParty(db);
      await linkSfLeadId(db, partyId, "00Q999");
      await linkSfLeadId(db, partyId, "00Q999");

      expect(await countIdentities(db, partyId, "sf_lead_id", "00Q999")).toBe(
        1
      );

      const rows = await db
        .select({ partyId: leadsMirror.partyId })
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, partyId));
      expect(rows.length).toBe(1);
    });

    it("updates the sf_lead_id on an existing mirror row", async () => {
      const partyId = await makeParty(db);
      await linkSfLeadId(db, partyId, "00Q-old");
      await linkSfLeadId(db, partyId, "00Q-new");

      const [mirror] = await db
        .select({ sfLeadId: leadsMirror.sfLeadId })
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, partyId));
      expect(mirror?.sfLeadId).toBe("00Q-new");
    });
  });

  describe("upsertLead", () => {
    it("creates a new Party + mirror when no partyId is given (`new`)", async () => {
      const result = await upsertLead(db, {
        party: { name: "Fresh Lead" },
        identities: [{ kind: "email", value: "fresh@lead.com" }],
        mirror: { tier: "WARM", projectInterest: "Bayn" },
      });

      expect(result.created).toBe(true);
      expect(result.partyId).toBeTruthy();

      const [party] = await db
        .select({ name: parties.name })
        .from(parties)
        .where(eq(parties.id, result.partyId));
      expect(party?.name).toBe("Fresh Lead");

      const [mirror] = await db
        .select({
          tier: leadsMirror.tier,
          projectInterest: leadsMirror.projectInterest,
        })
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, result.partyId));
      expect(mirror?.tier).toBe("WARM");
      expect(mirror?.projectInterest).toBe("Bayn");

      expect(
        await countIdentities(db, result.partyId, "email", "fresh@lead.com")
      ).toBe(1);
    });

    it("reuses the existing Party when a partyId is given (`match`)", async () => {
      const partyId = await makeParty(db, "Existing");
      const result = await upsertLead(db, {
        partyId,
        mirror: { tier: "HOT" },
      });

      expect(result.created).toBe(false);
      expect(result.partyId).toBe(partyId);

      const parties_rows = await db.select({ id: parties.id }).from(parties);
      expect(parties_rows.length).toBe(1); // no extra Party created

      const [mirror] = await db
        .select({ tier: leadsMirror.tier })
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, partyId));
      expect(mirror?.tier).toBe("HOT");
    });

    it("records the Salesforce Lead id on both stores when supplied (Req 2.8)", async () => {
      const result = await upsertLead(db, {
        party: { name: "WithSf" },
        sfLeadId: "00Q-upsert",
      });

      expect(
        await countIdentities(db, result.partyId, "sf_lead_id", "00Q-upsert")
      ).toBe(1);

      const [mirror] = await db
        .select({ sfLeadId: leadsMirror.sfLeadId })
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, result.partyId));
      expect(mirror?.sfLeadId).toBe("00Q-upsert");
    });

    it("is idempotent on re-upsert against the same Party", async () => {
      const partyId = await makeParty(db, "Repeat");
      await upsertLead(db, {
        partyId,
        identities: [{ kind: "phone_hash", value: "h1" }],
        sfLeadId: "00Q-rep",
      });
      await upsertLead(db, {
        partyId,
        identities: [{ kind: "phone_hash", value: "h1" }],
        sfLeadId: "00Q-rep",
      });

      expect(await countIdentities(db, partyId, "phone_hash", "h1")).toBe(1);
      expect(await countIdentities(db, partyId, "sf_lead_id", "00Q-rep")).toBe(
        1
      );

      const mirrors = await db
        .select({ partyId: leadsMirror.partyId })
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, partyId));
      expect(mirrors.length).toBe(1);
    });
  });
});
