/**
 * Figure sourcing & attribution for the Agent-First Home / Briefing Surface
 * (S5, Design §Components #11 "Figures come from SQL; the agent narrates").
 *
 * THE ONE RULE, restated for figures: every count or analytics figure on the
 * Home_Surface originates from `queryPipelineMetrics` over the `metrics_*` views
 * through a dispatched Catalog_Entry. The Home_Agent and Briefing_Workflow never
 * compute, recompute, derive, round, or estimate a figure (Req 14.1, 14.2).
 * This PURE module supplies the two guards that back that rule and the
 * no-fabrication tests:
 *
 *   - **Source membership / no fabrication (Req 14.1, 14.2):**
 *     {@link isSourced} answers "is this figure's value present in the figures
 *     actually returned through the Tool_Dispatcher for the turn?" A figure that
 *     is not sourced was computed, estimated, or invented and must be withheld.
 *     Build the membership universe with {@link collectSourcedFacts};
 *     {@link findUnsourced} applies the check across a presented set.
 *
 *   - **Attribution (Req 14.4):** {@link attribute} returns the attribution
 *     triple `{ metricId, scopeId, period }` for a presented figure, so any
 *     surface can trace the figure back to the exact metric, scope, and period
 *     it came from. {@link findUnattributed} flags any presented figure missing
 *     a complete triple.
 *
 * This module performs NO arithmetic on figures. It does not sum, average,
 * round, scale, or otherwise transform a value. It only tests membership by
 * value (verbatim string normalization, never coercion) and extracts the
 * attribution a figure already carries. It is pure (no DB, no I/O, no dispatcher
 * calls) so the figure-sourcing property can be exercised directly over
 * generated inputs.
 *
 * Design references: §Components #11, §Data Models. Requirements: 14.1, 14.2,
 * 14.4, 14.5.
 */

import type { BriefingFigure } from "./types";

/** A figure value as read verbatim from the Metrics_Views. */
type FigureValue = number | string | null | undefined;

// ── Attribution (Req 14.4) ─────────────────────────────────────────────────────

/**
 * The provenance every presented figure carries (Requirement 14.4): the source
 * metric identifier, the scope identifier, and the period it covers. Together
 * they let any surface trace a figure back to the exact `metrics_*` metric and
 * `{ scope, period }` it was read from.
 */
export interface FigureAttribution {
  /** The source metric identifier, e.g. `tierFunnel.hot`. */
  metricId: string;
  /** The scope identifier, e.g. the requesting user / rep. */
  scopeId: string;
  /** The period the figure covers. */
  period: string;
}

/** A figure has a presentable value only if it is present and non-null. */
function isPresent(value: FigureValue): value is number | string {
  return value !== null && value !== undefined;
}

/** True when an attribution triple is complete (every part non-empty). */
function isCompleteAttribution(a: FigureAttribution): boolean {
  return a.metricId.length > 0 && a.scopeId.length > 0 && a.period.length > 0;
}

/**
 * Return the attribution triple `{ metricId, scopeId, period }` for a presented
 * figure (Requirement 14.4). Returns `null` when the figure is not presentable
 * — it is withheld (`available === false`, Req 14.5), it has no value, or its
 * attribution triple is incomplete — so callers obtain a complete triple or
 * nothing. A non-null result is a guarantee the presented figure carries a full
 * attribution.
 *
 * Pure; extracts identifiers only and performs no arithmetic on the value.
 */
export function attribute(figure: BriefingFigure): FigureAttribution | null {
  if (!figure.available) return null;
  if (!isPresent(figure.value)) return null;
  const attribution: FigureAttribution = {
    metricId: figure.metricId,
    scopeId: figure.scopeId,
    period: figure.period,
  };
  return isCompleteAttribution(attribution) ? attribution : null;
}

/**
 * Return the presented figures whose attribution is incomplete (Requirement
 * 14.4). A presented figure is one marked `available`; a withheld figure
 * (`available === false`) is not presented and is not checked. An empty result
 * means every presented figure carries a complete `{ metricId, scopeId,
 * period }` triple.
 *
 * Pure; reads nothing and transforms no value.
 */
