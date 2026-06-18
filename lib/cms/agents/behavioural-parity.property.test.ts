import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import fc from "fast-check";

/**
 * Behavioural-parity property test (task 5.5 — a non-optional CC-NoRegress
 * boundary test).
 *
 *   **Feature: agentic-foundation, Property 12: For any equivalent request to a
 *   migrated capability, serving it via the Mastra agent path produces the same
 *   persisted state and the same audit outcome (including actor attribution
 *   semantics) as the deterministic path — including identical rejection of slot
 *   conflicts and invalid lifecycle transitions for booking/cancel/reschedule.**
 *
 * **Validates: Requirements 8.3, 8.5, 10.3, 14.1**
 *
 * ── What "the agent path" means here, and why we do NOT drive a live LLM ──────
 *
 * The Mastra agent path runs `agent.generate()`, which needs a live model and is
 * non-deterministic — it cannot be driven inside a property test. But the parity
 * that matters for CC-NoRegress is NOT the model's prose; it is that **when a
 * migrated capability's tool is invoked, it flows through the same audited
 * service + `dispatchTool` seam and produces the same persisted state + audit
 * outcome as the deterministic path for an equivalent request.** Both paths
 * converge on the existing audited service (`bookAppointment`,
 * `cancelAppointment`, `rescheduleAppointment`, `createTicket`):
 *
 *   • Deterministic path  → the deterministic executors in `lib/cms/ai/agent.ts`
 *     perform their mutation by calling the audited service directly. We invoke
 *     that same audited service primitive with the request's structured fields.
 *   • Agent path          → the migrated `CatalogEntry` handler
 *     (`lib/cms/ai/tools/text-capabilities.ts`), dispatched through the REAL
 *     `dispatchTool` (Zod → RBAC → OTP → audit → execute), which calls the SAME
 *     audited service (Req 8.2 — the handler reuses the service, never
 *     reimplements the rule).
 *
 * So this test compares, on two identically-seeded `pg-mem` databases:
 *     bookAppointment/cancelAppointment/rescheduleAppointment/createTicket(I)
 *   vs
 *     dispatchTool("create_booking"/"cancel_appointment"/"reschedule_appointment"
 *                  /"create_ticket", I, ctx{actor: agent:text-lead})
 * asserting identical persisted business-entity state and the audit
 * actor-attribution semantics Requirement 10.3 specifies, plus identical
 * rejection of slot conflicts and invalid lifecycle transitions.
 *
 * ── Actor-attribution semantics (Req 10.3) ───────────────────────────────────
 *
 * The two paths record DIFFERENT actors by design: the audited service stamps
 * its own system actor (e.g. the AI system user, action `ai_appointment_create`)
 * while the dispatcher stamps the SERVING agent identity (`agent:text-lead`,
 * action = the tool name). Requirement 10.3 is about the *semantics*, which the
 * design pins down as: exactly one audit row per mutation, action = the tool /
 * intent name, actor = the serving identity. We therefore assert, on success:
 *   1. the audited SERVICE row is produced identically by both paths (proving
 *      the same audited service ran — no rule re-derived); and
 *   2. the agent path adds EXACTLY ONE dispatcher attribution row whose actor is
 *      the serving identity (`agent:text-lead`) and whose action is the tool
 *      name (Req 10.1, 10.2) — which the deterministic path never carries.
 * On rejection neither path writes a successful-mutation service audit row, and
 * the persisted state is left identical and unchanged.
 *
 * ── Harness ──────────────────────────────────────────────────────────────────
 *
 * `pg-mem` (node-postgres adapter) with the appointment / ticket / outbox / audit
 * / RBAC tables created inline, plus the `ticket_number_seq` sequence the ticket
 * service uses. The text-agent RBAC identity `agent:text-lead` is seeded with the
 * `text:*` permission so the real RBAC permission check inside `dispatchTool`
 * grants the dispatch. `getTool` is mocked to resolve the REAL text
 * `CatalogEntry` objects (the canonical catalog the merged Tool_Catalog exposes)
 * so the real dispatcher pipeline + real handler + real audited service all run
 * against `pg-mem` — only the registry *lookup* is widened. The LLM gateway,
 * Salesforce adapter, and CRM sync are mocked so no network is hit; the audited
 * services themselves are never mocked.
 */

const NUM_RUNS = 100;

// ── Module mocks — no network, no model, no CRM. Services are NEVER mocked. ────

// The voice registry imports the LLM gateway at module load.
vi.mock("../ai/gateway", () => ({
  generateCompletion: vi.fn(async () => "Mocked completion."),
  generateEmbedding: vi.fn(async () => new Array(768).fill(0)),
}));

