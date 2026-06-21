import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../../schema";
import { outreachDrafts, sfOutbox, targets } from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "./registry";
import type { CatalogEntry } from "./catalog";
import type { ChannelAdapter, ChannelMessage } from "../../jobs/channel-adapter";
import {
  prospectingCapabilityEntries,
  createDurableOutreachApprovalStore,
  setOutreachApprovalStore,
  setOutreachChannelAdapter,
  _resetOutreachApprovalStoreForTests,
  _resetOutreachChannelAdapterForTests,
} from "./prospecting-capabilities";

/**
 * Property test for send idempotency (task 6.6) — the SECOND converging surface
 * that enforces the send jobKey boundary: the synchronous, human-gated
 * `send_outreach` CatalogEntry. (The async `outreach_send` job handler — the
 * FIRST surface — carries its own idempotency property in
 * `lib/cms/jobs/outreach-send.test.ts`; this file validates the same boundary on
 * the catalog-entry send path it is placed beside.)
 *
 * A draft's stable send jobKey is `outreach_send:{draftId}`; the CRM side effect
 * is enqueued under `outreach_send:{draftId}:sf-task` (the SAME key the async job
 * uses), and `enqueueOutbox`'s `ON CONFLICT (job_key) DO NOTHING` collapses any
 * retry to a single `sf_outbox` row. The single-use Approval_Flow token (the
 * REUSED S1 durable `admin_confirmations` mechanism) plus the draft's terminal
 * `status=sent` no-op guard bound the external send to AT MOST ONE per jobKey
 * across any number of retries — sequential or concurrent.
 *
 * Harness mirrors `lib/cms/ai/tools/prospecting-send.test.ts`: real migrations
 * 0029 (jobs / events / parties / sf_outbox) and 0038 (prospecting tables) plus a
 * minimal `admin_confirmations` table are applied under an in-memory Postgres so
 * the true table shapes and the unique `job_key` constraint are exercised; the
 * REAL durable token store and a fake counting ChannelAdapter are wired (no live
 * credentials, no Next.js routes touched).
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
// writes to. FK to users is omitted so arbitrary uuid rep identities work.
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

function splitStatements(sqlText: string): string[] {
  return sqlText
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function applyMigration(mem: IMemoryDb, file: string): void {
  const sqlText = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const stmt of splitStatements(sqlText)) mem.public.none(stmt);
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

const approve = (db: Database, ctx: ToolContext, input: unknown) =>
  capability("approve_outreach").handler(db, ctx, input as never) as Promise<{
    draftId: string;
    status: string;
    token?: string;
  }>;

const send = (db: Database, ctx: ToolContext, input: unknown) =>
  capability("send_outreach").handler(db, ctx, input as never) as Promise<{
    sent: boolean;
    draftId: string;
    status: string;
  }>;

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
  channel: "email" | "whatsapp" | "message"
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

/** Count of sf_outbox rows under the draft's send jobKey side-effect sub-key. */
async function outboxCount(db: Database, draftId: string): Promise<number> {
  const rows = await db
    .select({ id: sfOutbox.id })
    .from(sfOutbox)
    .where(eq(sfOutbox.jobKey, `outreach_send:${draftId}:sf-task`));
  return rows.length;
}

describe("send_outreach idempotency (task 6.6, Req 8.2)", () => {
  beforeEach(() => {
    // Exercise the REAL durable admin_confirmations-backed token store.
    setOutreachApprovalStore(createDurableOutreachApprovalStore());
  });

  afterEach(() => {
    _resetOutreachApprovalStoreForTests();
    _resetOutreachChannelAdapterForTests();
  });

  // **Feature: prospecting-workspace, Property 6: For a given send jobKey, any number of retries produce at most one external send and at most one outbox side effect.**
  // **Validates: Requirements 8.2**
  it("for a given send jobKey, any number of retries produce at most one external send and one outbox side effect", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Number of send_outreach retries presenting the same approval token.
        fc.integer({ min: 1, max: 6 }),
        // Whether those retries fire concurrently or sequentially.
        fc.boolean(),
        // Channel decides which recipient identity the send resolves.
        fc.constantFrom("email", "whatsapp", "message"),
        async (retryCount, concurrent, channel) => {
          const db = buildDb();
          const adapter = new CountingChannelAdapter();
          setOutreachChannelAdapter(adapter);

          const rep = randomUUID();
          await db.execute(sql`INSERT INTO "users" ("id") VALUES (${rep})`);
          const ctx: ToolContext = { actor: "rep:outreach", userId: rep };

          // A non-email channel sends to the transient raw phone; email sends to
          // the email identity. Seed whichever the channel resolves.
          const targetId =
            channel === "email"
              ? await seedTarget(db, { email: "vip@example.com" })
              : await seedTarget(db, {
                  email: null,
                  phoneHash: "hash-abc",
                  rawPhone: "+971500000001",
                });
          const draftId = await seedDraft(
            db,
            targetId,
            channel as "email" | "whatsapp" | "message"
          );

          // One approval → one single-use token bound to this rep + draft. Every
          // retry below re-presents that SAME token under the SAME send jobKey
          // (`outreach_send:{draftId}`).
          const approved = await approve(db, ctx, { draftId });
          const token = approved.token!;

          const attempts = Array.from({ length: retryCount }, () =>
            send(db, ctx, { draftId, token })
          );
          if (concurrent) {
            await Promise.all(attempts);
          } else {
            for (const a of attempts) await a;
          }

          // AT MOST ONE external send across all retries (exactly one on this
          // always-approved, never-opted-out happy path).
          expect(adapter.sent.length).toBeLessThanOrEqual(1);
          expect(adapter.sent).toHaveLength(1);

          // AT MOST ONE outbox side effect under the send jobKey.
          const obx = await outboxCount(db, draftId);
          expect(obx).toBeLessThanOrEqual(1);
          expect(obx).toBe(1);

          // The draft reaches the terminal sent state exactly once.
          expect(await statusOf(db, draftId)).toBe("sent");
        }
      ),
      { numRuns: 100 }
    );
  });
});
