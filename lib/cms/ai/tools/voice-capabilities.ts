/**
 * Voice Re-base + Surface Activation (S6) — the voice tools as unified
 * Catalog_Entries (Design §Components #1, Requirement 1).
 *
 * This module is the voice analogue of `text-capabilities.ts` /
 * `reporting-capabilities.ts`: it expresses the eight voice-specific tools as
 * {@link CatalogEntry} objects so {@link bindCatalog} can generate the
 * Voice_Agent's Mastra tools from them. It is binding METADATA, not a second
 * execution path — every tool still executes through the unchanged
 * `dispatchTool` (Zod → RBAC → OTP → audit → execute), which resolves the
 * handler from `toolRegistry` by name (Requirement 1.5).
 *
 * Two design choices keep this thin and correct:
 *
 *  - **Schemas reused verbatim.** Each entry's `inputSchema`/`outputSchema` are
 *    the existing `toolRegistry[name]` schemas — themselves the `toolSchemas`
 *    from `lib/cms/voice/contracts.ts`, the single source of truth (R1.2). No
 *    schema is redefined here.
 *  - **The shared reporting tools are REFERENCED, never redefined.** The
 *    Voice_Agent binds the SAME `get_pipeline_summary` / `queue_report_email`
 *    Catalog_Entry the Reporting_Agent uses (imported from
 *    `reporting-capabilities.ts`), so the figure the voice agent speaks equals
 *    the figure the report emits (R1.4, the structural root of figure
 *    consistency).
 *
 * Design references: §Components #1 (Voice_Capabilities). Requirements: 1.1,
 * 1.2, 1.3, 1.4, 1.5, 1.6.
 */

import { TOOL_NAMES, type ToolName } from "../../voice/contracts";
import { VOICE_AGENT_ACTOR, toolPermission, toolRegistry } from "./registry";
import { reportingCapabilityEntries } from "./reporting-capabilities";
import {
  loadCatalog,
  type CatalogEntry,
  type CatalogLoadResult,
} from "./catalog";

/**
 * The two voice tools that are SHARED S4 reporting Catalog_Entries (R1.4). The
 * Voice_Agent binds the reporting module's entries for these names rather than
 * redefining them, so the spoken figure equals the report figure.
 */
export const SHARED_REPORTING_TOOLS = [
  "get_pipeline_summary",
  "queue_report_email",
] as const;

type SharedReportingTool = (typeof SHARED_REPORTING_TOOLS)[number];

/** True when a tool name is one of the shared reporting tools. */
function isSharedReportingTool(name: string): name is SharedReportingTool {
  return (SHARED_REPORTING_TOOLS as readonly string[]).includes(name);
}

/**
 * Voice-specific tool names = every voice tool minus the shared reporting ones
 * (R1.1). These eight are defined as Catalog_Entries here; the remaining two
 * are referenced from the reporting module.
 */
export const VOICE_SPECIFIC_NAMES: ToolName[] = TOOL_NAMES.filter(
  (n) => !isSharedReportingTool(n),
);

/** The full set of names the Voice_Agent binds (voice-specific + shared). */
export const VOICE_AGENT_TOOL_NAMES: ToolName[] = [...TOOL_NAMES];

/**
 * Per-tool description surfaced to the model for native tool-calling — parity
 * with the lean orchestrator's `TOOL_DESCRIPTIONS` so the agent path and the
 * lean path expose the same tool semantics (Requirement 1.1, parity).
 */
const VOICE_TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_lead_context:
    "Refresh the caller's lead context (name, tier, interests, assigned rep) from the local mirror.",
  update_qualification:
    "Record qualification facts (budget band, timeline, intent, unit type) as they emerge.",
  score_lead:
    "Score the lead into a tier from the qualification signals on record.",
  check_viewing_slots:
    "List available viewing slots for a project, optionally near a date hint.",
  book_viewing: "Book a viewing for the caller into a specific available slot.",
  assign_rep:
    "Assign the best rep to the caller by project, language and capacity.",
  send_whatsapp_brief:
    "Queue a WhatsApp brief to a rep about this caller (runs in the background).",
  queue_report_email:
    "Queue an emailed pipeline report for a scope and period (runs in the background).",
  log_outcome:
    "Log a free-text call outcome as a Salesforce task (queued, not inline).",
  get_pipeline_summary:
    "Get pipeline figures for a scope and period (numbers are computed in SQL; narrate them).",
};

/**
 * Build a voice-specific {@link CatalogEntry} from the registry + contracts.
 * The schemas, OTP classification, permission, and handler are taken verbatim
 * from `toolRegistry[name]`; only the description (model-facing) and the audit
 * actor (`agent:voice-lead`, R3.3) are supplied here. The handler is provided
 * to satisfy the `CatalogEntry` shape and make the entry independently loadable
 * — on the agent path it is never reached, because `dispatchTool` resolves the
 * registry handler by name (R1.5).
 */
function toCatalogEntry(name: ToolName): CatalogEntry {
  const reg = toolRegistry[name];
  return {
    name,
    description: VOICE_TOOL_DESCRIPTIONS[name],
    inputSchema: reg.inputSchema,
    outputSchema: reg.outputSchema,
    requiresOtp: reg.requiresOtp,
    permission: reg.permission,
    auditActor: VOICE_AGENT_ACTOR,
    handler: reg.handler as unknown as CatalogEntry["handler"],
  };
}

/** The eight voice-specific Catalog_Entries (R1.1). */
export const voiceCapabilityEntries: CatalogEntry[] =
  VOICE_SPECIFIC_NAMES.map(toCatalogEntry);

/**
 * The two shared reporting Catalog_Entries the Voice_Agent binds — the SAME
 * objects the Reporting_Agent uses, filtered out of the reporting contributor
 * set by name (R1.4). Referenced, never redefined.
 */
const sharedReportingEntries: CatalogEntry[] = reportingCapabilityEntries.filter(
  (e) => isSharedReportingTool(e.name),
);

/** Validate + assemble just the voice-specific entries (R1.6). */
export function loadVoiceCapabilities(): CatalogLoadResult {
  return loadCatalog(voiceCapabilityEntries);
}

/**
 * Validate + assemble the full catalog the Voice_Agent binds: the eight
 * voice-specific entries plus the two shared reporting entries. `loadCatalog`
 * rejects duplicate names, so each of the ten names appears exactly once
 * (R1.3); the shared entries are bound by reference, so the voice figure equals
 * the report figure (R1.4).
 */
export function loadVoiceAgentCatalog(): CatalogLoadResult {
  return loadCatalog([...voiceCapabilityEntries, ...sharedReportingEntries]);
}
