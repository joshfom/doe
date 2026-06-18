import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Unit tests for the lead-engine resolution branches and the no-eligible-rep
 * path (task 4.4).
 *
 * Exercises the two distribution capabilities' HANDLER CONTRACTS directly,
 * against real SQL over pg-mem:
 *
 *   - `record_inbound_lead` — the four dedupe resolutions:
 *       • `match`    → attach to the matched Party (NO new Lead created),
 *                      publish `lead.resolved` (Req 5.2);
 *       • `new`      → create a Party + `leads_mirror` row, publish
 *                      `lead.resolved` (Req 5.3);
 *       • `conflict` → attach NOTHING, create no Party, publish `lead.conflict`
 *                      (and NOT `lead.resolved`) for human resolution (Req 5.4);
 *       • `error`    → create no Party, attach nothing, publish neither a
 *                      resolved nor a conflict event (Req 5.5).
 *   - `assign_lead_owner` — the no-eligible-rep path: with no project × language
 *       × capacity match, assign no owner, leave `leads_mirror.assigned_rep_id`
 *       null, and record `lead.unrouted` with the excluding rule (Req 6.6); and
 *       a persistence failure leaves the prior owner unchanged (Req 6.4).
 *
 * LAYERING NOTE (per the design's §Components #4/#5 and §Error Handling table).
 * The catalog handlers are the "execute" step only — they resolve identity,
 * create/attach the Lead, and publish lifecycle events. The Intake_Status
 * transitions the task description references (conflict/error → `queued`) are
 * driven by the intake WORKFLOW (task 5.6), not inside these handlers: neither
 * `record_inbound_lead` nor `assign_lead_owner` writes `inbound_leads.status`.
 * These tests therefore assert the HANDLER contract — the resolution result,
 * the create/attach side effects, and the published events — and additionally
 * assert that the handler leaves `inbound_leads.status` untouched on the
 * conflict/error branches (the workflow owns the `queued` transition).
 *
 * Harness mirrors `lib/cms/jobs/side-effect-idempotency.test.ts` and
 * `lib/cms/tickets/crm/dedupe.link.test.ts`: migration 0029 stands up the real
 * `parties` / `party_identities` / `leads_mirror` / `reps` / `events` tables,
 * then migration 0036 adds the `inbound_leads` intake ledger. `gen_random_uuid`
 * and `pg_notify` are stubbed (pg-mem ships neither).
 *
 * Design references: §Components #4, #5, §Error Handling.
 * Requirements: 5.2, 5.3, 5.4, 5.5, 6.4, 6.6.
 */

import * as schema from "../../schema";
import {
  events,
  inboundLeads,
  leadsMirror,
  parties,
  partyIdentities,
  reps,
} from "../../schema";
import type { Database } from "../../db";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";
import {
  leadCapabilityEntries,
  LEAD_DISTRIBUTION_AGENT_ACTOR,
} from "./lead-capabilities";
import type { CatalogEntry } from "./catalog";
import type { ToolContext } from "./registry";

// `resolveLeadByMatchKeys` / `buildMatchKeys` hash a present phone via
// computePhoneHash, which reads PHONE_HASH_SALT from the environment.
process.env.PHONE_HASH_SALT ??= "lead-resolution-test-salt";

const MIGRATIONS = ["0029_demonic_mandrill.sql", "0036_inbound_leads.sql"];

// Migration 0029 ALTERs these pre-existing tables; stub them so it applies.
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
  // `rowMode: "array"` that this drizzle version sends; strip both and convert
  // object rows back to positional arrays when drizzle asked for array mode.
  // Patching the Pool also covers the transaction path publishEvent uses.
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

// ── Capability handles ────────────────────────────────────────────────────────

function capability(name: string): CatalogEntry {
  const e = leadCapabilityEntries.find((c) => c.name === name);
  if (!e) throw new Error(`capability "${name}" not found`);
  return e;
}

const recordInboundLead = capability("record_inbound_lead");
const assignLeadOwner = capability("assign_lead_owner");

const CTX: ToolContext = { actor: LEAD_DISTRIBUTION_AGENT_ACTOR };

// ── Fixtures ────────────────────────────────────────────────────────────────

async function makeParty(
  db: Database,
  fields: { name?: string; language?: "en" | "ar" } = {}
): Promise<string> {
  const [row] = await db
    .insert(parties)
    .values({
      type: "person",
      name: fields.name ?? "Test",
      language: fields.language ?? "en",
    })
    .returning({ id: parties.id });
  return row.id;
}

async function linkIdentity(
  db: Database,
  partyId: string,
  kind: "phone_hash" | "email" | "sf_lead_id",
  value: string
): Promise<void> {
  await db.insert(partyIdentities).values({ partyId, kind, value });
}

async function makeInbound(db: Database): Promise<string> {
  const [row] = await db
    .insert(inboundLeads)
    .values({
      source: "web_form",
      idempotencyKey: `idem-${randomUUID()}`,
      status: "parsed", // resolution runs after the lead reaches `parsed`
    })
    .returning({ id: inboundLeads.id });
  return row.id;
}

async function makeRep(
  db: Database,
  fields: {
    name: string;
    languages: string[];
    projects: string[];
    capacity?: number;
    openHotCount?: number;
  }
): Promise<string> {
  const [row] = await db
    .insert(reps)
    .values({
      name: fields.name,
      languages: fields.languages,
      projects: fields.projects,
      capacity: fields.capacity ?? 3,
      openHotCount: fields.openHotCount ?? 0,
    })
    .returning({ id: reps.id });
  return row.id;
}

async function countParties(db: Database): Promise<number> {
  const rows = await db.select({ id: parties.id }).from(parties);
  return rows.length;
}

async function eventsOfType(db: Database, type: string): Promise<unknown[]> {
  const rows = await db
    .select({ payload: events.payload })
    .from(events)
    .where(eq(events.type, type));
  return rows.map((r) => r.payload);
}

async function inboundRow(db: Database, id: string) {
  const [row] = await db
    .select({ partyId: inboundLeads.partyId, status: inboundLeads.status })
    .from(inboundLeads)
    .where(eq(inboundLeads.id, id))
    .limit(1);
  return row;
}

async function assignedRep(
  db: Database,
  partyId: string
): Promise<string | null> {
  const [row] = await db
    .select({ assignedRepId: leadsMirror.assignedRepId })
    .from(leadsMirror)
    .where(eq(leadsMirror.partyId, partyId))
    .limit(1);
  return row?.assignedRepId ?? null;
}

// ── record_inbound_lead — resolution branches (Req 5.2–5.5) ───────────────────

describe("record_inbound_lead — resolution branches (Req 5.2, 5.3, 5.4, 5.5)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("new → creates a Party + leads_mirror and publishes lead.resolved (Req 5.3)", async () => {
    const inboundId = await makeInbound(db);
    const before = await countParties(db);

    const result = (await recordInboundLead.handler(db, CTX, {
      inboundId,
      email: "fresh@lead.com",
    })) as { resolution: string; partyId: string | null };

    expect(result.resolution).toBe("new");
    expect(result.partyId).toBeTruthy();

    // A NEW Party was created (Req 5.3).
    expect(await countParties(db)).toBe(before + 1);

    // The Lead is parties + leads_mirror — the mirror row exists.
    const [mirror] = await db
      .select({ partyId: leadsMirror.partyId })
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, result.partyId!));
    expect(mirror?.partyId).toBe(result.partyId);

    // The inbound ledger row is linked to the resolved Party.
    expect((await inboundRow(db, inboundId)).partyId).toBe(result.partyId);

    // lead.resolved published with created: true; no conflict.
    const resolved = (await eventsOfType(db, "lead.resolved")) as Array<{
      inboundId: string;
      partyId: string;
      created: boolean;
    }>;
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ inboundId, created: true });
    expect(await eventsOfType(db, "lead.conflict")).toHaveLength(0);
  });

  it("match → attaches to the matched Party WITHOUT creating a new Lead and publishes lead.resolved (Req 5.2)", async () => {
    const existing = await makeParty(db, { name: "Existing" });
    await linkIdentity(db, existing, "email", "match@lead.com");
    const inboundId = await makeInbound(db);
    const before = await countParties(db);

    const result = (await recordInboundLead.handler(db, CTX, {
      inboundId,
      email: "match@lead.com",
    })) as { resolution: string; partyId: string | null };

    expect(result.resolution).toBe("match");
    expect(result.partyId).toBe(existing);

    // NO new Party created — the inbound lead attached to the existing one.
    expect(await countParties(db)).toBe(before);

    // Inbound ledger linked to the matched Party.
    expect((await inboundRow(db, inboundId)).partyId).toBe(existing);

    const resolved = (await eventsOfType(db, "lead.resolved")) as Array<{
      inboundId: string;
      partyId: string;
      created: boolean;
    }>;
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      inboundId,
      partyId: existing,
      created: false,
    });
  });

  it("conflict → attaches nothing, creates no Party, publishes lead.conflict (not lead.resolved) (Req 5.4)", async () => {
    // Two distinct Parties resolved by two distinct match keys → conflict.
    const phone = "+971501234567";
    const partyByPhone = await makeParty(db, { name: "ByPhone" });
    await linkIdentity(
      db,
      partyByPhone,
      "phone_hash",
      computePhoneHash(normalizePhoneToE164(phone))
    );
    const partyByEmail = await makeParty(db, { name: "ByEmail" });
    await linkIdentity(db, partyByEmail, "email", "conflict@lead.com");

    const inboundId = await makeInbound(db);
    const before = await countParties(db);

    const result = (await recordInboundLead.handler(db, CTX, {
      inboundId,
      phone,
      email: "conflict@lead.com",
    })) as { resolution: string; partyId: string | null };

    expect(result.resolution).toBe("conflict");
    expect(result.partyId).toBeNull();

    // No Party created, nothing attached.
    expect(await countParties(db)).toBe(before);
    const row = await inboundRow(db, inboundId);
    expect(row.partyId).toBeNull();
    // The handler does NOT drive the intake status — the workflow owns `queued`.
    expect(row.status).toBe("parsed");

    // lead.conflict recorded with both candidates; no lead.resolved.
    const conflict = (await eventsOfType(db, "lead.conflict")) as Array<{
      inboundId: string;
      candidatePartyIds: string[];
    }>;
    expect(conflict).toHaveLength(1);
    expect(conflict[0].inboundId).toBe(inboundId);
    expect(new Set(conflict[0].candidatePartyIds)).toEqual(
      new Set([partyByPhone, partyByEmail])
    );
    expect(await eventsOfType(db, "lead.resolved")).toHaveLength(0);
  });

  it("error → creates no Party, attaches nothing, publishes neither resolved nor conflict (Req 5.5)", async () => {
    const inboundId = await makeInbound(db);
    const before = await countParties(db);

    // Empty match input → resolveLeadByMatchKeys returns { kind: "error" }.
    const result = (await recordInboundLead.handler(db, CTX, {
      inboundId,
    })) as { resolution: string; partyId: string | null };

    expect(result.resolution).toBe("error");
    expect(result.partyId).toBeNull();

    // No Party created, nothing attached.
    expect(await countParties(db)).toBe(before);
    const row = await inboundRow(db, inboundId);
    expect(row.partyId).toBeNull();
    // Handler leaves intake status untouched (the workflow drives `queued`).
    expect(row.status).toBe("parsed");

    expect(await eventsOfType(db, "lead.resolved")).toHaveLength(0);
    expect(await eventsOfType(db, "lead.conflict")).toHaveLength(0);
  });
});

