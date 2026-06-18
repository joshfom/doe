import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

/**
 * Tests for the task-9.4 tool handlers: `update_qualification`,
 * `check_viewing_slots`, `book_viewing`, `queue_report_email`, and
 * `log_outcome`.
 *
 *   - update_qualification: partial upsert onto leads_mirror (Req 6.4).
 *   - check_viewing_slots: reads only un-taken slots for the project, shaped per
 *     viewingSlotSchema, optionally narrowed by a date hint (Req 6.7).
 *   - book_viewing: reuses the audited bookAppointment, links rep/slot/project,
 *     marks the slot taken, and enqueues exactly one `appt:{id}` outbox event
 *     (Req 6.7, 13.4).
 *   - queue_report_email / log_outcome: idempotent enqueue keyed for de-dup
 *     (Req 9.5, Design §8.4).
 *
 * **Validates: Requirements 6.4, 6.7, 13.4**
 *
 * Harness mirrors `registry.test.ts`: pg-mem + migration 0029 over the base
 * tables the voice surface ALTERs.
 */

const sfSpies = {
  authenticate: vi.fn(),
  createCase: vi.fn(),
  updateCase: vi.fn(),
  getCaseStatus: vi.fn(),
};

vi.mock("../../tickets/crm/salesforce", () => {
  class MockSalesforceAdapter {
    name = "salesforce";
    authenticate = sfSpies.authenticate;
    createCase = sfSpies.createCase;
    updateCase = sfSpies.updateCase;
    getCaseStatus = sfSpies.getCaseStatus;
  }
  return {
    SalesforceAdapter: MockSalesforceAdapter,
    withRetry: vi.fn((fn: () => unknown) => fn()),
  };
});

import * as schema from "../../schema";
import {
  parties,
  leadsMirror,
  reps,
  viewingSlots,
  aiAppointments,
  sfOutbox,
  jobs,
} from "../../schema";
import type { Database } from "../../db";
import { toolRegistry } from "./registry";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "participant_name" text,
    "participant_phone" text,
    "participant_email" text,
    "participant_type" text NOT NULL DEFAULT 'visitor',
    "client_id" uuid,
    "tenant_id" uuid,
    "channel" text,
    "language" text NOT NULL DEFAULT 'en',
    "status" text NOT NULL DEFAULT 'active',
    "handoff_summary" jsonb,
    "otp_verification_state" text NOT NULL DEFAULT 'not_required',
    "resolved_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
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
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
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

  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
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

const CTX = { actor: "agent:voice-lead" } as const;

async function seedParty(db: Database, name?: string): Promise<string> {
  const partyId = randomUUID();
  await db.insert(parties).values({ id: partyId, type: "person", name, language: "en" });
  return partyId;
}

async function seedRep(db: Database, name: string): Promise<string> {
  const repId = randomUUID();
  await db.insert(reps).values({ id: repId, name, capacity: 3, openHotCount: 0 });
  return repId;
}

async function seedSlot(
  db: Database,
  opts: { project: string; startsAt: Date; repId?: string; taken?: boolean }
): Promise<string> {
  const slotId = randomUUID();
  await db.insert(viewingSlots).values({
    id: slotId,
    project: opts.project,
    startsAt: opts.startsAt,
    repId: opts.repId,
    taken: opts.taken ?? false,
  });
  return slotId;
}

// ── update_qualification ──────────────────────────────────────────────────────

describe("update_qualification — partial upsert onto leads_mirror (Req 6.4)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("creates the mirror row from the first fact and returns ok", async () => {
    const partyId = await seedParty(db);
    const res = await toolRegistry.update_qualification.handler(db, CTX, {
      partyId,
      budgetBand: "2.5-3.0M",
      unitType: "2BR",
    });
    expect(res).toEqual({ ok: true });

    const [row] = await db
      .select({ budgetBand: leadsMirror.budgetBand, unitInterest: leadsMirror.unitInterest })
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, partyId));
    expect(row.budgetBand).toBe("2.5-3.0M");
    expect(row.unitInterest).toBe("2BR");
  });

  it("does not clobber a previously-captured fact with an absent field", async () => {
    const partyId = await seedParty(db);
    await toolRegistry.update_qualification.handler(db, CTX, {
      partyId,
      budgetBand: "2.5-3.0M",
    });
    // Second turn supplies only unitType — budgetBand must survive.
    await toolRegistry.update_qualification.handler(db, CTX, {
      partyId,
      unitType: "3BR",
    });

    const [row] = await db
      .select({ budgetBand: leadsMirror.budgetBand, unitInterest: leadsMirror.unitInterest })
      .from(leadsMirror)
      .where(eq(leadsMirror.partyId, partyId));
    expect(row.budgetBand).toBe("2.5-3.0M");
    expect(row.unitInterest).toBe("3BR");
  });
});

// ── check_viewing_slots ────────────────────────────────────────────────────────

