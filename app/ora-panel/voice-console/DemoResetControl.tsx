"use client";

import { useState } from "react";
import { RotateCcw, TriangleAlert, LoaderCircle, Check, X } from "lucide-react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

type ResetStatus = "idle" | "confirming" | "loading" | "success" | "error";

interface DemoResetResult {
  /** Optional human-readable summary returned by POST /api/demo/reset (task 18.2). */
  message?: string;
  /** Optional count of demo-scoped rows removed, surfaced by the reset service. */
  removed?: number;
  [key: string]: unknown;
}

export interface DemoResetControlProps {
  /**
   * Optional callback fired after a successful reset so the Console page (task 15.1)
   * can clear its SSE-driven panes / re-subscribe. Kept optional so the control is
   * fully self-contained and usable without a parent handler.
   */
  onResetComplete?: (result: DemoResetResult) => void;
  className?: string;
}

/**
 * Self-contained reset control for the Demo Console.
 *
 * Wires the operator reset action to `POST /api/demo/reset` (Requirement 7.8,
 * Design §10). The endpoint is admin-gated and implemented in task 18.2; this
 * control calls it regardless and degrades gracefully when it is not yet
 * available (e.g. 404 before 18.2 lands) by surfacing an error card with retry.
 *
 * Mounting (for task 15.1's Console page shell):
 *
 *   import { DemoResetControl } from "./DemoResetControl";
 *   // inside the Console header / toolbar:
 *   <DemoResetControl onResetComplete={handleResetComplete} />
 *
 * The control manages its own confirm → loading → success/error lifecycle and
 * requires no provider, so it can be dropped anywhere in the page tree.
 */
export function DemoResetControl({ onResetComplete, className }: DemoResetControlProps) {
  const [status, setStatus] = useState<ResetStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DemoResetResult | null>(null);

  const isBusy = status === "loading";

  const runReset = async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/reset`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      // Parse defensively: the endpoint may not exist yet (404 before task 18.2),
      // or may return a non-JSON error body.
      let json: DemoResetResult = {};
      try {
        json = (await res.json()) as DemoResetResult;
      } catch {
        json = {};
      }

      if (!res.ok) {
        const reason =
          typeof json.message === "string" && json.message
            ? json.message
            : res.status === 404
              ? "Reset endpoint is not available yet."
              : `Reset failed (${res.status}).`;
        throw new Error(reason);
      }

      setResult(json);
      setStatus("success");
      onResetComplete?.(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
      setStatus("error");
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className={className}>
        <button
          type="button"
          disabled
          aria-busy="true"
          className="inline-flex h-10 items-center gap-2 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal-light disabled:opacity-70"
        >
          <LoaderCircle className="h-4 w-4 animate-spin stroke-1" aria-hidden="true" />
          Resetting demo…
        </button>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className={className}>
        <div
          role="status"
          className="inline-flex items-center gap-2 border border-ora-sand/60 bg-ora-white px-4 py-2 text-sm text-ora-charcoal"
        >
          <Check className="h-4 w-4 stroke-1 text-ora-gold" aria-hidden="true" />
          <span>
            {result?.message
              ? result.message
              : typeof result?.removed === "number"
                ? `Demo reset complete — ${result.removed} rows cleared.`
                : "Demo reset complete."}
          </span>
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setResult(null);
            }}
            className="ml-1 text-xs text-ora-charcoal-light underline-offset-2 hover:underline"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className={className}>
        <div
          role="alert"
          className="flex items-start gap-2 border border-ora-error/40 bg-ora-white px-4 py-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 stroke-1 text-ora-error" aria-hidden="true" />
          <div>
            <p className="text-ora-error">{error}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={runReset}
                className="inline-flex h-8 items-center gap-1.5 bg-ora-charcoal px-3 text-xs text-ora-white transition-colors hover:bg-ora-graphite"
              >
                <RotateCcw className="h-3.5 w-3.5 stroke-1" aria-hidden="true" />
                Retry
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setError(null);
                }}
                className="text-xs text-ora-charcoal-light underline-offset-2 hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Confirming (destructive two-step) ─────────────────────────────────────────
  if (status === "confirming") {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 border border-ora-error/40 bg-ora-white px-4 py-2 text-sm">
          <span className="text-ora-charcoal">Reset all demo data?</span>
          <button
            type="button"
            onClick={runReset}
            disabled={isBusy}
            className="inline-flex h-8 items-center gap-1.5 bg-ora-error px-3 text-xs text-ora-white transition-colors hover:opacity-90 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5 stroke-1" aria-hidden="true" />
            Confirm reset
          </button>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="inline-flex h-8 items-center gap-1.5 px-2 text-xs text-ora-charcoal-light hover:text-ora-charcoal"
          >
            <X className="h-3.5 w-3.5 stroke-1" aria-hidden="true" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Idle ───────────────────────────────────────────────────────────────────
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setStatus("confirming")}
        className="inline-flex h-10 items-center gap-2 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal transition-colors hover:bg-ora-sand/40"
      >
        <RotateCcw className="h-4 w-4 stroke-1" aria-hidden="true" />
        Reset demo
      </button>
    </div>
  );
}

export default DemoResetControl;
