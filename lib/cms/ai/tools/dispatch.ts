/**
 * DOE Agentic Foundation — typed tool dispatcher (Design §Components #2; the
 * audited execution boundary "the hands"). Evolved from the voice-only
 * dispatcher (voice-surface §10, §11, §13; task 9.1) into the single,
 * per-agent dispatcher every Mastra agent and the voice surface share.
 *
 * `dispatchTool` is the single choke point through which every agent tool call
 * flows. It backs `POST /api/tools/:toolName` (`lib/cms/api/routes/tools.ts`)
 * and is also called in-process by the Mastra tool bindings. An agent NEVER
 * runs a handler directly — it always goes through this dispatcher so every
 * call is, in this exact order:
 *
 *   1. Resolved against the typed {@link toolRegistry} (unknown tool → error).
 *   2. Validated against the tool's Zod input schema; on failure the handler is
 *      NOT executed and persistent state is left unchanged (Req 2.10, 3.2, 3.3).
 *   3. Permission-checked against the dispatching agent's RBAC identity
 *      (`ctx.actor`) via the RBAC engine (`loadUserRoles` → `resolvePermissions`
 *      → `hasPermission`); on denial the handler is NOT executed and persistent
 *      state is left unchanged (Req 3.4, 3.5, 11.3). Well-known static agent
 *      identities (the voice lead agent) carry an in-process grant so they need
 *      no RBAC seeding — every other identity resolves through the engine.
 *   4. OTP-gated when the tool returns personal/account data (`requiresOtp`):
 *      the existing {@link handleOtpGate} decides whether the caller is allowed
 *      to receive that data. A visitor, or any caller whose conversation is not
 *      `otpVerificationState === "verified"`, is INTERCEPTED — the handler does
 *      not run and NO client/tenant/payment data is returned (Req 11.1, 11.2;
 *      design Property 10).
 *   5. Executed, with exactly ONE {@link logAudit} entry written for the
 *      dispatch — for success AND for every failure mode above (Req 10.1, 10.2;
 *      design Property 11), recorded under `actor = ctx.actor` (the dispatching
 *      agent's identity) with the tool name as the action.
 *
 * On a handler throw or a handler-returned structured error the dispatcher
 * resolves to `{ ok: false, error }` rather than throwing, so the agent run
 * stays active and keeps reasoning (Req 3.6; design Property 9).
 *
 * Design references: §Components #2 (Mastra_Tool_Binding → Tool_Dispatcher),
 * §Components #1 (Catalog_Entry permission/actor fields).
 * Requirements: 2.10, 3.2, 3.3, 3.4, 3.5, 3.6, 10.1, 10.2, 11.1, 11.2, 11.3.
 */

import type { Database } from "../../db";
import type { AuditAction, AuditEntityType } from "../../types";
import { logAudit } from "../../audit";
import type { IdentityResult } from "../identity";
import { handleOtpGate } from "../otp";
import {
  loadUserRoles,
  resolvePermissions,
  hasPermission,
} from "../../rbac/engine";
import {
  getTool,
  AGENT_VOICE_LEAD_PERMISSIONS,
  VOICE_AGENT_ACTOR,
  type ToolContext,
} from "./registry";
import { HOME_AGENT_ACTOR, AGENT_HOME_PERMISSIONS, loadHomeCapabilities } from "./home-capabilities";
import {
  LEAD_DISTRIBUTION_AGENT_ACTOR,
  leadToolPermission,
  loadLeadCapabilities,
} from "./lead-capabilities";
import { loadProspectingCapabilities } from "./prospecting-capabilities";
import {
  PROSPECTING_AGENT_ACTOR,
  PROSPECTING_OUTREACH_AGENT_ACTOR,
  prospectingToolPermission,
} from "./prospecting-capabilities";

// ── Result shape ─────────────────────────────────────────────────────────────

/** Structured error codes a dispatch can return (never thrown). */
export type DispatchErrorCode =
  | "unknown_tool"
  | "validation_error"
  | "permission_denied"
  | "otp_required"
  | "handler_error";

/** A structured dispatch error the orchestrator can speak around (Req 6.10). */
export interface DispatchError {
  code: DispatchErrorCode;
  message: string;
}

/** Discriminated union returned by {@link dispatchTool} — typed result or error. */
export type DispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; error: DispatchError };

// ── OTP gate probe ───────────────────────────────────────────────────────────

/**
 * Synthetic message used to drive {@link handleOtpGate} for an OTP-gated tool.
 * The gate is message-classification based on the text path; on the voice path
 * the tool itself declares (`requiresOtp`) that it returns personal/account
 * data, so we probe the gate with a phrase that classifies as a PERSONAL query.
 * The gate then applies the SAME identity/verification rules the text path uses
 * (`handleChatMessage`): a recognised + verified caller proceeds; a visitor or
 * an unverified caller is intercepted. This is what keeps the voice path's
 * isolation guarantee identical to the text path's (Req 13.1, design Property 5).
 */
