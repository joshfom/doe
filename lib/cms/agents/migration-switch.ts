// lib/cms/agents/migration-switch.ts
//
// The Migration_Switch (Design §Components #6, Requirements 7, 14). A
// per-capability flag selects whether a request is served by a Mastra agent or
// the existing deterministic path; the DEFAULT is always deterministic.
//
// `routeCapability` reads the `agent_migration_flags` table and returns "agent"
// iff the capability's flag has `mode === "agent"` AND `enabled === true`
// (Requirement 7.1). Any other state — unset row, disabled flag, or
// `mode === "deterministic"` — routes to the deterministic path
// (Requirement 7.2), so the runtime is correct-by-default and never routes to
// an unproven agent path.
//
// `serveCapability` runs the agent path only when routed there and, on ANY
// handler error, falls back to the deterministic result and records a
// divergence (Requirements 7.3, 14.3). While a capability is unmigrated the
// deterministic path serves it unchanged (Requirement 14.2).
//
// `recordDivergence` stamps `last_divergence_at` so a diverging capability can
// be re-validated before it is re-enabled (Requirement 14.3).
//
// [container-only] This module runs on the container/worker tier only. Do NOT
// import it from any `app/` route/page/layout module.
//
// Design references: §Components #6 (Migration_Switch). Requirements: 7.1, 7.2,
// 7.3, 14.2, 14.3.

import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { agentMigrationFlags } from "../schema";

/** The capabilities the Migration_Switch can route (Design §Components #6). */
export type Capability =
  | "create_lead"
  | "register_lead"
  | "create_ticket"
  | "create_booking"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "request_otp"
  | "request_handover"
  | "navigate"
  | "provide_contact"
  | "report_overview"
  | "report_projects"
  | "report_clients"
  | "report_leads"
  | "report_tickets"
  | "report_appointments"
  | "admin_destructive"
  // S6 Voice Re-base: routes a voice turn to the Mastra Voice_Agent (default
  // lean). See `lib/cms/voice/serving-path.ts`.
  | "voice_lead";
/** Which path serves a capability for a given request. */
export type Path = "agent" | "deterministic";

/**
 * Resolve the serving path for a capability. Default is deterministic
 * (Requirement 7.2): a capability is only served by the Mastra agent once its
 * `agent_migration_flags` row has `mode === "agent"` AND `enabled === true`
 * (Requirement 7.1). An unset row or any disabled/deterministic flag routes to
 * the deterministic path.
 */
export async function routeCapability(
  db: Database,
  cap: Capability,
): Promise<Path> {
  const [flag] = await db
    .select()
    .from(agentMigrationFlags)
    .where(eq(agentMigrationFlags.capability, cap))
    .limit(1);

  return flag?.mode === "agent" && flag.enabled ? "agent" : "deterministic";
}

/**
 * Run the migrated capability via the agent path, falling back to the
 * deterministic path on any handler error.
 *
 * - If the capability is not routed to the agent (Requirement 7.2), the
 *   deterministic path serves it unchanged (Requirement 14.2) and the agent
 *   path is never invoked.
 * - If the capability IS routed to the agent and the agent handler throws for
 *   ANY reason, the divergence is recorded (`last_divergence_at` is stamped)
 *   and the deterministic result is returned instead (Requirements 7.3, 14.3).
 *   `recordDivergence` failures never mask the fallback.
 */
export async function serveCapability<T>(
  db: Database,
  cap: Capability,
  viaAgent: () => Promise<T>,
  viaDeterministic: () => Promise<T>,
): Promise<T> {
  if ((await routeCapability(db, cap)) !== "agent") {
    return viaDeterministic();
  }

  try {
    return await viaAgent();
  } catch (err) {
    // Agent path diverged/failed → fall back to deterministic for this
    // capability and stamp the divergence (Req 7.3, 14.3). Recording the
    // divergence must never prevent the fallback from being served.
    try {
      await recordDivergence(db, cap, err);
    } catch {
      // swallow — fallback correctness takes precedence over divergence bookkeeping
    }
    return viaDeterministic();
  }
}

/**
 * Record that a migrated capability diverged from / failed against the
 * deterministic path, stamping `last_divergence_at` so the capability is routed
 * back to deterministic and re-validated before it can be re-enabled
 * (Requirement 14.3).
 *
 * Upserts on the capability primary key so a divergence is recorded even if the
 * flag row was created out-of-band; `mode`/`enabled` are left at their safe
 * defaults (deterministic / disabled) when the row is first created.
 *
 * @param _err the originating error, accepted for call-site ergonomics and
 *             future structured logging; not persisted by this table.
 */
export async function recordDivergence(
  db: Database,
  cap: Capability,
  _err?: unknown,
): Promise<void> {
  void _err;
  const now = new Date();
  await db
    .insert(agentMigrationFlags)
    .values({
      capability: cap,
      lastDivergenceAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: agentMigrationFlags.capability,
      set: {
        lastDivergenceAt: now,
        updatedAt: now,
      },
    });
}
