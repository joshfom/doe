/**
 * Prediction grounding & citation checks (Agentic Reporting & C-Level Twin S4,
 * Design §Components #8 "Predictions grounded in records").
 *
 * The Reporting_Agent's sparring-partner twin may produce forward-looking
 * Predictions, but every numeric figure it states must trace to a real source:
 * a `metrics_*` view metric or a named record returned through the audited
 * Tool_Dispatcher. This module holds the **pure** grounding/citation checks the
 * agent runs over an assembled Prediction draft BEFORE the prediction is
 * emitted. It performs no database access, no dispatcher calls, and no
 * arithmetic on figures — it only verifies that what the model wrote is fully
 * sourced and explained.
 *
 * What `verifyGrounding` enforces:
 *  - **Citations (Req 9.1):** every numeric figure stated in the draft carries a
 *    citation to its source `metrics_*` metric or named record.
 *  - **No fabrication (Req 9.3):** every citation's source must be present in the
 *    `SourcedFacts` actually obtained through the dispatcher; a figure citing a
 *    source that was never returned is unsourced and rejected.
 *  - **Explanation (Req 9.2):** the prediction's basis must reference every cited
 *    figure and every cited source.
 *  - **Decline on missing records (Req 9.4):** when a cited record was not
 *    returned through the dispatcher, it is surfaced in `missingRecords` so the
 *    agent can decline the prediction and name exactly which records were
 *    unavailable, stating no unsupported figure.
 *
 * Design references: §Components #8. Requirements: 9.1, 9.2, 9.3, 9.4.
 */

/**
 * A citation binding one stated numeric figure to the source it derives from.
 * `source.kind` is `"metric"` for a `metrics_*` view metric or `"record"` for a
 * named record obtained through the dispatcher; `source.id` is that source's
 * identifier (the metric id or the record id).
 */
export interface Citation {
  /** The numeric figure, exactly as stated in the prediction draft. */
  figure: string;
  /** The source the figure derives from. */
  source: { kind: "metric" | "record"; id: string };
}

/**
 * An assembled Prediction the agent intends to emit, awaiting grounding checks.
 *  - `figures` — every numeric figure stated in the prediction (Req 9.1, 9.3).
 *  - `citations` — one citation per stated figure (Req 9.1).
 *  - `basis` — the natural-language explanation of the prediction's basis, which
 *    must reference every cited figure and source (Req 9.2).
 */
export interface PredictionDraft {
  figures: string[];
  citations: Citation[];
  basis: string;
}

/**
 * The facts actually obtained through the Tool_Dispatcher for the request — the
 * only sources a Prediction figure may legitimately derive from (Req 9.3).
 *  - `metricIds` — `metrics_*` metric ids returned via the dispatched
 *    `get_pipeline_summary` (the Metrics_Pipeline result).
 *  - `recordIds` — named record ids returned through the dispatcher (for example
 *    via `query_leads` / `get_lead_context`).
 */
export interface SourcedFacts {
  metricIds: readonly string[];
  recordIds: readonly string[];
}

/**
 * The outcome of grounding a Prediction draft.
 *  - `ok: true`  → every figure is cited, every citation is sourced through the
 *    dispatcher, and the basis references every cited figure and source; the
 *    prediction may be emitted.
 *  - `ok: false` → the draft is rejected. The accompanying lists pinpoint why so
 *    the agent can decline and explain (Req 9.4):
 *      - `uncitedFigures`   — stated figures with no citation (Req 9.1).
 *      - `unsourcedFigures` — figures whose citation points to a source not
 *        obtained through the dispatcher (Req 9.3).
 *      - `missingRecords`   — cited record ids absent from `SourcedFacts`; the
 *        records to name as unavailable when declining (Req 9.4).
 *      - `missingMetrics`   — cited metric ids absent from `SourcedFacts` (Req 9.3).
 *      - `basisOmissions`   — cited figures/source ids the basis fails to
 *        reference (Req 9.2).
 */
export type GroundingResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly uncitedFigures: readonly string[];
      readonly unsourcedFigures: readonly string[];
      readonly missingRecords: readonly string[];
      readonly missingMetrics: readonly string[];
      readonly basisOmissions: readonly string[];
    };

/** Append `value` to `target` if it is not already present (stable de-dup). */
function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) target.push(value);
}

/**
 * Verify that a Prediction draft is fully grounded before it is emitted
 * (Requirements 9.1, 9.2, 9.3, 9.4).
 *
 * The draft is accepted only when ALL of the following hold:
 *  1. every stated figure carries at least one citation (Req 9.1);
 *  2. every citation's source is present in the facts obtained through the
 *     dispatcher (Req 9.3) — a metric source in `sourced.metricIds`, a record
 *     source in `sourced.recordIds`;
 *  3. the basis references every cited figure and every cited source id (Req 9.2).
 *
 * Any uncited or unsourced figure rejects the draft; cited records absent from
 * the dispatched results are returned in `missingRecords` so the agent can
 * decline and name them (Req 9.4). This function is pure: it reads nothing, calls
 * no tools, and performs no arithmetic on figures.
 */
export function verifyGrounding(
  draft: PredictionDraft,
  sourced: SourcedFacts,
): GroundingResult {
  const metricIds = new Set(sourced.metricIds);
  const recordIds = new Set(sourced.recordIds);

  const uncitedFigures: string[] = [];
  const unsourcedFigures: string[] = [];
  const missingRecords: string[] = [];
  const missingMetrics: string[] = [];
  const basisOmissions: string[] = [];

  // Index citations by the figure they cite so each stated figure can be checked
  // for both presence (Req 9.1) and a sourced origin (Req 9.3).
  const citationsByFigure = new Map<string, Citation[]>();
  for (const citation of draft.citations) {
    const list = citationsByFigure.get(citation.figure);
    if (list) list.push(citation);
    else citationsByFigure.set(citation.figure, [citation]);
  }

  // (1) Every stated figure must carry a citation, and (2) each such citation's
  // source must have been obtained through the dispatcher.
  for (const figure of draft.figures) {
    const citations = citationsByFigure.get(figure);
    if (!citations || citations.length === 0) {
      pushUnique(uncitedFigures, figure);
      continue;
    }

    let figureUnsourced = false;
    for (const { source } of citations) {
      const present =
        source.kind === "metric"
          ? metricIds.has(source.id)
          : recordIds.has(source.id);
      if (present) continue;

      figureUnsourced = true;
      if (source.kind === "record") pushUnique(missingRecords, source.id);
      else pushUnique(missingMetrics, source.id);
    }
    if (figureUnsourced) pushUnique(unsourcedFigures, figure);
  }

  // (3) The basis must reference every cited figure and every cited source id
  // (Req 9.2). A cited token absent from the basis prose is an omission.
  for (const citation of draft.citations) {
    if (!draft.basis.includes(citation.figure)) {
      pushUnique(basisOmissions, citation.figure);
    }
    if (!draft.basis.includes(citation.source.id)) {
      pushUnique(basisOmissions, citation.source.id);
    }
  }

  const grounded =
    uncitedFigures.length === 0 &&
    unsourcedFigures.length === 0 &&
    missingRecords.length === 0 &&
    missingMetrics.length === 0 &&
    basisOmissions.length === 0;

  if (grounded) return { ok: true };

  return {
    ok: false,
    uncitedFigures,
    unsourcedFigures,
    missingRecords,
    missingMetrics,
    basisOmissions,
  };
}
