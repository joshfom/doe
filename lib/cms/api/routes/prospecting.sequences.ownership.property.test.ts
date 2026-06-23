import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

import type { Database } from "../../db";
import * as schema from "../../schema";

/**
 * Property 9 — Ownership scoping (Requirements 6.1, 6.3, 7.5, 13.1, 13.2, 13.3,
 * 15.4).
 *
 *   **Feature: prospecting-sequences, Property 9: Ownership scoping.**
 *
 * **Validates: Requirements 6.1, 6.3, 7.5, 13.1, 13.2, 13.3, 15.4**
 *
 * *For any* owner/requester pairing and Sequence set: the index returns EXACTLY
 * the requester's own Sequences (never another rep's), and any read / lifecycle
 * transition / edit on a NON-owned Sequence is reported not-found (`404`) and
 * leaves it unmodified and undisclosed (Req 13.1, 13.2, 13.3). The owner-scoped
 * bridge routes (`lib/cms/api/routes/prospecting.ts`) gate every Sequence access
 * on `owner_rep = ctx.userId`.
 *
 * Driven through the real Elysia routes against an in-memory Postgres (pg-mem)
 * carrying the real `drizzle/0040_agentic_prospecting_batch.sql` +
 * `drizzle/0043_prospecting_sequences.sql` schemas. The RBAC guard is mocked to
 * resolve the requester from a per-request `x-test-user` header so each generated
 * request acts as a different authenticated rep; everything else runs for real.
 */

const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));
const BATCH_MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../../db", () => ({
  get db() {
    return h.db;
  },
}));

// RBAC: resolve the requester from the `x-test-user` request header so each
// generated request can act as a different authenticated rep.
vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      ({ request }: { request: Request }) => ({
        userId: request.headers.get("x-test-user") ?? undefined,
        userType: "employee",
        isActive: true,
      })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:leads:read" }).derive(
        { as: "scoped" },
        () => ({ resolvedPermissions: ["leads:read"] })
      ),
  };
});

// Collaborators the ownership routes do not exercise (reads + lifecycle only).
vi.mock("../../ai/tools/dispatch", () => ({ dispatchTool: vi.fn() }));
vi.mock("../../prospecting/batch/send-cap", () => ({
  capExhausted: vi.fn(async () => false),
  recordSend: vi.fn(async () => {}),
  incrementScope: vi.fn(async () => {}),
}));
vi.mock("../../prospecting/optout", () => ({ isOptedOut: vi.fn(async () => false) }));
vi.mock("../../prospecting/batch/claim", () => ({ releaseClaim: vi.fn(async () => {}) }));
vi.mock("../../prospecting/crm-check", () => ({ checkCrmForContact: vi.fn() }));
vi.mock("../../prospecting/own-subject", () => ({ resolveComparisonSpec: vi.fn() }));
vi.mock("../../jobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("../../ai/gateway", () => ({ generateCompletion: vi.fn() }));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));
vi.mock("../../realtime/events", () => ({ publishEvent: vi.fn(async () => {}) }));
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));

import { Elysia } from "elysia";
import { prospectingRoutes } from "../../api/routes/prospecting";

const PREREQUISITE_SQL = `
  CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE "targets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_type" text NOT NULL,
    "display_name" text,
    "company_name" text,
    "title" text,
    "email" text,
    "phone_hash" text,
    "raw_phone" text,
    "country" text,
    "source_provider" text NOT NULL,
    "lawful_basis" text NOT NULL,
    "status" text NOT NULL DEFAULT 'new',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "outreach_drafts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "target_id" uuid NOT NULL REFERENCES "targets"("id") ON DELETE CASCADE,
    "channel" text NOT NULL,
    "language" text NOT NULL,
    "subject" text,
    "body" text NOT NULL,
    "grounding" jsonb NOT NULL,
    "status" text NOT NULL DEFAULT 'draft',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb,
    "at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "prospecting_sequences" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_rep" uuid NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "subject" jsonb NOT NULL,
    "target_count" integer NOT NULL DEFAULT 10,
    "mode" text NOT NULL DEFAULT 'draft',
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
`;

function applyMigration(mem: IMemoryDb, file: string): void {
  const migration = readFileSync(join(process.cwd(), "drizzle", file), "utf-8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) mem.public.none(trimmed);
  }
}

function buildDb(): {
  mem: IMemoryDb;
  db: Database;
  pool: { end: () => Promise<void> };
} {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => null,
    impure: true,
  });
  mem.public.registerFunction({
    name: "now",
    returns: DataType.timestamptz,
    implementation: () => new Date(),
    impure: true,
  });

  mem.public.none(PREREQUISITE_SQL);

  applyMigration(mem, BATCH_MIGRATION_FILE);
  mem.public.none(
    'ALTER TABLE "prospecting_batch_runs" ADD COLUMN "sequence_id" uuid'
  );
  applyMigration(mem, SEQUENCE_MIGRATION_FILE);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

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
  return { mem, db, pool };
}

