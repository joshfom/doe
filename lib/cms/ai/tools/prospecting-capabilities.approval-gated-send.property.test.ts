// `send_outreach` hashes nothing here, but its sibling write/property tests set
// a stable salt; mirror them so the harness is identical across the suite.
process.env.PHONE_HASH_SALT ??= "prospecting-approval-gated-send-test-salt";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import fc from "fast-check";

import * as schema from "../../schema";
import { outreachDrafts, prospectOptouts, sfOutbox, targets } from "../../schema";
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
} from "./prospecting-capabilities";

/**
 * Property test for approval-gated send (task 6.5, NOT optional).
 *
 * **Feature: prospecting-workspace, Property 5: No send_outreach side effect occurs without a valid single-use token bound to the approving rep; an opted-out Target is never sent to.**
 *
 * **Validates: Requirements 7.1, 7.3**
 *
 * The human-gated send is a non-negotiable boundary (Design §Components #7,
 * "No auto-send"): an outreach leaves the building ONLY when a rep presents a
 * valid, single-use Approval_Flow token bound to BOTH that rep and that draft —
 * and NEVER to an opted-out Target. This single property exercises that
 * biconditional across randomized token scenarios, against the REAL
 * `approve_outreach` + `send_outreach` catalog handlers wired to the REAL
 * durable `admin_confirmations`-backed Approval_Flow store
 * (`createDurableOutreachApprovalStore`) — not a stub — with a counting fake
 * ChannelAdapter standing in for the external transport.
 *
 * The two modelled "side effects" of a send are:
 *   (1) an external transport call (the fake ChannelAdapter `.send`), and
 *   (2) a CRM outbox row (`sf_outbox` under the draft's `outreach_send:{id}` key).
 *
 * The invariant, asserted per run by measuring the DELTA in both side effects
 * around a single measured send attempt:
 *
 *   side effect occurs  ⇔  the presented token is VALID, single-use, bound to
 *                          the approving rep AND the draft, AND the Target is
 *                          not opted out.
 *
 * Every other token scenario — unknown, malformed (non-uuid), expired, bound to
 * a different rep (wrong_user), bound to a different draft (wrong_draft), or
 * already consumed (reused) — and every opted-out Target yields ZERO sends and
 * ZERO outbox rows from the measured attempt, with the draft never left `sent`.
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
// writes to (the S1 token mechanism). FK to users omitted so arbitrary uuid rep
// identities work without seeding a users row for each.
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

function splitStatements(stmt: string): string[] {
  return stmt
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function applyMigration(mem: IMemoryDb, file: string): void {
  const text = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const stmt of splitStatements(text)) mem.public.none(stmt);
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

type Channel = "email" | "whatsapp" | "message";

async function seedTarget(
  db: Database,
  channel: Channel,
  email: string,
  phoneHash: string,
  rawPhone: string
): Promise<string> {
  // Email channel resolves the recipient from `email`; phone channels resolve
  // from the transient `raw_phone` (and opt-out matches the salted `phone_hash`).
  const isEmail = channel === "email";
  const [row] = await db
    .insert(targets)
    .values({
      targetType: "person",
      sourceProvider: "apollo",
      lawfulBasis: "legitimate_interest",
      email: isEmail ? email : null,
      phoneHash: isEmail ? null : phoneHash,
      rawPhone: isEmail ? null : rawPhone,
    })
    .returning({ id: targets.id });
  return row.id;
}

async function seedDraft(
  db: Database,
  targetId: string,
  channel: Channel
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

/** Count CRM outbox side-effect rows under a draft's send jobKey. */
async function outboxCount(db: Database, draftId: string): Promise<number> {
  const rows = await db
    .select({ id: sfOutbox.id })
    .from(sfOutbox)
    .where(eq(sfOutbox.jobKey, `outreach_send:${draftId}:sf-task`));
  return rows.length;
}