// The voice registry imports the Salesforce adapter; handlers must never reach CRM.
vi.mock("../tickets/crm/salesforce", () => {
  class MockSalesforceAdapter {
    name = "salesforce";
    authenticate = vi.fn();
    createCase = vi.fn();
    updateCase = vi.fn();
    getCaseStatus = vi.fn();
  }
  return {
    SalesforceAdapter: MockSalesforceAdapter,
    withRetry: vi.fn((fn: () => unknown) => fn()),
  };
});

// createTicket fires CRM sync as fire-and-forget; make it a no-op so it never
// touches a crm_sync_log table and never escapes the test as a floating promise.
vi.mock("../tickets/crm/sync", () => ({
  syncTicketToCrm: vi.fn(async () => undefined),
}));

// Widen the dispatcher's tool resolution to the canonical text Tool_Catalog.
// dispatch.ts resolves tools via getTool() from the (voice) registry; the merged
// catalog the design assembles also contains the migrated text capabilities. We
// keep every real registry export and only widen getTool to resolve the REAL
// text CatalogEntry objects so the real dispatcher pipeline + real handlers run.
vi.mock("../ai/tools/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ai/tools/registry")>();
  const { loadTextCapabilities } = await import(
    "../ai/tools/text-capabilities"
  );
  const loaded = loadTextCapabilities();
  const textCatalog = loaded.catalog;
  return {
    ...actual,
    getTool: (name: string) => textCatalog.get(name) ?? actual.getTool(name),
  };
});

import * as schema from "../schema";
import { aiAppointments, auditLog, tickets } from "../schema";
import type { Database } from "../db";
import type { IdentityResult } from "../ai/identity";
import {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
} from "../ai/actions";
import { createTicket } from "../tickets/service";
import { dispatchTool, type DispatchResult } from "../ai/tools/dispatch";
import { TEXT_AGENT_ACTOR } from "../ai/tools/text-capabilities";
import type { ToolContext } from "../ai/tools/registry";

// ── pg-mem harness ────────────────────────────────────────────────────────────

const VISITOR: IdentityResult = { type: "visitor", units: [] };

/** Service-level audit actions a mutation produces (never the dispatcher's). */
const SERVICE_ACTIONS = new Set([
  "ai_appointment_create",
  "ai_appointment_cancel",
  "ticket_create",
]);

const TABLES_SQL = `
  CREATE SEQUENCE "ticket_number_seq" START 1;
  CREATE TABLE "ai_appointments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "reference_number" text NOT NULL UNIQUE,
    "conversation_id" uuid,
    "client_id" uuid,
    "tenant_id" uuid,
    "contact_name" text NOT NULL,
    "contact_email" text,
    "contact_phone" text,
    "appointment_type" text NOT NULL,
    "scheduled_date" date NOT NULL,
    "scheduled_time" time NOT NULL,
    "status" text NOT NULL DEFAULT 'confirmed',
    "notes" text,
    "rep_id" uuid,
    "slot_id" uuid,
    "sf_event_id" text,
    "project" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "tickets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "ticket_number" text NOT NULL UNIQUE,
    "subject" text NOT NULL,
    "description" text NOT NULL,
    "status" text NOT NULL DEFAULT 'open',
    "priority" text NOT NULL DEFAULT 'medium',
    "category" text,
    "request_type" text NOT NULL DEFAULT 'general_inquiry',
    "community_id" uuid,
    "project_id" uuid,
    "unit_number" text,
    "request_data" jsonb,
    "scheduled_start" timestamp,
    "scheduled_end" timestamp,
    "contact_name" text NOT NULL,
    "contact_email" text NOT NULL,
    "contact_phone" text,
    "source" text NOT NULL,
    "assignee_id" uuid,
    "created_by" uuid,
    "external_crm_id" text,
    "first_touch_attribution" jsonb,
    "last_touch_attribution" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "resolved_at" timestamp,
    "closed_at" timestamp
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
  CREATE TABLE "audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL,
    "action" text NOT NULL,
    "entity_type" text NOT NULL,
    "entity_id" text NOT NULL,
    "summary" text NOT NULL,
    "changes" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "roles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "display_name" text NOT NULL,
    "description" text,
    "user_type" text NOT NULL,
    "is_system" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "permissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "resource" text NOT NULL,
    "action" text NOT NULL,
    "description" text
  );
  CREATE TABLE "role_permissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "role_id" uuid NOT NULL,
    "permission_id" uuid NOT NULL
  );
  CREATE TABLE "user_roles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL,
    "role_id" uuid NOT NULL,
    "granted_by" uuid,
    "granted_at" timestamp DEFAULT now() NOT NULL
  );
`;

