/**
 * Figure attribution & source-membership checks (Agentic Reporting & C-Level
 * Twin S4, Design §Components #1 "The Reporting_Agent", §Correctness Properties
 * Property 3 "Numbers come from SQL — no fabricated figure" and Property 4
 * "Figure attribution").
 *
 * The Reporting_Agent narrates; it never computes. Two guarantees back that up,
 * and this PURE module supplies the checks for both:
 *
 *   - **Attribution (Req 2.4, Property 4):** every figure the agent presents is
 *     accompanied by an attribution identifying its source metric identifier
 *     and its Report_Scope identifier. {@link attributeFigures} turns a metric
 *     map (the figures read verbatim from the Metrics_Pipeline for one scope)
 *     into {@link AttributedFigure}s, each carrying `{ metricId, scopeId }`.
 *
 *   - **Source membership / no fabrication (Req 1.3, 16.2, Property 3):** every
 *     numeric figure stated must be a member of the figures actually returned by
 *     the Metrics_Pipeline (or a named record returned through the
 *     Tool_Dispatcher). {@link isSourced} answers "did this exact figure come
 *     back from a dispatched tool?"; {@link findUnsourced} / {@link
 *     verifyNoFabrication} apply that check across a set of presented figures so
 *     the agent can refuse to state any figure that is absent from the
 *     dispatched results.
 *
 * THE ONE RULE: this module performs NO arithmetic on figures. It does not sum,
 * average, round, or otherwise transform a value. It only derives identifiers,
 * attaches attribution, and tests membership by value — a figure is read,
 * tagged, and either matched against the dispatched results verbatim or flagged
 * as unsourced.
 *
 * The module is pure (no DB, no I/O, no dispatcher calls) so the attribution
 * property (Property 4) and the no-fabrication property (Property 3) can be
 * exercised directly over generated inputs.
 *
 * Design references: §Components #1, §Correctness Properties (Properties 3, 4).
 * Requirements: 1.3, 2.4, 16.2.
 */

import type { FigureValue } from "./reconcile";
import type { ReportScope } from "./scope";

// ── Attribution ───────────────────────────────────────────────────────────────

/**
 * The provenance attached to a presented figure (Requirement 2.4): the source
 * metric identifier it was read under and the Report_Scope identifier it was
 * fetched for. Together they let any surface trace a figure back to the exact
 * `metrics_*` metric and `{ scope, period, repId? }` it came from.
 */
export interface FigureAttribution {
  /** The source metric identifier, e.g. `tierFunnel.hot`. */
  metricId: string;
  /** The Report_Scope identifier, e.g. `exec:all-time` or `rep:all-time:rep_7`. */
  scopeId: string;
}

/** A figure presented together with its attribution (Requirement 2.4). */
export interface AttributedFigure extends FigureAttribution {
  /** The figure value, read verbatim from the Metrics_Pipeline (never recomputed). */
  value: number | string;
}

/**
 * Derive the canonical Report_Scope identifier for a {@link ReportScope}. This
 * is the `scopeId` carried on every {@link AttributedFigure} and the
 * `FigureLedgerEntry` (reconcile.ts), so a figure's attribution lines up with
 * the reconciliation ledger for the same scope.
 *
 *   - exec  → `exec:{period}`            (e.g. `exec:all-time`)
 *   - rep   → `rep:{period}:{repId}`     (e.g. `rep:this-week:rep_7`)
 *
 * A rep scope missing its `repId` falls back to `rep:{period}` rather than
 * fabricating an id; scope resolution (scope.ts) guarantees a resolved rep
 * scope always carries a `repId`, so this fallback is defensive only.
 */
export function scopeId(scope: ReportScope): string {
  if (scope.scope === "rep" && scope.repId) {
    return `rep:${scope.period}:${scope.repId}`;
  }
  return `${scope.scope}:${scope.period}`;
}

/** A figure has a presentable value only if it is present and non-null. */
function isPresent(value: FigureValue): value is number | string {
  return value !== null && value !== undefined;
}

/**
 * Attach `{ metricId, scopeId }` attribution to a single figure (Requirement
 * 2.4). Returns `null` when the figure has no value (null/undefined) — an
 * absent figure is not "presented", so there is nothing to attribute (it is
 * withheld upstream by the reconciliation ledger, reconcile.ts).
 */
export function attributeFigure(
  metricId: string,
  value: FigureValue,
  scope: ReportScope | string,
): AttributedFigure | null {
  if (!isPresent(value)) return null;
  const id = typeof scope === "string" ? scope : scopeId(scope);
  return { metricId, scopeId: id, value };
}

/**
 * Attach `{ metricId, scopeId }` attribution to every presented figure in a
 * metric map (Requirement 2.4, Property 4). The map mirrors the per-surface
 * figure maps reconcile.ts works over — metric identifier → figure value, read
 * verbatim from the Metrics_Pipeline for one Report_Scope.
 *
 * Figures with no value (null/undefined) are omitted: only figures actually
 * presented carry attribution. The result is sorted by `metricId` so repeated
 * attribution of the same inputs yields an identical, deterministic list.
 *
 * Pure; performs no arithmetic on values.
 */
export function attributeFigures(
  figures: Record<string, FigureValue>,
  scope: ReportScope | string,
): AttributedFigure[] {
  const id = typeof scope === "string" ? scope : scopeId(scope);
  const out: AttributedFigure[] = [];
  for (const metricId of Object.keys(figures)) {
    const value = figures[metricId];
    if (isPresent(value)) out.push({ metricId, scopeId: id, value });
  }
  out.sort((a, b) =>
    a.metricId < b.metricId ? -1 : a.metricId > b.metricId ? 1 : 0,
  );
  return out;
}

