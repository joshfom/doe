/**
 * Lead Engine (S3) — first-party capture helpers.
 *
 * The Lead Engine is the platform's single lead collector. These helpers route
 * the two first-party, web-originated enquiry surfaces — public CMS form
 * submissions and the marketing-site AI chat popup — into the same durable
 * `inbound_leads` ledger every other source uses, via {@link recordInbound}.
 * They replace the separate "Form submissions" inbox: a submission or a chat
 * enquiry now becomes a first-class lead the Console can analyze, qualify,
 * route, and sync to Salesforce.
 *
 * Both surfaces normalize to the `web_form` Lead_Source (they are web-originated
 * enquiries) and carry a distinguishing marker in `attribution` (`channel`) so
 * the Console can still tell a form submission from a chat enquiry. Capture is
 * idempotent by a stable key:
 *   - a form submission keys on its `form_submissions.id`;
 *   - a chat enquiry keys on its conversation id, so exactly ONE lead is
 *     created per chat conversation (the opening enquiry) no matter how many
 *     messages follow.
 *
 * Every function is best-effort and never throws — callers invoke them
 * fire-and-forget so a capture failure can never break a form POST or a chat
 * turn. A failure is logged and swallowed; the durable submission/conversation
 * rows are unaffected.
 */

import type { Database } from "../db";
import type { AttributionData } from "@/lib/analytics/types";
import { recordInbound } from "./intake";
import { inboundLeadSchema, type InboundLead } from "./inbound";
import { deriveIdempotencyKey, flattenAttribution } from "./adapters/web-form";

const CONTENT_MAX = 10_000;

/** Common field-name aliases the public forms use for the contact fields. */
const NAME_KEYS = ["name", "fullname", "full_name", "yourname", "contactname"];
const EMAIL_KEYS = ["email", "emailaddress", "email_address", "contactemail"];
const PHONE_KEYS = ["phone", "phonenumber", "phone_number", "mobile", "tel", "contactphone"];

/** Case/punctuation-insensitive lookup of the first matching key in `data`. */
function pick(data: Record<string, unknown>, keys: string[]): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
  const index = new Map<string, unknown>();
  for (const [k, v] of Object.entries(data)) index.set(norm(k), v);
  for (const key of keys) {
    const v = index.get(norm(key));
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  // Compose a name from first + last when no single name field exists.
  if (keys === NAME_KEYS) {
    const first = index.get("firstname") ?? index.get("first");
    const last = index.get("lastname") ?? index.get("last");
    const composed = [first, last].filter((s) => typeof s === "string" && s).join(" ").trim();
    if (composed) return composed;
  }
  return undefined;
}

/** Build readable free-text content from a form's submitted field map. */
function buildFormContent(formName: string, data: Record<string, unknown>): string {
  const skip = new Set([...NAME_KEYS, ...EMAIL_KEYS, ...PHONE_KEYS, "submittedat"]);
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
  const lines: string[] = [`Form: ${formName}`];

  // Prefer a message/enquiry body if present.
  for (const [k, v] of Object.entries(data)) {
    if (skip.has(norm(k))) continue;
    if (v == null || v === "") continue;
    const value = typeof v === "string" ? v : JSON.stringify(v);
    lines.push(`${k}: ${value}`);
  }
  return lines.join("\n").slice(0, CONTENT_MAX);
}

/**
 * Capture a public CMS form submission as an inbound lead. Idempotent by the
 * submission id. Returns the recorded `inbound_leads.id`, or `null` on any
 * failure (logged, never thrown).
 */
export async function captureFormSubmissionLead(
  db: Database,
  args: {
    submissionId: string;
    formId: string;
    formName: string;
    data: Record<string, unknown>;
    sourcePageSlug?: string | null;
    attribution?: AttributionData | null;
  }
): Promise<string | null> {
  try {
    const attribution = flattenAttribution(args.attribution) ?? {};
    attribution.channel = "web_form";
    attribution.form_id = args.formId;
    if (args.sourcePageSlug) attribution.landing_path = args.sourcePageSlug;

    const candidate: InboundLead = {
      source: "web_form",
      capturedAt: new Date().toISOString(),
      name: pick(args.data, NAME_KEYS),
      email: pick(args.data, EMAIL_KEYS),
      phone: pick(args.data, PHONE_KEYS),
      content: buildFormContent(args.formName, args.data),
      rawPayload: { kind: "form_submission", submissionId: args.submissionId, data: args.data },
      attribution,
      idempotencyKey: deriveIdempotencyKey("web_form", {
        providerId: `submission:${args.submissionId}`,
        contentIdentity: null,
      }),
    };

    const lead = inboundLeadSchema.parse(candidate);
    const { id } = await recordInbound(db, lead);
    return id;
  } catch (err) {
    console.error("[leads/capture] form submission capture failed:", err);
    return null;
  }
}

/**
 * Capture a marketing-site AI chat enquiry as an inbound lead. Idempotent by the
 * conversation id, so exactly one lead is created per conversation (the opening
 * enquiry). Returns the recorded `inbound_leads.id`, or `null` on any failure.
 */
export async function captureChatLead(
  db: Database,
  args: {
    conversationId: string;
    message: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    attribution?: AttributionData | null;
  }
): Promise<string | null> {
  try {
    const attribution = flattenAttribution(args.attribution) ?? {};
    attribution.channel = "ai_chat";

    const candidate: InboundLead = {
      source: "web_form",
      capturedAt: new Date().toISOString(),
      name: args.name?.trim() || undefined,
      email: args.email?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      content: `AI chat enquiry:\n${args.message}`.slice(0, CONTENT_MAX),
      rawPayload: { kind: "ai_chat", conversationId: args.conversationId, message: args.message },
      attribution,
      idempotencyKey: deriveIdempotencyKey("web_form", {
        providerId: `chat:${args.conversationId}`,
        contentIdentity: null,
      }),
    };

    const lead = inboundLeadSchema.parse(candidate);
    const { id } = await recordInbound(db, lead);
    return id;
  } catch (err) {
    console.error("[leads/capture] chat enquiry capture failed:", err);
    return null;
  }
}
