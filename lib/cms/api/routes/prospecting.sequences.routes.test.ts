import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import type { Database } from "../../db";
import * as schema from "../../schema";

/**
 * Sequences bridge routes — example / integration tests (task 6.6).
 *
 * Exercises the SEQUENCE-SPECIFIC owner-scoped routes
 * (`lib/cms/api/routes/prospecting.ts`) end to end against the real Elysia app
 * over an in-memory Postgres (pg-mem) carrying the real
 * `drizzle/0040_agentic_prospecting_batch.sql` +
 * `drizzle/0043_prospecting_sequences.sql` schemas. Covers:
 *   - unauthenticated read/write → `401` (Req 13.4);
 *   - create validation: `invalid_name` / `invalid_subject` → `400`, draft on
 *     success (Req 2.5, 2.8);
 *   - a never-refreshed Sequence shows an empty last-refresh + zero enrolled
 *     (Req 6.5);
 *   - the Activity_Log aggregates the Sequence's runs in order (Req 7.6);
 *   - the lifecycle routes honour the legal transitions and reject illegal ones
 *     with `409` (Req 1.3–1.7, 7.2).
 *
 * The send / approve / reject / send-cap / SF-outbox behaviours are INHERITED
 * unchanged from the agentic-prospecting-batch queue routes (the Sequence reuses
 * the same Review_Inbox), and are covered by that feature's queue tests
 * (`lib/cms/prospecting/batch/queue.*`, `send-cap.*`) rather than duplicated here.
 */

const BATCH_MIGRATION_FILE = "0040_agentic_prospecting_batch.sql";
const SEQUENCE_MIGRATION_FILE = "0043_prospecting_sequences.sql";

const REP_ID = "11111111-1111-1111-1111-111111111111";

// A switchable auth identity the RBAC mock reads: `undefined` simulates an
// unauthenticated request; otherwise the seeded rep.
const h = vi.hoisted(() => ({
  db: null as unknown,
  userId: "11111111-1111-1111-1111-111111111111" as string | undefined,
}));

vi.mock("../../db", () => ({
  get db() {
    return h.db;
  },
}));

vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: h.userId, userType: "employee", isActive: true })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:leads:read" }).derive(
        { as: "scoped" },
        () => ({ resolvedPermissions: ["leads:read"] })
      ),
  };
});

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
  backup.restore();
  h.userId = REP_ID;
  mem.public.none(
    `INSERT INTO "users" ("id") VALUES ('${REP_ID}') ON CONFLICT DO NOTHING`
  );
});

function app() {
  return new Elysia().use(prospectingRoutes);
}

const HDRS = { "Content-Type": "application/json" };

