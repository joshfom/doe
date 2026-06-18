/**
 * Agentic Reporting & C-Level Twin (S4) — Chart_Generator
 * (Design §Components #3 "Chart_Generator — Chart_Spec → Chart_Artifact").
 *
 * Turns a {@link ChartSpec} into a {@link ChartArtifact} on the container/worker
 * tier ONLY. The agent builds a Chart_Spec whose plotted figures are taken
 * VERBATIM from the turn's single `PipelineMetrics` result; this generator
 * renders it to an image without altering, rounding, or recomputing any value
 * (Requirement 4.1, 4.2). It reads no database and no personal data, so it is
 * not a dispatched tool (Requirement 11 governs DB/personal-data access only).
 *
 * THE ONE RULE: the generator performs NO arithmetic on figures. A `y` value
 * read from the Metrics_Pipeline is copied into the Chart_Spec and carried into
 * the Chart_Artifact byte-for-byte. The reconciliation/figure-consistency
 * guarantees (Requirement 2) hold because chart, chat, and export all derive
 * from the same `PipelineMetrics` (Design §"The single source of figures").
 *
 * Guardrails (Requirement 5):
 *   - Container-tier guard — {@link assertContainerTier} refuses a serverless
 *     invocation before any work (Requirement 5.5, 14.5).
 *   - Supported type — exactly one of `{ bar, line, pie }`; any other type
 *     yields no artifact and an `unsupported_type` error (Requirement 4.3, 4.4).
 *   - Unavailable figures — a spec with no plottable figures yields no artifact
 *     and an `unavailable_source` error (Requirement 4.5).
 *   - Data-point cap — more than `maxDataPoints` (default 500) yields no
 *     artifact and a `too_many_points` error (Requirement 5.3, 5.4).
 *   - Concurrency cap — a module-level semaphore caps concurrent renderings at
 *     `maxConcurrent` (default 10); a request arriving at capacity is REJECTED
 *     with a `capacity` error rather than queued (Requirement 5.6, 5.7).
 *   - Timeout — rendering past `timeoutMs` (default 10_000) aborts, discards any
 *     partial artifact, and returns a `timeout` error while preserving the
 *     conversation (Requirement 5.2). The p95 target is 5s (Requirement 5.1).
 *
 * The renderer is INJECTABLE (a slow/fake renderer can be supplied by tests);
 * the default renderer is a lightweight, deterministic, value-preserving
 * encoder. The production headless-chromium renderer is injected at the call
 * site and is not part of the property-tested surface (Design §Testing).
 *
 * Design references: §Components #3, §Data Models (`ChartSpec`,
 * `ChartArtifact`), §Correctness Properties (Property 8, Property 9),
 * §Error Handling. Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3,
 * 5.4, 5.5, 5.6, 5.7, 14.5.
 */

import type { PipelineMetrics } from "@/lib/cms/metrics/pipeline";
import type { ReportScope } from "./scope";

// ── Chart types & data models (Design §Data Models) ───────────────────────────

/** The supported chart-type set (Requirement 4.3). */
export type ChartType = "bar" | "line" | "pie";

/** The supported chart types as a runtime set for validation (Requirement 4.4). */
export const SUPPORTED_CHART_TYPES: readonly ChartType[] = ["bar", "line", "pie"];

/** One plotted point. `y` is a figure read verbatim from a `metrics_*` view. */
export interface ChartPoint {
  x: string;
  y: number;
}

/** One labelled series of points (Design §Data Models). */
export interface ChartSeries {
  label: string;
  points: ChartPoint[];
}

/**
 * The typed description of a chart; its plotted figures are taken verbatim from
 * the turn's `PipelineMetrics` (Design §Data Models, Requirement 4.1).
 */
export interface ChartSpec {
  /** Exactly one supported type (Requirement 4.3). */
  type: ChartType;
  title: string;
  /** The source metric identifier, carried for attribution (Requirement 2.4). */
  metricId: string;
  scope: ReportScope;
  /** `y` values are verbatim from SQL — never altered, rounded, or recomputed. */
  series: ChartSeries[];
}

/** The rendered chart image plus provenance (Design §Data Models). */
export interface ChartArtifact {
  /** The exact spec that produced this artifact (its figures, verbatim). */
  spec: ChartSpec;
  mimeType: "image/png";
  bytes: Uint8Array;
  /** The total number of plotted data points across every series. */
  dataPointCount: number;
}

// ── Configuration (Requirement 5.2, 5.3, 5.6) ─────────────────────────────────