const OTP_PERSONAL_PROBE = "my account";

/** Identity assumed when a dispatch carries none — the most-restricted caller. */
const VISITOR_IDENTITY: IdentityResult = { type: "visitor", units: [] };

// ── Per-agent RBAC permission check ──────────────────────────────────────────

/**
 * In-process permission grants for well-known agent identities that are not
 * seeded as RBAC roles. The voice lead agent (`agent:voice-lead`) predates the
 * RBAC-backed catalog and holds its tool permissions here, so the voice path
 * needs no RBAC seeding and behaves exactly as before. Every other agent
 * identity (e.g. `agent:text-lead`, `agent:admin`) is resolved through the
 * RBAC engine against its seeded roles.
 */
const STATIC_AGENT_PERMISSIONS: ReadonlyMap<string, ReadonlySet<string>> =
  new Map([
    [VOICE_AGENT_ACTOR, AGENT_VOICE_LEAD_PERMISSIONS],
    // The S5 Home_Agent (`agent:home-twin`) resolves its `home:tool:*` grants
    // here (same pattern as the voice agent), so home Briefing reads + chat
    // Delegated_Actions pass RBAC without a seeded role. Per-row clamps in each
    // handler still scope to the requesting user.
    [HOME_AGENT_ACTOR, AGENT_HOME_PERMISSIONS],
    // The S3 lead-engine Distribution actor, used by the synchronous "Run
    // analysis" pipeline (`lib/cms/leads/analyze.ts`) the Console triggers. It
    // resolves identity + assigns the owner via the lead-engine catalog
    // (`lead:tool:*`) and records qualification/score via the shared registry
    // tools (`voice:tool:update_qualification` / `score_lead`), which the
    // dispatcher resolves from the voice registry. Granting it in-process makes
    // the pipeline robust without depending on RBAC seed state (same pattern as
    // the voice/home agents); each tool's `permission` field still flows through
    // the check, so the grant is exactly these capabilities — no wildcard.
    [
      LEAD_DISTRIBUTION_AGENT_ACTOR,
      new Set<string>([
        leadToolPermission("record_inbound_lead"),
        leadToolPermission("attach_inbound_lead"),
        leadToolPermission("assign_lead_owner"),
        leadToolPermission("flag_lead_conflict"),
        "voice:tool:update_qualification",
        "voice:tool:score_lead",
      ]),
    ],
    // The S7 prospecting agent identities (`agent:prospecting`,
    // `agent:outreach`) resolve their `prospecting:tool:*` grants here — the
    // same pattern as the voice/home/lead agents — because they are string
    // actors, not uuid principals, so they are NOT linked in `user_roles`
    // (which is uuid-keyed) and cannot resolve through the RBAC engine. Each
    // grant is EXACTLY the role's seeded tool set (no wildcard, mirroring
    // `PROSPECTING_AGENT_IDENTITIES`). `send_outreach` is granted to NEITHER:
    // a send requires a human Approval_Flow token and is dispatched under the
    // approving rep's (uuid) identity, never an agent (Design §5).
    [
      PROSPECTING_AGENT_ACTOR,
      new Set<string>([
        prospectingToolPermission("find_comparables"),
        prospectingToolPermission("market_comps"),
        prospectingToolPermission("prospect_search"),
        prospectingToolPermission("enrich_target"),
        prospectingToolPermission("record_target"),
        prospectingToolPermission("promote_target_to_lead"),
      ]),
    ],
    [
      PROSPECTING_OUTREACH_AGENT_ACTOR,
      new Set<string>([prospectingToolPermission("draft_outreach")]),
    ],
  ]);

/**
 * Decide whether the dispatching agent identity (`actor`) holds the permission
 * a tool requires (Req 3.4, 11.3). Well-known static agent identities resolve
 * against their in-process grant; all other identities resolve through the
 * RBAC engine — load the identity's roles, resolve the deduplicated permission
 * union, and test it (supporting exact and `resource:*` / `*:*` wildcards).
 */
async function actorHasPermission(
  db: Database,
  actor: string,
  permission: string
): Promise<boolean> {
  const staticGrant = STATIC_AGENT_PERMISSIONS.get(actor);
  if (staticGrant) {
    return hasPermission([...staticGrant], permission);
  }
  const roles = await loadUserRoles(db, actor);
  const perms = await resolvePermissions(db, roles);
  return hasPermission(perms, permission);
}

// ── Audit helper ─────────────────────────────────────────────────────────────

