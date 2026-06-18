import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Integration tests for the Chart_Generator's runtime guardrails — task 8.4.
 *
 * Where the property tests cover value preservation (Property 8) and the
 * data-point/concurrency caps as pure predicates (Property 9), these tests
 * exercise the LIVE async behaviour of {@link renderChart} end-to-end with an
 * INJECTED renderer standing in for the production headless-chromium renderer
 * (Design §Components #3, §Error Handling):
 *
 *   - Timeout abort (Requirement 5.2): a slow renderer that never resolves on
 *     its own is raced against a short `timeoutMs`. On expiry the generator
 *     fires its AbortSignal, discards any partial artifact, and returns a
 *     `timeout` error — and a SUBSEQUENT render still succeeds, proving the
 *     conversation/runtime (the module concurrency slot) is preserved.
 *
 *   - At-capacity rejection (Requirement 5.7): renderers that hold their slots
 *     fill `maxConcurrent`; a further request is REJECTED with a `capacity`
 *     error (not queued), and once the held slots free up rendering succeeds
 *     again.
 *
 * All renderers are injected and deterministic; held promises are released
 * explicitly so the suite stays fast and leaves no lingering timers.
 *
 * _Design §Error Handling; Requirements: 5.2, 5.7_
 */

import {
  renderChart,
  activeRenderCount,
  __resetChartConcurrencyForTest,
  defaultChartRenderer,
  type ChartSpec,
  type ChartRenderer,
} from "./chart-generator";

// A minimal, valid Chart_Spec: one bar series with finite (present) figures.
function makeSpec(): ChartSpec {
  return {
    type: "bar",
    title: "Pipeline by tier",
    metricId: "metrics_tier_funnel_overall",
    scope: { scope: "exec", period: "all-time" },
    series: [
      {
        label: "leads",
        points: [
          { x: "HOT", y: 12 },
          { x: "WARM", y: 34 },
          { x: "NURTURE", y: 56 },
        ],
      },
    ],
  };
}

// Force the container tier so the tier guard never refuses under the test env.
const CONTAINER = { serverless: false } as const;

beforeEach(() => {
  __resetChartConcurrencyForTest();
});

afterEach(() => {
  __resetChartConcurrencyForTest();
});

describe("renderChart — timeout abort (Requirement 5.2)", () => {
  it("aborts a slow render, discards the partial artifact, and returns a timeout error", async () => {
    let abortFired = false;
    let resolvedBytes = false;

    // A renderer that would only finish after a long delay; it should be
    // aborted by the generator's timeout before that delay elapses. It honours
    // the AbortSignal (production renderers receive the same signal).
    const slowRenderer: ChartRenderer = ({ signal }) =>
      new Promise<Uint8Array>((resolve) => {
        const timer = setTimeout(() => {
          resolvedBytes = true;
          resolve(Uint8Array.from([1, 2, 3]));
        }, 5_000);
        signal.addEventListener("abort", () => {
          abortFired = true;
          clearTimeout(timer);
          // Deliberately do NOT resolve: the partial artifact is discarded.
        });
      });

    const result = await renderChart(makeSpec(), { timeoutMs: 20 }, {
      ...CONTAINER,
      renderer: slowRenderer,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a timeout failure");
    expect(result.error.code).toBe("timeout");
    if (result.error.code !== "timeout") throw new Error("narrowing");
    expect(result.error.timeoutMs).toBe(20);

    // The AbortSignal fired and no partial artifact was produced.
    expect(abortFired).toBe(true);
    expect(resolvedBytes).toBe(false);

    // The concurrency slot was released (conversation/runtime preserved).
    expect(activeRenderCount()).toBe(0);
  });

  it("preserves the runtime: a subsequent render succeeds after a timeout", async () => {
    const slowRenderer: ChartRenderer = ({ signal }) =>
      new Promise<Uint8Array>((resolve) => {
        const timer = setTimeout(() => resolve(Uint8Array.from([9])), 5_000);
        signal.addEventListener("abort", () => clearTimeout(timer));
      });

    const timedOut = await renderChart(makeSpec(), { timeoutMs: 20 }, {
      ...CONTAINER,
      renderer: slowRenderer,
    });
    expect(timedOut.ok).toBe(false);

    // A fresh render on the same module (default fast renderer) still works.
    const next = await renderChart(makeSpec(), undefined, {
      ...CONTAINER,
      renderer: defaultChartRenderer,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error("expected the subsequent render to succeed");
    expect(next.artifact.mimeType).toBe("image/png");
    expect(next.artifact.dataPointCount).toBe(3);
    expect(activeRenderCount()).toBe(0);
  });
});

describe("renderChart — at-capacity rejection (Requirement 5.7)", () => {
  it("rejects a request at the concurrency cap and recovers once slots free up", async () => {
    const releasers: Array<() => void> = [];

    // A renderer that holds its slot until explicitly released.
    const holdingRenderer: ChartRenderer = () =>
      new Promise<Uint8Array>((resolve) => {
        releasers.push(() => resolve(Uint8Array.from([0])));
      });

    const cfg = { maxConcurrent: 2, timeoutMs: 10_000 };

    // Fill both slots. renderChart increments the semaphore synchronously up to
    // its first await, so by the time these calls return their pending promises
    // the cap is reached. We do NOT await them yet.
    const held1 = renderChart(makeSpec(), cfg, { ...CONTAINER, renderer: holdingRenderer });
    const held2 = renderChart(makeSpec(), cfg, { ...CONTAINER, renderer: holdingRenderer });

    expect(activeRenderCount()).toBe(2);

    // A third request at capacity is rejected, not queued.
    const rejected = await renderChart(makeSpec(), cfg, {
      ...CONTAINER,
      renderer: holdingRenderer,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected a capacity rejection");
    expect(rejected.error.code).toBe("capacity");
    if (rejected.error.code !== "capacity") throw new Error("narrowing");
    expect(rejected.error.maxConcurrent).toBe(2);

    // The rejected request never started a render, so still exactly 2 in flight.
    expect(activeRenderCount()).toBe(2);

    // Free up the held slots.
    for (const release of releasers) release();
    await Promise.all([held1, held2]);
    expect(activeRenderCount()).toBe(0);

    // Capacity recovered: a further render now succeeds.
    const recovered = await renderChart(makeSpec(), cfg, {
      ...CONTAINER,
      renderer: defaultChartRenderer,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) throw new Error("expected recovery render to succeed");
    expect(recovered.artifact.dataPointCount).toBe(3);
  });
});