/**
 * Stand up a fresh pg-mem database with the tables this test needs and the
 * `agent:text-lead` RBAC grant seeded so the real permission check inside
 * `dispatchTool` admits the agent path.
 */
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

  mem.public.none(TABLES_SQL);

  // Seed the text-agent RBAC identity with the `text:*` permission so the real
  // RBAC resolution inside dispatchTool grants every `text:tool:*` permission.
  const roleId = randomUUID();
  const permId = randomUUID();
  mem.public.none(`
    INSERT INTO "roles" ("id","name","display_name","user_type","is_system")
      VALUES ('${roleId}','agent_text_lead','Text Lead Agent','employee',true);
    INSERT INTO "permissions" ("id","resource","action","description")
      VALUES ('${permId}','text','*','All text-agent tool permissions');
    INSERT INTO "role_permissions" ("role_id","permission_id")
      VALUES ('${roleId}','${permId}');
    INSERT INTO "user_roles" ("user_id","role_id")
      VALUES ('${TEXT_AGENT_ACTOR}','${roleId}');
  `);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, mirroring the sibling dispatch tests.
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

/** Insert a pre-existing appointment row (the entity cancel/reschedule act on). */
async function seedAppointment(
  db: Database,
  appt: {
    referenceNumber: string;
    contactName: string;
    appointmentType: string;
    scheduledDate: string;
    scheduledTime: string;
    status: "confirmed" | "cancelled" | "rescheduled";
  }
): Promise<void> {
  await db.insert(aiAppointments).values({
    referenceNumber: appt.referenceNumber,
    contactName: appt.contactName,
    appointmentType: appt.appointmentType as never,
    scheduledDate: appt.scheduledDate,
    scheduledTime: appt.scheduledTime,
    status: appt.status as never,
  });
}

// ── State + audit readers / normalisers ───────────────────────────────────────

/** Normalised appointment rows (id / timestamps excluded — uuid/clock differ). */
async function readAppointments(db: Database) {
  const rows = await db
    .select({
      referenceNumber: aiAppointments.referenceNumber,
      conversationId: aiAppointments.conversationId,
      contactName: aiAppointments.contactName,
      contactEmail: aiAppointments.contactEmail,
      contactPhone: aiAppointments.contactPhone,
      appointmentType: aiAppointments.appointmentType,
      scheduledDate: aiAppointments.scheduledDate,
      scheduledTime: aiAppointments.scheduledTime,
      status: aiAppointments.status,
      notes: aiAppointments.notes,
    })
    .from(aiAppointments);
  return rows
    .map((r) => JSON.stringify(r))
    .sort();
}

/** Normalised ticket rows (id / timestamps / crm id excluded). */
async function readTickets(db: Database) {
  const rows = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      description: tickets.description,
      status: tickets.status,
      priority: tickets.priority,
      requestType: tickets.requestType,
      contactName: tickets.contactName,
      contactEmail: tickets.contactEmail,
      contactPhone: tickets.contactPhone,
      source: tickets.source,
    })
    .from(tickets);
  return rows.map((r) => JSON.stringify(r)).sort();
}

/** All audit rows, as (userId, action, summary) — entityId excluded (uuid). */
async function readAudit(db: Database) {
  return db
    .select({
      userId: auditLog.userId,
      action: auditLog.action,
      summary: auditLog.summary,
    })
    .from(auditLog);
}

/** The service-level mutation audit rows (multiset key), order-independent. */
function serviceAuditKeys(
  rows: Array<{ userId: string; action: string; summary: string }>
) {
  return rows
    .filter((r) => SERVICE_ACTIONS.has(r.action))
    .map((r) => `${r.userId}\u0000${r.action}\u0000${r.summary}`)
    .sort();
}

/** The dispatcher attribution rows for the serving text-agent identity. */
function agentAttributionRows(
  rows: Array<{ userId: string; action: string; summary: string }>
) {
  return rows.filter((r) => r.userId === TEXT_AGENT_ACTOR);
}

function agentCtx(conversationId: string): ToolContext {
  return {
    actor: TEXT_AGENT_ACTOR,
    conversationId,
    identity: VISITOR,
    language: "en",
    otpVerificationState: "not_required",
  };
}

// ── Shared assertions ──────────────────────────────────────────────────────────

/**
 * Assert success parity for an equivalent request:
 *  - identical persisted business-entity state on both DBs;
 *  - identical audited SERVICE row(s) (same audited service ran);
 *  - the agent DB carries EXACTLY ONE dispatcher attribution row (actor = the
 *    serving identity, action = the tool name) that the deterministic DB lacks.
 */
