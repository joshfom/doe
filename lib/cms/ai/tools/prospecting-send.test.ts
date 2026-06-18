import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";

import * as schema from "../../schema";
import {
  adminConfirmations,
  outreachDrafts,
  prospectOptouts,
  sfOutbox,
  targets,
} from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import type { CatalogEntry } from "./catalog";
import type { ChannelAdapter, ChannelMessage } from "../../jobs/channel-adapter";
import {
  prospectingCapabilityEntries,
  createDurableOutreachApprovalStore,
  getOutreachApprovalStore,
  setOutreachApprovalStore,
  setOutreachChannelAdapter,
  _resetOutreachApprovalStoreForTests,
  _resetOutreachChannelAdapterForTests,
  OUTREACH_APPROVAL_TTL_MS,
} from "./prospecting-capabilities";

/**
 * Focused unit tests for the human-gated approval + send path (task 6.2):
 * `approve_outreach` and `send_outreach`.
 *
 * These exercise the REAL durable Approval_Flow store — the REUSED S1 admin
 * confirmation-token mechanism backed by the genuine `admin_confirmations` table
 * under pg-mem — so the single-use, user-AND-draft-bound token gate is what's
 * under test, not a stub. A fake counting ChannelAdapter stands in for the
 * external transport. The harness applies the real migrations 0029 (jobs /
 * events / parties / sf_outbox) and 0038 (prospecting tables) plus a minimal
 * `admin_confirmations` table, mirroring `lib/cms/jobs/outreach-send.test.ts`.
 *
 * Properties asserted here (Requirements 7.1, 7.2, 7.3, 7.4):
 *   • approve issues a single-use token + marks the draft approved;
 *   • presenting a valid token sends via the ChannelAdapter under the approving
 *     rep, enqueues ONE CRM outbox side effect, and sets status=sent;
 *   • an opted-out Target is never sent to (draft suppressed, no send);
 *   • an expired / unknown / reused / wrong-draft token is refused with no send;
 *   • no raw phone appears in any event/outbox payload.
 */

const MIGRATION_0029 = "0029_demonic_mandrill.sql";
const MIGRATION_0038 = "0038_prospecting.sql";

const PREREQUISITE_0029 = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

