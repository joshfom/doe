// `computePhoneHash` (reached by promote_target_to_lead's match-key building and
// by the conflict fixture below) reads PHONE_HASH_SALT from the environment; set
// a stable test salt so hashing is deterministic across the suite.
process.env.PHONE_HASH_SALT ??= "prospecting-promotion-test-salt";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "../../schema";
import {
  targets,
  parties,
  partyIdentities,
  leadsMirror,
  events,
} from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import type { CatalogEntry } from "./catalog";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";

/**
 * Unit tests for the `promote_target_to_lead` promotion branches (task 7.3).
 *
 * promote_target_to_lead is entirely S2 reuse (`resolveLeadByMatchKeys` +
 * `upsertLead`) wired to the S3 lead-engine handoff. Its four resolution
 * branches each have a distinct contract (Design §Components #5, §Error
 * Handling; Requirements 5.2, 5.3, 5.4):
 *
 *   - `match`     → attach to the EXISTING party (no duplicate party/mirror),
 *                   stamp the Target (partyId + status=promoted), emit
 *                   `prospecting.target.promoted` (resolution=match), and hand
 *                   the Lead to S3 (assign_lead_owner + score_lead);
 *   - `new`       → create the parties + leads_mirror pairing, stamp the Target,
 *                   emit `prospecting.target.promoted` (resolution=new), and hand
 *                   the Lead to S3 best-effort;
 *   - `conflict`  → create NOTHING, retain the Target (status unchanged), emit
 *                   `prospecting.target.promoted` (resolution=conflict) for human
 *                   resolution, and DO NOT hand off to S3;
 *   - `error`     → create NOTHING, retain the Target, leave the party graph
 *                   untouched, emit NO event, and DO NOT hand off to S3.
 *
 * The party-graph mutations run for real against pg-mem (the real dedupe +
 * upsert + publishEvent SQL). Only the S3 lead-engine boundary is spied — these
 * tests assert the handoff is INVOKED (or not) per branch, while the routing /
 * DNA themselves are S3's own (separately tested) concern. The handoff is
 * best-effort: a failure inside it must never undo the promoted Lead.
 *
 * Harness mirrors `prospecting-capabilities.write.test.ts`: an in-memory
 * Postgres (pg-mem) through the node-postgres adapter so publishEvent's
 * transaction + NOTIFY and upsertLead's ON CONFLICT run unchanged.
 *
 * Design references: §Components #5, §Error Handling.
 * Requirements: 5.2, 5.3, 5.4.
 */

// ── S3 lead-engine handoff: spy the boundary ─────────────────────────────────
//
// promote_target_to_lead reaches S3 via `loadLeadCapabilities().catalog.get()`
// (resolving `assign_lead_owner` + `score_lead`). We replace just that loader
// with one returning spy handlers, so the handoff is observable and
// deterministic without standing up the reps table or the model gateway. Every
// other lead-capabilities export (e.g. LEAD_DISTRIBUTION_AGENT_ACTOR, imported
// by the module under test) is preserved.
const s3 = vi.hoisted(() => ({
  assignSpy: vi.fn(),
  scoreSpy: vi.fn(),
}));

vi.mock("./lead-capabilities", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./lead-capabilities")>();
  return {
    ...actual,
    loadLeadCapabilities: () => ({
      ok: true as const,
      catalog: new Map<string, { name: string; handler: unknown }>([
        [
          "assign_lead_owner",
          { name: "assign_lead_owner", handler: s3.assignSpy },
        ],
        ["score_lead", { name: "score_lead", handler: s3.scoreSpy }],
      ]),
    }),
  };
});

// Import the module under test AFTER the mock declaration (vi.mock is hoisted by
// Vitest, so the spied loader is in place when this module's lazy handoff runs).
import {
  prospectingCapabilityEntries,
  PROSPECTING_AGENT_ACTOR,
} from "./prospecting-capabilities";

// ── pg-mem harness (only the tables the promotion handler touches) ───────────

