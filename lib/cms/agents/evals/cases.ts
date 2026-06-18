// lib/cms/agents/evals/cases.ts
//
// The Eval_Harness case set (Agentic Foundation S1, Design §Components #5,
// Requirement 6.4). It provides at least one {@link EvalCase} for EVERY
// Migrated_Capability of Requirements 8 and 9:
//
//   • the ten text capabilities (Req 8.1): create_lead, register_lead,
//     create_ticket, create_booking, cancel_appointment,
//     reschedule_appointment, request_otp, request_handover, navigate,
//     provide_contact;
//   • the six admin read-only reports (Req 9.1): report_overview,
//     report_projects, report_clients, report_leads, report_tickets,
//     report_appointments;
//   • plus the propose/confirm human-in-the-loop confirmation flow (Req 9.3–9.4).
//
// The coverage anchors ({@link TEXT_EVAL_CAPABILITIES},
// {@link ADMIN_REPORT_EVAL_CAPABILITIES}) are derived from the canonical
// capability modules so the eval set can never silently drift from the catalog —
// task 7.2 asserts the case set covers every name in these anchors.
//
// Each case's input is phrased so the deterministic reference agent
// (./reference-agents.ts) routes it to exactly the right tool; the `expect`
// predicate then verifies the agent dispatched that — and only that — tool. The
// confirmation-flow case additionally stubs the fake dispatcher so propose
// returns a token and verifies the agent threads it into confirm.
//
// [container-only] Container/worker tier only — do NOT import from `app/`.
//
// Design references: §Components #5 (Eval_Harness). Requirements: 6.3, 6.4.

import { TEXT_CAPABILITY_NAMES } from "../../ai/tools/text-capabilities";
import { adminReportCapabilities } from "../../ai/tools/admin-capabilities";
import type { AgentTrace } from "../tracing";
import type { DispatchStub, EvalCase, ToolCallRecord } from "./harness";

// ── Coverage anchors (derived from the canonical catalog) ────────────────────

/** The ten text capabilities under eval (Requirement 8.1), in catalog order. */
export const TEXT_EVAL_CAPABILITIES: readonly string[] = TEXT_CAPABILITY_NAMES;

/** The six admin read-only reports under eval (Requirement 9.1). */
export const ADMIN_REPORT_EVAL_CAPABILITIES: readonly string[] =
  adminReportCapabilities.map((e) => e.name);

/** The capability label for the propose/confirm confirmation flow eval. */
export const ADMIN_CONFIRMATION_FLOW_CAPABILITY = "admin_confirmation_flow";

// ── Expectation predicates ────────────────────────────────────────────────────

/**
 * Passes iff `toolName` was the single tool the agent dispatched, exactly once,
 * with no other tool calls — the correctness bar for a single-capability case.
 * Also confirms the trace recorded exactly that one tool step.
 */
function onlyToolCalledOnce(toolName: string) {
  return (
    trace: AgentTrace,
    calls: ReadonlyArray<ToolCallRecord>,
  ): boolean => {
    if (calls.length !== 1 || calls[0].toolName !== toolName) return false;
    const toolSteps = trace.steps.filter((s) => s.kind === "tool");
    return toolSteps.length === 1 && toolSteps[0].toolName === toolName;
  };
}

/**
 * Passes iff the agent dispatched `propose_admin_action` then
 * `confirm_admin_action` (in that order, exactly once each) and threaded the
 * proposal's token into the confirm call (Req 9.3–9.4).
 */
function proposedThenConfirmed(expectedToken: string) {
  return (
    _trace: AgentTrace,
    calls: ReadonlyArray<ToolCallRecord>,
  ): boolean => {
    if (calls.length !== 2) return false;
    const [first, second] = calls;
    if (first.toolName !== "propose_admin_action") return false;
    if (second.toolName !== "confirm_admin_action") return false;
    const token = (second.input as { token?: unknown } | undefined)?.token;
    return token === expectedToken;
  };
}

// ── Text capability cases (Requirement 8.1) ──────────────────────────────────

