// lib/cms/agents/evals/index.ts
//
// Public surface of the Eval_Harness (Agentic Foundation S1, Design §Components
// #5, Requirements 6.3, 6.4). Re-exports the harness primitives, the
// deterministic reference agents, and the per-capability case set, plus a
// {@link runDefaultEvals} convenience that runs the full suite against the
// reference agents (text cases → reference text agent, admin cases → reference
// admin agent) and returns one pass/fail report per case.
//
// [container-only] Container/worker tier only — do NOT import from any `app/`
// route/page/layout module (Requirement 15.3).
//
// Design references: §Components #5 (Eval_Harness). Requirements: 6.3, 6.4.

export {
  runEvals,
  createCountingDispatcher,
  DEFAULT_DISPATCH_STUB,
  type AgentLike,
  type EvalAgentContext,
  type EvalCase,
  type EvalReport,
  type ToolCallRecord,
  type CountingDispatcher,
  type DispatchStub,
} from "./harness";

export {
  createReferenceTextAgent,
  createReferenceAdminAgent,
} from "./reference-agents";

export {
  textEvalCases,
  adminReportEvalCases,
  adminConfirmationFlowCase,
  adminEvalCases,
  allEvalCases,
  TEXT_EVAL_CAPABILITIES,
  ADMIN_REPORT_EVAL_CAPABILITIES,
  ADMIN_CONFIRMATION_FLOW_CAPABILITY,
} from "./cases";

import { runEvals, type EvalReport } from "./harness";
import {
  createReferenceTextAgent,
  createReferenceAdminAgent,
} from "./reference-agents";
import { textEvalCases, adminEvalCases } from "./cases";

/**
 * Run the full default eval suite against the deterministic reference agents
 * (Requirement 6.3, 6.4): the ten text-capability cases against the reference
 * text agent and the six report + confirmation-flow cases against the reference
 * admin agent. Returns one {@link EvalReport} per case. Deterministic and
 * credential-free.
 */
export async function runDefaultEvals(): Promise<EvalReport[]> {
  const textReports = await runEvals(createReferenceTextAgent(), textEvalCases);
  const adminReports = await runEvals(
    createReferenceAdminAgent(),
    adminEvalCases,
  );
  return [...textReports, ...adminReports];
}