export interface ChartGeneratorConfig {
  /** Max data points in a single artifact; default 500 (Requirement 5.3). */
  maxDataPoints: number;
  /** Render timeout in ms; default 10_000 (Requirement 5.2). */
  timeoutMs: number;
  /** Max concurrent renderings; default 10 (Requirement 5.6). */
  maxConcurrent: number;
}

/** The default guardrail configuration (Requirement 5.2, 5.3, 5.6). */
export const DEFAULT_CHART_CONFIG: Readonly<ChartGeneratorConfig> = Object.freeze({
  maxDataPoints: 500,
  timeoutMs: 10_000,
  maxConcurrent: 10,
});

function resolveConfig(cfg?: Partial<ChartGeneratorConfig>): ChartGeneratorConfig {
  return {
    maxDataPoints: cfg?.maxDataPoints ?? DEFAULT_CHART_CONFIG.maxDataPoints,
    timeoutMs: cfg?.timeoutMs ?? DEFAULT_CHART_CONFIG.timeoutMs,
    maxConcurrent: cfg?.maxConcurrent ?? DEFAULT_CHART_CONFIG.maxConcurrent,
  };
}

// ── Discriminated result & errors (Design §Error Handling) ────────────────────

/**
 * The discriminated set of soft chart errors (Requirement 4.4, 4.5, 5.2, 5.4,
 * 5.7). Each keeps the conversation active rather than throwing. The hard
 * container-tier refusal is a thrown {@link ContainerTierError}, not a member of
 * this set, because it signals a misconfigured deployment (Requirement 5.5).
 */
export type ChartError =
  | { code: "unsupported_type"; message: string; type: string }
  | { code: "too_many_points"; message: string; count: number; max: number }
  | { code: "timeout"; message: string; timeoutMs: number }
  | { code: "capacity"; message: string; maxConcurrent: number }
  | { code: "unavailable_source"; message: string; metricId: string };

/** The outcome of a chart render (Design §Components #3). */
export type ChartResult =
  | { ok: true; artifact: ChartArtifact }
  | { ok: false; error: ChartError };

// ── Container-tier guard (Requirement 5.5, 14.5) ──────────────────────────────

/**
 * Thrown when a container-only component is invoked from a serverless function
 * invocation. Hard refusal: the component must never run a long-lived rendering
 * process on Next.js serverless (Requirement 5.5, 14.3, 14.5).
 */
export class ContainerTierError extends Error {
  readonly code = "container_tier_required";
  constructor(message = "Chart_Generator is restricted to the container/worker tier and must not run on Next.js serverless.") {
    super(message);
    this.name = "ContainerTierError";
  }
}

/**
 * Detect whether the current process is a serverless function invocation rather
 * than the container/worker tier.
 *
 * The container tier (the Bun Elysia mount and the `workers/*` processes) runs
 * as a plain long-lived process where none of the serverless platform signals
 * are present. Detection precedence:
 *   1. Explicit override via `DOE_TIER` (`container`/`worker` → not serverless;
 *      `serverless` → serverless) so deployments can be unambiguous.
 *   2. Known serverless platform env vars (`VERCEL`, `AWS_LAMBDA_FUNCTION_NAME`,
 *      `LAMBDA_TASK_ROOT`) or the Next.js edge runtime (`NEXT_RUNTIME === "edge"`).
 *   3. Default: not serverless (a standalone container/worker process or tests).
 */
export function detectServerless(): boolean {
  const tier = process.env.DOE_TIER?.toLowerCase();
  if (tier === "container" || tier === "worker") return false;
  if (tier === "serverless") return true;

  if (
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
  ) {
    return true;
  }
  if (process.env.NEXT_RUNTIME === "edge") return true;

  return false;
}

/**
 * Refuse, without executing, any invocation that is running on the serverless
 * tier (Requirement 5.5, 14.5). Throws {@link ContainerTierError} when the
 * caller is serverless. Tests may force the decision via `opts.serverless`.
 */
export function assertContainerTier(opts?: { serverless?: boolean }): void {
  const serverless = opts?.serverless ?? detectServerless();
  if (serverless) {
    throw new ContainerTierError();
  }
}

// ── Module-level concurrency semaphore (Requirement 5.6, 5.7) ─────────────────
//
// A single counter shared across all renders in the process caps the number of
// concurrent renderings. A request arriving at the cap is rejected with a
// `capacity` error rather than queued (Requirement 5.7). The check-and-acquire
// is synchronous (single-threaded JS), so no two callers can both pass the
// capacity check for the same slot.

let activeRenders = 0;

/** The number of renderings currently in flight (for diagnostics/tests). */
export function activeRenderCount(): number {
  return activeRenders;
}

/**
 * Reset the concurrency counter. Test-only helper for isolation between cases;
 * never called in production paths.
 */
