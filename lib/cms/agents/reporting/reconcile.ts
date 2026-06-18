/**
 * Figure reconciliation ledger (Agentic Reporting & C-Level Twin S4,
 * Design §Components, §Data Models (FigureLedger)).
 *
 * A single `PipelineMetrics` result for one Report_Scope is shared, by
 * reference, across the three surfaces the Reporting_Agent can produce — the
 * chat narration, the Chart_Spec/Chart_Artifact, and the Report_Export. That
 * shared-source-by-construction is the backbone of figure consistency
 * (Requirement 2). This module is the **defence-in-depth** guard on top of it:
 * given the per-surface figure maps that were actually about to be presented,
 * it classifies every metric and decides what may be published.
 *
 * Classification, for one Report_Scope, over the figure each surface presents
 * for a metric:
 *   - `consistent`     — every surface that presents the metric reports the
 *                        SAME value; the figure is published unchanged
 *                        (Requirement 2.2).
 *   - `unavailable`    — no surface has a value for a requested metric (the
 *                        Metrics_Pipeline returned nothing for it); the figure
 *                        is withheld from ALL surfaces and marked unavailable,
 *                        never substituted (Requirement 2.5).
 *   - `irreconcilable` — the value would differ across surfaces; the figure is
 *                        SUPPRESSED on ALL surfaces and marked could-not-be-
 *                        reconciled, while every consistent figure in the scope
 *                        is left unchanged (Requirement 2.6).
 *
 * THE ONE RULE: this module performs NO arithmetic on figures. It only inspects
 * presence and equality. A figure is never rounded, summed, averaged, or
 * otherwise transformed — it is read, compared for identity, and either
 * published verbatim or withheld/suppressed.
 *
 * The module is pure (no DB, no I/O) so the figure-consistency property (P1)
 * and the suppress-only-the-irreconcilable property (P2) can be exercised
 * directly.
 *
 * Design references: §Components (Figure reconciliation), §Data Models
 * (FigureLedger). Requirements: 2.2, 2.3, 2.5, 2.6.
 */

/** The reconciliation status of a single metric for one Report_Scope. */
export type FigureStatus = "consistent" | "unavailable" | "irreconcilable";

/**
 * A figure value as presented by a surface. `null`/`undefined` both mean the
 * surface has no value for the metric (the Metrics_Pipeline returned none).
 * Figures are never booleans or objects — only a SQL-sourced number or a
 * pre-formatted string read verbatim from a `metrics_*` view.
 */
export type FigureValue = number | string | null | undefined;

/** The figures one surface presents, keyed by metric identifier. */
export type SurfaceFigures = Record<string, FigureValue>;

/** One classified metric in the ledger (Design §Data Models). */
export interface FigureLedgerEntry {
  /** The metric identifier (e.g. `tierFunnel.hot`). */
  metricId: string;
  /** Identifies the Report_Scope this figure belongs to (Requirement 2.4). */
  scopeId: string;
  /**
   * The reconciled value: the agreed figure when `consistent`, otherwise
   * `null` (withheld when `unavailable`, suppressed when `irreconcilable`).
   */
  value: number | string | null;
  status: FigureStatus;
}

/** Input to {@link buildFigureLedger}. */
export interface FigureLedgerInput {
  /** Identifies the single Report_Scope all surfaces were produced for. */
  scopeId: string;
  /**
   * The per-surface figure maps. The keys are surface names (by convention
   * `"chat"`, `"chart"`, `"export"`), each mapping metric identifiers to the
   * figure that surface was about to present.
   */
  surfaces: Record<string, SurfaceFigures>;
  /**
   * The metrics that were requested for this scope. Defaults to the union of
   * every metric key present across the surfaces. Supplying it lets a metric
   * that was requested but is entirely absent surface as `unavailable` rather
   * than be silently dropped (Requirement 2.5).
   */
  requestedMetrics?: string[];
}

/** A figure has a usable value on a surface only if it is present and non-null. */
function isAvailable(value: FigureValue): value is number | string {
  return value !== null && value !== undefined;
}

/**
 * Identity comparison only — NO arithmetic, NO coercion. Two figures reconcile
 * only when they are the same type and the same value (so the number `1` and
 * the string `"1"` never reconcile). `Object.is` gives byte-for-byte identity
 * for the number/string figures this module handles (Requirement 2.2).
 */
function figuresEqual(a: number | string, b: number | string): boolean {
  return Object.is(a, b);
}

/**
 * The reconciliation surface for one Report_Scope. Holds the classified entry
 * for every requested metric and answers "what may each surface publish?".
 *
 * Construct via {@link buildFigureLedger}.
 */