/**
 * Verify that every figure in a presented set carries a complete attribution —
 * a non-empty `metricId` and a non-empty `scopeId` (Requirement 2.4, Property
 * 4). Returns the figures whose attribution is incomplete; an empty result
 * means every presented figure is fully attributed.
 *
 * Pure; reads nothing and transforms no value.
 */
export function findUnattributed(
  figures: readonly AttributedFigure[],
): AttributedFigure[] {
  return figures.filter(
    (f) => f.metricId.length === 0 || f.scopeId.length === 0,
  );
}

// ── Source membership (no fabrication) ────────────────────────────────────────

/**
 * The universe of figures legitimately obtained through the Tool_Dispatcher for
 * a turn — the figures returned by the Metrics_Pipeline (via the dispatched
 * `get_pipeline_summary`) and any figures carried on named records returned
 * through the dispatcher (via `query_leads` / `get_lead_context`). A stated
 * figure is "sourced" if and only if its value is a member of this set
 * (Requirement 1.3, 16.2, Property 3).
 *
 * Build one with {@link collectSourcedFigures}; it is the only legitimate origin
 * of any figure the agent may state.
 */
export interface SourcedFigures {
  /** Normalized membership keys of every figure obtained through the dispatcher. */
  readonly keys: ReadonlySet<string>;
}

/**
 * Normalize a figure value to a membership key. Numbers and strings normalize to
 * their verbatim string form (e.g. `42` and the stated `"42"` share a key) so a
 * figure the agent states as text matches the SQL value it was read from. This
 * is string formatting, NOT arithmetic — no rounding, scaling, or unit change is
 * applied, so `42` and `42.0` are distinct keys and never coincide. Absent
 * values (null/undefined) have no key.
 */
function figureKey(value: FigureValue): string | null {
  if (!isPresent(value)) return null;
  return String(value);
}

/**
 * Collect the source-membership universe from one or more figure maps — the
 * metric maps read from the Metrics_Pipeline for the turn, plus any maps of
 * record-sourced figures returned through the dispatcher. Every present
 * (non-null) value becomes a membership key (Requirement 1.3, Property 3).
 *
 * Pure; performs no arithmetic. `undefined` maps are ignored so callers can pass
 * optional surfaces directly.
 */
export function collectSourcedFigures(
  ...maps: Array<Record<string, FigureValue> | undefined | null>
): SourcedFigures {
  const keys = new Set<string>();
  for (const map of maps) {
    if (!map) continue;
    for (const metricId of Object.keys(map)) {
      const key = figureKey(map[metricId]);
      if (key !== null) keys.add(key);
    }
  }
  return { keys };
}

/**
 * True when a stated figure is a member of the figures actually returned through
 * the Tool_Dispatcher for the turn (Requirement 1.3, 16.2, Property 3) — i.e.
 * the figure was read from the Metrics_Pipeline or a named record, not computed,
 * estimated, or invented by the model. An absent figure (null/undefined) is
 * never sourced.
 *
 * Pure; tests membership by value only, with no arithmetic or coercion beyond
 * verbatim string normalization (see {@link figureKey}).
 */
export function isSourced(
  figure: FigureValue,
  sourced: SourcedFigures,
): boolean {
  const key = figureKey(figure);
  if (key === null) return false;
  return sourced.keys.has(key);
}

/**
 * Return the figures in a presented set whose values are NOT sourced from the
 * dispatched results (Requirement 1.3, 16.2, Property 3). An empty result means
 * every presented figure is backed by a figure the dispatcher returned; a
 * non-empty result lists exactly the fabricated/unsourced figures the agent must
 * not state.
 *
 * Accepts either raw figure values or {@link AttributedFigure}s.
 */
export function findUnsourced<T extends FigureValue | AttributedFigure>(
  figures: readonly T[],
  sourced: SourcedFigures,
): T[] {
  return figures.filter((f) => {
    const value = isAttributedFigure(f) ? f.value : (f as FigureValue);
    return !isSourced(value, sourced);
  });
}

/** Outcome of {@link verifyNoFabrication}. */
export type NoFabricationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly unsourced: readonly (number | string)[] };

/**
 * Verify that no presented figure is absent from the dispatched results
 * (Requirement 1.3, 16.2, Property 3). Accepts only when every figure is
 * sourced; otherwise rejects and lists the unsourced values so the agent can
 * withhold them and state no fabricated figure.
 *
 * Pure; no arithmetic, no I/O.
 */
export function verifyNoFabrication(
  figures: readonly (FigureValue | AttributedFigure)[],
  sourced: SourcedFigures,
): NoFabricationResult {
  const unsourced: (number | string)[] = [];
  for (const f of figures) {
    const value = isAttributedFigure(f) ? f.value : f;
    if (!isSourced(value, sourced) && isPresent(value)) {
      unsourced.push(value);
    }
  }
  return unsourced.length === 0 ? { ok: true } : { ok: false, unsourced };
}

/** Narrow an entry to an {@link AttributedFigure}. */
function isAttributedFigure(
  value: FigureValue | AttributedFigure,
): value is AttributedFigure {
  return (
    value !== null &&
    typeof value === "object" &&
    "metricId" in value &&
    "value" in value
  );
}
