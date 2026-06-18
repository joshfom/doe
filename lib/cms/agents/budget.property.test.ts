import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { runWithBudget, type RunBudget } from "./budget";

/**
 * **Feature: agentic-foundation, Property 20: For any sequence of per-step token/step usages, runWithBudget returns a structured budget-exceeded result exactly when cumulative usage first crosses the configured ceiling, and no model step executes after the abort.**
 *
 * **Validates: Requirements 5.4, 5.5**
 *
 * `runWithBudget` (Design §Components #4, "Per-run cost ceiling") wraps an agent
 * run with a per-run cost ceiling expressed as a maximum step count and token
 * budget (Requirement 5.4). It threads an `AbortSignal` into the run and an
 * `onStep(usageDelta)` callback the run invokes after each model step. On the
 * FIRST crossing of either ceiling the guard records the reason and aborts the
 * signal, so no further model step runs and a structured budget-exceeded result
 * is returned instead of more model calls (Requirement 5.5). Steps are checked
 * before tokens, so a step that simultaneously crosses both ceilings is a
 * "steps" crossing.
 *
 * To pin this down we generate arbitrary sequences of non-negative per-step
 * token usages together with arbitrary `maxSteps`/`maxTokens` ceilings, and
 * drive a FAKE run that mirrors how a real Mastra run behaves: before each step
 * it checks `signal.aborted` (and stops if so), otherwise it "executes" the step
 * (recording that it ran) and reports that step's token delta via `onStep`.
 *
 * An independent reference model computes, from the same inputs, exactly which
 * step (if any) is the first crossing, the reason, the usage tallied at that
 * point, and how many steps therefore execute. The test asserts `runWithBudget`
 * agrees with the model on (a) ok vs budget-exceeded, (b) the reason and usage
 * tallies at the crossing, and (c) the exact set of steps that executed — which
 * is what guarantees no step runs after the abort.
 */

// ── Independent reference model of the budget semantics ──────────────────────
// Mirrors the contract WITHOUT reusing the implementation's control flow:
// a step i (0-indexed) executes, then reports delta[i]; after reporting,
// usedSteps = i+1 and usedTokens = sum(delta[0..i]). The first step at which
// usedSteps > maxSteps (checked first) or usedTokens > maxTokens is the
// crossing; that step still executed, and no later step executes.
interface Expectation {
  ok: boolean;
  reason: "tokens" | "steps" | null;
  usedTokens: number;
  usedSteps: number;
  /** Number of steps that execute (== crossing index + 1, or all of them). */
  executedSteps: number;
}

function expected(deltas: number[], budget: RunBudget): Expectation {
  let usedTokens = 0;
  let usedSteps = 0;
  for (let i = 0; i < deltas.length; i++) {
    // Step i executes, then reports its usage.
    usedSteps += 1;
    usedTokens += deltas[i];
    if (usedSteps > budget.maxSteps) {
      return { ok: false, reason: "steps", usedTokens, usedSteps, executedSteps: i + 1 };
    }
    if (usedTokens > budget.maxTokens) {
      return { ok: false, reason: "tokens", usedTokens, usedSteps, executedSteps: i + 1 };
    }
  }
  return { ok: true, reason: null, usedTokens, usedSteps, executedSteps: deltas.length };
}

// A step's token usage is non-negative (real token usage cannot be negative).
const deltaArb = fc.nat({ max: 500 });
const deltasArb = fc.array(deltaArb, { maxLength: 40 });
// Ceilings span 0 (immediate crossing) up through values larger than any
// plausible run total, so generated cases exercise step-first crossings,
// token-first crossings, simultaneous crossings, and within-budget runs.
const budgetArb: fc.Arbitrary<RunBudget> = fc.record({
  maxSteps: fc.nat({ max: 45 }),
  maxTokens: fc.nat({ max: 6000 }),
});

/**
 * A fake run that executes steps one at a time. Before each step it honours the
 * abort signal (so no step runs after the guard aborts); it records every step
 * that actually executes into `executed`, then reports that step's delta. The
 * run resolves with the list of executed step indices.
 */
function makeResolvingRun(deltas: number[], executed: number[]) {
  return async (signal: AbortSignal, onStep: (delta: number) => void): Promise<number[]> => {
    for (let i = 0; i < deltas.length; i++) {
      if (signal.aborted) break; // abort honoured — no model step after the abort
      executed.push(i); // this step executes
      onStep(deltas[i]); // report usage; the guard may abort here
    }
    return executed;
  };
}

describe("runWithBudget — per-run cost ceiling (Property 20)", () => {
  it("returns budget-exceeded exactly at the first crossing and runs no step after the abort", async () => {
    await fc.assert(
      fc.asyncProperty(deltasArb, budgetArb, async (deltas, budget) => {
        const exp = expected(deltas, budget);
        const executed: number[] = [];
        const result = await runWithBudget(budget, makeResolvingRun(deltas, executed));

        // (c) Exactly the steps up to and including the crossing executed, and
        // none after — i.e. the executed indices are 0..executedSteps-1.
        expect(executed).toStrictEqual(
          Array.from({ length: exp.executedSteps }, (_v, i) => i),
        );

        if (exp.ok) {
          // (a) Within budget → ok, and the run completed every step.
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.result).toStrictEqual(executed);
          expect(executed).toHaveLength(deltas.length);
        } else {
          // (a)+(b) Crossed → structured budget-exceeded with the model's
          // reason and the usage tallied at the crossing.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.budgetExceeded.reason).toBe(exp.reason);
            expect(result.budgetExceeded.usedSteps).toBe(exp.usedSteps);
            expect(result.budgetExceeded.usedTokens).toBe(exp.usedTokens);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("still surfaces the structured budget-exceeded result when the aborted run rejects", async () => {
    // A real Mastra run may reject with an AbortError once its signal fires.
    // The guard must convert that into the same structured result, not throw.
    await fc.assert(
      fc.asyncProperty(deltasArb, budgetArb, async (deltas, budget) => {
        const exp = expected(deltas, budget);
        const executed: number[] = [];
        const result = await runWithBudget<number[]>(budget, async (signal, onStep) => {
          for (let i = 0; i < deltas.length; i++) {
            if (signal.aborted) {
              // Simulate the run rejecting because its signal was aborted.
              const err = new Error("aborted");
              err.name = "AbortError";
              throw err;
            }
            executed.push(i);
            onStep(deltas[i]);
          }
          return executed;
        });

        // No step executes after the abort, regardless of how the run unwinds.
        expect(executed).toStrictEqual(
          Array.from({ length: exp.executedSteps }, (_v, i) => i),
        );

        if (exp.ok) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.budgetExceeded.reason).toBe(exp.reason);
            expect(result.budgetExceeded.usedSteps).toBe(exp.usedSteps);
            expect(result.budgetExceeded.usedTokens).toBe(exp.usedTokens);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
