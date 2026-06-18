import { sql } from "drizzle-orm";
import type { Database } from "../db";
import { events } from "../schema";

// ── DOE event surface (SSE event bus) ─────────────────────────────────────────
// Append-only event log feeding the Server-Sent Events stream consumed by the
// Demo Console. `publishEvent` inserts one row into `events` and issues a
// Postgres NOTIFY on the `doe_events` channel carrying ONLY the event id; the
// subscriber re-reads the full row by id. This keeps the NOTIFY payload tiny
// (well under Postgres' 8KB limit) and the `events` table the single source of
// truth for replay + live delivery. (Design §6/7.6, §15; Requirements 7.2, 11.3)

/** Postgres LISTEN/NOTIFY channel for the DOE event surface. */
export const DOE_EVENTS_CHANNEL = "doe_events";

/**
 * The set of event types emitted across the voice surface and the agentic
 * runtime. Consumed by the Demo Console panes (transcript, decisions, actions,
 * outbox, jobs, agent reasoning).
 *
 * The `agent.*` family is emitted by the Mastra tracing exporter
 * (`lib/cms/agents/tracing.ts`) so an agent's reasoning — run lifecycle, each
 * step, decisions, tool calls, and budget halts — is visible on the existing
 * Console (Design §Components #5, §Data Models (Enum extension); Requirement
 * 6.2). `events.type` is plain `text`, so adding these needs no DB migration —
 * the same precedent the voice surface set for its channel/status values.
 */
export type DoeEventType =
  | "session.created"
  | "call.connected"
  | "call.ended"
  | "call.processed"
  | "turn.appended"
  | "tool.called"
  | "decision.made"
  | "outbox.queued"
  | "outbox.sent"
  | "outbox.dead"
  | "job.queued"
  | "job.running"
  | "job.done"
  | "job.failed"
  | "report.sent"
  // Agentic Reporting (S4) — emailed-report failure, discriminated by mode
  // (unavailable/empty metrics 7.7, PDF render failure 7.8, Graph send failure
  // 7.4). `events.type` is plain `text`, so this needs no DB migration.
  | "report.failed"
  // Agentic Foundation (S1) — Mastra agent tracing (Req 6.2).
  | "agent.run.started"
  | "agent.step"
  | "agent.decision"
  | "agent.tool.called"
  | "agent.run.finished"
  | "agent.budget.exceeded"
  // Lead Engine (S3) — lead-lifecycle events (Req 4.8, 6.3). `events.type` is
  // plain `text`, so these need no DB migration — the same precedent S1 set for
  // the `agent.*` family.
  | "lead.ingested"
  | "lead.parsed"
  | "lead.resolved"
  | "lead.conflict"
  | "lead.routed"
  | "lead.unrouted"
  | "lead.enriched"
  | "lead.nudged"
  | "lead.nudge.suppressed"
  | "lead.source.unconfigured"
  // Prospecting Workspace (S7) — prospecting/market lifecycle events (Req 10.1).
  // `events.type` is plain `text`, so these need no DB migration — the same
  // precedent S1 set for the `agent.*` family.
  | "prospecting.brief.received"
  | "prospecting.comparables.found"
  | "prospecting.hypothesis.proposed"
  | "prospecting.search.completed"
  | "prospecting.target.recorded"
  | "prospecting.target.enriched"
  | "prospecting.target.promoted"
  | "prospecting.outreach.drafted"
  | "prospecting.outreach.approved"
  | "prospecting.outreach.sent"
  | "prospecting.outreach.suppressed"
  | "market.synced"
  | "market.source.unconfigured";

/**
 * A single append-only event row.
 *
 * PRIVACY INVARIANT (Requirement 14.5 / Property 9): `payload` MUST NEVER
 * contain a raw phone number. Callers are responsible for passing privacy-safe
 * payloads (e.g. a salted `phone_hash`, never an E.164 number). The bus only
 * persists what it is handed; it does not scrub payloads, so the invariant is
 * enforced at the call sites and verified by the phone-privacy property test.
 */
export interface DoeEvent {
  id: string;
  type: DoeEventType;
  payload: unknown;
  at: string;
}

/**
 * Publish a DOE event.
 *
 * In a single transaction this:
 *   1. inserts one row into the append-only `events` table, and
 *   2. issues `pg_notify('doe_events', <inserted event id>)` carrying only the
 *      id, so subscribers re-read the persisted row.
 *
 * Atomicity guarantees the NOTIFY never references an id that was not committed.
 *
 * @param db Drizzle database (or transaction) handle.
 * @param e  The event to publish, minus the server-assigned `id`/`at`.
 */
export async function publishEvent(
  db: Database,
  e: Omit<DoeEvent, "id" | "at">
): Promise<void> {
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(events)
      .values({ type: e.type, payload: e.payload })
      .returning({ id: events.id });

    // NOTIFY carries only the event id; the subscriber re-reads the full row.
    await tx.execute(sql`SELECT pg_notify(${DOE_EVENTS_CHANNEL}, ${inserted.id})`);
  });
}
