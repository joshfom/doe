/**
 * Shared data models for the Agent-First Home / Briefing Surface (S5).
 *
 * This is the canonical home types module named in the design's §Data Models.
 * It carries the surface-facing shapes the pure home modules
 * (`window.ts`, `figures.ts`, `stack.ts`, `briefing-cache.ts`, …), the
 * Briefing_Workflow, and the Home_Agent all share, so a figure, Stack_Item, or
 * Briefing has exactly one definition across the spec.
 *
 * THE ONE RULE (inherited from S1, repeated everywhere it bites): Mastra agents
 * reason and plan; the audited dispatcher executes. Every figure here is read
 * verbatim from the `metrics_*` views through a dispatched Catalog_Entry — never
 * computed, recomputed, rounded, or estimated by the model (Req 14.1, 14.2).
 *
 * Design references: §Data Models. Requirements: 2.1, 2.6, 2.7, 5.7, 9.4,
 * 14.1, 14.2, 14.4, 14.5.
 */

/** The time-of-day class of a Briefing (Requirement 3.3). */
export type BriefingWindow = "morning" | "midday" | "evening";

/**
 * A single entry in the user's Stack for the current period (a task, a lead to
 * follow up, or an appointment). Title and any references are already
 * phone-redacted before presentation (Req 2.7, 9.4): a lead/person reference
 * carries an id or a salted `phone_hash` only — never a raw phone, full or
 * partial.
 */
export interface StackItem {
  id: string;
  kind: "task" | "lead_followup" | "appointment";
  /** Already phone-redacted (Req 2.7, 9.4). */
  title: string;
  status: "open" | "done";
  dueAt: string | null;
  /** References carry ids/hashes only — never a raw phone (Req 2.7, 9.4). */
  leadPhoneHash?: string | null;
}

/**
 * A count or analytics figure presented on the Home_Surface, read verbatim from
 * the Metrics_Views through a dispatched Catalog_Entry. The agent narrates it;
 * it never computes it (Req 14.1, 14.2).
 *
 * Every presented figure carries its full attribution triple so any surface can
 * trace it back to the exact metric, scope, and period it came from (Req 14.4):
 *   - {@link metricId} — the source metric identifier.
 *   - {@link scopeId}  — the scope identifier (e.g. the requesting user / rep).
 *   - {@link period}   — the period the figure covers.
 *
 * {@link available} `false` marks a figure that could not be sourced; such a
 * figure is withheld behind an "unavailable" marker and never substituted with
 * a computed or estimated value (Req 14.5).
 */
export interface BriefingFigure {
  /** Attribution: source metric identifier (Req 14.4). */
  metricId: string;
  /** Attribution: scope identifier (Req 14.4). */
  scopeId: string;
  /** Attribution: period the figure covers (Req 14.4). */
  period: string;
  /** Verbatim from the Metrics_Views — never recomputed (Req 14.1). */
  value: number | string;
  /** `false` → "unavailable" marker, never substituted (Req 14.5). */
  available: boolean;
}

/**
 * An assembled, narrated summary presented on the Home_Surface for a
 * Briefing_Window. The cached JSON *is* this object, which is what guarantees a
 * served cached Briefing presents figures byte-identical to what was assembled
 * (Req 5.7).
 */
export interface Briefing {
  userId: string;
  window: BriefingWindow;
  /** YYYY-MM-DD (local). */
  periodDate: string;
  greeting: string;
  /** The prior period's completed + outstanding Stack_Items, or null. */
  recap: { completed: StackItem[]; outstanding: StackItem[] } | null;
  /** The current period's Stack, or an unavailable marker (Req 2.6). */
  stack: StackItem[] | { unavailable: true };
  figures: BriefingFigure[];
  /** Morning prompts the user to add Stack_Items (Req 2.1). */
  invitesAdd: boolean;
  /** UTC; basis for cache figure parity (Req 5.7). */
  assembledAt: string;
}