async function assertSuccessParity(
  detDb: Database,
  agentDb: Database,
  toolName: string,
  readState: (db: Database) => Promise<string[]>
) {
  expect(await readState(agentDb)).toEqual(await readState(detDb));

  const detAudit = await readAudit(detDb);
  const agentAudit = await readAudit(agentDb);

  // 1. The audited service produced the same mutation audit row(s) on both paths.
  expect(serviceAuditKeys(agentAudit)).toEqual(serviceAuditKeys(detAudit));
  expect(serviceAuditKeys(detAudit).length).toBeGreaterThan(0);

  // 2. The deterministic path carries NO agent-identity attribution row.
  expect(agentAttributionRows(detAudit)).toHaveLength(0);

  // 3. The agent path adds exactly one attribution row: actor = serving
  //    identity, action = the tool name (Req 10.1, 10.2, 10.3).
  const attribution = agentAttributionRows(agentAudit);
  expect(attribution).toHaveLength(1);
  expect(attribution[0].userId).toBe(TEXT_AGENT_ACTOR);
  expect(attribution[0].action).toBe(toolName);
}

/**
 * Assert rejection parity (slot conflict / invalid lifecycle):
 *  - the deterministic service rejects (throws);
 *  - the agent dispatch resolves to a structured handler_error (never throws);
 *  - persisted state is identical and unchanged on both DBs;
 *  - neither path writes a successful-mutation service audit row.
 */
async function assertRejectionParity(
  detDb: Database,
  agentDb: Database,
  detThrew: boolean,
  agentResult: DispatchResult,
  readState: (db: Database) => Promise<string[]>
) {
  // Deterministic service rejected the equivalent request.
  expect(detThrew).toBe(true);

  // Agent path returned a structured handler error rather than throwing (Req 3.6).
  expect(agentResult.ok).toBe(false);
  if (!agentResult.ok) {
    expect(agentResult.error.code).toBe("handler_error");
  }

  // Persisted state identical and unchanged (no mutation slipped through either).
  expect(await readState(agentDb)).toEqual(await readState(detDb));

  // No successful-mutation service audit row on either path.
  expect(serviceAuditKeys(await readAudit(detDb))).toHaveLength(0);
  expect(serviceAuditKeys(await readAudit(agentDb))).toHaveLength(0);
}

// ── Arbitraries ────────────────────────────────────────────────────────────────

const arbName = fc
  .stringMatching(/^[A-Z][a-z]{1,8}( [A-Z][a-z]{1,8})?$/)
  .filter((s) => s.trim().length > 0);
const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,8}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
    fc.constantFrom("com", "org", "net", "io")
  )
  .map(([l, d, t]) => `${l}@${d}.${t}`);
const arbPhone = fc
  .stringMatching(/^[0-9]{7,10}$/)
  .map((d) => `+9715${d.slice(0, 8)}`);
