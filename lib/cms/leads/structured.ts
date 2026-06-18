/**
 * Lead Engine (S3) — Structured_Lead_Fields schema + a deterministic extractor
 * (Design §Components #3 "Parse"; Requirements 4.1, 4.2).
 *
 * The canonical Parse_Agent (lead-engine task 5.2) is a Mastra LLM agent that
 * runs on the container tier only. Until it is wired, the Lead Engine still
 * needs to advance recorded leads past `received` so the Console is not a dead
 * inbox — so this module provides BOTH:
 *
 *   1. {@link structuredLeadFieldsSchema} — the single Zod contract every
 *      extracted field set is validated against before it is persisted (Req
 *      4.2). The LLM Parse_Agent and the deterministic extractor below both
 *      emit this exact shape.
 *   2. {@link extractStructuredFields} — a fast, deterministic, dependency-free
 *      extractor over the lead's free-text content + attribution. It needs no
 *      model gateway, so it runs anywhere (including the Next.js request that
 *      backs the "Run analysis" button) and is fully unit-testable. It never
 *      throws and never invents data: a field it cannot find with confidence is
 *      left unset (Req 4.6), and `intent` defaults to `unknown`.
 *
 * No personal data leaves this module — it only reads the free-text content and
 * the (already-captured) attribution map and returns plain structured fields.
 */

import { z } from "zod";

// ── Schema ───────────────────────────────────────────────────────────────────

/** The message intent the extractor classifies an enquiry as. */
export const LEAD_INTENTS = [
  "buy",
  "rent",
  "sell",
  "invest",
  "viewing",
  "general",
  "unknown",
] as const;

export type LeadIntent = (typeof LEAD_INTENTS)[number];

/**
 * The structured fields the Parse step extracts from an Inbound_Lead's free-text
 * content and Raw_Payload (Design §Components #3). Every field except `intent`
 * is optional — a field the extractor cannot determine is left unset rather than
 * guessed (Req 4.6). `intent` always carries a value, defaulting to `unknown`.
 */
export const structuredLeadFieldsSchema = z.object({
  /** The contact's name, when stated in the content (≤255). */
  name: z.string().max(255).optional(),
  /** The project or community the lead is interested in (≤255). */
  projectInterest: z.string().max(255).optional(),
  /** The unit type the lead is interested in, e.g. "2BR", "studio" (≤120). */
  unitInterest: z.string().max(120).optional(),
  /** A human-readable budget band, e.g. "AED 1.5M", "2-3M" (≤120). */
  budgetBand: z.string().max(120).optional(),
  /** A purchase/move timeline phrase, e.g. "ASAP", "3 months" (≤120). */
  timeline: z.string().max(120).optional(),
  /** The classified message intent (always present; defaults to `unknown`). */
  intent: z.enum(LEAD_INTENTS).default("unknown"),
});

export type StructuredLeadFields = z.infer<typeof structuredLeadFieldsSchema>;

// ── Deterministic extractor ──────────────────────────────────────────────────

/** Optional hints the caller already knows (e.g. the contact name from intake). */
export interface ExtractHints {
  /** A name already captured on the inbound lead, used when the content has none. */
  name?: string | null;
  /** The lead's attribution map; `utm_campaign` is a strong project signal. */
  attribution?: Record<string, string> | null;
}

const UNIT_RE =
  /\b(studio|penthouse|townhouse|villa|(?:\d{1,2})\s*(?:br|bed(?:room)?s?|bhk))\b/i;

const BUDGET_RE =
  /(?:aed|dhs?|usd|\$|budget(?:\s*(?:of|is|around|up to))?)\s*[:=]?\s*([\d.,]+\s*(?:k|m|million|thousand)?)|([\d.,]+\s*(?:k|m|million)\b)/i;

const TIMELINE_RE =
  /\b(asap|immediately|right away|this (?:week|month)|next (?:week|month)|within \d+\s*(?:days?|weeks?|months?)|in \d+\s*(?:days?|weeks?|months?)|\d+\s*(?:months?|weeks?))\b/i;