describe("check_viewing_slots — un-taken slots for the project (Req 6.7)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("returns only un-taken slots for the project, oldest-first, with rep name", async () => {
    const repId = await seedRep(db, "Aisha");
    const later = await seedSlot(db, { project: "Bayn", startsAt: new Date("2025-02-02T11:00:00Z"), repId });
    const earlier = await seedSlot(db, { project: "Bayn", startsAt: new Date("2025-02-01T10:00:00Z"), repId });
    await seedSlot(db, { project: "Bayn", startsAt: new Date("2025-02-03T10:00:00Z"), taken: true });
    await seedSlot(db, { project: "Marina", startsAt: new Date("2025-02-01T10:00:00Z") });

    const { slots } = await toolRegistry.check_viewing_slots.handler(db, CTX, {
      project: "Bayn",
    });

    expect(slots.map((s) => s.id)).toEqual([earlier, later]);
    expect(slots[0]).toMatchObject({ project: "Bayn", repName: "Aisha" });
    expect(slots[0].startsAt).toBe("2025-02-01T10:00:00.000Z");
  });

  it("narrows results when a YYYY-MM-DD date hint is given", async () => {
    await seedSlot(db, { project: "Bayn", startsAt: new Date("2025-02-01T10:00:00Z") });
    const onDay = await seedSlot(db, { project: "Bayn", startsAt: new Date("2025-02-05T10:00:00Z") });

    const { slots } = await toolRegistry.check_viewing_slots.handler(db, CTX, {
      project: "Bayn",
      dateHint: "2025-02-05",
    });
    expect(slots.map((s) => s.id)).toEqual([onDay]);
  });

  it("ignores a non-date free-form hint rather than filtering everything out", async () => {
    await seedSlot(db, { project: "Bayn", startsAt: new Date("2025-02-01T10:00:00Z") });
    const { slots } = await toolRegistry.check_viewing_slots.handler(db, CTX, {
      project: "Bayn",
      dateHint: "sometime next week",
    });
    expect(slots).toHaveLength(1);
  });
});

// ── book_viewing ───────────────────────────────────────────────────────────────

describe("book_viewing — audited booking + link + outbox (Req 6.7, 13.4)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("books the slot, links rep/slot/project, marks it taken, and enqueues one outbox event", async () => {
    const partyId = await seedParty(db, "Sara");
    const repId = await seedRep(db, "Aisha");
    const slotId = await seedSlot(db, {
      project: "Bayn",
      startsAt: new Date("2025-03-01T14:00:00Z"),
      repId,
    });

    const res = await toolRegistry.book_viewing.handler(db, CTX, { partyId, slotId });

    expect(res.repName).toBe("Aisha");
    expect(res.when).toBe("2025-03-01T14:00:00.000Z");
    expect(res.appointmentId).toBeTruthy();

    // Appointment linked to rep/slot/project.
    const [appt] = await db
      .select({
        repId: aiAppointments.repId,
        slotId: aiAppointments.slotId,
        project: aiAppointments.project,
        date: aiAppointments.scheduledDate,
        time: aiAppointments.scheduledTime,
      })
      .from(aiAppointments)
      .where(eq(aiAppointments.id, res.appointmentId));
    expect(appt.repId).toBe(repId);
    expect(appt.slotId).toBe(slotId);
    expect(appt.project).toBe("Bayn");
    expect(appt.date).toBe("2025-03-01");
    expect(String(appt.time)).toMatch(/^14:00/);

    // Slot marked taken.
    const [slot] = await db
      .select({ taken: viewingSlots.taken })
      .from(viewingSlots)
      .where(eq(viewingSlots.id, slotId));
    expect(slot.taken).toBe(true);

    // Exactly one outbox event keyed appt:{id}.
    const outbox = await db
      .select({ kind: sfOutbox.kind, jobKey: sfOutbox.jobKey })
      .from(sfOutbox)
      .where(eq(sfOutbox.jobKey, `appt:${res.appointmentId}`));
    expect(outbox).toHaveLength(1);
    expect(outbox[0].kind).toBe("event");
  });

  it("throws when the slot is already taken", async () => {
    const partyId = await seedParty(db, "Sara");
    const slotId = await seedSlot(db, {
      project: "Bayn",
      startsAt: new Date("2025-03-02T14:00:00Z"),
      taken: true,
    });
    await expect(
      toolRegistry.book_viewing.handler(db, CTX, { partyId, slotId })
    ).rejects.toThrow(/already taken/);
  });

  it("throws when the slot does not exist", async () => {
    const partyId = await seedParty(db, "Sara");
    await expect(
      toolRegistry.book_viewing.handler(db, CTX, { partyId, slotId: randomUUID() })
    ).rejects.toThrow(/not found/);
  });
});

// ── queue_report_email + log_outcome ────────────────────────────────────────────

describe("queue_report_email — idempotent enqueue by scope:period (Req 9.5)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("enqueues a compile_and_email_report job and de-dups by jobKey", async () => {
    const input = { requesterEmail: "exec@doe.local", scope: "exec", period: "overall" };
    const first = await toolRegistry.queue_report_email.handler(db, CTX, input);
    const second = await toolRegistry.queue_report_email.handler(db, CTX, input);

    expect(first.jobId).toBe(second.jobId);
    const rows = await db
      .select({ kind: jobs.kind, jobKey: jobs.jobKey })
      .from(jobs)
      .where(eq(jobs.jobKey, "report:exec:overall"));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("compile_and_email_report");
  });
});

describe("log_outcome — enqueues a Salesforce task via the outbox (Design §8.4)", () => {
  let db: Database;
  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("enqueues a task and de-dups identical free text, but distinct text enqueues a new row", async () => {
    const repId = randomUUID();
    const partyId = randomUUID();

    const a = await toolRegistry.log_outcome.handler(db, CTX, {
      repId,
      partyId,
      freeText: "Caller wants a callback tomorrow.",
    });
    const aAgain = await toolRegistry.log_outcome.handler(db, CTX, {
      repId,
      partyId,
      freeText: "Caller wants a callback tomorrow.",
    });
    const b = await toolRegistry.log_outcome.handler(db, CTX, {
      repId,
      partyId,
      freeText: "Different note entirely.",
    });

    expect(a.outboxId).toBe(aAgain.outboxId);
    expect(b.outboxId).not.toBe(a.outboxId);

    const tasks = await db
      .select({ kind: sfOutbox.kind })
      .from(sfOutbox)
      .where(eq(sfOutbox.kind, "task"));
    expect(tasks).toHaveLength(2);
  });
});