const PREREQUISITE_0038 = `
  CREATE TABLE "users"    ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "projects" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_units" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

// Minimal admin_confirmations table the REUSED durable Approval_Flow store
// writes to (the S1 token mechanism). FK to users is omitted so the test can use
// arbitrary uuid rep identities without seeding a users row.
const ADMIN_CONFIRMATIONS_DDL = `
  CREATE TABLE "admin_confirmations" (
    "token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "kind" text NOT NULL,
    "args" jsonb NOT NULL,
    "expires_at" timestamp NOT NULL,
    "consumed_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
`;

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function applyMigration(mem: IMemoryDb, file: string): void {
  const sql = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const stmt of splitStatements(sql)) mem.public.none(stmt);
}

function buildDb(): Database {
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

  mem.public.none(PREREQUISITE_0029);
  applyMigration(mem, MIGRATION_0029);
  mem.public.none(PREREQUISITE_0038);
  applyMigration(mem, MIGRATION_0038);
  mem.public.none(ADMIN_CONFIRMATIONS_DDL);

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

  return drizzle(pool, { schema }) as unknown as Database;
}

/** A fake channel that counts every send (the modelled external side effect). */
class CountingChannelAdapter implements ChannelAdapter {
  readonly provider = "fake";
  readonly sent: ChannelMessage[] = [];
  async send(message: ChannelMessage) {
    this.sent.push(message);
    return { messageId: `fake-${this.sent.length}`, provider: this.provider };
  }
}

function capability(name: string): CatalogEntry {
  const e = prospectingCapabilityEntries.find((c) => c.name === name);
  if (!e) throw new Error(`capability "${name}" not found`);
  return e;
}

async function seedTarget(
  db: Database,
  overrides: Partial<typeof targets.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(targets)
    .values({
      targetType: "person",
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
      email: "buyer@example.com",
      ...overrides,
    })
    .returning({ id: targets.id });
  return row.id;
}

async function seedDraft(
  db: Database,
  targetId: string,
  channel: "email" | "whatsapp" | "message" = "email"
): Promise<string> {
  const [row] = await db
    .insert(outreachDrafts)
    .values({
      targetId,
      channel,
      language: "en",
      body: "A discreet, data-grounded note.",
      grounding: [],
      status: "draft",
    })
    .returning({ id: outreachDrafts.id });
  return row.id;
}

async function statusOf(db: Database, draftId: string): Promise<string> {
  const [row] = await db
    .select({ status: outreachDrafts.status })
    .from(outreachDrafts)
    .where(eq(outreachDrafts.id, draftId));
  return row.status;
}

async function outboxRows(db: Database, draftId: string) {
  return db
    .select()
    .from(sfOutbox)
    .where(eq(sfOutbox.jobKey, `outreach_send:${draftId}:sf-task`));
}

const approve = (db: Database, ctx: ToolContext, input: unknown) =>
  capability("approve_outreach").handler(db, ctx, input as never) as Promise<{
    draftId: string;
    status: string;
    token?: string;
    expiresAt?: string;
    reason?: string;
  }>;

const send = (db: Database, ctx: ToolContext, input: unknown) =>
  capability("send_outreach").handler(db, ctx, input as never) as Promise<{
    sent: boolean;
    draftId: string;
    status: string;
    reason?: string;
    message?: string;
    messageId?: string;
    alreadySent?: boolean;
  }>;

let db: Database;
let adapter: CountingChannelAdapter;
const REP = randomUUID();
const ctx = (): ToolContext => ({ actor: "rep:outreach", userId: REP });

beforeEach(async () => {
  db = buildDb();
  adapter = new CountingChannelAdapter();
  // Seed the approving rep so the outreach_drafts.approved_by FK resolves.
  await db.execute(sql`INSERT INTO "users" ("id") VALUES (${REP})`);
  // Exercise the REAL durable, admin_confirmations-backed store (the reused S1
  // admin confirmation mechanism) and the fake channel transport.
  setOutreachApprovalStore(createDurableOutreachApprovalStore());
  setOutreachChannelAdapter(adapter);
});

afterEach(() => {
  _resetOutreachApprovalStoreForTests();
  _resetOutreachChannelAdapterForTests();
});

describe("approve_outreach (Req 7.1, 7.4)", () => {
  it("issues a single-use token bound to the rep + draft and marks the draft approved", async () => {
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);

    const out = await approve(db, ctx(), { draftId });

    expect(out.status).toBe("approved");
    expect(out.token).toBeTruthy();
    expect(out.expiresAt).toBeTruthy();
    expect(await statusOf(db, draftId)).toBe("approved");

    // The token is persisted in the REUSED admin_confirmations table, bound to
    // the rep + draft (no new token mechanism / no new table).
    const [row] = await db
      .select()
      .from(adminConfirmations)
      .where(eq(adminConfirmations.token, out.token!));
    expect(row.userId).toBe(REP);
    expect(row.kind).toBe("outreach_send");
    expect((row.args as { draftId?: string }).draftId).toBe(draftId);
    expect(row.consumedAt).toBeNull();
  });

  it("refuses to approve an already-sent draft (no token issued)", async () => {
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    await db
      .update(outreachDrafts)
      .set({ status: "sent" })
      .where(eq(outreachDrafts.id, draftId));

    const out = await approve(db, ctx(), { draftId });
    expect(out.token).toBeUndefined();
    expect(out.reason).toBe("already_sent");
  });

  it("requires an authenticated approving rep", async () => {
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    await expect(
      approve(db, { actor: "rep:outreach" }, { draftId })
    ).rejects.toThrow(/authenticated user/i);
  });
});

describe("send_outreach — valid token (Req 7.2)", () => {
  it("sends via the ChannelAdapter under the approving rep, enqueues one outbox side effect, and sets status=sent", async () => {
    const targetId = await seedTarget(db, { email: "vip@example.com" });
    const draftId = await seedDraft(db, targetId);

    const approved = await approve(db, ctx(), { draftId });
    const out = await send(db, ctx(), { draftId, token: approved.token });

    expect(out.sent).toBe(true);
    expect(out.status).toBe("sent");
    expect(out.messageId).toBe("fake-1");
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0].to).toBe("vip@example.com");
    expect(await statusOf(db, draftId)).toBe("sent");

    // Exactly one CRM outbox side effect under the draft's send jobKey.
    const rows = await outboxRows(db, draftId);
    expect(rows).toHaveLength(1);
  });

  it("keeps no raw phone in the outbox side-effect payload (CC-Privacy, Req 9.2)", async () => {
    const targetId = await seedTarget(db, {
      email: null,
      phoneHash: "hash-abc",
      rawPhone: "+971500000001",
    });
    const draftId = await seedDraft(db, targetId, "whatsapp");

    const approved = await approve(db, ctx(), { draftId });
    const out = await send(db, ctx(), { draftId, token: approved.token });

    expect(out.sent).toBe(true);
    // The raw phone is the send recipient (transport only)…
    expect(adapter.sent[0].to).toBe("+971500000001");

    // …but never appears in the outbox payload, which carries the salted hash.
    const rows = await outboxRows(db, draftId);
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as Record<string, unknown>;
    expect(payload.phoneHash).toBe("hash-abc");
    expect(JSON.stringify(payload)).not.toContain("+971500000001");
  });
});

describe("send_outreach — refusals (Req 7.1, 7.3)", () => {
  it("refuses to send to an opted-out Target — no send, no outbox row, draft suppressed", async () => {
    const targetId = await seedTarget(db, { email: "optout@example.com" });
    const draftId = await seedDraft(db, targetId);
    await db
      .insert(prospectOptouts)
      .values({ matchKind: "email", matchValue: "optout@example.com" });

    const approved = await approve(db, ctx(), { draftId });
    const out = await send(db, ctx(), { draftId, token: approved.token });

    expect(out.sent).toBe(false);
    expect(out.reason).toBe("opted_out");
    expect(out.status).toBe("suppressed");
    expect(adapter.sent).toHaveLength(0);
    expect(await outboxRows(db, draftId)).toHaveLength(0);
    expect(await statusOf(db, draftId)).toBe("suppressed");
  });

  it("refuses an unknown token with a re-approve prompt and no send", async () => {
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    await approve(db, ctx(), { draftId });

    const out = await send(db, ctx(), { draftId, token: randomUUID() });
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("not_found");
    expect(out.message).toBeTruthy();
    expect(adapter.sent).toHaveLength(0);
    expect(await statusOf(db, draftId)).toBe("approved");
  });

  it("refuses an expired token and performs no send", async () => {
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    // Issue a token that is already expired (negative TTL).
    const record = await getOutreachApprovalStore().issue(db, REP, draftId, -1000);

    const out = await send(db, ctx(), { draftId, token: record.token });
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("expired");
    expect(adapter.sent).toHaveLength(0);
  });

  it("refuses a token bound to a different rep (wrong_user) and performs no send", async () => {
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    const approved = await approve(db, ctx(), { draftId });

    const otherRep = randomUUID();
    const out = await send(
      db,
      { actor: "rep:outreach", userId: otherRep },
      { draftId, token: approved.token }
    );
    expect(out.sent).toBe(false);
    expect(out.reason).toBe("wrong_user");
    expect(adapter.sent).toHaveLength(0);
    expect(await statusOf(db, draftId)).toBe("approved");
  });

  it("never honours a reused token twice (single-use)", async () => {
    const targetId = await seedTarget(db);
    const draftId = await seedDraft(db, targetId);
    const approved = await approve(db, ctx(), { draftId });

    // First send consumes the token and sends exactly once.
    const first = await send(db, ctx(), { draftId, token: approved.token });
    expect(first.sent).toBe(true);
    expect(adapter.sent).toHaveLength(1);

    // The token is spent — consuming it again is refused (store-level check,
    // independent of the draft's terminal status guard).
    const reuse = await getOutreachApprovalStore().consume(
      db,
      approved.token!,
      REP,
      draftId
    );
    expect(reuse.ok).toBe(false);
    if (!reuse.ok) expect(reuse.reason).toBe("already_consumed");
  });
});

describe("DurableOutreachApprovalStore — reused S1 token semantics", () => {
  it("rejects a wrong-draft token without consuming it", async () => {
    const targetId = await seedTarget(db);
    const draftA = await seedDraft(db, targetId);
    const draftB = await seedDraft(db, targetId);
    const record = await getOutreachApprovalStore().issue(
      db,
      REP,
      draftA,
      OUTREACH_APPROVAL_TTL_MS
    );

    // Presenting draftA's token against draftB is refused…
    const wrong = await getOutreachApprovalStore().consume(
      db,
      record.token,
      REP,
      draftB
    );
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe("wrong_draft");

    // …and the token is NOT spent — it still works for its own draft.
    const right = await getOutreachApprovalStore().consume(
      db,
      record.token,
      REP,
      draftA
    );
    expect(right.ok).toBe(true);
  });
});