const INTENT_PATTERNS: Array<{ intent: LeadIntent; re: RegExp }> = [
  { intent: "viewing", re: /\b(viewing|visit|tour|see the (?:unit|property|apartment))\b/i },
  { intent: "rent", re: /\b(rent|renting|lease|leasing|tenant)\b/i },
  { intent: "sell", re: /\b(sell|selling|list my|dispose)\b/i },
  { intent: "invest", re: /\b(invest|investment|roi|yield|rental return)\b/i },
  { intent: "buy", re: /\b(buy|buying|purchase|purchasing|interested in (?:a|the|buying)|looking (?:for|to buy)|available)\b/i },
];

/** Title-case a matched fragment for tidy display (e.g. "2br" → "2BR"). */
function tidyUnit(raw: string): string {
  const v = raw.trim().toLowerCase();
  // Normalize "2 bedroom" / "2 bed" / "2bhk" → "2BR"; keep words like studio.
  const bed = /^(\d{1,2})\s*(?:br|bed(?:room)?s?|bhk)$/i.exec(v);
  if (bed) return `${bed[1]}BR`;
  return v.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Tidy a budget fragment into a compact band (e.g. "1.5 m" → "AED 1.5M"). */
function tidyBudget(raw: string): string {
  const v = raw.trim().replace(/\s+/g, " ");
  const compact = v.replace(/\bmillion\b/i, "M").replace(/\bthousand\b/i, "K");
  return /^aed/i.test(compact) ? compact.toUpperCase() : `AED ${compact.toUpperCase()}`;
}

/**
 * Extract {@link StructuredLeadFields} from an inbound lead's free-text content
 * and attribution. Deterministic, side-effect-free, and never throwing — it
 * reads only the supplied text and hints. A field that cannot be determined is
 * left unset (Req 4.6); `intent` defaults to `unknown`.
 *
 * The returned object is already validated against
 * {@link structuredLeadFieldsSchema}, so callers can persist it directly.
 */
export function extractStructuredFields(
  content: string,
  hints: ExtractHints = {}
): StructuredLeadFields {
  const text = (content ?? "").slice(0, 10_000);

  const fields: Record<string, unknown> = { intent: "unknown" };

  // Name: prefer an explicit "my name is X" / "I'm X" in the content, else the
  // name already captured on the inbound lead. The trigger is matched
  // case-insensitively, but the captured name must be Capitalized words so a
  // lowercase continuation ("I am interested in…") is not mistaken for a name.
  const trigger = /\b(?:my name is|i am|i'm|this is)\s+/i.exec(text);
  let extractedName: string | undefined;
  if (trigger) {
    const after = text.slice(trigger.index + trigger[0].length);
    const nameMatch =
      /^([A-Z][\p{L}'.-]+(?:\s+[A-Z][\p{L}'.-]+){0,2})/u.exec(after);
    extractedName = nameMatch?.[1]?.trim();
  }
  const name = extractedName || hints.name?.trim() || undefined;
  if (name) fields.name = name.slice(0, 255);

  // Unit interest, e.g. "2BR", "studio", "villa".
  const unit = UNIT_RE.exec(text);
  if (unit) fields.unitInterest = tidyUnit(unit[0]).slice(0, 120);

  // Budget band.
  const budget = BUDGET_RE.exec(text);
  const budgetFrag = budget?.[1] ?? budget?.[2];
  if (budgetFrag) fields.budgetBand = tidyBudget(budgetFrag).slice(0, 120);

  // Timeline.
  const timeline = TIMELINE_RE.exec(text);
  if (timeline) fields.timeline = timeline[0].trim().slice(0, 120);

  // Project interest: the campaign attribution is the strongest signal; else a
  // capitalized "interested in <Project>" phrase from the content.
  const campaign = hints.attribution?.utm_campaign?.trim();
  const projMatch =
    /\b(?:interested in|looking at|enquir(?:y|ing) about|project)\s+([A-Z][\p{L}\d &'-]{2,60})/u.exec(
      text
    );
  const project = campaign || projMatch?.[1]?.trim();
  if (project) fields.projectInterest = project.slice(0, 255);

  // Intent: first matching pattern wins (ordered most-specific first).
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(text)) {
      fields.intent = intent;
      break;
    }
  }

  // Validate + apply the default; extraction never produces an invalid shape,
  // but parse() guarantees the contract for callers that persist the result.
  return structuredLeadFieldsSchema.parse(fields);
}
