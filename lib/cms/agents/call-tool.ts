// lib/cms/agents/call-tool.ts
//
// The single binding seam between a Mastra tool and the audited dispatcher
// (Design §Components #2). Every Mastra_Tool_Binding's `execute()` does NO work
// itself — it delegates here, and `callTool` calls `dispatchTool` so the agent
// path inherits the exact same Zod → RBAC → OTP → audit → execute guarantees as
// every other caller. Agents never touch the database directly (Requirement 3.1).
//
// Decision — in-process vs HTTP (Design §"Dispatcher binding"). Mastra agents
// and workflows run on the container/worker tier (Requirement 15.3), in the same
// process and codebase as the Elysia app and the `db` handle. We therefore bind
// tools to `dispatchTool` IN-PROCESS by default: it removes an HTTP hop (latency
// and an extra auth surface) while preserving every guarantee, because
// validation/RBAC/OTP/audit all live inside `dispatchTool`, not the route
// handler. The out-of-process transport — Eden `POST /api/tools/:toolName` behind
// a service-token guard — remains the path for any separately-deployed agent
// (today the voice worker; tomorrow a remote agent). Both transports converge on
// the SAME `dispatchTool`, so "through the Tool_Dispatcher" (Requirement 3.1) is
// satisfied either way.
//
// [container-only] This seam runs on the container/worker tier only, never on
// Next.js serverless (Requirement 15.3).
//
// Design references: §Components #2 (Mastra_Tool_Binding → Tool_Dispatcher).
// Requirements: 3.1.

import type { IdentityResult } from "../ai/identity";
import type { OtpVerificationState } from "../ai/otp";
import type { Language } from "../voice/contracts";
import { db } from "../db";
import { dispatchTool, type DispatchResult } from "../ai/tools/dispatch";

/**
 * Per-call context threaded from a Mastra agent turn into the dispatcher. The
 * agent supplies its RBAC identity (`agentActor`) plus the conversation and
 * caller details the dispatcher's OTP gate and audit need. `runtimeCtx` carries
 * the Mastra tool-execution context for the call so the seam can be extended
 * without changing the binding signature.
 */
export interface CallToolCtx {
  /** The dispatching agent's RBAC identity, e.g. `"agent:text-lead"`. */
  agentActor: string;
  /**
   * OPTIONAL per-call dispatch actor — the REQUESTING USER's identity for this
   * turn, when the agent runs on behalf of a signed-in user (e.g. the
   * Home_Agent, Requirement 8.2). When present it becomes the dispatcher's
   * `ctx.actor`, so the audit log records the requesting user (and RBAC is
   * checked against that user) rather than the static agent identity. When
   * ABSENT (the default for agents that act under their own identity, like the
   * text/admin agents) the dispatch actor falls back to {@link agentActor}, so
   * existing callers are unaffected.
   */
  requestingActor?: string;
  /** The Mastra tool-execution context for this call. */
  runtimeCtx?: unknown;
  /** The active conversation id, when the turn has one. */
  conversationId?: string;
  /** Resolved caller identity (client / tenant / visitor). */
  identity?: IdentityResult;
  /** Turn language, for OTP-gate prompts. */
  language?: Language;
  /** Current OTP verification state on the conversation. */
  otpVerificationState?: OtpVerificationState;
}

/**
 * Default (co-located) transport: dispatch a single tool call in-process through
 * the audited `dispatchTool`. Returns the structured {@link DispatchResult}; it
 * never throws, so the agent run stays active and keeps reasoning even when the
 * tool fails (Requirement 3.6, inherited from the dispatcher).
 *
 * Out-of-process agents instead POST to `/api/tools/:toolName`, which calls the
 * SAME `dispatchTool` behind a service-token guard — both paths are "through the
 * Tool_Dispatcher" (Requirement 3.1) and carry identical guarantees.
 *
 * @param name   The catalog tool name to dispatch (resolved by the dispatcher).
 * @param input  The raw, unvalidated tool input (validated inside the dispatcher).
 * @param ctx    The agent-turn context (RBAC identity, conversation, OTP state).
 */
export async function callTool(
  name: string,
  input: unknown,
  ctx: CallToolCtx
): Promise<DispatchResult> {
  return dispatchTool(db, name, input, {
    // The dispatcher records `ctx.actor` as the audited actor AND checks RBAC
    // against it. When a per-turn requesting user is threaded (the Home_Agent's
    // Delegated_Actions, Requirement 8.2), that user's identity is the dispatch
    // actor, so the audit log records the user (never `agent:home-twin`). When
    // absent — the default for agents acting under their own identity, e.g. the
    // text/admin agents — the dispatch falls back to the static agent identity.
    actor: ctx.requestingActor ?? ctx.agentActor,
    // The bound agent's identity, carried so the dispatcher can authorize the
    // call via the agent's (delegated) RBAC grant when the requesting user does
    // not personally hold the tool permission. RBAC still passes if EITHER the
    // user or the bound agent is permitted; per-row clamps below keep results
    // scoped to the user.
    agentActor: ctx.agentActor,
    // The requesting user id, threaded so a handler's row-level scope
    // (`ctx.userId`) clamps reads/writes to that user (e.g. `list_stack`).
    userId: ctx.requestingActor,
    conversationId: ctx.conversationId,
    identity: ctx.identity,
    language: ctx.language,
    otpVerificationState: ctx.otpVerificationState,
  });
}
