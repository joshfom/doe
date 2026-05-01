/**
 * Lightweight agent layer that runs BEFORE RAG. Two responsibilities:
 *
 * 1. **Identity capture** — extract name/email/phone from the latest user
 *    message and persist them onto the conversation row. Keeps the
 *    conversation aware of who's talking even when they typed it casually.
 *
 * 2. **Tool dispatch** — detect deterministic intents (create ticket,
 *    request OTP) and either execute them or ask for the missing fields.
 *    This avoids depending on the LLM's flaky JSON tool-calling: we use
 *    plain regex/keyword checks for intents and structured field extraction
 *    for the arguments. The LLM is only used for the freeform reply when no
 *    tool fires.
 */
import { eq, and, ilike, or } from "drizzle-orm";
import type { Database } from "../db";
import { aiConversations, pages } from "../schema";
import type { IdentityResult } from "./identity";
import { resolveIdentityByEmail, resolveIdentityByPhone } from "./identity";
import {
  classifyQuery,
  generateOtp,
  createOtpRecord,
  maskEmail,
} from "./otp";
import { sendOtpEmail } from "./email";
import { createTicket } from "../tickets/service";
import type { TicketRequestType } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ConversationContact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface AgentResult {
  /** When true, the agent produced the response and chat.ts should skip RAG. */
  handled: boolean;
  response?: string;
  identity?: IdentityResult;
  contact?: ConversationContact;
  metadata?: Record<string, unknown>;
}

export interface AgentInput {
  conversationId: string;
  message: string;
  history: Array<{ role: string; content: string }>;
  identity: IdentityResult;
  language: "en" | "ar";
  contact: ConversationContact;
}

// ── Field extraction ─────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// Loose mobile pattern: optional +, country code, allow spaces/dashes; we
// require at least 8 digits in total to avoid catching unit numbers etc.
const PHONE_RE = /\+?\d[\d\s\-]{7,}\d/;

/**
 * Pull a name out of common phrases like "I'm John", "my name is Ahmed
 * Al-Mansoori", "this is Sara". Returns the matched name or null.
 *
 * Conservative on purpose — we'd rather miss a name than misclassify
 * "I'm trying to..." as "I'm Trying".
 */
