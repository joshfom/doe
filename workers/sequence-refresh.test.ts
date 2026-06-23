import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Database } from "@/lib/cms/db";

/**
 * Tests for the sequence-refresh worker (task 4.5).
 *
 * The worker owns only the cadence; the testable unit is
 * {@link runSequenceRefreshTick}, which wraps the pure
 * `runSequenceRefreshSweep` workflow so a tick failure is logged and never
 * throws out of the loop (Req 4.1, 14.4). The sweep itself is mocked here — its
 * behaviour is covered by the refresh-sweep property tests — so this file
 * asserts only the worker contract: one tick invokes the sweep once, and a
 * thrown sweep error is swallowed (the loop survives).
 */

const h = vi.hoisted(() => ({
  sweep: vi.fn(),
}));

vi.mock("@/lib/cms/prospecting/sequences/refresh-sweep", () => ({
  runSequenceRefreshSweep: h.sweep,
}));

// `@/lib/cms/db` pulls a live pg pool at import time; stub it so importing the
// worker never opens a connection (the tick is driven with an explicit handle).
vi.mock("@/lib/cms/db", () => ({ db: {} }));

import {
  runSequenceRefreshTick,
  resolveSequenceRefreshIntervalMs,
  SEQUENCE_REFRESH_DEFAULT_INTERVAL_MS,
} from "./sequence-refresh";

const fakeDb = {} as Database;

describe("sequence-refresh worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("one tick invokes runSequenceRefreshSweep exactly once and returns its result (Req 4.1)", async () => {
    h.sweep.mockResolvedValueOnce({ due: 3, enqueued: 2 });

    const result = await runSequenceRefreshTick(fakeDb);

    expect(h.sweep).toHaveBeenCalledTimes(1);
    expect(h.sweep).toHaveBeenCalledWith(fakeDb);
    expect(result).toEqual({ due: 3, enqueued: 2 });
  });

  it("a thrown sweep error is swallowed — the tick resolves to null and never throws (loop survives, Req 14.4)", async () => {
    h.sweep.mockRejectedValueOnce(new Error("sweep blew up"));

    const result = await runSequenceRefreshTick(fakeDb);

    expect(h.sweep).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("a subsequent tick still runs after a prior tick failed (the loop is resilient)", async () => {
    h.sweep.mockRejectedValueOnce(new Error("transient"));
    h.sweep.mockResolvedValueOnce({ due: 1, enqueued: 1 });

    const first = await runSequenceRefreshTick(fakeDb);
    const second = await runSequenceRefreshTick(fakeDb);

    expect(first).toBeNull();
    expect(second).toEqual({ due: 1, enqueued: 1 });
    expect(h.sweep).toHaveBeenCalledTimes(2);
  });

  it("the sweep interval defaults to 60s and honours a positive SEQUENCE_REFRESH_INTERVAL_MS override", () => {
    expect(resolveSequenceRefreshIntervalMs({} as NodeJS.ProcessEnv)).toBe(
      SEQUENCE_REFRESH_DEFAULT_INTERVAL_MS
    );
    expect(SEQUENCE_REFRESH_DEFAULT_INTERVAL_MS).toBe(60_000);
    expect(
      resolveSequenceRefreshIntervalMs({
        SEQUENCE_REFRESH_INTERVAL_MS: "5000",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(5000);
    // Non-positive / non-numeric falls back to the default.
    expect(
      resolveSequenceRefreshIntervalMs({
        SEQUENCE_REFRESH_INTERVAL_MS: "0",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(SEQUENCE_REFRESH_DEFAULT_INTERVAL_MS);
    expect(
      resolveSequenceRefreshIntervalMs({
        SEQUENCE_REFRESH_INTERVAL_MS: "not-a-number",
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(SEQUENCE_REFRESH_DEFAULT_INTERVAL_MS);
  });
});
