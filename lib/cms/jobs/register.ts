import { registerJobHandler } from "./index";
import { postCallProcessingHandler } from "./post-call-processing";
import { morningBriefingHandler } from "./morning-briefing";
import { compileAndEmailReportHandler } from "./compile-and-email-report";
import { sendWhatsappBriefHandler } from "./send-whatsapp-brief";
import { leadNudgeHandler } from "./lead-nudge";
import { briefingAssemblyHandler } from "./briefing-assembly";
import { outreachSendHandler } from "./outreach-send";
import { enrichmentFetchHandler } from "./enrichment-fetch";
import { marketSyncHandler } from "./market-sync";

// ── Voice-surface job handler registration ────────────────────────────────────
// The job-runner spine (`./index`) ships with placeholder handlers that throw.
// Long-lived workers call `registerVoiceJobHandlers()` once at startup to plug
// in the real implementations before the poll loop runs. Heavy handlers added in
// later task-group-16 tasks (compile_and_email_report, morning_briefing,
// send_whatsapp_brief) register here too as they land.

let registered = false;

/**
 * Register all implemented voice-surface job handlers on the default registry.
 * Idempotent — safe to call more than once.
 */
export function registerVoiceJobHandlers(): void {
  if (registered) return;
  registerJobHandler("post_call_processing", postCallProcessingHandler);
  registerJobHandler("morning_briefing", morningBriefingHandler);
  registerJobHandler("compile_and_email_report", compileAndEmailReportHandler);
  registerJobHandler("send_whatsapp_brief", sendWhatsappBriefHandler);
  registered = true;
}

// ── Lead-engine job handler registration (Lead Engine S3) ─────────────────────
// The lead-engine runs on its own container/worker tier (`workers/lead-nudge.ts`,
// task 7.4), which calls `registerLeadEngineJobHandlers()` once at startup to
// plug the `lead_nudge` handler onto the same spine before the sweep loop runs.
// Kept separate from the voice registration so each tier wires only its own
// handlers, using the identical `registerJobHandler` seam.

let leadEngineRegistered = false;

/**
 * Register all implemented lead-engine job handlers on the default registry.
 * Idempotent — safe to call more than once.
 */
export function registerLeadEngineJobHandlers(): void {
  if (leadEngineRegistered) return;
  registerJobHandler("lead_nudge", leadNudgeHandler);
  leadEngineRegistered = true;
}

// ── Home / Briefing job handler registration (Agent-First Home S5) ────────────
// The Home_Surface's scheduled Briefing pre-warm (`briefing_assembly`) runs on
// the container/worker tier, which calls `registerHomeJobHandlers()` once at
// startup to plug the handler onto the same spine before the pre-warm loop runs.
// Kept separate so each tier wires only its own handlers, using the identical
// `registerJobHandler` seam (mirrors the lead-engine registration above).

let homeRegistered = false;

/**
 * Register all implemented home-surface job handlers on the default registry.
 * Idempotent — safe to call more than once.
 */
export function registerHomeJobHandlers(): void {
  if (homeRegistered) return;
  registerJobHandler("briefing_assembly", briefingAssemblyHandler);
  homeRegistered = true;
}

// ── Prospecting job handler registration (Prospecting Workspace S7) ───────────
// The prospecting jobs (`outreach_send`, `enrichment_fetch`, `market_sync`) run
// on the container/worker tier — the prospecting agents/workflows worker and the
// market-sync worker (task 8.3) call `registerProspectingJobHandlers()` once at
// startup to plug these handlers onto the same spine before their loops run.
// Kept separate so each tier wires only its own handlers, using the identical
// `registerJobHandler` seam (mirrors the lead-engine / home registrations above).
//
// NOTE on the defaults: `outreachSendHandler` and `enrichmentFetchHandler` carry
// env-/registry-resolved defaults; `marketSyncHandler` has NO adapter wired (the
// market-sync worker injects the configured one). A tier that needs a concrete
// adapter re-registers via `registerJobHandler` with its own
// `createMarketSyncHandler(adapter)` instance.

let prospectingRegistered = false;

/**
 * Register all implemented prospecting job handlers on the default registry.
 * Idempotent — safe to call more than once.
 */
export function registerProspectingJobHandlers(): void {
  if (prospectingRegistered) return;
  registerJobHandler("outreach_send", outreachSendHandler);
  registerJobHandler("enrichment_fetch", enrichmentFetchHandler);
  registerJobHandler("market_sync", marketSyncHandler);
  prospectingRegistered = true;
}