const DDL = `
  CREATE TABLE "parties" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL DEFAULT 'person',
    "name" text,
    "language" text DEFAULT 'en',
    "client_id" uuid,
    "tenant_id" uuid,
    "consent_at" timestamp,
    "demo" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "party_identities" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "party_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "value" text NOT NULL,
    "verified_at" timestamp
  );
  CREATE INDEX "party_identities_value_idx" ON "party_identities" ("kind","value");
  CREATE TABLE "leads_mirror" (
    "party_id" uuid PRIMARY KEY,
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
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
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
  // publishEvent issues `SELECT pg_notify(channel, id)`; pg-mem lacks it.
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });
  mem.public.none(DDL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both (mirrors the sibling write/dispatch tests).
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

const CTX: ToolContext = { actor: PROSPECTING_AGENT_ACTOR };
const ASSIGNED_REP_ID = randomUUID();
const PROMOTED_EVENT = "prospecting.target.promoted";

function capability(name: string): CatalogEntry {
  const e = prospectingCapabilityEntries.find((c) => c.name === name);
  if (!e) throw new Error(`capability "${name}" not found`);
  return e;
}

const promote = () => capability("promote_target_to_lead");

let db: Database;

beforeEach(() => {
  db = buildDb();
  // Default S3 handoff responses: a routed rep + a scored tier (the real
  // assign_lead_owner / score_lead shapes the handler reads from).
  s3.assignSpy.mockReset();
  s3.scoreSpy.mockReset();
  s3.assignSpy.mockResolvedValue({ repId: ASSIGNED_REP_ID, rationale: "test" });
  s3.scoreSpy.mockResolvedValue({ tier: "WARM", reason: "test rationale" });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function seedTarget(email?: string): Promise<string> {
  const [t] = await db
    .insert(targets)
    .values({
      targetType: "person",
      email: email ?? null,
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
    })
    .returning({ id: targets.id });
  return t.id;
}

async function promotedEvents(): Promise<Array<{ payload: unknown }>> {
  return db
    .select({ payload: events.payload })
    .from(events)
    .where(eq(events.type, PROMOTED_EVENT));
}

// ── match branch ──────────────────────────────────────────────────────────────

describe("promote_target_to_lead — match branch", () => {
  it("attaches to the existing party without creating a duplicate party or mirror", async () => {
    const [p] = await db
      .insert(parties)
      .values({ type: "person", name: "Existing HNWI" })
      .returning({ id: parties.id });
    await db
      .insert(partyIdentities)
      .values({ partyId: p.id, kind: "email", value: "match@example.com" });

    const targetId = await seedTarget("match@example.com");
    const out = (await promote().handler(db, CTX, {
      targetId,
      email: "match@example.com",
    })) as { resolution: string; partyId: string | null };

    expect(out.resolution).toBe("match");
    expect(out.partyId).toBe(p.id);

    // No duplicate party — still exactly the one we seeded.
    const allParties = await db.select().from(parties);
    expect(allParties).toHaveLength(1);
  });

  it("stamps the target with the resolved party id and status=promoted", async () => {
    const [p] = await db
      .insert(parties)
      .values({ type: "person" })
      .returning({ id: parties.id });
    await db
      .insert(partyIdentities)
      .values({ partyId: p.id, kind: "email", value: "stamp@example.com" });

    const targetId = await seedTarget("stamp@example.com");
    await promote().handler(db, CTX, { targetId, email: "stamp@example.com" });

    const [t] = await db.select().from(targets).where(eq(targets.id, targetId));
    expect(t.partyId).toBe(p.id);
    expect(t.status).toBe("promoted");
  });

  it("emits prospecting.target.promoted with resolution=match and hands off to S3", async () => {
    const [p] = await db
      .insert(parties)
      .values({ type: "person" })
      .returning({ id: parties.id });
    await db
      .insert(partyIdentities)
      .values({ partyId: p.id, kind: "email", value: "evt@example.com" });

    const targetId = await seedTarget("evt@example.com");
    await promote().handler(db, CTX, { targetId, email: "evt@example.com" });

    const evs = await promotedEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0].payload).toMatchObject({
      targetId,
      partyId: p.id,
      resolution: "match",
      repId: ASSIGNED_REP_ID,
    });

    // The promoted Lead was handed to S3 (routing + DNA), keyed by the partyId.
    expect(s3.assignSpy).toHaveBeenCalledTimes(1);
    expect(s3.assignSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { partyId: p.id }
    );
    expect(s3.scoreSpy).toHaveBeenCalledTimes(1);
    expect(s3.scoreSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { partyId: p.id }
    );
  });
});

// ── new branch ──────────────────────────────────────────────────────────────

describe("promote_target_to_lead — new branch", () => {
  it("creates the parties + leads_mirror pairing and stamps the target", async () => {
    const targetId = await seedTarget("new@example.com");
    const out = (await promote().handler(db, CTX, {
      targetId,
      email: "new@example.com",
    })) as { resolution: string; partyId: string | null };

    expect(out.resolution).toBe("new");
    expect(out.partyId).not.toBeNull();

    // A party + its leads_mirror pairing now exist.
    const allParties = await db.select().from(parties);
    expect(allParties).toHaveLength(1);
    const mirror = await db
      .select()
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, out.partyId!));
    expect(mirror).toHaveLength(1);

    const [t] = await db.select().from(targets).where(eq(targets.id, targetId));
    expect(t.partyId).toBe(out.partyId);
    expect(t.status).toBe("promoted");
  });

  it("emits prospecting.target.promoted with resolution=new and hands off to S3 (assign + score)", async () => {
    const targetId = await seedTarget("newevt@example.com");
    const out = (await promote().handler(db, CTX, {
      targetId,
      email: "newevt@example.com",
    })) as { partyId: string | null };

    const evs = await promotedEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0].payload).toMatchObject({
      targetId,
      partyId: out.partyId,
      resolution: "new",
      repId: ASSIGNED_REP_ID,
    });

    expect(s3.assignSpy).toHaveBeenCalledTimes(1);
    expect(s3.assignSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { partyId: out.partyId }
    );
    expect(s3.scoreSpy).toHaveBeenCalledTimes(1);
    expect(s3.scoreSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { partyId: out.partyId }
    );
  });

  it("keeps the promoted Lead even when the S3 handoff fails (best-effort)", async () => {
    // Routing AND scoring both throw — the handoff must never undo the
    // promotion (Design §Error Handling; Req 5.4 spirit).
    s3.assignSpy.mockRejectedValue(new Error("router down"));
    s3.scoreSpy.mockRejectedValue(new Error("gateway down"));

    const targetId = await seedTarget("resilient@example.com");
    const out = (await promote().handler(db, CTX, {
      targetId,
      email: "resilient@example.com",
    })) as { resolution: string; partyId: string | null };

    // Promotion still succeeded despite the failing handoff.
    expect(out.resolution).toBe("new");
    expect(out.partyId).not.toBeNull();
    const mirror = await db
      .select()
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, out.partyId!));
    expect(mirror).toHaveLength(1);
    const [t] = await db.select().from(targets).where(eq(targets.id, targetId));
    expect(t.status).toBe("promoted");

    // The promoted event still fires; repId is null because routing failed.
    const evs = await promotedEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0].payload).toMatchObject({ resolution: "new", repId: null });
  });
});

// ── conflict branch ───────────────────────────────────────────────────────────

describe("promote_target_to_lead — conflict branch", () => {
  // Two parties, one per identity key, so phone + email resolve to DIFFERENT
  // parties → resolveLeadByMatchKeys returns conflict.
  async function seedConflict(): Promise<string> {
    const [p1] = await db
      .insert(parties)
      .values({ type: "person" })
      .returning({ id: parties.id });
    const [p2] = await db
      .insert(parties)
      .values({ type: "person" })
      .returning({ id: parties.id });
    const phoneHash = computePhoneHash(normalizePhoneToE164("+971501112222"));
    await db
      .insert(partyIdentities)
      .values({ partyId: p1.id, kind: "phone_hash", value: phoneHash });
    await db
      .insert(partyIdentities)
      .values({ partyId: p2.id, kind: "email", value: "conflict@example.com" });
    return seedTarget("conflict@example.com");
  }

  it("creates nothing, retains the target unchanged, and does not hand off to S3", async () => {
    const targetId = await seedConflict();
    const out = (await promote().handler(db, CTX, {
      targetId,
      phone: "+971501112222",
      email: "conflict@example.com",
    })) as { resolution: string; partyId: string | null };

    expect(out.resolution).toBe("conflict");
    expect(out.partyId).toBeNull();

    // No leads_mirror row created for either candidate party.
    const mirror = await db.select().from(leadsMirror);
    expect(mirror).toHaveLength(0);

    // The Target is retained, not promoted (status untouched, no partyId).
    const [t] = await db.select().from(targets).where(eq(targets.id, targetId));
    expect(t.status).toBe("new");
    expect(t.partyId).toBeNull();

    // No S3 handoff on a conflict.
    expect(s3.assignSpy).not.toHaveBeenCalled();
    expect(s3.scoreSpy).not.toHaveBeenCalled();
  });

  it("emits prospecting.target.promoted with resolution=conflict for human resolution", async () => {
    const targetId = await seedConflict();
    await promote().handler(db, CTX, {
      targetId,
      phone: "+971501112222",
      email: "conflict@example.com",
    });

    const evs = await promotedEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0].payload).toMatchObject({ targetId, resolution: "conflict" });
    // The candidate parties are surfaced so a human can resolve the conflict.
    const payload = evs[0].payload as { candidatePartyIds?: unknown };
    expect(Array.isArray(payload.candidatePartyIds)).toBe(true);
  });
});

// ── error branch ──────────────────────────────────────────────────────────────

describe("promote_target_to_lead — error branch", () => {
  it("creates nothing, leaves the party graph untouched, retains the target, emits no event, and does not hand off", async () => {
    // No phone/email/sfLeadId → no match keys → resolveLeadByMatchKeys returns
    // error (Req 5.4): create nothing.
    const targetId = await seedTarget();
    const out = (await promote().handler(db, CTX, {
      targetId,
    })) as { resolution: string; partyId: string | null };

    expect(out.resolution).toBe("error");
    expect(out.partyId).toBeNull();

    // Party graph untouched.
    expect(await db.select().from(parties)).toHaveLength(0);
    expect(await db.select().from(partyIdentities)).toHaveLength(0);
    expect(await db.select().from(leadsMirror)).toHaveLength(0);

    // Target retained, not promoted.
    const [t] = await db.select().from(targets).where(eq(targets.id, targetId));
    expect(t.status).toBe("new");
    expect(t.partyId).toBeNull();

    // No promoted event, no S3 handoff.
    expect(await promotedEvents()).toHaveLength(0);
    expect(s3.assignSpy).not.toHaveBeenCalled();
    expect(s3.scoreSpy).not.toHaveBeenCalled();
  });
});