// ── Token scenarios ───────────────────────────────────────────────────────────
//
// Exactly ONE of these holds per run. Only "valid" should produce a send; every
// other scenario (and every opted-out Target) must produce ZERO side effects.
const TOKEN_SCENARIOS = [
  "valid", // a freshly-issued, correctly-bound token
  "opted_out", // a valid token, but the Target is on the do-not-contact list
  "unknown", // a well-formed uuid that was never issued
  "non_uuid", // a malformed (non-uuid) token string
  "expired", // a token issued already past its TTL
  "wrong_user", // a valid token presented by a DIFFERENT rep
  "wrong_draft", // a valid token issued for a DIFFERENT draft
  "reused", // a token already consumed by a prior valid send
] as const;
type TokenScenario = (typeof TOKEN_SCENARIOS)[number];

const scenarioArb = fc.record({
  scenario: fc.constantFrom<TokenScenario>(...TOKEN_SCENARIOS),
  channel: fc.constantFrom<Channel>("email", "whatsapp", "message"),
  emailSeed: fc.integer({ min: 0, max: 1_000_000 }),
  phoneSeed: fc.integer({ min: 100_000, max: 999_999 }),
});

let adapter: CountingChannelAdapter;

beforeEach(() => {
  adapter = new CountingChannelAdapter();
  // Exercise the REAL durable, admin_confirmations-backed Approval_Flow store
  // (the reused S1 admin confirmation mechanism) + the fake channel transport.
  setOutreachApprovalStore(createDurableOutreachApprovalStore());
  setOutreachChannelAdapter(adapter);
});

afterEach(() => {
  _resetOutreachApprovalStoreForTests();
  _resetOutreachChannelAdapterForTests();
});

// The spec baseline for this non-optional property (Property 5) is >= 100
// iterations; overridable upward via FAST_CHECK_NUM_RUNS for CI.
const NUM_RUNS = Math.max(100, Number(process.env.FAST_CHECK_NUM_RUNS) || 0);