async function call(method: string, path: string, body?: unknown) {
  const res = await app().handle(
    new Request(`http://localhost/prospecting/${path}`, {
      method,
      headers: HDRS,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  );
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body: json as Record<string, unknown> | null };
}

const VALID_SUBJECT = {
  kind: "icp" as const,
  icpFilter: { targetType: "person" },
};

/** Seed a sequence directly in a given status; returns its id. */
function seedSeq(status: "draft" | "live" | "paused" | "archived"): string {
  const id = randomUUID();
  mem.public.none(
    `INSERT INTO "prospecting_sequences" ` +
      `("id", "owner_rep", "name", "subject", "target_count", "mode", "status") ` +
      `VALUES ('${id}', '${REP_ID}', 'seq', ` +
      `'{"kind":"icp","icpFilter":{"targetType":"person"}}'::jsonb, 10, ` +
      `'${status === "live" ? "live" : "draft"}', '${status}')`
  );
  return id;
}

describe("Sequences bridge routes — integration", () => {
  describe("authentication (Req 13.4)", () => {
    it("rejects unauthenticated reads and writes with 401", async () => {
      const id = seedSeq("draft");
      h.userId = undefined;

      expect((await call("GET", "sequences")).status).toBe(401);
      expect((await call("GET", `sequences/${id}`)).status).toBe(401);
      expect(
        (await call("POST", "sequences", { name: "x", subject: VALID_SUBJECT }))
          .status
      ).toBe(401);
      expect((await call("PATCH", `sequences/${id}`, { name: "y" })).status).toBe(
        401
      );
      expect((await call("POST", `sequences/${id}/publish`)).status).toBe(401);
      expect((await call("POST", `sequences/${id}/pause`)).status).toBe(401);
    });
  });

  describe("create validation (Req 2.5, 2.8)", () => {
    it("rejects a missing name with 400 invalid_name and creates no row", async () => {
      const res = await call("POST", "sequences", { subject: VALID_SUBJECT });
      expect(res.status).toBe(400);
      expect(res.body?.code).toBe("invalid_name");
      const rows = await db.select().from(schema.prospectingSequences);
      expect(rows).toHaveLength(0);
    });

    it("rejects a missing subject with 400 invalid_subject and creates no row", async () => {
      const res = await call("POST", "sequences", { name: "No subject" });
      expect(res.status).toBe(400);
      expect(res.body?.code).toBe("invalid_subject");
      const rows = await db.select().from(schema.prospectingSequences);
      expect(rows).toHaveLength(0);
    });

    it("creates a draft sequence on valid input (Req 1.2)", async () => {
      const res = await call("POST", "sequences", {
        name: "My campaign",
        subject: VALID_SUBJECT,
      });
      expect(res.status).toBe(201);
      const seq = res.body?.sequence as { status: string; mode: string; nextRefreshAt: unknown };
      expect(seq.status).toBe("draft");
      expect(seq.mode).toBe("draft");
      expect(seq.nextRefreshAt).toBeNull();
    });
  });

  describe("never-refreshed read (Req 6.5)", () => {
    it("shows an empty last-refresh and zero enrolled for a fresh sequence", async () => {
      const create = await call("POST", "sequences", {
        name: "Fresh",
        subject: VALID_SUBJECT,
      });
      const id = (create.body?.sequence as { id: string }).id;

      const list = await call("GET", "sequences");
      const listed = (list.body?.sequences as Array<Record<string, unknown>>)[0];
      expect(listed.lastRefreshedAt).toBeNull();
      expect(listed.enrolledProspects).toBe(0);
      expect(listed.pendingProspects).toBe(0);

      const detail = await call("GET", `sequences/${id}`);
      expect((detail.body?.sequence as { lastRefreshedAt: unknown }).lastRefreshedAt).toBeNull();
      expect(detail.body?.enrolledCount).toBe(0);
      expect(detail.body?.activity).toEqual([]);
    });
  });

  describe("activity aggregation across runs (Req 7.6)", () => {
    it("returns the sequence's runs' activity in run-then-seq order", async () => {
      const id = seedSeq("live");
      // Two runs for the sequence, the first created earlier than the second.
      const runA = randomUUID();
      const runB = randomUUID();
      mem.public.none(
        `INSERT INTO "prospecting_batch_runs" ("id","owner_rep","sequence_id","subject","target_count","rerun_key","created_at") ` +
          `VALUES ('${runA}','${REP_ID}','${id}','{"kind":"icp"}'::jsonb,10,'${runA}','2026-01-01T00:00:00Z')`
      );
      mem.public.none(
        `INSERT INTO "prospecting_batch_runs" ("id","owner_rep","sequence_id","subject","target_count","rerun_key","created_at") ` +
          `VALUES ('${runB}','${REP_ID}','${id}','{"kind":"icp"}'::jsonb,10,'${runB}','2026-02-01T00:00:00Z')`
      );
      // Activity rows: run A seq 1,2 then run B seq 1,2.
      const ins = (run: string, seq: number, action: string) =>
        mem.public.none(
          `INSERT INTO "prospecting_batch_activity" ("id","batch_run_id","seq","action") ` +
            `VALUES ('${randomUUID()}','${run}',${seq},'${action}')`
        );
      ins(runA, 1, "discovered");
      ins(runA, 2, "scored");
      ins(runB, 1, "discovered");
      ins(runB, 2, "drafted");

      const detail = await call("GET", `sequences/${id}`);
      const activity = detail.body?.activity as Array<{
        batchRunId: string;
        seq: number;
        action: string;
      }>;
      expect(activity.map((a) => [a.batchRunId, a.seq])).toEqual([
        [runA, 1],
        [runA, 2],
        [runB, 1],
        [runB, 2],
      ]);
    });
  });

  describe("lifecycle routes (Req 1.3–1.7, 7.2)", () => {
    it("walks draft → publish → pause → resume → archive and schedules on publish", async () => {
      const id = seedSeq("draft");

      const publish = await call("POST", `sequences/${id}/publish`);
      expect(publish.status).toBe(200);
      const afterPublish = (publish.body?.sequence as {
        status: string;
        nextRefreshAt: unknown;
      });
      expect(afterPublish.status).toBe("live");
      expect(afterPublish.nextRefreshAt).not.toBeNull();

      const pause = await call("POST", `sequences/${id}/pause`);
      expect(pause.status).toBe(200);
      expect((pause.body?.sequence as { status: string }).status).toBe("paused");

      const resume = await call("POST", `sequences/${id}/resume`);
      expect(resume.status).toBe(200);
      expect((resume.body?.sequence as { status: string }).status).toBe("live");

      const archive = await call("POST", `sequences/${id}/archive`);
      expect(archive.status).toBe(200);
      const archived = archive.body?.sequence as {
        status: string;
        nextRefreshAt: unknown;
        archivedAt: unknown;
      };
      expect(archived.status).toBe("archived");
      expect(archived.nextRefreshAt).toBeNull();
      expect(archived.archivedAt).not.toBeNull();
    });

    it("rejects an illegal transition with 409 and leaves the row unchanged", async () => {
      const id = seedSeq("draft");
      // draft → pause is illegal (only live → pause is allowed).
      const res = await call("POST", `sequences/${id}/pause`);
      expect(res.status).toBe(409);
      expect(res.body?.code).toBe("illegal_transition");

      const [row] = await db
        .select()
        .from(schema.prospectingSequences)
        .where(eq(schema.prospectingSequences.id, id));
      expect(row.status).toBe("draft");
    });

    it("rejects publishing a sequence whose subject does not resolve with 400 invalid_subject (kept draft)", async () => {
      // Seed a draft with an empty (unresolvable) subject directly.
      const id = randomUUID();
      mem.public.none(
        `INSERT INTO "prospecting_sequences" ("id","owner_rep","name","subject","target_count","mode","status") ` +
          `VALUES ('${id}','${REP_ID}','no subject','{}'::jsonb,10,'draft','draft')`
      );
      const res = await call("POST", `sequences/${id}/publish`);
      expect(res.status).toBe(400);
      expect(res.body?.code).toBe("invalid_subject");

      const [row] = await db
        .select()
        .from(schema.prospectingSequences)
        .where(eq(schema.prospectingSequences.id, id));
      expect(row.status).toBe("draft");
    });

    it("reports a lifecycle transition on a non-owned sequence as 404", async () => {
      const id = seedSeq("draft");
      h.userId = "99999999-9999-9999-9999-999999999999";
      const res = await call("POST", `sequences/${id}/publish`);
      expect(res.status).toBe(404);
    });
  });
});