export function __resetChartConcurrencyForTest(): void {
  activeRenders = 0;
}

// ── Injectable renderer (Design §Testing — slow/fake renderer for tests) ──────

export interface ChartRenderInput {
  /** The spec to render; figures are read, never mutated. */
  spec: ChartSpec;
  /** The pre-counted total data points (kept verbatim onto the artifact). */
  dataPointCount: number;
  /** Aborted when the timeout fires so a renderer can stop early (Req 5.2). */
  signal: AbortSignal;
}

/** A renderer turns a spec into image bytes. Injectable for tests/production. */
export type ChartRenderer = (input: ChartRenderInput) => Promise<Uint8Array>;

export interface RenderChartDeps {
  /** Override the renderer (production injects headless chromium; tests a fake). */
  renderer?: ChartRenderer;
  /** Force the tier decision (test-only); defaults to {@link detectServerless}. */
  serverless?: boolean;
}

/** The 8-byte PNG file signature. */
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The default renderer: a lightweight, deterministic, VALUE-PRESERVING encoder.
 *
 * It does not draw pixels — the production renderer (headless chromium) is
 * injected at the call site. This default exists so the generator is usable and
 * testable without a browser engine: it emits the PNG signature followed by a
 * UTF-8 serialization of the spec's plotted points, copied verbatim, so the
 * artifact bytes deterministically reflect the exact `y` figures with no
 * rounding or recomputation (Requirement 4.2).
 */
export const defaultChartRenderer: ChartRenderer = async ({ spec }) => {
  const payload = JSON.stringify({
    type: spec.type,
    metricId: spec.metricId,
    series: spec.series.map((s) => ({
      label: s.label,
      points: s.points.map((p) => [p.x, p.y]),
    })),
  });
  const body = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(PNG_SIGNATURE.length + body.length);
  bytes.set(PNG_SIGNATURE, 0);
  bytes.set(body, PNG_SIGNATURE.length);
  return bytes;
};

// ── Counting & validation helpers ─────────────────────────────────────────────

/** Total plotted data points across every series in a spec. */
export function countDataPoints(spec: ChartSpec): number {
  return spec.series.reduce((sum, series) => sum + series.points.length, 0);
}

/** True when every plotted `y` is a finite number (a real, present figure). */
function allFiguresPresent(spec: ChartSpec): boolean {
  return spec.series.every((series) =>
    series.points.every((p) => typeof p.y === "number" && Number.isFinite(p.y)),
  );
}

// ── renderChart ───────────────────────────────────────────────────────────────

/**
 * Render a {@link ChartSpec} into a {@link ChartArtifact}, enforcing the type,
 * availability, data-point, concurrency, and timeout guardrails.
 *
 * Checks run in order so the cheapest, most-specific refusal wins:
 *   0. Container-tier guard — throws {@link ContainerTierError} on serverless
 *      (Requirement 5.5, 14.5). This is a hard misconfiguration, not a
 *      {@link ChartResult} error.
 *   1. Unsupported type → `unsupported_type` (Requirement 4.3, 4.4).
 *   2. No plottable figures (zero points, or a non-finite `y`) →
 *      `unavailable_source` (Requirement 4.5).
 *   3. Over the data-point cap → `too_many_points` (Requirement 5.3, 5.4).
 *   4. At the concurrency cap → `capacity` (Requirement 5.6, 5.7).
 *   5. Render, racing the configured timeout → `timeout` on expiry, aborting and
 *      discarding any partial artifact (Requirement 5.2); otherwise an artifact
 *      whose figures equal the spec verbatim (Requirement 4.2, 4.6).
 *
 * @param spec the chart to render (figures already verbatim from PipelineMetrics).
 * @param cfg  optional guardrail overrides (merged onto {@link DEFAULT_CHART_CONFIG}).
 * @param deps optional injected renderer / tier override.
 */