describe("Property 5: approval-gated send (valid single-use token ⇔ send; opted-out never sent)", () => {
  it(
    "a send side effect occurs iff a valid single-use rep+draft-bound token is presented and the Target is not opted out",
    async () => {
      await fc.assert(
        fc.asyncProperty(scenarioArb, async (spec) => {
          const db = buildDb();
          // A fresh counting adapter per run keeps deltas isolated; the durable
          // store lives in admin_confirmations (also fresh per `buildDb`).
          adapter = new CountingChannelAdapter();
          setOutreachChannelAdapter(adapter);

          const rep = randomUUID();
          await db.execute(sql`INSERT INTO "users" ("id") VALUES (${rep})`);
          const repCtx: ToolContext = { actor: "rep:outreach", userId: rep };

          const email = `buyer${spec.emailSeed}@example.com`;
          const phoneHash = `hash-${spec.phoneSeed}`;
          const rawPhone = `+9715${spec.phoneSeed}`;

          const targetId = await seedTarget(
            db,
            spec.channel,
            email,
            phoneHash,
            rawPhone
          );
          const draftId = await seedDraft(db, targetId, spec.channel);

          // Build the (token, ctx) to PRESENT to the measured send, plus any
          // setup the scenario needs. `shouldSend` is the expected outcome.
          let token: string;
          let presentCtx: ToolContext = repCtx;
          let shouldSend = false;

          switch (spec.scenario) {
            case "valid": {
              const a = await approve(db, repCtx, { draftId });
              token = a.token!;
              shouldSend = true;
              break;
            }
            case "opted_out": {
              const a = await approve(db, repCtx, { draftId });
              token = a.token!;
              // Opt the Target out on the key the send path matches (email for
              // the email channel, salted phone hash for the phone channels).
              if (spec.channel === "email") {
                await db
                  .insert(prospectOptouts)
                  .values({ matchKind: "email", matchValue: email });
              } else {
                await db
                  .insert(prospectOptouts)
                  .values({ matchKind: "phone_hash", matchValue: phoneHash });
              }
              shouldSend = false;
              break;
            }
            case "unknown": {
              // Approve (so the draft is `approved`), but present a never-issued
              // uuid instead of the real token.
              await approve(db, repCtx, { draftId });
              token = randomUUID();
              shouldSend = false;
              break;
            }
            case "non_uuid": {
              await approve(db, repCtx, { draftId });
              token = "not-a-valid-uuid-token";
              shouldSend = false;
              break;
            }
            case "expired": {
              // Issue a token already past its TTL directly through the store.
              const rec = await getOutreachApprovalStore().issue(
                db,
                rep,
                draftId,
                -1000
              );
              token = rec.token;
              shouldSend = false;
              break;
            }
            case "wrong_user": {
              const a = await approve(db, repCtx, { draftId });
              token = a.token!;
              // A DIFFERENT rep presents the rep-bound token.
              presentCtx = { actor: "rep:outreach", userId: randomUUID() };
              shouldSend = false;
              break;
            }
            case "wrong_draft": {
              // Token issued for a SECOND draft, presented against the first.
              const otherDraftId = await seedDraft(db, targetId, spec.channel);
              const a = await approve(db, repCtx, { draftId: otherDraftId });
              token = a.token!;
              shouldSend = false;
              break;
            }
            case "reused": {
              // Approve + a first VALID send consumes the token (preamble side
              // effect); the MEASURED attempt then replays the spent token.
              const a = await approve(db, repCtx, { draftId });
              token = a.token!;
              const first = await send(db, repCtx, { draftId, token });
              expect(first.sent).toBe(true);
              shouldSend = false;
              break;
            }
          }

          // ── Measure the side-effect delta around the single send attempt ────
          const beforeSends = adapter.sent.length;
          const beforeOutbox = await outboxCount(db, draftId);
          const statusBefore = await statusOf(db, draftId);

          const out = await send(db, presentCtx, { draftId, token });

          const afterSends = adapter.sent.length;
          const afterOutbox = await outboxCount(db, draftId);
          const statusAfter = await statusOf(db, draftId);

          const sendDelta = afterSends - beforeSends;
          const outboxDelta = afterOutbox - beforeOutbox;

          if (shouldSend) {
            // VALID token + not opted out → EXACTLY ONE external send and ONE
            // outbox side effect; the draft is now `sent`.
            expect(out.sent).toBe(true);
            expect(out.status).toBe("sent");
            expect(sendDelta).toBe(1);
            expect(outboxDelta).toBe(1);
            expect(statusAfter).toBe("sent");
            // The transport saw the real recipient for the channel.
            const last = adapter.sent[adapter.sent.length - 1];
            expect(last.to).toBe(spec.channel === "email" ? email : rawPhone);
          } else {
            // No valid authorisation (or opted out) → NO NEW external send and
            // NO NEW outbox side effect from the measured attempt. This delta is
            // the heart of Property 5 and holds for EVERY non-valid scenario.
            expect(sendDelta).toBe(0);
            expect(outboxDelta).toBe(0);

            if (spec.scenario === "opted_out") {
              // A valid token but an opted-out Target: refused, draft suppressed,
              // never sent (Req 7.3).
              expect(out.sent).toBe(false);
              expect(out.reason).toBe("opted_out");
              expect(statusAfter).toBe("suppressed");
            } else if (spec.scenario === "reused") {
              // The spent token can never authorise a SECOND send: the draft was
              // already sent by the preamble, so re-presenting it is an
              // idempotent no-op that produces no new side effect (single-use,
              // Req 7.1 / CC-Idem).
              expect(out.alreadySent).toBe(true);
              expect(statusAfter).toBe("sent");
            } else {
              // unknown / non_uuid / expired / wrong_user / wrong_draft: the
              // token gate refuses with a re-approve prompt and the draft is
              // never flipped to `sent`.
              expect(out.sent).toBe(false);
              expect(out.message).toBeTruthy();
              expect(statusAfter).toBe(statusBefore);
              expect(statusAfter).not.toBe("sent");
            }
          }
        }),
        { numRuns: NUM_RUNS }
      );
    },
    120_000
  );
});