export class FigureLedger {
  readonly scopeId: string;
  readonly entries: readonly FigureLedgerEntry[];

  private readonly byMetric: ReadonlyMap<string, FigureLedgerEntry>;

  constructor(scopeId: string, entries: FigureLedgerEntry[]) {
    this.scopeId = scopeId;
    // Deterministic ordering by metric id so repeated reconciliations of the
    // same inputs yield an identical ledger (Requirement 2.3, defence-in-depth).
    const sorted = [...entries].sort((a, b) =>
      a.metricId < b.metricId ? -1 : a.metricId > b.metricId ? 1 : 0
    );
    this.entries = sorted;
    this.byMetric = new Map(sorted.map((e) => [e.metricId, e]));
  }

  /** The classified entry for a metric, if it was reconciled. */
  entry(metricId: string): FigureLedgerEntry | undefined {
    return this.byMetric.get(metricId);
  }

  /** Every entry with the given status. */
  byStatus(status: FigureStatus): FigureLedgerEntry[] {
    return this.entries.filter((e) => e.status === status);
  }

  /** Figures safe to publish on every surface (values agree across surfaces). */
  consistent(): FigureLedgerEntry[] {
    return this.byStatus("consistent");
  }

  /** Requested figures the Metrics_Pipeline returned no value for (withheld). */
  unavailable(): FigureLedgerEntry[] {
    return this.byStatus("unavailable");
  }

  /** Figures whose values differed across surfaces (suppressed everywhere). */
  irreconcilable(): FigureLedgerEntry[] {
    return this.byStatus("irreconcilable");
  }

  /** The metric identifiers that may be published (the consistent ones). */
  publishedMetricIds(): string[] {
    return this.consistent().map((e) => e.metricId);
  }

  /**
   * The canonical reconciled figures: metric identifier → agreed value, for
   * the consistent metrics only. Identical regardless of which surface asks,
   * so the figure published in chat equals the figure in the chart and export
   * (Requirement 2.2).
   */
  reconciledFigures(): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    for (const e of this.consistent()) {
      // `value` is non-null for consistent entries by construction.
      out[e.metricId] = e.value as number | string;
    }
    return out;
  }

  /**
   * Project a surface's figure map down to only what it may publish: keep the
   * consistent metrics (taking the canonical reconciled value so every surface
   * publishes byte-for-byte identical figures), withhold unavailable metrics,
   * and suppress irreconcilable ones. Pure; no arithmetic on figures.
   */
  publish(surface: SurfaceFigures): SurfaceFigures {
    const out: SurfaceFigures = {};
    for (const e of this.consistent()) {
      if (e.metricId in surface) {
        out[e.metricId] = e.value as number | string;
      }
    }
    return out;
  }
}

/**
 * Classify the per-surface figure maps for one Report_Scope into a
 * {@link FigureLedger}.
 *
 * For each requested metric (the union of every key present across the
 * surfaces, plus any explicitly `requestedMetrics`):
 *   - gather the values the surfaces actually present (ignoring null/absent);
 *   - if none are present → `unavailable` (withheld; value `null`);
 *   - if all present values are identical → `consistent` (published verbatim);
 *   - otherwise the values differ → `irreconcilable` (suppressed; value `null`).
 */
export function buildFigureLedger(input: FigureLedgerInput): FigureLedger {
  const surfaceNames = Object.keys(input.surfaces);

  const metricIds = new Set<string>(input.requestedMetrics ?? []);
  for (const name of surfaceNames) {
    for (const metricId of Object.keys(input.surfaces[name])) {
      metricIds.add(metricId);
    }
  }

  const entries: FigureLedgerEntry[] = [];
  for (const metricId of metricIds) {
    const presented: Array<number | string> = [];
    for (const name of surfaceNames) {
      const value = input.surfaces[name][metricId];
      if (isAvailable(value)) presented.push(value);
    }

    let status: FigureStatus;
    let value: number | string | null;
    if (presented.length === 0) {
      // Requested but the Metrics_Pipeline returned no value → withhold (2.5).
      status = "unavailable";
      value = null;
    } else {
      const first = presented[0];
      const allEqual = presented.every((v) => figuresEqual(v, first));
      if (allEqual) {
        // Every surface that presents it agrees → publish verbatim (2.2).
        status = "consistent";
        value = first;
      } else {
        // Values would differ across surfaces → suppress everywhere (2.6).
        status = "irreconcilable";
        value = null;
      }
    }

    entries.push({ metricId, scopeId: input.scopeId, value, status });
  }

  return new FigureLedger(input.scopeId, entries);
}