export function extractName(message: string): string | null {
  const trimmed = message.trim();

  const patterns: RegExp[] = [
    /(?:my name is|i am|i'm|this is|here is|name's)\s+([A-Z][a-zA-Z'`-]+(?:\s+[A-Z][a-zA-Z'`-]+){0,3})/,
    /^([A-Z][a-zA-Z'`-]+(?:\s+[A-Z][a-zA-Z'`-]+){1,3})$/, // line is just a name, e.g. "John Smith"
  ];

  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m && m[1]) {
      const candidate = m[1].trim();
      // Reject obvious false positives (verbs, common short words)
      if (
        !/^(trying|looking|wondering|asking|interested|trying)\b/i.test(
          candidate
        )
      ) {
        return candidate;
      }
    }
  }

  return null;
}

export function extractEmail(message: string): string | null {
  const m = message.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

export function extractPhone(message: string): string | null {
  const m = message.match(PHONE_RE);
  if (!m) return null;
  // Strip whitespace/dashes for canonical form
  return m[0].replace(/[\s\-]/g, "");
}

// ── Intent detection ─────────────────────────────────────────────────────────

const TICKET_KEYWORDS = [
  "create ticket",
  "create support ticket",
  "create a ticket",
  "open a ticket",
  "open ticket",
  "raise a ticket",
  "submit a ticket",
  "log a ticket",
  "أنشئ تذكرة",
  "افتح تذكرة",
];

const MOVE_IN_KEYWORDS = ["move in", "move-in", "moving in", "movein"];
const CONSTRUCTION_KEYWORDS = [
  "construction material",
  "delivery",
  "deliver materials",
  "contractor",
  "vendor access",
];
const NOC_KEYWORDS = ["noc", "no objection certificate"];
const OTP_REQUEST_KEYWORDS = [
  "send me the otp",
  "send the otp",
  "send otp",
  "send me an otp",
  "send a code",
  "send verification",
  "verify me",
];

function containsAny(message: string, keywords: string[]): boolean {
  const lower = message.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

const NAVIGATE_KEYWORDS = [
  "take me to",
  "navigate to",
  "go to the",
  "go to ",
  "show me the",
  "open the",
  "link to",
  "where can i find",
  "where is the",
  "how do i get to",
  "خذني إلى",
  "اذهب إلى",
  "افتح صفحة",
  "رابط",
];

export type AgentIntent =
  | "create_ticket"
  | "request_otp"
  | "navigate"
  | "provide_contact"
  | "none";

export function detectIntent(message: string): AgentIntent {
  if (containsAny(message, OTP_REQUEST_KEYWORDS)) return "request_otp";
  if (containsAny(message, TICKET_KEYWORDS)) return "create_ticket";
  if (containsAny(message, NAVIGATE_KEYWORDS)) return "navigate";
  // If a message is mostly a contact handoff (name/email/phone with little else),
  // treat it as provide_contact so the agent can persist before falling through.
  if (extractEmail(message) || extractPhone(message)) return "provide_contact";
  return "none";
}

// ── Ticket request type inference ────────────────────────────────────────────

export function inferRequestType(
  message: string,
  history: Array<{ role: string; content: string }>
): TicketRequestType {
  const all = [message, ...history.map((m) => m.content)].join(" ").toLowerCase();

  if (containsAny(all, NOC_KEYWORDS)) return "noc";
  if (containsAny(all, CONSTRUCTION_KEYWORDS))
    return "construction_material_delivery";
  if (containsAny(all, MOVE_IN_KEYWORDS)) return "move_in";
  return "general_inquiry";
}

// ── Conversation contact persistence ─────────────────────────────────────────

async function persistContact(
  db: Database,
  conversationId: string,
  contact: ConversationContact
): Promise<void> {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (contact.name) updates.participantName = contact.name;
  if (contact.email) updates.participantEmail = contact.email;
  if (contact.phone) updates.participantPhone = contact.phone;

  if (Object.keys(updates).length === 1) return; // only updatedAt — nothing to persist

  await db
    .update(aiConversations)
    .set(updates)
    .where(eq(aiConversations.id, conversationId));
}

// ── Tool: create_ticket ──────────────────────────────────────────────────────

interface MissingFields {
  name: boolean;
  email: boolean;
  phone: boolean;
}

function describeMissing(
  missing: MissingFields,
  language: "en" | "ar",
  requestType: TicketRequestType
): string {
  const need: string[] = [];
  if (language === "ar") {
    if (missing.name) need.push("اسمك الكامل");
    if (missing.email) need.push("بريدك الإلكتروني");
    if (missing.phone) need.push("رقم هاتفك");

    if (need.length === 0) return "";

    const list = need.join("، و");
    const typeLabel =
      requestType === "construction_material_delivery"
        ? "تذكرة توصيل مواد البناء"
        : requestType === "move_in"
          ? "تذكرة الانتقال"
          : requestType === "noc"
            ? "طلب شهادة عدم ممانعة"
            : "تذكرة الدعم";
    return `قبل أن أفتح ${typeLabel}، أحتاج ${list}. هل يمكنك مشاركتها معي؟`;
  }

  if (missing.name) need.push("your full name");
  if (missing.email) need.push("a contact email");
  if (missing.phone) need.push("a contact mobile number");

  if (need.length === 0) return "";

  const list =
    need.length === 1
      ? need[0]
      : need.slice(0, -1).join(", ") + ", and " + need[need.length - 1];

  const typeLabel =
    requestType === "construction_material_delivery"
      ? "a construction material delivery ticket"
      : requestType === "move_in"
        ? "a move-in permit ticket"
        : requestType === "noc"
          ? "an NOC request"
          : "a support ticket";

  return `Before I open ${typeLabel}, I need ${list}. Could you share them so I can register the request properly?`;
}

async function executeCreateTicket(
  db: Database,
  input: AgentInput
): Promise<AgentResult> {
  const requestType = inferRequestType(input.message, input.history);

  const missing: MissingFields = {
    name: !input.contact.name,
    email: !input.contact.email,
    phone: !input.contact.phone,
  };

  // Allow ticket if we have name + (email OR phone). Phone alone is enough
  // for permit/delivery tickets where contact is the priority, but we still
  // prefer both. Tweak: require name + email at minimum (email is needed
  // for ticket notifications + OTP).
  const haveEnough =
    !!input.contact.name &&
    !!input.contact.email &&
    (!!input.contact.phone || requestType === "general_inquiry");

  if (!haveEnough) {
    return {
      handled: true,
      response: describeMissing(missing, input.language, requestType),
      metadata: { intent: "create_ticket", awaiting: missing, requestType },
    };
  }

  // Build a concise subject + description from the conversation
  const subject =
    requestType === "move_in"
      ? `Move-in permit request — ${input.contact.name}`
      : requestType === "construction_material_delivery"
        ? `Construction material delivery — ${input.contact.name}`
        : requestType === "noc"
          ? `NOC request — ${input.contact.name}`
          : `Support request — ${input.contact.name}`;

  const transcript = input.history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-10)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const description = `Created from ORA AI chat.

Latest user message:
${input.message}

Recent conversation:
${transcript}`;

  try {
    const { ticketNumber } = await createTicket(db, {
      subject,
      description,
      contactName: input.contact.name!,
      contactEmail: input.contact.email!,
      contactPhone: input.contact.phone ?? undefined,
      priority: "medium",
      source: "api",
      createdBy: null,
      requestType,
    });

    const response =
      input.language === "ar"
        ? `تم! فتحت لك التذكرة رقم ${ticketNumber} وسيتابع معك أحد موظفينا قريباً. ستصلك رسالة بريد إلكتروني على ${input.contact.email} عند تحديث الحالة.`
        : `Done — I've opened ticket ${ticketNumber} for you. A teammate will follow up shortly, and we'll email status updates to ${input.contact.email}.`;

    return {
      handled: true,
      response,
      metadata: {
        intent: "create_ticket",
        executed: true,
        ticketNumber,
        requestType,
      },
    };
  } catch (err) {
    console.error("[agent] createTicket failed", err);
    const response =
      input.language === "ar"
        ? "اعتذر، لم أتمكن من فتح التذكرة الآن. هل يمكنك المحاولة مرة أخرى أو سأقوم بتحويلك إلى موظف خدمة؟"
        : "I couldn't open the ticket just now. Want me to try again, or shall I connect you with a human agent?";
    return {
      handled: true,
      response,
      metadata: { intent: "create_ticket", executed: false, error: String(err) },
    };
  }
}

// ── Tool: request_otp ────────────────────────────────────────────────────────

async function executeRequestOtp(
  db: Database,
  input: AgentInput
): Promise<AgentResult> {
  // Need a recognized identity OR an email on file to send OTP to
  let targetEmail: string | null = input.contact.email;

  // If identity was recognized via phone, we may still not have an email here;
  // the OTP module looks up the email from the client/tenant record.
  let recognized = input.identity;
  if (!targetEmail && recognized.type === "visitor") {
    // Try resolve via collected phone/email
    if (input.contact.email) {
      recognized = await resolveIdentityByEmail(db, input.contact.email);
    } else if (input.contact.phone) {
      recognized = await resolveIdentityByPhone(db, input.contact.phone);
    }
  }

  if (!targetEmail && recognized.type === "visitor") {
    const response =
      input.language === "ar"
        ? "لإرسال رمز التحقق، أحتاج بريدك الإلكتروني المسجل لدينا. ما هو بريدك الإلكتروني؟"
        : "To send a verification code, I need the email registered on your account. What's your email address?";
    return {
      handled: true,
      response,
      metadata: { intent: "request_otp", awaiting: "email" },
    };
  }

  // We have an email — generate OTP and send it
  if (!targetEmail) {
    // identity recognized but no captured email — pull from history hopefully
    // not reached often; bail to RAG/instructions
    const response =
      input.language === "ar"
        ? "لإرسال رمز التحقق أحتاج التأكد من بريدك الإلكتروني. ما هو بريدك المسجل؟"
        : "To send the code I need to confirm your email. What's the email on your account?";
    return {
      handled: true,
      response,
      metadata: { intent: "request_otp", awaiting: "email" },
    };
  }

  try {
    const otp = generateOtp();
    await createOtpRecord(
      db,
      input.conversationId,
      targetEmail,
      otp.hash,
      otp.expiresAt
    );

    const recipientName = input.contact.name ?? recognized.firstName ?? "there";
    const result = await sendOtpEmail({
      recipientEmail: targetEmail,
      otpCode: otp.code,
      recipientName,
      language: input.language,
    });

    if (!result.success) {
      const response =
        input.language === "ar"
          ? `لم أتمكن من إرسال رمز التحقق إلى ${maskEmail(targetEmail)} الآن. هل ترغب أن أحول إلى موظف بشري؟`
          : `I wasn't able to send the verification code to ${maskEmail(targetEmail)} just now. Want me to connect you to a human agent instead?`;
      return {
        handled: true,
        response,
        metadata: { intent: "request_otp", sent: false, error: result.error },
      };
    }

    const response =
      input.language === "ar"
        ? `أرسلت رمز التحقق إلى ${maskEmail(targetEmail)}. الرمز صالح لمدة ٥ دقائق — أدخله هنا حالما يصلك.`
        : `Sent — the 6-digit code is on its way to ${maskEmail(targetEmail)} and is valid for 5 minutes. Paste it here when it arrives.`;

    return {
      handled: true,
      response,
      metadata: { intent: "request_otp", sent: true },
    };
  } catch (err) {
    console.error("[agent] OTP send failed", err);
    const response =
      input.language === "ar"
        ? "حدث خطأ أثناء إرسال رمز التحقق. هل تريد أن أحاول مرة أخرى؟"
        : "Something went wrong sending the code. Want me to try again?";
    return {
      handled: true,
      response,
      metadata: { intent: "request_otp", sent: false, error: String(err) },
    };
  }
}

// ── Tool: navigate ───────────────────────────────────────────────────────────

/**
 * Common navigation aliases. Maps human keywords to a canonical search term
 * used to look up the page in the CMS by title or slug.
 */
const NAV_ALIASES: Array<{ keywords: string[]; search: string; fallback?: string }> = [
  { keywords: ["contact", "reach you", "get in touch", "اتصل", "تواصل"], search: "contact", fallback: "/contact" },
  { keywords: ["about", "who are you", "من نحن"], search: "about", fallback: "/about" },
  { keywords: ["communities", "community", "مجتمع"], search: "communit", fallback: "/communities" },
  { keywords: ["projects", "project", "مشاريع", "مشروع"], search: "project", fallback: "/projects" },
  { keywords: ["careers", "jobs", "وظائف"], search: "career", fallback: "/careers" },
  { keywords: ["blog", "news", "articles", "مدونة", "أخبار"], search: "blog", fallback: "/blog" },
  { keywords: ["amenities", "facilities", "مرافق"], search: "amenit" },
  { keywords: ["faq", "faqs", "questions", "أسئلة"], search: "faq", fallback: "/faq" },
  { keywords: ["privacy", "privacy policy", "خصوصية"], search: "privacy", fallback: "/privacy" },
  { keywords: ["terms", "terms of service", "شروط"], search: "terms", fallback: "/terms" },
];

interface NavMatch {
  title: string;
  slug: string;
}

async function findPageMatch(
  db: Database,
  language: "en" | "ar",
  search: string
): Promise<NavMatch | null> {
  const pattern = `%${search}%`;
  const rows = await db
    .select({ title: pages.title, slug: pages.slug })
    .from(pages)
    .where(
      and(
        eq(pages.locale, language),
        eq(pages.status, "published"),
        or(ilike(pages.title, pattern), ilike(pages.slug, pattern))
      )
    )
    .limit(1);

  if (rows.length === 0) return null;
  return rows[0];
}

async function executeNavigate(
  db: Database,
  input: AgentInput
): Promise<AgentResult> {
  const lower = input.message.toLowerCase();
  const localePrefix = input.language === "ar" ? "/ar" : "/en";

  // Try each known alias against the message
  for (const alias of NAV_ALIASES) {
    const hit = alias.keywords.find((kw) => lower.includes(kw));
    if (!hit) continue;

    const match = await findPageMatch(db, input.language, alias.search);
    let url: string | null = null;
    let label: string | null = null;

    if (match) {
      url = `${localePrefix}/${match.slug.replace(/^\//, "")}`;
      label = match.title;
    } else if (alias.fallback) {
      url = `${localePrefix}${alias.fallback}`;
      label = alias.keywords[0].replace(/\b\w/g, (c) => c.toUpperCase());
    }

    if (url && label) {
      const response =
        input.language === "ar"
          ? `بالطبع — هذا هو الرابط: [${label}](${url}). هل أساعدك في شيء آخر؟`
          : `Of course — here you go: [${label}](${url}). Anything else I can help with?`;
      return {
        handled: true,
        response,
        metadata: { intent: "navigate", url, label },
      };
    }
  }

  // Generic fallback: search the message for any noun phrase that matches a page
  const stripped = lower
    .replace(
      /(take me to|navigate to|go to the|go to|show me the|open the|link to|where can i find|where is the|how do i get to|the |page|please|could you|can you)/g,
      " "
    )
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();

  const term = stripped.split(/\s+/).filter((w) => w.length > 2)[0];
  if (term) {
    const match = await findPageMatch(db, input.language, term);
    if (match) {
      const url = `${localePrefix}/${match.slug.replace(/^\//, "")}`;
      const response =
        input.language === "ar"
          ? `هذا هو الرابط: [${match.title}](${url}).`
          : `Here you go: [${match.title}](${url}).`;
      return {
        handled: true,
        response,
        metadata: { intent: "navigate", url, label: match.title },
      };
    }
  }

  // Couldn't resolve — fall through to RAG so the LLM can still try to help
  return { handled: false };
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Runs the lightweight agent. Returns `{handled: true, response}` to short-
 * circuit the RAG pipeline, or `{handled: false}` to fall through to RAG.
 *
 * Always extracts and persists identity fields from the user's message so
 * the next turn (and RAG) sees them.
 */
export async function runAgent(
  db: Database,
  input: AgentInput
): Promise<AgentResult> {
  // 1. Extract any identity fields from the current message
  const extractedName = extractName(input.message);
  const extractedEmail = extractEmail(input.message);
  const extractedPhone = extractPhone(input.message);

  const updatedContact: ConversationContact = {
    name: input.contact.name ?? extractedName,
    email: input.contact.email ?? extractedEmail,
    phone: input.contact.phone ?? extractedPhone,
  };

  if (extractedName || extractedEmail || extractedPhone) {
    try {
      await persistContact(db, input.conversationId, {
        name: extractedName,
        email: extractedEmail,
        phone: extractedPhone,
      });
    } catch (err) {
      console.error("[agent] persistContact failed", err);
    }
  }

  // 2. If we just learned an email or phone and identity was visitor, try to
  //    upgrade the identity now so downstream calls (RAG, OTP) personalize.
  let identity = input.identity;
  if (identity.type === "visitor") {
    if (extractedEmail) {
      identity = await resolveIdentityByEmail(db, extractedEmail);
    } else if (extractedPhone) {
      identity = await resolveIdentityByPhone(db, extractedPhone);
    }
  }

  // 2b. Re-shared email path: if the user just typed an email we already
  //     have on this conversation (and they're recognized), they're most
  //     likely confirming "yes, here's my email again — please send the
  //     code." Acknowledge warmly and route straight into OTP send instead
  //     of asking for it a second time.
  const reshareEmail =
    !!extractedEmail &&
    !!input.contact.email &&
    extractedEmail === input.contact.email.toLowerCase() &&
    identity.type !== "visitor";

  // 3. Detect intent (skipped when reshareEmail short-circuits below)
  const intent = detectIntent(input.message);

  const enrichedInput: AgentInput = {
    ...input,
    contact: updatedContact,
    identity,
  };

  if (reshareEmail) {
    const otpResult = await executeRequestOtp(db, enrichedInput);
    // Soften the response with an acknowledgment that we already had it
    if (otpResult.handled && otpResult.response) {
      const ack =
        input.language === "ar"
          ? "وصلني بريدك مسبقاً — شكراً للتأكيد! "
          : "Got your email already — thanks for confirming! ";
      otpResult.response = ack + otpResult.response;
    }
    return {
      ...otpResult,
      identity,
      contact: updatedContact,
    };
  }

  if (intent === "create_ticket") {
    return {
      ...(await executeCreateTicket(db, enrichedInput)),
      identity,
      contact: updatedContact,
    };
  }

  if (intent === "request_otp") {
    return {
      ...(await executeRequestOtp(db, enrichedInput)),
      identity,
      contact: updatedContact,
    };
  }

  if (intent === "navigate") {
    return {
      ...(await executeNavigate(db, enrichedInput)),
      identity,
      contact: updatedContact,
    };
  }

  // No tool fired — fall through to RAG, but pass enriched identity/contact
  // back so chat.ts can use them.
  return {
    handled: false,
    identity,
    contact: updatedContact,
  };
}

// ── Helpers exported for chat.ts ─────────────────────────────────────────────

/**
 * Pull the existing contact info off the conversation row so the agent can
 * accumulate fields across turns.
 */
export async function loadConversationContact(
  db: Database,
  conversationId: string
): Promise<ConversationContact> {
  const [row] = await db
    .select({
      name: aiConversations.participantName,
      email: aiConversations.participantEmail,
      phone: aiConversations.participantPhone,
    })
    .from(aiConversations)
    .where(eq(aiConversations.id, conversationId))
    .limit(1);

  if (!row) return { name: null, email: null, phone: null };
  return {
    name: row.name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
  };
}

// Used to detect a 6-digit OTP message — re-exported here for chat.ts.
export function isOtpCode(message: string): boolean {
  return /^\s*\d{6}\s*$/.test(message);
}

// Used by classifyQuery import elsewhere
export { classifyQuery };