let mem!: IMemoryDb;
let db!: Database;
let dbPool!: { end: () => Promise<void> };
let backup!: { restore: () => void };

beforeAll(() => {
  ({ mem, db, pool: dbPool } = buildDb());
  backup = mem.backup();
  h.db = db;
});

afterAll(async () => {
  await dbPool?.end?.();
});

beforeEach(() => {
  vi.clearAllMocks();
});

type SeqStatus = "draft" | "live" | "paused" | "archived";

/** Seed one Sequence owned by `ownerRep` in the given status. */
function seedSequence(
  mem: IMemoryDb,
  ownerRep: string,
  status: SeqStatus
): string {
  const id = randomUUID();
  mem.public.none(
    `INSERT INTO "users" ("id") VALUES ('${ownerRep}') ON CONFLICT DO NOTHING`
  );
  mem.public.none(
    `INSERT INTO "prospecting_sequences" ` +
      `("id", "owner_rep", "name", "subject", "target_count", "mode", "status") ` +
      `VALUES ('${id}', '${ownerRep}', 'seq', ` +
      `'{"kind":"icp","icpFilter":{"targetType":"person"}}'::jsonb, 10, ` +
      `'${status === "live" ? "live" : "draft"}', '${status}')`
  );
  return id;
}

function app() {
  return new Elysia().use(prospectingRoutes);
}

function hdrs(user: string) {
  return { "x-test-user": user, "Content-Type": "application/json" };
}

async function listSequences(user: string): Promise<{ id: string }[]> {
  const res = await app().handle(
    new Request("http://localhost/prospecting/sequences", {
      headers: hdrs(user),
    })
  );
  const body = (await res.json()) as { sequences?: { id: string }[] };
  return body.sequences ?? [];
}

async function getStatus(method: string, path: string, user: string, body?: unknown) {
  const res = await app().handle(
    new Request(`http://localhost/prospecting/${path}`, {
      method,
      headers: hdrs(user),
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  );
  return res.status;
}

async function readRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.prospectingSequences)
    .where(eq(schema.prospectingSequences.id, id));
  return row;
}

const STATUSES: SeqStatus[] = ["draft", "live", "paused", "archived"];
const REPS = ["rep-a", "rep-b", "rep-c"].map(
  (_, i) => `0000000${i}-0000-0000-0000-000000000000`
);

describe("**Feature: prospecting-sequences, Property 9: Ownership scoping.**", () => {
  it("Validates: Requirements 6.1, 6.3, 7.5, 13.1, 13.2, 13.3, 15.4 — the index returns exactly the requester's sequences, and any read/transition/edit on a non-owned sequence is 404 and leaves it unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          owners: fc.array(
            fc.record({
              ownerIdx: fc.integer({ min: 0, max: REPS.length - 1 }),
              status: fc.constantFrom(...STATUSES),
            }),
            { minLength: 1, maxLength: 6 }
          ),
          requesterIdx: fc.integer({ min: 0, max: REPS.length - 1 }),
          op: fc.constantFrom(
            "get",
            "publish",
            "pause",
            "resume",
            "archive",
            "edit"
          ),
        }),
        async ({ owners, requesterIdx, op }) => {
          backup.restore();

          const seeded = owners.map((o) => ({
            id: seedSequence(mem, REPS[o.ownerIdx], o.status),
            ownerIdx: o.ownerIdx,
          }));
          const requester = REPS[requesterIdx];

          // (Req 6.1, 13.1) The index returns EXACTLY the requester's sequences.
          const owned = new Set(
            seeded.filter((s) => s.ownerIdx === requesterIdx).map((s) => s.id)
          );
          const listed = await listSequences(requester);
          const listedIds = new Set(listed.map((s) => s.id));
          expect(listedIds).toEqual(owned);
          for (const row of listed) {
            // Never another rep's sequence.
            expect(owned.has(row.id)).toBe(true);
          }

          // (Req 13.2, 13.3) Any access to a NON-owned sequence → 404 + unchanged.
          const nonOwned = seeded.filter((s) => s.ownerIdx !== requesterIdx);
          for (const s of nonOwned) {
            const before = await readRow(s.id);
            let status: number;
            if (op === "get") {
              status = await getStatus("GET", `sequences/${s.id}`, requester);
            } else if (op === "edit") {
              status = await getStatus("PATCH", `sequences/${s.id}`, requester, {
                name: "hijacked",
              });
            } else {
              status = await getStatus(
                "POST",
                `sequences/${s.id}/${op}`,
                requester
              );
            }
            expect(status).toBe(404);

            // The row is undisclosed AND unmodified.
            const after = await readRow(s.id);
            expect(after.name).toBe(before.name);
            expect(after.status).toBe(before.status);
            expect(after.mode).toBe(before.mode);
            expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  }, 120000);
});
