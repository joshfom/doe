/**
 * Per-run model cost ceiling guard (Agentic Foundation S1, Design §Components #4).
 *
 * The Mastra runtime must enforce a per-run model cost ceiling, expressed as a
 * configurable maximum token and/or call (step) budget (Requirement 5.4). When
 * an agent run crosses that ceiling, the runtime must halt further model calls
 * for that run and return a structured budget-exceeded result rather than
 * continuing to spend (Requirement 5.5).
 *
 * `runWithBudget` wraps an agent run with that guard. It threads an
 * `AbortController` signal into the run and an `onStep` callback the run invokes
 * after each model step with that step's token usage delta. The guard
 * accumulates usage and, on the FIRST crossing of either ceiling, records the
 * reason and aborts the run via the signal — so no model step executes after
 * the abort. Whether the wrapped run resolves or rejects (because the abort
 * surfaced as a thrown `AbortError`), a crossing always yields the structured
 * budget-exceeded result; only a genuine, non-budget error is re-thrown.
 *
 * Mastra's native `maxSteps` provides the call ceiling; the token ceiling is
 * enforced here by accumulating per-step `usage` via the run's step hook
 * (Design §Components #4, "Per-run cost ceiling").
 *
 * Design references: §Components #4 (Per-run cost ceiling).
 * Requirements: 5.4, 5.5.
 */

/** The configurable per-run ceiling: a maximum step count and token budget. */
export interface RunBudget {
  /** Maximum number of model steps (calls) permitted in the run. */
  maxSteps: number;
  /** Maximum cumulative token usage permitted across the run. */
  maxTokens: number;
}

/**
 * The structured outcome of a budgeted run.
 *  - `ok: true`  → the run completed within budget; `result` is its value.
 *  - `ok: false` → a ceiling was crossed; `budgetExceeded` records which ceiling
 *    (`"tokens"` or `"steps"`) and the usage tallied at the crossing.
 */
export type BudgetedResult<T> =
  | { ok: true; result: T }
  | {
      ok: false;
      budgetExceeded: {
        reason: "tokens" | "steps";
        usedTokens: number;
        usedSteps: number;
      };
    };

/**
 * The wrapped run. Receives:
 *  - `signal`  — aborted by the guard on the first ceiling crossing; the run
 *    must stop issuing model calls when it fires (passed to Mastra's run as its
 *    `abortSignal`);
 *  - `onStep`  — called by the run after each model step with that step's token
 *    usage delta, so the guard can tally usage and decide whether to abort.
 */
export type BudgetedRun<T> = (
  signal: AbortSignal,
  onStep: (usageDelta: number) => void,
) => Promise<T>;

/**
 * Run `run` under a per-run cost ceiling (Requirements 5.4, 5.5).
 *
 * The guard tallies steps and tokens as the run reports them via `onStep`. On
 * the first crossing of either ceiling it records the reason and aborts the
 * run's signal, so no model step executes after the abort. A crossing always
 * resolves to a structured budget-exceeded result — including when the abort
 * causes the wrapped run to reject with an abort error. Any error raised
 * without a budget crossing is a genuine failure and is re-thrown unchanged.
 */
export async function runWithBudget<T>(
  budget: RunBudget,
  run: BudgetedRun<T>,
): Promise<BudgetedResult<T>> {
  const controller = new AbortController();
  let usedTokens = 0;
  let usedSteps = 0;
  let exceeded: "tokens" | "steps" | null = null;

  const onStep = (usageDelta: number): void => {
    // Already over the ceiling and aborted: ignore any late-arriving deltas so
    // the recorded tally reflects usage at the crossing, not after it.
    if (exceeded !== null) return;

    usedTokens += usageDelta;
    usedSteps += 1;

    // Steps are checked first: a step that also pushes tokens over is still a
    // step crossing, matching the design sketch's ordering.
    if (usedSteps > budget.maxSteps) {
      exceeded = "steps";
      controller.abort();
    } else if (usedTokens > budget.maxTokens) {
      exceeded = "tokens";
      controller.abort();
    }
  };

  try {
    const result = await run(controller.signal, onStep);
    return exceeded !== null
      ? {
          ok: false,
          budgetExceeded: { reason: exceeded, usedTokens, usedSteps },
        }
      : { ok: true, result };
  } catch (error) {
    // If we aborted because the ceiling was crossed, the rejection is the
    // expected consequence of the abort — surface the structured result.
    if (exceeded !== null) {
      return {
        ok: false,
        budgetExceeded: { reason: exceeded, usedTokens, usedSteps },
      };
    }
    // Otherwise it is a genuine failure unrelated to the budget.
    throw error;
  }
}
