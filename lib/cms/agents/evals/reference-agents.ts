// lib/cms/agents/evals/reference-agents.ts
//
// Deterministic reference agents for the Eval_Harness (Agentic Foundation S1,
// Design §Components #5). These implement {@link AgentLike} WITHOUT a model
// gateway or memory connection so the harness is reproducible and runnable
// without network/credentials (the "[deps]" constraint). Each agent maps a
// natural-language turn onto exactly the catalog tool a correctly-behaving
// migrated capability would dispatch, via simple ordered keyword routing — a
// deterministic stand-in for the model's tool selection. The cases in
// ./cases.ts pair each capability with an input these routers resolve to the
// matching tool, so `runEvals` exercises real input→tool behaviour without a
// live agent loop.
//
// A production adapter (wrapping a real Mastra agent through `runAgentTurn`)
// could implement the same {@link AgentLike} surface; the reference agents are
// the deterministic baseline the eval suite runs against.
//
// [container-only] Container/worker tier only — do NOT import from `app/`.
//
// Design references: §Components #5 (Eval_Harness). Requirements: 6.3, 6.4.

import type { ModelTier } from "../gateway";
import type { AgentLike, EvalAgentContext } from "./harness";

// The reference agents declare the SAME model tiers as the migrated Mastra
// agents (text → "fast", admin → "premium"; see text-agent.ts / admin-agent.ts)
// for trace parity. They are stated as literals here rather than imported so the
// harness stays free of the `@mastra/core/agent` runtime graph and remains
// model-free and credential-free.
const TEXT_AGENT_MODEL_TIER: ModelTier = "fast";
const ADMIN_AGENT_MODEL_TIER: ModelTier = "premium";

