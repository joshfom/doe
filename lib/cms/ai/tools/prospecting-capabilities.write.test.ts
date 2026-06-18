// `computePhoneHash` (reached by record_target / promote_target_to_lead and by
// the assertions below) reads PHONE_HASH_SALT from the environment; set a stable
// test salt so hashing is deterministic across the suite.
process.env.PHONE_HASH_SALT ??= "prospecting-write-test-salt";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as schema from "../../schema";
import {
  targets,
  outreachDrafts,
  prospectOptouts,
  parties,
  partyIdentities,
  leadsMirror,
  events,
  sfOutbox,
} from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import type { CatalogEntry } from "./catalog";
import {
  prospectingCapabilityEntries,
  loadProspectingCapabilities,
  PROSPECTING_CAPABILITY_NAMES,
  PROSPECTING_AGENT_ACTOR,
  PROSPECTING_OUTREACH_AGENT_ACTOR,
  prospectingToolPermission,
  getOutreachApprovalStore,
  _resetOutreachApprovalStoreForTests,
  setOutreachChannelAdapter,
  _resetOutreachChannelAdapterForTests,
  OUTREACH_APPROVAL_TTL_MS,
} from "./prospecting-capabilities";
import {
  providerRegistry,
  type EnrichmentProvider,
  type ProviderId,
  type ProviderResult,
  type ProviderEnrichment,
} from "../../prospecting/providers";
import { computePhoneHash, normalizePhoneToE164 } from "../../voice/identity";
import type { ChannelAdapter, ChannelMessage } from "../../jobs/channel-adapter";

/**
 * Unit tests for the write/provider prospecting capabilities (task 3.3):
 * `record_target`, `prospect_search`, `enrich_target`, `draft_outreach`,
 * `promote_target_to_lead`, and the human-gated `send_outreach`.
 *
 * The harness stands up an in-memory Postgres (pg-mem) through the
 * node-postgres adapter so the handlers' real SQL — including `publishEvent`'s
 * transaction + NOTIFY and `enqueueOutbox`'s ON CONFLICT — runs unchanged.
 * Providers are stubbed (a fake EnrichmentProvider + an unconfigured one) and
 * the send channel is a counting fake, so no live calls are made.
 */

// Hand-written DDL — only the tables the write handlers touch, with plain uuid
// columns (no cross-table FKs) so the test needs no unrelated tables.
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
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL,
    "brief_id" uuid,
    "channel" text NOT NULL,
    "language" text NOT NULL,
    "subject" text,
    "body" text NOT NULL,
    "grounding" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "approved_by" uuid,
    "job_key" text,
    "sent_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "outreach_drafts_job_key_ux" ON "outreach_drafts" ("job_key");
  CREATE TABLE "prospect_optouts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "match_kind" text NOT NULL,
    "match_value" text NOT NULL,
    "reason" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "prospect_optouts_match_ux" ON "prospect_optouts" ("match_kind","match_value");
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
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
  // `rowMode: "array"`; strip both (mirrors the sibling dispatch/lead tests).
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

// ── Provider + channel fakes (no live calls) ─────────────────────────────────

class FakeProvider implements EnrichmentProvider {
  constructor(
    readonly id: ProviderId,
    private readonly results: ProviderResult[] = [],
    private readonly enrichment: ProviderEnrichment | null = null
  ) {}
  async search(): Promise<ProviderResult[]> {
    return this.results;
  }
  async enrich(): Promise<ProviderEnrichment> {
    return (
      this.enrichment ?? { sourceProvider: this.id, attributes: {} }
    );
  }
}

class UnconfiguredProvider implements EnrichmentProvider {
  constructor(readonly id: ProviderId) {}
  async search() {
    return { unconfigured: true as const };
  }
  async enrich() {
    return { unconfigured: true as const };
  }
}