/** One eval case per migrated text capability (Requirement 8.1). */
export const textEvalCases: EvalCase[] = [
  {
    capability: "create_lead",
    input:
      "I'm interested in buying a villa — please send me the brochure and price list.",
    expect: onlyToolCalledOnce("create_lead"),
  },
  {
    capability: "register_lead",
    input:
      "I'm a broker; please register my client Ahmed who is interested in a villa.",
    expect: onlyToolCalledOnce("register_lead"),
  },
  {
    capability: "create_ticket",
    input: "I need to open a support ticket to request an NOC.",
    expect: onlyToolCalledOnce("create_ticket"),
  },
  {
    capability: "create_booking",
    input: "Can I book a site visit for next Tuesday at 10:00?",
    expect: onlyToolCalledOnce("create_booking"),
  },
  {
    capability: "cancel_appointment",
    input: "Please cancel my appointment ORA-APT-000042.",
    expect: onlyToolCalledOnce("cancel_appointment"),
  },
  {
    capability: "reschedule_appointment",
    input: "I'd like to reschedule appointment ORA-APT-000042 to Friday at 14:00.",
    expect: onlyToolCalledOnce("reschedule_appointment"),
  },
  {
    capability: "request_otp",
    input: "Please send me a verification code so I can verify my identity.",
    expect: onlyToolCalledOnce("request_otp"),
  },
  {
    capability: "request_handover",
    input: "I'd like to talk to a human agent, please.",
    expect: onlyToolCalledOnce("request_handover"),
  },
  {
    capability: "navigate",
    input: "Where can I find your contact page on the website?",
    expect: onlyToolCalledOnce("navigate"),
  },
  {
    capability: "provide_contact",
    input: "My name is Sara and my email is sara@example.com.",
    expect: onlyToolCalledOnce("provide_contact"),
  },
];

// ── Admin report cases (Requirement 9.1) ─────────────────────────────────────

/** One eval case per admin read-only report (Requirement 9.1). */
export const adminReportEvalCases: EvalCase[] = [
  {
    capability: "report_overview",
    input: "Give me a platform overview.",
    expect: onlyToolCalledOnce("report_overview"),
  },
  {
    capability: "report_projects",
    input: "How many projects do we have, broken down by status?",
    expect: onlyToolCalledOnce("report_projects"),
  },
  {
    capability: "report_clients",
    input: "How many clients are in the CRM?",
    expect: onlyToolCalledOnce("report_clients"),
  },
  {
    capability: "report_leads",
    input: "How many leads did we capture this month?",
    expect: onlyToolCalledOnce("report_leads"),
  },
  {
    capability: "report_tickets",
    input: "Show me the ticket report broken down by status.",
    expect: onlyToolCalledOnce("report_tickets"),
  },
  {
    capability: "report_appointments",
    input: "How many appointments are scheduled?",
    expect: onlyToolCalledOnce("report_appointments"),
  },
];

// ── Admin confirmation-flow case (Requirement 9.3–9.4) ───────────────────────

/** The token the confirmation-flow stub returns from propose_admin_action. */
const CONFIRMATION_FLOW_TOKEN = "eval-confirmation-token";

/**
 * Counting-fake stub for the confirmation flow: `propose_admin_action` returns a
 * single-use token (no mutation in that step), `confirm_admin_action` reports
 * the bound action executed. Every other tool succeeds trivially.
 */
const confirmationFlowDispatch: DispatchStub = (name) => {
  if (name === "propose_admin_action") {
    return {
      ok: true,
      result: {
        token: CONFIRMATION_FLOW_TOKEN,
        kind: "bulk_close_tickets",
        requiresConfirmation: true,
        expiresAt: "2999-01-01T00:00:00.000Z",
      },
    };
  }
  if (name === "confirm_admin_action") {
    return {
      ok: true,
      result: { executed: true, kind: "bulk_close_tickets", message: "done" },
    };
  }
  return { ok: true, result: { tool: name } };
};

/** The propose/confirm human-in-the-loop confirmation flow case (Req 9.3–9.4). */
export const adminConfirmationFlowCase: EvalCase = {
  capability: ADMIN_CONFIRMATION_FLOW_CAPABILITY,
  input: "Close all resolved tickets in bulk.",
  dispatch: confirmationFlowDispatch,
  expect: proposedThenConfirmed(CONFIRMATION_FLOW_TOKEN),
};

/** Every admin eval case: the six reports plus the confirmation flow. */
export const adminEvalCases: EvalCase[] = [
  ...adminReportEvalCases,
  adminConfirmationFlowCase,
];

/** The complete eval case set across both agents (text + admin). */
export const allEvalCases: EvalCase[] = [...textEvalCases, ...adminEvalCases];