const arbApptType = fc.constantFrom(
  "site_visit",
  "consultation",
  "payment_discussion",
  "maintenance_request"
);
const arbDate = fc
  .date({
    min: new Date("2026-01-01T00:00:00Z"),
    max: new Date("2026-12-28T00:00:00Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));
const arbHour = fc
  .integer({ min: 9, max: 16 })
  .map((h) => `${String(h).padStart(2, "0")}:00`);
const arbRef = fc
  .integer({ min: 1, max: 999999 })
  .map((n) => `ORA-APT-${String(n).padStart(6, "0")}`);
const arbRequestType = fc.constantFrom(
  "general_inquiry",
  "noc",
  "move_in",
  "maintenance_request"
);
const arbPriority = fc.constantFrom("low", "medium", "high", "urgent");

// ── The parity scenarios ───────────────────────────────────────────────────────

type Scenario =
  | {
      kind: "book_success";
      input: {
        contactName: string;
        contactEmail: string;
        contactPhone: string;
        appointmentType: string;
        scheduledDate: string;
        scheduledTime: string;
        notes: string;
      };
      conversationId: string;
    }
  | {
      kind: "book_conflict";
      occupant: { date: string; time: string };
      input: {
        contactName: string;
        contactEmail: string;
        contactPhone: string;
        appointmentType: string;
        scheduledDate: string;
        scheduledTime: string;
        notes: string;
      };
      conversationId: string;
    }
  | {
      kind: "cancel_success";
      ref: string;
      seed: {
        contactName: string;
        appointmentType: string;
        date: string;
        time: string;
      };
      conversationId: string;
    }
  | {
      kind: "cancel_lifecycle";
      ref: string;
      seed: {
        contactName: string;
        appointmentType: string;
        date: string;
        time: string;
      };
      conversationId: string;
    }
  | {
      kind: "reschedule_success";
      ref: string;
      seed: {
        contactName: string;
        appointmentType: string;
        date: string;
        time: string;
      };
      newDate: string;
      newTime: string;
      conversationId: string;
    }
  | {
      kind: "reschedule_conflict";
      ref: string;
      seed: {
        contactName: string;
        appointmentType: string;
        date: string;
        time: string;
      };
      occupant: { ref: string; date: string; time: string };
      conversationId: string;
    }
  | {
      kind: "reschedule_lifecycle";
      ref: string;
      seed: {
        contactName: string;
        appointmentType: string;
        date: string;
        time: string;
      };
      newDate: string;
      newTime: string;
      conversationId: string;
    }
  | {
      kind: "ticket_success";
      input: {
        contactName: string;
        contactEmail: string;
        contactPhone: string;
        subject: string;
        description: string;
        requestType: string;
        priority: string;
      };
      conversationId: string;
    };

const bookInputArb = fc.record({
  contactName: arbName,
  contactEmail: arbEmail,
  contactPhone: arbPhone,
  appointmentType: arbApptType,
  scheduledDate: arbDate,
  scheduledTime: arbHour,
  // Trim-stable (no leading/trailing whitespace): the catalog input schema
  // applies `.trim()`, so constraining to trim-stable text keeps the request
  // fed to both paths literally equivalent rather than schema-normalised on
  // only one side.
  notes: fc.oneof(
    fc.constant(""),
    fc.stringMatching(/^[A-Za-z]+( [A-Za-z]+){0,3}$/)
  ),
});

const seedArb = fc.record({
  contactName: arbName,
  appointmentType: arbApptType,
  date: arbDate,
  time: arbHour,
});

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
  fc.record({ input: bookInputArb, conversationId: fc.uuid() }).map((s) => ({
    kind: "book_success" as const,
    ...s,
  })),
  fc
    .record({
      occupant: fc.record({ date: arbDate, time: arbHour }),
      input: bookInputArb,
      conversationId: fc.uuid(),
    })
    .map((s) => ({
      kind: "book_conflict" as const,
      // Force the request onto the occupied slot.
      occupant: s.occupant,
      input: {
        ...s.input,
        scheduledDate: s.occupant.date,
        scheduledTime: s.occupant.time,
      },
      conversationId: s.conversationId,
    })),
  fc
    .record({ ref: arbRef, seed: seedArb, conversationId: fc.uuid() })
    .map((s) => ({ kind: "cancel_success" as const, ...s })),
  fc
    .record({ ref: arbRef, seed: seedArb, conversationId: fc.uuid() })
    .map((s) => ({ kind: "cancel_lifecycle" as const, ...s })),
  fc
    .record({
      ref: arbRef,
      seed: seedArb,
      newDate: arbDate,
      newTime: arbHour,
      conversationId: fc.uuid(),
    })
    .map((s) => ({ kind: "reschedule_success" as const, ...s })),
  fc
    .record({
      ref: arbRef,
      seed: seedArb,
      occupantRef: arbRef,
      occDate: arbDate,
      occTime: arbHour,
      conversationId: fc.uuid(),
    })
    .filter((s) => s.ref !== s.occupantRef)
    .map((s) => ({
      kind: "reschedule_conflict" as const,
      ref: s.ref,
      seed: s.seed,
      occupant: { ref: s.occupantRef, date: s.occDate, time: s.occTime },
      conversationId: s.conversationId,
    })),
  fc
    .record({
      ref: arbRef,
      seed: seedArb,
      newDate: arbDate,
      newTime: arbHour,
      conversationId: fc.uuid(),
    })
    .map((s) => ({ kind: "reschedule_lifecycle" as const, ...s })),
  fc
    .record({
      input: fc.record({
        contactName: arbName,
        contactEmail: arbEmail,
        contactPhone: arbPhone,
        // Trim-stable text — the catalog input schema trims subject/description.
        subject: fc.stringMatching(/^[A-Za-z]+( [A-Za-z]+){0,3}$/),
        description: fc.stringMatching(/^[A-Za-z]+( [A-Za-z]+){0,4}$/),
        requestType: arbRequestType,
        priority: arbPriority,
      }),
      conversationId: fc.uuid(),
    })
    .map((s) => ({ kind: "ticket_success" as const, ...s }))
);

/** Run the deterministic audited service for a scenario; report if it threw. */
async function runDeterministic(
  db: Database,
  s: Scenario
): Promise<{ threw: boolean }> {
  try {
    switch (s.kind) {
      case "book_success":
      case "book_conflict":
        await bookAppointment(db, {
          conversationId: s.conversationId,
          contactName: s.input.contactName,
          contactEmail: s.input.contactEmail,
          contactPhone: s.input.contactPhone,
          appointmentType: s.input.appointmentType as never,
          scheduledDate: s.input.scheduledDate,
          scheduledTime: s.input.scheduledTime,
          notes: s.input.notes,
        });
        return { threw: false };
      case "cancel_success":
      case "cancel_lifecycle":
        await cancelAppointment(db, s.ref, s.conversationId);
        return { threw: false };
      case "reschedule_success":
        await rescheduleAppointment(db, s.ref, s.newDate, s.newTime);
        return { threw: false };
      case "reschedule_conflict":
        await rescheduleAppointment(
          db,
          s.ref,
          s.occupant.date,
          s.occupant.time
        );
        return { threw: false };
      case "reschedule_lifecycle":
        await rescheduleAppointment(db, s.ref, s.newDate, s.newTime);
        return { threw: false };
      case "ticket_success":
        await createTicket(db, {
          subject: s.input.subject,
          description: s.input.description,
          contactName: s.input.contactName,
          contactEmail: s.input.contactEmail,
          contactPhone: s.input.contactPhone,
          priority: s.input.priority as never,
          source: "api",
          createdBy: null,
          requestType: s.input.requestType as never,
        });
        return { threw: false };
    }
  } catch {
    return { threw: true };
  }
}

/** Run the agent path (catalog handler via dispatchTool) for a scenario. */
async function runAgent(db: Database, s: Scenario): Promise<DispatchResult> {
  const ctx = agentCtx(s.conversationId);
  switch (s.kind) {
    case "book_success":
    case "book_conflict":
      return dispatchTool(
        db,
        "create_booking",
        {
          contactName: s.input.contactName,
          contactEmail: s.input.contactEmail,
          contactPhone: s.input.contactPhone,
          appointmentType: s.input.appointmentType,
          scheduledDate: s.input.scheduledDate,
          scheduledTime: s.input.scheduledTime,
          notes: s.input.notes,
        },
        ctx
      );
    case "cancel_success":
    case "cancel_lifecycle":
      return dispatchTool(
        db,
        "cancel_appointment",
        { referenceNumber: s.ref },
        ctx
      );
    case "reschedule_success":
      return dispatchTool(
        db,
        "reschedule_appointment",
        { referenceNumber: s.ref, newDate: s.newDate, newTime: s.newTime },
        ctx
      );
    case "reschedule_conflict":
      return dispatchTool(
        db,
        "reschedule_appointment",
        {
          referenceNumber: s.ref,
          newDate: s.occupant.date,
          newTime: s.occupant.time,
        },
        ctx
      );
    case "reschedule_lifecycle":
      return dispatchTool(
        db,
        "reschedule_appointment",
        { referenceNumber: s.ref, newDate: s.newDate, newTime: s.newTime },
        ctx
      );
    case "ticket_success":
      return dispatchTool(
        db,
        "create_ticket",
        {
          contactName: s.input.contactName,
          contactEmail: s.input.contactEmail,
          contactPhone: s.input.contactPhone,
          subject: s.input.subject,
          description: s.input.description,
          requestType: s.input.requestType,
          priority: s.input.priority,
        },
        ctx
      );
  }
}

/** Seed both DBs identically for a scenario's pre-existing state. */
async function seedBoth(detDb: Database, agentDb: Database, s: Scenario) {
  for (const db of [detDb, agentDb]) {
    switch (s.kind) {
      case "book_conflict":
        await seedAppointment(db, {
          referenceNumber: "ORA-APT-900001",
          contactName: "Occupant",
          appointmentType: "site_visit",
          scheduledDate: s.occupant.date,
          scheduledTime: s.occupant.time,
          status: "confirmed",
        });
        break;
      case "cancel_success":
        await seedAppointment(db, {
          referenceNumber: s.ref,
          contactName: s.seed.contactName,
          appointmentType: s.seed.appointmentType,
          scheduledDate: s.seed.date,
          scheduledTime: s.seed.time,
          status: "confirmed",
        });
        break;
      case "cancel_lifecycle":
        await seedAppointment(db, {
          referenceNumber: s.ref,
          contactName: s.seed.contactName,
          appointmentType: s.seed.appointmentType,
          scheduledDate: s.seed.date,
          scheduledTime: s.seed.time,
          status: "cancelled",
        });
        break;
      case "reschedule_success":
        await seedAppointment(db, {
          referenceNumber: s.ref,
          contactName: s.seed.contactName,
          appointmentType: s.seed.appointmentType,
          scheduledDate: s.seed.date,
          scheduledTime: s.seed.time,
          status: "confirmed",
        });
        break;
      case "reschedule_conflict":
        await seedAppointment(db, {
          referenceNumber: s.ref,
          contactName: s.seed.contactName,
          appointmentType: s.seed.appointmentType,
          scheduledDate: s.seed.date,
          scheduledTime: s.seed.time,
          status: "confirmed",
        });
        await seedAppointment(db, {
          referenceNumber: s.occupant.ref,
          contactName: "Occupant",
          appointmentType: "site_visit",
          scheduledDate: s.occupant.date,
          scheduledTime: s.occupant.time,
          status: "confirmed",
        });
        break;
      case "reschedule_lifecycle":
        await seedAppointment(db, {
          referenceNumber: s.ref,
          contactName: s.seed.contactName,
          appointmentType: s.seed.appointmentType,
          scheduledDate: s.seed.date,
          scheduledTime: s.seed.time,
          status: "cancelled",
        });
        break;
      default:
        break;
    }
  }
}

const SUCCESS_KINDS = new Set([
  "book_success",
  "cancel_success",
  "reschedule_success",
  "ticket_success",
]);

const stateReaderFor = (s: Scenario) =>
  s.kind === "ticket_success" ? readTickets : readAppointments;

// ── Property 12 ─────────────────────────────────────────────────────────────

describe("Feature: agentic-foundation, Property 12: behavioural parity between the deterministic path and the migrated Mastra agent path (Req 8.3, 8.5, 10.3, 14.1)", () => {
  it("for any equivalent request, the agent path produces the same persisted state + audit attribution semantics, and rejects slot conflicts / invalid lifecycle transitions identically", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const { db: detDb } = buildDb();
        const { db: agentDb } = buildDb();

        await seedBoth(detDb, agentDb, s);

        const det = await runDeterministic(detDb, s);
        const agent = await runAgent(agentDb, s);

        const readState = stateReaderFor(s);

        if (SUCCESS_KINDS.has(s.kind)) {
          // The deterministic service must have succeeded for an equivalent
          // request, otherwise the scenario is not a valid success case.
          expect(det.threw).toBe(false);
          expect(agent.ok).toBe(true);

          const toolName =
            s.kind === "book_success"
              ? "create_booking"
              : s.kind === "cancel_success"
                ? "cancel_appointment"
                : s.kind === "reschedule_success"
                  ? "reschedule_appointment"
                  : "create_ticket";

          await assertSuccessParity(detDb, agentDb, toolName, readState);
        } else {
          await assertRejectionParity(
            detDb,
            agentDb,
            det.threw,
            agent,
            readState
          );
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// ── Explicit examples — one per scenario family, for clarity ──────────────────

describe("behavioural parity — explicit examples (Req 8.3, 8.5, 10.3, 14.1)", () => {
  it("create_booking success: identical appointment + one agent attribution row", async () => {
    const s: Scenario = {
      kind: "book_success",
      input: {
        contactName: "Sara Khan",
        contactEmail: "sara@doe.com",
        contactPhone: "+971500000001",
        appointmentType: "site_visit",
        scheduledDate: "2026-05-10",
        scheduledTime: "10:00",
        notes: "Looking forward",
      },
      conversationId: randomUUID(),
    };
    const { db: detDb } = buildDb();
    const { db: agentDb } = buildDb();
    const det = await runDeterministic(detDb, s);
    const agent = await runAgent(agentDb, s);
    expect(det.threw).toBe(false);
    expect(agent.ok).toBe(true);
    await assertSuccessParity(detDb, agentDb, "create_booking", readAppointments);
  });

  it("create_booking slot conflict: both reject, state unchanged", async () => {
    const s: Scenario = {
      kind: "book_conflict",
      occupant: { date: "2026-05-11", time: "11:00" },
      input: {
        contactName: "Omar Ali",
        contactEmail: "omar@doe.com",
        contactPhone: "+971500000002",
        appointmentType: "consultation",
        scheduledDate: "2026-05-11",
        scheduledTime: "11:00",
        notes: "",
      },
      conversationId: randomUUID(),
    };
    const { db: detDb } = buildDb();
    const { db: agentDb } = buildDb();
    await seedBoth(detDb, agentDb, s);
    const det = await runDeterministic(detDb, s);
    const agent = await runAgent(agentDb, s);
    await assertRejectionParity(detDb, agentDb, det.threw, agent, readAppointments);
  });

  it("cancel_appointment success: identical cancellation + attribution", async () => {
    const ref = "ORA-APT-000123";
    const s: Scenario = {
      kind: "cancel_success",
      ref,
      seed: {
        contactName: "Lina Park",
        appointmentType: "site_visit",
        date: "2026-06-01",
        time: "12:00",
      },
      conversationId: randomUUID(),
    };
    const { db: detDb } = buildDb();
    const { db: agentDb } = buildDb();
    await seedBoth(detDb, agentDb, s);
    const det = await runDeterministic(detDb, s);
    const agent = await runAgent(agentDb, s);
    expect(det.threw).toBe(false);
    expect(agent.ok).toBe(true);
    await assertSuccessParity(detDb, agentDb, "cancel_appointment", readAppointments);
  });

  it("cancel_appointment invalid lifecycle (already cancelled): both reject", async () => {
    const ref = "ORA-APT-000124";
    const s: Scenario = {
      kind: "cancel_lifecycle",
      ref,
      seed: {
        contactName: "Lina Park",
        appointmentType: "site_visit",
        date: "2026-06-02",
        time: "13:00",
      },
      conversationId: randomUUID(),
    };
    const { db: detDb } = buildDb();
    const { db: agentDb } = buildDb();
    await seedBoth(detDb, agentDb, s);
    const det = await runDeterministic(detDb, s);
    const agent = await runAgent(agentDb, s);
    await assertRejectionParity(detDb, agentDb, det.threw, agent, readAppointments);
  });

  it("reschedule_appointment success: identical move + attribution", async () => {
    const ref = "ORA-APT-000200";
    const s: Scenario = {
      kind: "reschedule_success",
      ref,
      seed: {
        contactName: "Yusuf Adel",
        appointmentType: "consultation",
        date: "2026-07-01",
        time: "09:00",
      },
      newDate: "2026-07-02",
      newTime: "15:00",
      conversationId: randomUUID(),
    };
    const { db: detDb } = buildDb();
    const { db: agentDb } = buildDb();
    await seedBoth(detDb, agentDb, s);
    const det = await runDeterministic(detDb, s);
    const agent = await runAgent(agentDb, s);
    expect(det.threw).toBe(false);
    expect(agent.ok).toBe(true);
    await assertSuccessParity(
      detDb,
      agentDb,
      "reschedule_appointment",
      readAppointments
    );
  });

  it("reschedule_appointment slot conflict: both reject, state unchanged", async () => {
    const s: Scenario = {
      kind: "reschedule_conflict",
      ref: "ORA-APT-000201",
      seed: {
        contactName: "Yusuf Adel",
        appointmentType: "consultation",
        date: "2026-07-03",
        time: "09:00",
      },
      occupant: { ref: "ORA-APT-000202", date: "2026-07-04", time: "16:00" },
      conversationId: randomUUID(),
    };
    const { db: detDb } = buildDb();
    const { db: agentDb } = buildDb();
    await seedBoth(detDb, agentDb, s);
    const det = await runDeterministic(detDb, s);
    const agent = await runAgent(agentDb, s);
    await assertRejectionParity(detDb, agentDb, det.threw, agent, readAppointments);
  });

  it("reschedule_appointment invalid lifecycle (cancelled): both reject", async () => {
    const s: Scenario = {
      kind: "reschedule_lifecycle",
      ref: "ORA-APT-000203",
      seed: {
        contactName: "Yusuf Adel",
        appointmentType: "consultation",
        date: "2026-07-05",
        time: "09:00",
      },
      newDate: "2026-07-06",
      newTime: "14:00",
      conversationId: randomUUID(),
    };
    const { db: detDb } = buildDb();
    const { db: agentDb } = buildDb();
    await seedBoth(detDb, agentDb, s);
    const det = await runDeterministic(detDb, s);
    const agent = await runAgent(agentDb, s);
    await assertRejectionParity(detDb, agentDb, det.threw, agent, readAppointments);
  });

  it("create_ticket success: identical ticket + one agent attribution row", async () => {
    const s: Scenario = {
      kind: "ticket_success",
      input: {
        contactName: "Maya Said",
        contactEmail: "maya@doe.com",
        contactPhone: "+971500000003",
        subject: "Move in permit",
        description: "Need a permit for move in",
        requestType: "general_inquiry",
        priority: "medium",
      },
      conversationId: randomUUID(),
    };
    const { db: detDb } = buildDb();
    const { db: agentDb } = buildDb();
    const det = await runDeterministic(detDb, s);
    const agent = await runAgent(agentDb, s);
    expect(det.threw).toBe(false);
    expect(agent.ok).toBe(true);
    await assertSuccessParity(detDb, agentDb, "create_ticket", readTickets);
  });
});