/** Case-insensitive "input contains any of these substrings" helper. */
function mentions(input: string, ...needles: string[]): boolean {
  const lower = input.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

// ── Reference text agent ──────────────────────────────────────────────────────

/**
 * Deterministic reference text agent. Routes a visitor message onto exactly one
 * of the ten migrated text capabilities (Requirement 8.1) by ordered keyword
 * matching, then dispatches that single tool through the counting fake. The
 * order matters: more specific intents (reschedule/cancel before generic
 * appointment phrasing, register before generic lead interest) are matched
 * first.
 */
export function createReferenceTextAgent(): AgentLike {
  return {
    id: "textAgent",
    modelTier: TEXT_AGENT_MODEL_TIER,
    async runTurn(input: string, ctx: EvalAgentContext): Promise<string> {
      // reschedule before cancel/booking — "reschedule" is the strongest signal.
      if (mentions(input, "reschedule")) {
        await ctx.callTool("reschedule_appointment", {
          referenceNumber: "ORA-APT-000042",
          newDate: "2026-01-09",
          newTime: "14:00",
        });
        return "Rescheduled the appointment.";
      }
      if (mentions(input, "cancel")) {
        await ctx.callTool("cancel_appointment", {
          referenceNumber: "ORA-APT-000042",
        });
        return "Cancelled the appointment.";
      }
      if (mentions(input, "book", "schedule a", "site visit")) {
        await ctx.callTool("create_booking", {
          contactName: "Eval Visitor",
          appointmentType: "site_visit",
          scheduledDate: "2026-01-06",
          scheduledTime: "10:00",
        });
        return "Booked the appointment.";
      }
      // register (broker registers a third party) before generic lead interest.
      if (mentions(input, "register")) {
        await ctx.callTool("register_lead", {
          clientName: "Ahmed",
          clientEmail: "ahmed@example.com",
        });
        return "Registered the client as a lead.";
      }
      if (mentions(input, "ticket", "noc", "permit", "complaint")) {
        await ctx.callTool("create_ticket", {
          contactName: "Eval Visitor",
          contactEmail: "visitor@example.com",
          description: "NOC request",
          requestType: "noc",
        });
        return "Opened a support ticket.";
      }
      if (mentions(input, "verification", "verify", "otp", " code")) {
        await ctx.callTool("request_otp", {
          email: "visitor@example.com",
          language: "en",
        });
        return "Sent a verification code.";
      }
      if (mentions(input, "human", "live agent", "real person", "speak to")) {
        await ctx.callTool("request_handover", {
          reason: "Visitor requested a human agent",
        });
        return "Handing you over to a human agent.";
      }
      // Own sales interest → lead capture.
      if (mentions(input, "interested", "buying", "buy ", "brochure", "price", "floor plan")) {
        await ctx.callTool("create_lead", {
          contactName: "Eval Visitor",
          contactEmail: "visitor@example.com",
          language: "en",
        });
        return "Captured your interest as a lead.";
      }
      // Shared contact details → persist on the conversation.
      if (mentions(input, "my email", "my name is", "my phone", "@")) {
        await ctx.callTool("provide_contact", {
          name: "Sara",
          email: "sara@example.com",
        });
        return "Saved your contact details.";
      }
      // Page lookup → navigate.
      if (mentions(input, "where", "find", "page", "navigate", "show me")) {
        await ctx.callTool("navigate", { query: "contact", language: "en" });
        return "Here is the page you asked for.";
      }
      return "I'm not sure how to help with that yet.";
    },
  };
}

// ── Reference admin agent ─────────────────────────────────────────────────────

/** The bound destructive action the confirmation-flow eval proposes/confirms. */
const EVAL_DESTRUCTIVE_KIND = "bulk_close_tickets";

/**
 * Deterministic reference admin agent. Routes a staff message onto one of the
 * six read-only report capabilities (Requirement 9.1) or, for a destructive
 * request, drives the full human-in-the-loop confirmation flow (Requirement
 * 9.3–9.4): it calls `propose_admin_action` to obtain a token, then
 * `confirm_admin_action` with that exact token — exercising propose→confirm
 * threading end to end. Destructive intent is checked first so a "close all
 * tickets in bulk" request never resolves to the read-only ticket report.
 */
export function createReferenceAdminAgent(): AgentLike {
  return {
    id: "adminAgent",
    modelTier: ADMIN_AGENT_MODEL_TIER,
    async runTurn(input: string, ctx: EvalAgentContext): Promise<string> {
      // Destructive intent → propose then confirm (Req 9.3–9.4). Checked first
      // so bulk/"close all" phrasing never falls through to a read-only report.
      if (mentions(input, "bulk", "close all", "cancel all", "delete all")) {
        const proposed = await ctx.callTool("propose_admin_action", {
          kind: EVAL_DESTRUCTIVE_KIND,
          args: {},
          summary: "Close all resolved tickets",
        });
        let token = "";
        if (
          proposed.ok &&
          proposed.result !== null &&
          typeof proposed.result === "object"
        ) {
          token = (proposed.result as { token?: string }).token ?? "";
        }
        await ctx.callTool("confirm_admin_action", { token });
        return `Proposed and confirmed ${EVAL_DESTRUCTIVE_KIND}.`;
      }
      if (mentions(input, "overview", "snapshot", "summary")) {
        await ctx.callTool("report_overview", {});
        return "Here is the platform overview.";
      }
      if (mentions(input, "project")) {
        await ctx.callTool("report_projects", {});
        return "Here is the projects report.";
      }
      if (mentions(input, "appointment")) {
        await ctx.callTool("report_appointments", {});
        return "Here is the appointments report.";
      }
      if (mentions(input, "ticket")) {
        await ctx.callTool("report_tickets", {});
        return "Here is the tickets report.";
      }
      if (mentions(input, "lead")) {
        await ctx.callTool("report_leads", {});
        return "Here is the leads report.";
      }
      if (mentions(input, "client")) {
        await ctx.callTool("report_clients", {});
        return "Here is the clients report.";
      }
      return "I'm not sure which report you need yet.";
    },
  };
}