/**
 * Write the single audit entry for a dispatch. The action is the tool name and
 * the actor is the dispatching agent's identity (`ctx.actor`) (Req 10.1, 10.2 /
 * design Property 11). Audit is best-effort inside {@link logAudit} (it never
 * throws), so calling it on every dispatch path yields exactly one row per
 * dispatch without risking the call.
 */
async function auditDispatch(
  db: Database,
  actor: string,
  toolName: string,
  conversationId: string | undefined,
  summary: string
): Promise<void> {
  await logAudit(db, {
    userId: actor,
    // The voice tool name is the audited action (design §6 mapping). The audit
    // action union does not enumerate tool names, so cast at this boundary.
    action: toolName as unknown as AuditAction,
    entityType: "ai_conversation" as AuditEntityType,
    entityId: conversationId ?? toolName,
    summary,
  });
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Validate, permission-check, OTP-gate, audit, and execute a single agent tool
 * call. Returns a structured {@link DispatchResult}; it never throws (Req 3.6).
 *
 * @param db        Drizzle database handle.
 * @param toolName  The requested tool name (validated against the registry).
 * @param input     The raw, unvalidated tool input (validated here, Req 3.2).
 * @param ctx       Per-dispatch context: the dispatching agent's RBAC identity
 *                  (`actor`), conversation, resolved caller identity, language,
 *                  and OTP verification state (consumed by the gate).
 */
/**
 * The minimal shape `dispatchTool` needs from a resolved tool, satisfied by both
 * a voice-registry `ToolDef` and a home `CatalogEntry`.
 */
interface DispatchableTool {
  inputSchema: { safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } };
  permission: string;
  requiresOtp?: boolean;
  handler: (db: Database, ctx: ToolContext, input: never) => Promise<unknown>;
}

/** Memoized home Catalog_Entries, keyed by tool name (lazy — first miss only). */
let homeCatalogByName: Map<string, DispatchableTool> | null = null;

/** Memoized lead-engine Catalog_Entries, keyed by tool name (lazy). */
let leadCatalogByName: Map<string, DispatchableTool> | null = null;

/** Memoized S7 prospecting Catalog_Entries, keyed by tool name (lazy). */
let prospectingCatalogByName: Map<string, DispatchableTool> | null = null;

/**
 * Resolve a tool by name. The voice `toolRegistry` is the primary source; when a
 * name is not a registry tool, fall back to the home Tool_Catalog
 * (`loadHomeCapabilities`) so the home-native Catalog_Entries (`list_stack`,
 * `add_stack_item`, `complete_stack_item`, `queue_combined_report`) — which live
 * only in the home catalog, not the voice registry — are dispatchable through
 * the SAME audited path (Zod → RBAC → OTP → audit → execute). Returns `undefined`
 * for a genuinely unknown name.
 */
function resolveDispatchTool(name: string): DispatchableTool | undefined {
  const registryTool = getTool(name);
  if (registryTool) return registryTool as unknown as DispatchableTool;

  if (!homeCatalogByName) {
    const loaded = loadHomeCapabilities();
    homeCatalogByName = loaded.ok
      ? (loaded.catalog as unknown as Map<string, DispatchableTool>)
      : new Map();
  }
  const homeTool = homeCatalogByName.get(name);
  if (homeTool) return homeTool;

  // Finally, the S3 lead-engine Tool_Catalog (`record_inbound_lead`,
  // `attach_inbound_lead`, `assign_lead_owner`, `flag_lead_conflict`,
  // `enrich_lead_read`) so the lead pipeline dispatches through the SAME audited
  // path. `update_qualification` / `score_lead` are resolved above from the
  // voice registry (which shadows the lead-catalog re-exports of those names).
  if (!leadCatalogByName) {
    const loaded = loadLeadCapabilities();
    leadCatalogByName = loaded.ok
      ? (loaded.catalog as unknown as Map<string, DispatchableTool>)
      : new Map();
  }
  const leadTool = leadCatalogByName.get(name);
  if (leadTool) return leadTool;

  // Finally, the S7 prospecting Tool_Catalog (`find_comparables`,
  // `market_comps`, `record_target`, `prospect_search`, `enrich_target`,
  // `draft_outreach`, `promote_target_to_lead`, `send_outreach`) so every
  // prospecting mutation / personal-data read / provider call / send dispatches
  // through the SAME audited path (Zod → RBAC → OTP → audit → execute). An
  // agent never holds a tool object for these names; the dispatcher is the only
  // way they execute (the audit boundary rule, Requirement 8.1).
  if (!prospectingCatalogByName) {
    const loaded = loadProspectingCapabilities();
    prospectingCatalogByName = loaded.ok
      ? (loaded.catalog as unknown as Map<string, DispatchableTool>)
      : new Map();
  }
  return prospectingCatalogByName.get(name);
}