export async function renderChart(
  spec: ChartSpec,
  cfg?: Partial<ChartGeneratorConfig>,
  deps?: RenderChartDeps,
): Promise<ChartResult> {
  // (0) Container-tier guard — refuse before any work (Requirement 5.5, 14.5).
  assertContainerTier({ serverless: deps?.serverless });

  const config = resolveConfig(cfg);
  const renderer = deps?.renderer ?? defaultChartRenderer;

  // (1) Supported type (Requirement 4.3, 4.4).
  if (!SUPPORTED_CHART_TYPES.includes(spec.type)) {
    return {
      ok: false,
      error: {
        code: "unsupported_type",
        message: `Unsupported chart type "${String(spec.type)}"; supported types are ${SUPPORTED_CHART_TYPES.join(", ")}.`,
        type: String(spec.type),
      },
    };
  }

  // (2) Figures must be available (present, finite) — never substitute (Req 4.5).
  const dataPointCount = countDataPoints(spec);
  if (dataPointCount === 0 || !allFiguresPresent(spec)) {
    return {
      ok: false,
      error: {
        code: "unavailable_source",
        message: `No analytics figures available to plot for metric "${spec.metricId}".`,
        metricId: spec.metricId,
      },
    };
  }

  // (3) Data-point cap (Requirement 5.3, 5.4).
  if (dataPointCount > config.maxDataPoints) {
    return {
      ok: false,
      error: {
        code: "too_many_points",
        message: `Chart requests ${dataPointCount} data points, exceeding the configured maximum of ${config.maxDataPoints}.`,
        count: dataPointCount,
        max: config.maxDataPoints,
      },
    };
  }

  // (4) Concurrency cap — synchronous check-and-acquire (Requirement 5.6, 5.7).
  if (activeRenders >= config.maxConcurrent) {
    return {
      ok: false,
      error: {
        code: "capacity",
        message: `Chart generation capacity limit of ${config.maxConcurrent} concurrent renderings reached.`,
        maxConcurrent: config.maxConcurrent,
      },
    };
  }
  activeRenders += 1;

  // (5) Render, racing the timeout (Requirement 5.2).
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const renderPromise = renderer({ spec, dataPointCount, signal: controller.signal });
    // Swallow a late rejection if the timeout already won the race so it never
    // surfaces as an unhandled rejection after we have returned a timeout error.
    renderPromise.catch(() => undefined);

    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ timedOut: true });
      }, config.timeoutMs);
    });

    const outcome = await Promise.race([
      renderPromise.then((bytes) => ({ timedOut: false as const, bytes })),
      timeoutPromise,
    ]);

    if (outcome.timedOut) {
      // Discard any partial artifact; preserve the conversation (Requirement 5.2).
      return {
        ok: false,
        error: {
          code: "timeout",
          message: `Chart rendering exceeded the configured timeout of ${config.timeoutMs}ms and was aborted.`,
          timeoutMs: config.timeoutMs,
        },
      };
    }

    // Success — figures carried verbatim onto the artifact (Requirement 4.2, 4.6).
    return {
      ok: true,
      artifact: {
        spec,
        mimeType: "image/png",
        bytes: outcome.bytes,
        dataPointCount,
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
    activeRenders -= 1;
  }
}

// ── Chart_Spec construction from PipelineMetrics (verbatim) ───────────────────

/**
 * Build one {@link ChartSeries} from a set of `metrics_*` view rows, copying the
 * `y` figure VERBATIM from `yKey` and the `x` label from `xKey`. No arithmetic,
 * no rounding, no recomputation (Requirement 4.1). A row whose `yKey` is not a
 * finite number is omitted — the figure is absent, never substituted, so the
 * downstream `unavailable_source` guard can fire when nothing plottable remains.
 */
export function seriesFromRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  label: string,
  xKey: string,
  yKey: string,
): ChartSeries {
  const points: ChartPoint[] = [];
  for (const row of rows) {
    const rawY = row[yKey];
    const y = typeof rawY === "number" ? rawY : Number(rawY);
    if (!Number.isFinite(y)) continue; // absent figure — never fabricate one
    points.push({ x: String(row[xKey]), y });
  }
  return { label, points };
}

/** The fields needed to assemble a {@link ChartSpec} around its series. */
export interface ChartSpecRequest {
  type: ChartType;
  title: string;
  metricId: string;
  scope: ReportScope;
}

/**
 * Assemble a {@link ChartSpec} from pre-extracted series, carrying the figures
 * through unchanged (Requirement 4.1, 2.4). Pure: it copies the series as given
 * and performs no transformation on any `y` value.
 */
export function buildChartSpec(request: ChartSpecRequest, series: ChartSeries[]): ChartSpec {
  return {
    type: request.type,
    title: request.title,
    metricId: request.metricId,
    scope: request.scope,
    series,
  };
}

/**
 * Convenience: derive a {@link ChartSpec} directly from a turn's
 * {@link PipelineMetrics}. The caller chooses the metric/series mapping via
 * `select`, which must return its series with `y` figures copied verbatim from
 * the metrics (e.g. via {@link seriesFromRows}); this function performs no
 * arithmetic itself, preserving the verbatim guarantee (Requirement 4.1).
 */
export function buildChartSpecFromMetrics(
  metrics: PipelineMetrics,
  request: ChartSpecRequest,
  select: (metrics: PipelineMetrics) => ChartSeries[],
): ChartSpec {
  return buildChartSpec(request, select(metrics));
}