export function findUnattributed(
  figures: readonly BriefingFigure[],
): BriefingFigure[] {
  return figures.filter((f) => f.available && attribute(f) === null);
}

// ── Source membership / no fabrication (Req 14.1, 14.2) ────────────────────────

/**
 * The universe of figures legitimately obtained through the Tool_Dispatcher for
 * a turn — the figures returned by the Metrics_Views (via the dispatched
 * `get_pipeline_summary`) and any figures carried on records returned through
 * the dispatcher. A presented figure is "sourced" if and only if its value is a
 * member of this set (Requirement 14.1, 14.2).
 *
 * Build one with {@link collectSourcedFacts}; it is the only legitimate origin
 * of any figure the Home_Surface may present.
 */
export interface SourcedFacts {
  /** Normalized membership keys of every figure obtained through the dispatcher. */
  readonly keys: ReadonlySet<string>;
}

/**
 * Normalize a figure value to a membership key. Numbers and strings normalize to
 * their verbatim string form (e.g. `42` and the stated `"42"` share a key) so a
 * figure narrated as text matches the SQL value it was read from. This is string
 * formatting, NOT arithmetic — no rounding, scaling, or unit change is applied,
 * so `42` and `42.0` are distinct keys and never coincide. Absent values
 * (null/undefined) have no key.
 */
function figureKey(value: FigureValue): string | null {
  if (!isPresent(value)) return null;
  return String(value);
}

/**
 * Collect the source-membership universe from the dispatched results — the
 * figure maps read from the Metrics_Views for the turn, plus any maps of
 * record-sourced figures returned through the dispatcher, and/or raw value
 * lists. Every present (non-null) value becomes a membership key (Requirement
 * 14.1, 14.2).
 *
 * Pure; performs no arithmetic. `undefined`/`null` sources are ignored so
 * callers can pass optional surfaces directly.
 */
export function collectSourcedFacts(
  ...sources: Array<
    Record<string, FigureValue> | readonly FigureValue[] | undefined | null
  >
): SourcedFacts {
  const keys = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    const values: FigureValue[] = Array.isArray(source)
      ? [...source]
      : Object.values(source as Record<string, FigureValue>);
    for (const value of values) {
      const key = figureKey(value);
      if (key !== null) keys.add(key);
    }
  }
  return { keys };
}

/**
 * True when a presented figure's value is a member of the figures actually
 * returned through the Tool_Dispatcher for the turn (Requirement 14.1, 14.2) —
 * i.e. the figure was read from the Metrics_Views or a dispatched record, not
 * computed, estimated, or invented by the model.
 *
 * A withheld figure (`available === false`, Req 14.5) presents no value and is
 * never sourced; an absent value (null/undefined) is never sourced.
 *
 * Pure; tests membership by value only, with no arithmetic or coercion beyond
 * verbatim string normalization (see {@link figureKey}).
 */
export function isSourced(
  figure: BriefingFigure,
  sourcedFacts: SourcedFacts,
): boolean {
  if (!figure.available) return false;
  const key = figureKey(figure.value);
  if (key === null) return false;
  return sourcedFacts.keys.has(key);
}

/**
 * Return the presented figures whose values are NOT sourced from the dispatched
 * results (Requirement 14.1, 14.2). A presented figure is one marked
 * `available`; a withheld figure is not presented and is not checked. An empty
 * result means every presented figure is backed by a figure the dispatcher
 * returned; a non-empty result lists exactly the fabricated/unsourced figures
 * the Home_Surface must withhold.
 *
 * Pure; no arithmetic, no I/O.
 */
export function findUnsourced(
  figures: readonly BriefingFigure[],
  sourcedFacts: SourcedFacts,
): BriefingFigure[] {
  return figures.filter((f) => f.available && !isSourced(f, sourcedFacts));
}