export async function dispatchTool(
  db: Database,
  toolName: string,
  input: unknown,
  ctx: ToolContext
): Promise<DispatchResult> {
  const actor = ctx.actor ?? VOICE_AGENT_ACTOR;
  const conversationId = ctx.conversationId;

  // 1. Resolve the tool (voice registry, then the home Tool_Catalog). Unknown
  //    tool → audited structured error.
  const tool = resolveDispatchTool(toolName);
  if (!tool) {
    await auditDispatch(
      db,
      actor,
      toolName,
      conversationId,
      `Rejected unknown tool "${toolName}"`
    );
    return {
      ok: false,
      error: { code: "unknown_tool", message: `Unknown tool "${toolName}"` },
    };
  }

  // 2. Validate input against the tool's Zod schema. On failure the handler is
  //    never executed and persistent state is unchanged (Req 2.10, 3.2, 3.3).
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    const message = (parsed.error?.issues ?? [])
      .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
      .join("; ");
    await auditDispatch(
      db,
      actor,
      toolName,
      conversationId,
      `Rejected invalid input for "${toolName}": ${message}`
    );
    return { ok: false, error: { code: "validation_error", message } };
  }

  // 3. Permission-check against the dispatching agent's RBAC identity
  //    (Req 3.4, 11.3). The handler is never reached on denial and persistent
  //    state is left unchanged (Req 3.5). A delegated dispatch (a user acting
  //    THROUGH a bound agent, e.g. the Home_Agent) is authorized if EITHER the
  //    requesting user OR the bound agent holds the permission — the agent's
  //    grant authorizes on the user's behalf, while audit records the user and
  //    handler row-clamps keep results user-scoped.
  const permitted =
    (await actorHasPermission(db, actor, tool.permission)) ||
    (ctx.agentActor != null &&
      ctx.agentActor !== actor &&
      (await actorHasPermission(db, ctx.agentActor, tool.permission)));
  if (!permitted) {
    await auditDispatch(
      db,
      actor,
      toolName,
      conversationId,
      `Denied "${toolName}" for actor "${actor}" (missing ${tool.permission})`
    );
    return {
      ok: false,
      error: {
        code: "permission_denied",
        message: `Actor "${actor}" lacks permission "${tool.permission}"`,
      },
    };
  }

  // 4. OTP gate for tools that return personal/account data (Req 11.1, 11.2).
  //    The existing handleOtpGate makes the proceed/intercept decision so the
  //    agentic path's isolation is identical to the text path's (Property 10).
  if (tool.requiresOtp) {
    const identity = ctx.identity ?? VISITOR_IDENTITY;
    const gate = await handleOtpGate(
      db,
      conversationId ?? "",
      OTP_PERSONAL_PROBE,
      identity,
      ctx.language ?? "en",
      ctx.otpVerificationState ?? "not_required"
    );

    // Any non-"proceed" decision means the caller is NOT cleared for personal
    // data — intercept WITHOUT running the handler, so nothing is returned.
    if (gate.action !== "proceed") {
      await auditDispatch(
        db,
        actor,
        toolName,
        conversationId,
        `OTP gate intercepted "${toolName}" (identity=${identity.type}, ` +
          `state=${ctx.otpVerificationState ?? "not_required"})`
      );
      return {
        ok: false,
        error: {
          code: "otp_required",
          message:
            gate.response ??
            "Identity verification is required before personal account data can be shared.",
        },
      };
    }
  }

  // 5. Execute the handler. One audit entry either way (Req 10.1 / Property 11).
  //    A handler throw or returned error resolves to { ok: false, error }
  //    rather than throwing, so the agent run stays active (Req 3.6).
  try {
    const result = await tool.handler(
      db,
      { ...ctx, actor },
      parsed.data as never
    );
    await auditDispatch(
      db,
      actor,
      toolName,
      conversationId,
      `Executed "${toolName}"`
    );
    return { ok: true, result };
  } catch (err) {
    // Defensive coercion: a thrown value may be impossible to convert to a
    // primitive (e.g. a null-prototype object, or one whose toString /
    // Symbol.toPrimitive throws), in which case String(err) itself throws.
    // Guarding here guarantees dispatchTool never throws (Req 3.6 / Property 9).
    let message: string;
    if (err instanceof Error) {
      message = err.message;
    } else {
      try {
        message = String(err);
      } catch {
        message = "Unknown handler error";
      }
    }
    await auditDispatch(
      db,
      actor,
      toolName,
      conversationId,
      `Handler error in "${toolName}": ${message}`
    );
    return { ok: false, error: { code: "handler_error", message } };
  }
}