class CountingChannel implements ChannelAdapter {
  readonly provider = "fake";
  readonly sent: ChannelMessage[] = [];
  async send(message: ChannelMessage) {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}`, provider: this.provider };
  }
}

const CTX: ToolContext = { actor: PROSPECTING_AGENT_ACTOR };
const REP_ID = randomUUID();
const REP_CTX: ToolContext = { actor: PROSPECTING_AGENT_ACTOR, userId: REP_ID };

function capability(name: string): CatalogEntry {
  const e = prospectingCapabilityEntries.find((c) => c.name === name);
  if (!e) throw new Error(`capability "${name}" not found`);
  return e;
}

let db: Database;

beforeEach(() => {
  db = buildDb();
  providerRegistry.clear();
});

afterEach(() => {
  providerRegistry.clear();
  _resetOutreachApprovalStoreForTests();
  _resetOutreachChannelAdapterForTests();
});

// ── Catalog wiring ────────────────────────────────────────────────────────────

describe("prospecting write/provider capabilities — catalog wiring", () => {
  it("assembles cleanly through loadCatalog with all eight entries", () => {
    const result = loadProspectingCapabilities();
    expect(result.ok).toBe(true);
    expect(PROSPECTING_CAPABILITY_NAMES).toEqual(
      expect.arrayContaining([
        "find_comparables",
        "market_comps",
        "record_target",
        "prospect_search",
        "enrich_target",
        "draft_outreach",
        "promote_target_to_lead",
        "send_outreach",
      ])
    );
  });

  it("permissions every write entry under the prospecting helper", () => {
    for (const name of [
      "record_target",
      "prospect_search",
      "enrich_target",
      "promote_target_to_lead",
    ]) {
      expect(capability(name).permission).toBe(prospectingToolPermission(name));
      expect(capability(name).auditActor).toBe(PROSPECTING_AGENT_ACTOR);
    }
    // draft_outreach runs under the outreach agent identity.
    expect(capability("draft_outreach").auditActor).toBe(
      PROSPECTING_OUTREACH_AGENT_ACTOR
    );
    // send_outreach is never under an agent identity (human-gated).
    expect(capability("send_outreach").auditActor).not.toBe(
      PROSPECTING_AGENT_ACTOR
    );
    expect(capability("send_outreach").permission).toBe(
      prospectingToolPermission("send_outreach")
    );
  });
});

// ── record_target ───────────────────────────────────────────────────────────

describe("record_target", () => {
  it("stores the phone only as a salted hash (raw held transiently) and stamps provenance", async () => {
    const out = (await capability("record_target").handler(db, CTX, {
      targetType: "person",
      displayName: "A. Founder",
      email: "  Founder@Example.COM ",
      phone: "+971501234567",
      attributes: {
        title: {
          value: "Managing Partner",
          source: "apollo",
          asOf: "2026-02-01T00:00:00.000Z",
          lawfulBasis: "legitimate_interest",
        },
      },
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
    })) as { targetId: string; phoneHash: string | null };

    const expectedHash = computePhoneHash(normalizePhoneToE164("+971501234567"));
    expect(out.phoneHash).toBe(expectedHash);

    const [row] = await db
      .select()
      .from(targets)
      .where(eq(targets.id, out.targetId));
    expect(row.phoneHash).toBe(expectedHash);
    expect(row.rawPhone).toBe("+971501234567"); // transient only
    expect(row.email).toBe("founder@example.com"); // normalized
    expect(row.sourceProvider).toBe("apollo");
    expect(row.lawfulBasis).toBe("legitimate_interest");
    expect(row.status).toBe("new");
    expect((row.attributes as Record<string, unknown>).title).toMatchObject({
      source: "apollo",
      asOf: "2026-02-01T00:00:00.000Z",
    });
  });

  it("records a target with no phone (phoneHash null)", async () => {
    const out = (await capability("record_target").handler(db, CTX, {
      targetType: "company",
      companyName: "Acme Capital",
      sourceProvider: "crunchbase",
      lawfulBasis: "public_record",
    })) as { targetId: string; phoneHash: string | null };
    expect(out.phoneHash).toBeNull();
    const [row] = await db
      .select()
      .from(targets)
      .where(eq(targets.id, out.targetId));
    expect(row.phoneHash).toBeNull();
    expect(row.rawPhone).toBeNull();
  });
});

// ── prospect_search ───────────────────────────────────────────────────────────

describe("prospect_search", () => {
  it("fans out to configured providers and skips unconfigured ones", async () => {
    const candidate: ProviderResult = {
      targetType: "person",
      displayName: "Liquidity Founder",
      email: "lf@example.com",
      phone: "+971555555555",
      attributes: {
        wealth: {
          value: "post-exit",
          source: "apollo",
          asOf: "2026-02-01T00:00:00.000Z",
        },
      },
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
    };
    providerRegistry.register(new FakeProvider("apollo", [candidate]));
    providerRegistry.register(new UnconfiguredProvider("pdl"));

    const out = (await capability("prospect_search").handler(db, CTX, {
      filter: { targetType: "person", geography: ["India"] },
    })) as {
      candidates: ProviderResult[];
      unconfiguredProviders: string[];
      failedProviders: string[];
    };

    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].displayName).toBe("Liquidity Founder");
    expect(out.candidates[0].sourceProvider).toBe("apollo");
    expect(out.unconfiguredProviders).toContain("pdl");
    expect(out.failedProviders).toEqual([]);
  });

  it("returns no candidates when no providers are configured", async () => {
    const out = (await capability("prospect_search").handler(db, CTX, {
      filter: { targetType: "company" },
    })) as { candidates: unknown[] };
    expect(out.candidates).toEqual([]);
  });
});

// ── enrich_target ───────────────────────────────────────────────────────────

describe("enrich_target", () => {
  it("merges provenanced provider attributes onto the target", async () => {
    const [t] = await db
      .insert(targets)
      .values({
        targetType: "person",
        displayName: "Target One",
        email: "t1@example.com",
        attributes: {
          seed: { value: "x", source: "manual", asOf: "2026-01-01T00:00:00.000Z" },
        },
        sourceProvider: "apollo",
        lawfulBasis: "legitimate_interest",
      })
      .returning({ id: targets.id });

    providerRegistry.register(
      new FakeProvider("pdl", [], {
        sourceProvider: "pdl",
        attributes: {
          netWorthBand: {
            value: "50-100M",
            source: "pdl",
            asOf: "2026-02-10T00:00:00.000Z",
            lawfulBasis: "legitimate_interest",
          },
        },
      })
    );
    providerRegistry.register(new UnconfiguredProvider("cognism"));

    const out = (await capability("enrich_target").handler(db, CTX, {
      targetId: t.id,
    })) as {
      targetId: string;
      attributes: Record<string, { source: string }>;
      unconfiguredProviders: string[];
    };

    expect(out.attributes.netWorthBand.source).toBe("pdl");
    expect(out.attributes.seed).toBeDefined(); // existing preserved
    expect(out.unconfiguredProviders).toContain("cognism");

    const [row] = await db.select().from(targets).where(eq(targets.id, t.id));
    expect((row.attributes as Record<string, unknown>).netWorthBand).toBeDefined();
    expect(row.status).toBe("researching");
  });
});

// ── draft_outreach ────────────────────────────────────────────────────────────

describe("draft_outreach", () => {
  it("persists an unsent draft with its grounding manifest and emits drafted", async () => {
    const [t] = await db
      .insert(targets)
      .values({
        targetType: "person",
        sourceProvider: "apollo",
        lawfulBasis: "legitimate_interest",
      })
      .returning({ id: targets.id });

    const draft = {
      targetId: t.id,
      channel: "email" as const,
      language: "en" as const,
      subject: "An understated note",
      body: "Recent Palm Jumeirah villa sales have averaged AED 40M.",
      grounding: [
        {
          claim: "Palm villa sales averaged AED 40M",
          sourceTable: "market_transactions" as const,
          recordId: randomUUID(),
          asOf: "2026-02-01T00:00:00.000Z",
        },
      ],
    };

    const out = (await capability("draft_outreach").handler(db, CTX, draft)) as {
      draftId: string;
      status: string;
    };
    expect(out.status).toBe("draft");

    const [row] = await db
      .select()
      .from(outreachDrafts)
      .where(eq(outreachDrafts.id, out.draftId));
    expect(row.status).toBe("draft");
    expect(row.sentAt).toBeNull();
    expect((row.grounding as unknown[]).length).toBe(1);

    const evRows = await db
      .select()
      .from(events)
      .where(eq(events.type, "prospecting.outreach.drafted"));
    expect(evRows).toHaveLength(1);
  });
});

// ── promote_target_to_lead ────────────────────────────────────────────────────

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

describe("promote_target_to_lead", () => {
  it("creates parties + leads_mirror on a new contact and stamps the target", async () => {
    const targetId = await seedTarget("new@example.com");
    const out = (await capability("promote_target_to_lead").handler(db, CTX, {
      targetId,
      email: "new@example.com",
    })) as { resolution: string; partyId: string | null };

    expect(out.resolution).toBe("new");
    expect(out.partyId).not.toBeNull();

    const [t] = await db.select().from(targets).where(eq(targets.id, targetId));
    expect(t.partyId).toBe(out.partyId);
    expect(t.status).toBe("promoted");

    const mirror = await db
      .select()
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, out.partyId!));
    expect(mirror).toHaveLength(1);
  });

  it("attaches to the existing party on a match", async () => {
    // Seed an existing party with an email identity.
    const [p] = await db
      .insert(parties)
      .values({ type: "person", name: "Existing" })
      .returning({ id: parties.id });
    await db
      .insert(partyIdentities)
      .values({ partyId: p.id, kind: "email", value: "dup@example.com" });

    const targetId = await seedTarget("dup@example.com");
    const out = (await capability("promote_target_to_lead").handler(db, CTX, {
      targetId,
      email: "dup@example.com",
    })) as { resolution: string; partyId: string | null };

    expect(out.resolution).toBe("match");
    expect(out.partyId).toBe(p.id);

    // No new party was created (still exactly one).
    const allParties = await db.select().from(parties);
    expect(allParties).toHaveLength(1);
  });

  it("creates nothing on an error (empty match input) and retains the target", async () => {
    const targetId = await seedTarget();
    const out = (await capability("promote_target_to_lead").handler(db, CTX, {
      targetId,
    })) as { resolution: string; partyId: string | null };

    expect(out.resolution).toBe("error");
    expect(out.partyId).toBeNull();

    const allParties = await db.select().from(parties);
    expect(allParties).toHaveLength(0);
    const [t] = await db.select().from(targets).where(eq(targets.id, targetId));
    expect(t.partyId).toBeNull();
    expect(t.status).toBe("new");
  });

  it("creates nothing on a conflict (distinct keys → distinct parties)", async () => {
    // Two parties, one per identity key, so phone + email resolve differently.
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

    const targetId = await seedTarget("conflict@example.com");
    const out = (await capability("promote_target_to_lead").handler(db, CTX, {
      targetId,
      phone: "+971501112222",
      email: "conflict@example.com",
    })) as { resolution: string; partyId: string | null };

    expect(out.resolution).toBe("conflict");
    expect(out.partyId).toBeNull();

    // No leads_mirror row was created for either party.
    const mirror = await db.select().from(leadsMirror);
    expect(mirror).toHaveLength(0);
    const [t] = await db.select().from(targets).where(eq(targets.id, targetId));
    expect(t.status).toBe("new");
  });
});

// ── send_outreach ───────────────────────────────────────────────────────────

async function seedDraft(opts: {
  email?: string;
  phoneHash?: string;
  channel?: "email" | "whatsapp" | "message";
  rawPhone?: string;
}): Promise<{ draftId: string; targetId: string }> {
  const [t] = await db
    .insert(targets)
    .values({
      targetType: "person",
      email: opts.email ?? null,
      phoneHash: opts.phoneHash ?? null,
      rawPhone: opts.rawPhone ?? null,
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
    })
    .returning({ id: targets.id });
  const [d] = await db
    .insert(outreachDrafts)
    .values({
      targetId: t.id,
      channel: opts.channel ?? "email",
      language: "en",
      body: "An understated note.",
      grounding: [],
      status: "draft",
    })
    .returning({ id: outreachDrafts.id });
  return { draftId: d.id, targetId: t.id };
}

describe("send_outreach", () => {
  it("throws without an authenticated rep in context", async () => {
    const { draftId } = await seedDraft({ email: "x@example.com" });
    await expect(
      capability("send_outreach").handler(db, CTX, {
        draftId,
        token: "anything",
      })
    ).rejects.toThrow(/authenticated user/);
  });

  it("refuses an invalid token with no send side effect", async () => {
    const channel = new CountingChannel();
    setOutreachChannelAdapter(channel);
    const { draftId } = await seedDraft({ email: "x@example.com" });

    const out = (await capability("send_outreach").handler(db, REP_CTX, {
      draftId,
      token: "not-a-real-token",
    })) as { sent: boolean; reason?: string };

    expect(out.sent).toBe(false);
    expect(out.reason).toBe("not_found");
    expect(channel.sent).toHaveLength(0);
    const outbox = await db.select().from(sfOutbox);
    expect(outbox).toHaveLength(0);
  });

  it("refuses to send to an opted-out target and suppresses the draft", async () => {
    const channel = new CountingChannel();
    setOutreachChannelAdapter(channel);
    const { draftId } = await seedDraft({ email: "optout@example.com" });
    // Record the opt-out on the (normalized) email.
    await db
      .insert(prospectOptouts)
      .values({ matchKind: "email", matchValue: "optout@example.com" });

    const record = await getOutreachApprovalStore().issue(
      db,
      REP_ID,
      draftId,
      OUTREACH_APPROVAL_TTL_MS
    );
    const out = (await capability("send_outreach").handler(db, REP_CTX, {
      draftId,
      token: record.token,
    })) as { sent: boolean; reason?: string; status: string };

    expect(out.sent).toBe(false);
    expect(out.reason).toBe("opted_out");
    expect(out.status).toBe("suppressed");
    expect(channel.sent).toHaveLength(0);

    const [row] = await db
      .select()
      .from(outreachDrafts)
      .where(eq(outreachDrafts.id, draftId));
    expect(row.status).toBe("suppressed");
  });

  it("sends on a valid token: channel send + outbox side effect + draft marked sent", async () => {
    const channel = new CountingChannel();
    setOutreachChannelAdapter(channel);
    const { draftId, targetId } = await seedDraft({ email: "send@example.com" });

    const record = await getOutreachApprovalStore().issue(
      db,
      REP_ID,
      draftId,
      OUTREACH_APPROVAL_TTL_MS
    );
    const out = (await capability("send_outreach").handler(db, REP_CTX, {
      draftId,
      token: record.token,
    })) as { sent: boolean; messageId?: string; status: string };

    expect(out.sent).toBe(true);
    expect(out.status).toBe("sent");
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0].to).toBe("send@example.com");

    const [row] = await db
      .select()
      .from(outreachDrafts)
      .where(eq(outreachDrafts.id, draftId));
    expect(row.status).toBe("sent");
    expect(row.approvedBy).toBe(REP_ID);
    expect(row.sentAt).not.toBeNull();
    expect(row.jobKey).toBe(`outreach_send:${draftId}`);

    // A CRM side effect was enqueued under the draft's send jobKey (the
    // `:sf-task` sub-key shared with the async outreach_send job so the two send
    // paths converge on ONE outbox row) and carries NO raw phone.
    const outbox = await db.select().from(sfOutbox);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].jobKey).toBe(`outreach_send:${draftId}:sf-task`);
    expect(JSON.stringify(outbox[0].payload)).not.toContain("send@example.com");
    expect(JSON.stringify(outbox[0].payload)).toContain(targetId);

    // The sent event carries no raw phone either.
    const evRows = await db
      .select()
      .from(events)
      .where(eq(events.type, "prospecting.outreach.sent"));
    expect(evRows).toHaveLength(1);
  });

  it("is an idempotent no-op for an already-sent draft", async () => {
    const channel = new CountingChannel();
    setOutreachChannelAdapter(channel);
    const { draftId } = await seedDraft({ email: "again@example.com" });
    await db
      .update(outreachDrafts)
      .set({ status: "sent" })
      .where(eq(outreachDrafts.id, draftId));

    const out = (await capability("send_outreach").handler(db, REP_CTX, {
      draftId,
      token: "irrelevant",
    })) as { sent: boolean; alreadySent?: boolean };

    expect(out.sent).toBe(true);
    expect(out.alreadySent).toBe(true);
    expect(channel.sent).toHaveLength(0);
  });

  it("refuses a token bound to a different draft", async () => {
    const channel = new CountingChannel();
    setOutreachChannelAdapter(channel);
    const a = await seedDraft({ email: "a@example.com" });
    const b = await seedDraft({ email: "b@example.com" });

    // Token issued for draft A, presented for draft B.
    const record = await getOutreachApprovalStore().issue(
      db,
      REP_ID,
      a.draftId,
      OUTREACH_APPROVAL_TTL_MS
    );
    const out = (await capability("send_outreach").handler(db, REP_CTX, {
      draftId: b.draftId,
      token: record.token,
    })) as { sent: boolean; reason?: string };

    expect(out.sent).toBe(false);
    expect(out.reason).toBe("wrong_draft");
    expect(channel.sent).toHaveLength(0);
  });
});