// ── assign_lead_owner — no eligible rep + persistence failure (Req 6.6, 6.4) ──

describe("assign_lead_owner — no eligible rep & persistence failure (Req 6.6, 6.4)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("no language match → assigns no owner, leaves assigned_rep_id null, records lead.unrouted with the language reason (Req 6.6)", async () => {
    // Lead speaks English; the only rep speaks Arabic → no candidate.
    const partyId = await makeParty(db, { name: "Lead", language: "en" });
    await db.insert(leadsMirror).values({ partyId });
    await makeRep(db, {
      name: "ArabicOnly",
      languages: ["ar"],
      projects: ["Bayn"],
    });

    const result = (await assignLeadOwner.handler(db, CTX, { partyId })) as {
      repId: string | null;
      rationale: string;
    };

    expect(result.repId).toBeNull();
    expect(await assignedRep(db, partyId)).toBeNull();

    const unrouted = (await eventsOfType(db, "lead.unrouted")) as Array<{
      partyId: string;
      reason: string;
      matchedLanguage: string;
    }>;
    expect(unrouted).toHaveLength(1);
    expect(unrouted[0]).toMatchObject({ partyId, matchedLanguage: "en" });
    expect(unrouted[0].reason).toMatch(/language/i);
    // No owner was assigned, so no lead.routed event.
    expect(await eventsOfType(db, "lead.routed")).toHaveLength(0);
  });

  it("no project match → assigns no owner and records lead.unrouted with the project reason (Req 6.6)", async () => {
    const partyId = await makeParty(db, { name: "Lead", language: "en" });
    await db
      .insert(leadsMirror)
      .values({ partyId, projectInterest: "Marina" });
    // Rep speaks the language but does not serve the project of interest.
    await makeRep(db, {
      name: "WrongProject",
      languages: ["en"],
      projects: ["Bayn"],
    });

    const result = (await assignLeadOwner.handler(db, CTX, { partyId })) as {
      repId: string | null;
      rationale: string;
    };

    expect(result.repId).toBeNull();
    expect(await assignedRep(db, partyId)).toBeNull();

    const unrouted = (await eventsOfType(db, "lead.unrouted")) as Array<{
      reason: string;
      matchedProject: string | null;
    }>;
    expect(unrouted).toHaveLength(1);
    expect(unrouted[0].reason).toMatch(/project/i);
    expect(unrouted[0].matchedProject).toBe("Marina");
  });

  it("persistence failure leaves the prior owner unchanged (Req 6.4)", async () => {
    const partyId = await makeParty(db, { name: "Owned", language: "en" });
    const priorRep = await makeRep(db, {
      name: "Prior",
      languages: ["en"],
      projects: ["Bayn"],
    });
    // A second eligible rep so selection succeeds and a persist is attempted.
    await makeRep(db, {
      name: "NewCandidate",
      languages: ["en"],
      projects: ["Bayn"],
    });
    // Establish the prior owner.
    await db.insert(leadsMirror).values({ partyId, assignedRepId: priorRep });

    // Wrap the db so the owner-persist insert fails, while reads still work.
    const failingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "insert") {
          return () => {
            throw new Error("simulated persistence failure");
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Database;

    await expect(
      assignLeadOwner.handler(failingDb, CTX, { partyId })
    ).rejects.toThrow(/persistence failure/);

    // The prior owner is unchanged — the failed persist committed nothing.
    expect(await assignedRep(db, partyId)).toBe(priorRep);
    // No routed event was published (the persist failed before publishing).
    expect(await eventsOfType(db, "lead.routed")).toHaveLength(0);
  });
});
