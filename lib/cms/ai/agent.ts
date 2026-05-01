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
import { sendOtpEmail, sendAppointmentEmail } from "./email";
import { createTicket } from "../tickets/service";
import {
  bookAppointment,
  lookupClientAccount,
  cancelAppointment,
  rescheduleAppointment,
} from "./actions";
import {
  loadHandoffState,
  mergeHandoffState,
  clearHandoffFields,
  type HandoffState,
} from "./handoff-state";
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

const BOOKING_KEYWORDS = [
  "book a meeting",
  "book a tour",
  "book a site visit",
  "book a consultation",
  "book an appointment",
  "book appointment",
  "book a viewing",
  "schedule a meeting",
  "schedule a tour",
  "schedule a site visit",
  "schedule an appointment",
  "schedule a viewing",
  "schedule a consultation",
  "schedule a call",
  "schedule a visit",
  "site visit",
  "site tour",
  "tour the",
  "visit the site",
  "احجز",
  "موعد",
  "زيارة الموقع",
  "زيارة موقع",
  "جدولة",
];

const HANDOVER_KEYWORDS = [
  "talk to a human",
  "talk to human",
  "speak to a human",
  "speak to human",
  "speak to agent",
  "speak to a person",
  "talk to someone",
  "real person",
  "live agent",
  "live person",
  "transfer me",
  "connect me to",
  "human please",
  "i want a human",
  "ممثل",
  "بشري",
  "تحدث مع شخص",
  "محادثة مع موظف",
  "موظف خدمة",
];

const CANCEL_KEYWORDS = [
  "cancel my appointment",
  "cancel my booking",
  "cancel my meeting",
  "cancel my visit",
  "cancel the appointment",
  "cancel appointment",
  "cancel booking",
  "cancel ora-apt",
  "إلغاء الموعد",
  "ألغي الموعد",
  "إلغاء الحجز",
];

const RESCHEDULE_KEYWORDS = [
  "reschedule",
  "re-schedule",
  "move my appointment",
  "move my booking",
  "change my appointment",
  "change my booking",
  "change the time",
  "different time",
  "another time",
  "تغيير الموعد",
  "إعادة جدولة",
  "تأجيل الموعد",
];

const CONFIRM_KEYWORDS = [
  "yes",
  "yep",
  "yeah",
  "yes please",
  "confirm",
  "confirmed",
  "go ahead",
  "looks good",
  "looks right",
  "that's right",
  "thats right",
  "correct",
  "ok",
  "okay",
  "sure",
  "do it",
  "proceed",
  "نعم",
  "أكد",
  "أؤكد",
  "موافق",
  "تمام",
];

const DECLINE_KEYWORDS = [
  "no",
  "nope",
  "cancel",
  "don't",
  "do not",
  "wait",
  "not now",
  "stop",
  "لا",
  "ألغي",
  "ليس الآن",
];

export type AgentIntent =
  | "create_ticket"
  | "create_booking"
  | "confirm_pending"
  | "decline_pending"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "request_handover"
  | "request_otp"
  | "navigate"
  | "provide_contact"
  | "none";

export function detectIntent(message: string): AgentIntent {
  if (containsAny(message, HANDOVER_KEYWORDS)) return "request_handover";
  if (containsAny(message, OTP_REQUEST_KEYWORDS)) return "request_otp";
  if (containsAny(message, CANCEL_KEYWORDS)) return "cancel_appointment";
  if (containsAny(message, RESCHEDULE_KEYWORDS)) return "reschedule_appointment";
  if (containsAny(message, BOOKING_KEYWORDS)) return "create_booking";
  if (containsAny(message, TICKET_KEYWORDS)) return "create_ticket";
  if (containsAny(message, NAVIGATE_KEYWORDS)) return "navigate";
  // If a message is mostly a contact handoff (name/email/phone with little else),
  // treat it as provide_contact so the agent can persist before falling through.
  if (extractEmail(message) || extractPhone(message)) return "provide_contact";
  return "none";
}

/**
 * Detect a short, standalone "yes/no" reply to a pending question.
 * Returns "confirm" / "decline" / null. Conservative — if the message is
 * long or contains other content, returns null so we don't accidentally
 * confirm a booking when the user wrote a paragraph that happened to start
 * with "yes…".
 */
export function detectYesNo(message: string): "confirm" | "decline" | null {
  const trimmed = message.trim().toLowerCase().replace(/[!.…،.]+$/g, "");
  if (trimmed.length === 0 || trimmed.length > 40) return null;
  // exact match against a known token
  if (CONFIRM_KEYWORDS.includes(trimmed)) return "confirm";
  if (DECLINE_KEYWORDS.includes(trimmed)) return "decline";
  // starts-with for slightly longer affirmations
  for (const kw of CONFIRM_KEYWORDS) {
    if (kw.length >= 3 && trimmed.startsWith(kw + " ")) return "confirm";
  }
  for (const kw of DECLINE_KEYWORDS) {
    if (kw.length >= 3 && trimmed.startsWith(kw + " ")) return "decline";
  }
  return null;
}

/** Extract an ORA appointment reference (ORA-APT-XXXXXX) from free text. */
export function extractAppointmentReference(message: string): string | null {
  const m = message.match(/\bORA-APT-[A-Z0-9]{6}\b/i);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Detect "on behalf of" / "for my <relative>" patterns. Returns the
 * relationship label or "third_party" if a name was mentioned without a clear
 * relationship. Returns null when the booking is for the requester themselves.
 */
export function extractOnBehalfOf(message: string): {
  relationship?: string;
  name?: string;
} | null {
  const lower = message.toLowerCase();

  // "on behalf of <Name>"
  const obo = message.match(/on\s+behalf\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (obo) return { relationship: "third_party", name: obo[1] };

  // "for my wife/husband/sister/brother/colleague/friend/son/daughter/parent/mother/father <Name>?"
  const rel = lower.match(
    /\bfor\s+my\s+(wife|husband|sister|brother|colleague|friend|partner|son|daughter|mother|father|parent|client|tenant|boss|assistant)\b(?:\s+([A-Za-z]+(?:\s+[A-Za-z]+)?))?/
  );
  if (rel) {
    return {
      relationship: rel[1],
      name: rel[2]
        ? rel[2].replace(/\b\w/g, (c) => c.toUpperCase())
        : undefined,
    };
  }

  // "for <Name>" where Name is clearly a person (capitalised, not the requester)
  const forName = message.match(
    /\bfor\s+(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/
  );
  if (forName) return { relationship: "third_party", name: forName[1] };

  return null;
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

// ── Tool: create_booking (appointment) ───────────────────────────────────────

/**
 * Parse a date+time mentioned in the user message OR recent conversation.
 * Returns { date: "YYYY-MM-DD", time: "HH:MM" } or null on ambiguity.
 *
 * Conservative — we'd rather return null and ask the user than book the
 * wrong slot. Handles common forms:
 *   "tomorrow at 5pm" / "tomorrow 5 pm" / "tomorrow at 17:00"
 *   "next monday at 10am"
 *   "May 15 at 3pm" / "15 May 3:30pm" / "2026-05-15 15:00"
 *   "today at 4pm"
 */
export function parseDateTime(
  message: string,
  reference: Date = new Date()
): { date: string; time: string } | null {
  const lower = message.toLowerCase();

  // ── Time extraction ───────────────────────────────────────────────────────
  let hour: number | null = null;
  let minute = 0;

  // 12-hour: "5pm", "5:30 pm", "11 a.m."
  const m12 = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2] ? parseInt(m12[2], 10) : 0;
    const isPm = m12[3].startsWith("p");
    if (h === 12) h = isPm ? 12 : 0;
    else if (isPm) h += 12;
    hour = h;
    minute = min;
  } else {
    // 24-hour: "17:00", "at 14:30"
    const m24 = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (m24) {
      hour = parseInt(m24[1], 10);
      minute = parseInt(m24[2], 10);
    }
  }

  if (hour === null) return null;

  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  // ── Date extraction ───────────────────────────────────────────────────────
  const ref = new Date(reference);
  ref.setHours(0, 0, 0, 0);

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // ISO date: 2026-05-15
  const mIso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (mIso) {
    return { date: `${mIso[1]}-${mIso[2]}-${mIso[3]}`, time };
  }

  // "tomorrow"
  if (/\btomorrow\b|غداً|غدا/.test(lower)) {
    const d = new Date(ref);
    d.setDate(d.getDate() + 1);
    return { date: fmt(d), time };
  }

  // "today" / "tonight"
  if (/\btoday\b|\btonight\b|اليوم/.test(lower)) {
    return { date: fmt(ref), time };
  }

  // "next <weekday>" / "<weekday>"
  const weekdays = [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  ];
  for (let i = 0; i < weekdays.length; i++) {
    const re = new RegExp(`\\b(?:next\\s+)?${weekdays[i]}\\b`);
    if (re.test(lower)) {
      const target = i;
      const cur = ref.getDay();
      let delta = (target - cur + 7) % 7;
      if (delta === 0 || /next\s+/.test(lower)) delta = delta === 0 ? 7 : delta;
      const d = new Date(ref);
      d.setDate(d.getDate() + delta);
      return { date: fmt(d), time };
    }
  }

  // "May 15", "15 May", "May 15 2026"
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const mNamed = lower.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:[,\s]+(\d{4}))?/
  );
  if (mNamed) {
    const monIdx = months.findIndex((m) => m.startsWith(mNamed[1]));
    const day = parseInt(mNamed[2], 10);
    const year = mNamed[3] ? parseInt(mNamed[3], 10) : ref.getFullYear();
    const d = new Date(year, monIdx, day);
    if (!isNaN(d.getTime())) return { date: fmt(d), time };
  }

  // No date hint — bail (don't assume today, avoids accidental booking)
  return null;
}

function classifyAppointmentType(message: string, history: Array<{ content: string }>):
  "site_visit" | "consultation" | "payment_discussion" | "maintenance_request" {
  const all = [message, ...history.map((h) => h.content)].join(" ").toLowerCase();
  if (/maint(en)?ance|repair|broken|fix /.test(all)) return "maintenance_request";
  if (/payment|paid|installment|invoice|due/.test(all)) return "payment_discussion";
  if (/site\s+visit|tour|view(ing)? the|see the|come to the/.test(all)) return "site_visit";
  return "consultation";
}

// ── Working-hours guard ──────────────────────────────────────────────────────
// UAE business hours: Mon–Sat 09:00–19:00. Friday is the cultural off-day.

const WORK_OPEN_HOUR = 9;
const WORK_CLOSE_HOUR = 19;

function appointmentTypeLabel(
  t: "site_visit" | "consultation" | "payment_discussion" | "maintenance_request",
  language: "en" | "ar"
): string {
  const map = {
    site_visit: { en: "site visit", ar: "زيارة موقع" },
    consultation: { en: "consultation", ar: "استشارة" },
    payment_discussion: { en: "payment discussion", ar: "مناقشة دفع" },
    maintenance_request: { en: "maintenance visit", ar: "زيارة صيانة" },
  };
  return map[t][language];
}

/**
 * Validate that a date/time falls within UAE business hours and is not in
 * the past. Returns null when valid, or a localized error message otherwise.
 */
export function validateBookingWindow(
  date: string,
  time: string,
  language: "en" | "ar",
  now: Date = new Date()
): string | null {
  const [hh, mm] = time.split(":").map(Number);
  // Treat the booked slot as Asia/Dubai local — the server may run in UTC,
  // so build the date string in local form.
  const slot = new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`);
  if (isNaN(slot.getTime())) {
    return language === "ar"
      ? "لم أفهم التاريخ والوقت. هل يمكنك إعادة المحاولة بصيغة مثل 'غداً 5 مساءً'؟"
      : "I couldn't read that date or time. Could you try again, e.g. 'tomorrow at 5pm'?";
  }
  if (slot.getTime() < now.getTime()) {
    return language === "ar"
      ? "هذا الوقت في الماضي. ما هو موعد آخر يناسبك؟"
      : "That time has already passed. Could you pick another slot?";
  }
  // Friday is day 5 (Sun=0)
  if (slot.getDay() === 5) {
    return language === "ar"
      ? "نحن مغلقون أيام الجمعة. هل يمكنك اختيار يوم آخر بين السبت والخميس؟"
      : "We're closed on Fridays. Could you pick another day (Saturday–Thursday)?";
  }
  if (hh < WORK_OPEN_HOUR || hh >= WORK_CLOSE_HOUR) {
    return language === "ar"
      ? `ساعات عملنا من ${WORK_OPEN_HOUR}:00 صباحاً حتى ${WORK_CLOSE_HOUR}:00 مساءً. هل يناسبك وقت ضمن هذه الساعات؟`
      : `Our hours are ${WORK_OPEN_HOUR}:00–${WORK_CLOSE_HOUR}:00. Could you pick a time within that window?`;
  }
  return null;
}

// ── Tool: create_booking (with confirmation turn) ────────────────────────────

/**
 * First half of the booking flow. Gathers contact + date/time, optionally
 * collects on-behalf-of details, validates the window, then BUFFERS the
 * pending booking and asks the user to confirm. Actual DB writes happen in
 * `executeConfirmPending` once the user replies "yes".
 */
async function executeCreateBooking(
  db: Database,
  input: AgentInput
): Promise<AgentResult> {
  const language = input.language;

  // 1. Auto-fill from DB for known clients/tenants
  let contact = { ...input.contact };
  if (
    input.identity.type !== "visitor" &&
    (!contact.name || !contact.email || !contact.phone)
  ) {
    try {
      const account = await lookupClientAccount(db, input.identity);
      if (account.type !== "visitor") {
        const dbName = [account.firstName, account.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
        contact = {
          name: contact.name ?? (dbName.length > 0 ? dbName : null),
          email: contact.email ?? account.email ?? null,
          phone: contact.phone ?? account.phone ?? null,
        };
      }
    } catch (err) {
      console.error("[agent] booking: account lookup failed", err);
    }
  }

  // 2. Detect on-behalf-of from this message OR most recent user history
  const handoff = await loadHandoffState(db, input.conversationId);
  let onBehalfOf = handoff.pendingBooking?.onBehalfOf;
  const oboDetected = extractOnBehalfOf(input.message);
  if (oboDetected) {
    onBehalfOf = {
      ...(onBehalfOf ?? {}),
      ...(oboDetected.relationship
        ? { relationship: oboDetected.relationship }
        : {}),
      ...(oboDetected.name ? { name: oboDetected.name } : {}),
    };
  }
  // If the user just provided an email/phone in this message AND we're in an
  // on-behalf-of flow, attach to onBehalfOf rather than the requester contact.
  if (onBehalfOf) {
    const newEmail = extractEmail(input.message);
    const newPhone = extractPhone(input.message);
    if (newEmail && !onBehalfOf.email) onBehalfOf.email = newEmail;
    if (newPhone && !onBehalfOf.phone) onBehalfOf.phone = newPhone;
  }

  // 3. Validate contact info — only ask for what's actually missing
  if (!contact.name || !contact.email) {
    const need: string[] = [];
    if (!contact.name) need.push(language === "ar" ? "اسمك الكامل" : "your full name");
    if (!contact.email)
      need.push(language === "ar" ? "بريدك الإلكتروني" : "your email");
    if (!contact.phone)
      need.push(language === "ar" ? "رقم هاتفك" : "your mobile number");

    const list =
      language === "ar"
        ? need.join("، و")
        : need.length === 1
          ? need[0]
          : need.slice(0, -1).join(", ") + ", and " + need[need.length - 1];

    const response =
      language === "ar"
        ? `بكل سرور أحجز لك موعداً. قبل أن أحجز، أحتاج ${list}. هل يمكنك مشاركتها؟`
        : `Happy to book a meeting with our team. Before I do, I just need ${list}. Could you share?`;

    return {
      handled: true,
      response,
      metadata: { intent: "create_booking", awaiting: "contact" },
    };
  }

  // 3b. If booking is on behalf of someone else, make sure we have THAT
  //     person's name + email. Phone optional.
  if (onBehalfOf && (!onBehalfOf.name || !onBehalfOf.email)) {
    // Persist what we have so far so the next turn picks it up
    await mergeHandoffState(db, input.conversationId, {
      pendingBooking: {
        appointmentType: classifyAppointmentType(input.message, input.history),
        scheduledDate: handoff.pendingBooking?.scheduledDate ?? "",
        scheduledTime: handoff.pendingBooking?.scheduledTime ?? "",
        contactName: contact.name,
        contactEmail: contact.email,
        contactPhone: contact.phone,
        onBehalfOf,
      },
    });
    const need: string[] = [];
    if (!onBehalfOf.name)
      need.push(language === "ar" ? "اسمهم الكامل" : "their full name");
    if (!onBehalfOf.email)
      need.push(language === "ar" ? "بريدهم الإلكتروني" : "their email");
    if (!onBehalfOf.phone)
      need.push(language === "ar" ? "رقم هاتفهم" : "their mobile number");
    const list =
      language === "ar"
        ? need.join("، و")
        : need.length === 1
          ? need[0]
          : need.slice(0, -1).join(", ") + ", and " + need[need.length - 1];
    const relText = onBehalfOf.relationship
      ? language === "ar"
        ? ` (${onBehalfOf.relationship})`
        : ` (${onBehalfOf.relationship})`
      : "";
    const response =
      language === "ar"
        ? `بكل سرور — لحجز الموعد لـ ${onBehalfOf.name ?? "الشخص"}${relText}، أحتاج ${list}.`
        : `Of course — to book on behalf of ${onBehalfOf.name ?? "them"}${relText}, I just need ${list}.`;
    return {
      handled: true,
      response,
      metadata: { intent: "create_booking", awaiting: "behalf_contact" },
    };
  }

  // 4. Parse date + time from message + recent history
  let parsed = parseDateTime(input.message);
  if (!parsed) {
    const recentUserMsgs = input.history
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) => m.content);
    for (const msg of recentUserMsgs.reverse()) {
      parsed = parseDateTime(msg);
      if (parsed) break;
    }
  }

  if (!parsed) {
    const greetName = contact.name ? contact.name.split(" ")[0] : null;
    const response =
      language === "ar"
        ? `بكل سرور${greetName ? ` يا ${greetName}` : ""} أحجز لك موعداً مع فريقنا. ما هو التاريخ والوقت اللذان يناسبانك؟ (مثال: "غداً الساعة 5 مساءً" أو "20 مايو الساعة 10 صباحاً")`
        : `Happy to set up a meeting with our team${greetName ? `, ${greetName}` : ""}. What date and time work for you? (e.g. "tomorrow at 5pm" or "May 20 at 10am")`;
    return {
      handled: true,
      response,
      metadata: { intent: "create_booking", awaiting: "datetime" },
    };
  }

  // 5. Working-hours guard
  const windowError = validateBookingWindow(parsed.date, parsed.time, language);
  if (windowError) {
    return {
      handled: true,
      response: windowError,
      metadata: {
        intent: "create_booking",
        awaiting: "datetime",
        rejectedDate: parsed.date,
        rejectedTime: parsed.time,
      },
    };
  }

  const apptType = classifyAppointmentType(input.message, input.history);

  // 6. Buffer the pending booking and ask for explicit confirmation
  await mergeHandoffState(db, input.conversationId, {
    pendingBooking: {
      appointmentType: apptType,
      scheduledDate: parsed.date,
      scheduledTime: parsed.time,
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      onBehalfOf: onBehalfOf ?? undefined,
      notes: input.message,
    },
  });

  const typeLabel = appointmentTypeLabel(apptType, language);
  const targetName = onBehalfOf?.name ?? contact.name.split(" ")[0];
  const targetEmail = onBehalfOf?.email ?? contact.email;

  const summary =
    language === "ar"
      ? `لنتأكد قبل التثبيت — ${typeLabel} لـ ${targetName} يوم ${parsed.date} الساعة ${parsed.time}، وسأرسل التأكيد إلى ${targetEmail}. هل أؤكد الحجز؟ (نعم / لا)`
      : `Just to confirm before I lock it in — ${typeLabel} for ${targetName} on ${parsed.date} at ${parsed.time}, confirmation email to ${targetEmail}. Should I confirm? (yes / no)`;

  return {
    handled: true,
    response: summary,
    metadata: {
      intent: "create_booking",
      awaiting: "confirmation",
      scheduledDate: parsed.date,
      scheduledTime: parsed.time,
      appointmentType: apptType,
      onBehalfOf: onBehalfOf ?? undefined,
    },
  };
}

/**
 * Finalise a booking that's been buffered via `pendingBooking` after the
 * user replies "yes / confirm". Performs DB write, ticket, email.
 */
async function executeConfirmPending(
  db: Database,
  input: AgentInput,
  state: HandoffState
): Promise<AgentResult> {
  const language = input.language;
  const pb = state.pendingBooking;
  if (!pb) {
    return {
      handled: true,
      response:
        language === "ar"
          ? "لا يوجد طلب معلق لتأكيده. كيف يمكنني مساعدتك؟"
          : "I don't have anything pending to confirm right now. How can I help?",
      metadata: { intent: "confirm_pending", noop: true },
    };
  }

  // Use the on-behalf-of contact if present, else the requester
  const target = pb.onBehalfOf?.email
    ? {
        name: pb.onBehalfOf.name ?? pb.contactName,
        email: pb.onBehalfOf.email,
        phone: pb.onBehalfOf.phone ?? pb.contactPhone,
      }
    : {
        name: pb.contactName,
        email: pb.contactEmail,
        phone: pb.contactPhone,
      };

  // Defensive: if either is missing we can't book. This shouldn't happen
  // because executeCreateBooking refuses to buffer without name+email, but
  // guard anyway so the type system is satisfied and we degrade gracefully.
  if (!target.name || !target.email) {
    return {
      handled: true,
      response:
        language === "ar"
          ? "أحتاج إلى الاسم الكامل والبريد الإلكتروني قبل الحجز."
          : "I need a full name and email before I can book.",
      metadata: { intent: "confirm_pending", missingContact: true },
    };
  }
  const targetName: string = target.name;
  const targetEmail: string = target.email;

  try {
    const appt = await bookAppointment(db, {
      conversationId: input.conversationId,
      clientId: input.identity.clientId,
      tenantId: input.identity.tenantId,
      contactName: targetName,
      contactEmail: targetEmail,
      contactPhone: target.phone ?? undefined,
      appointmentType: pb.appointmentType,
      scheduledDate: pb.scheduledDate,
      scheduledTime: pb.scheduledTime,
      notes:
        `Booked via ORA AI chat.` +
        (pb.onBehalfOf?.name
          ? ` On behalf of ${pb.onBehalfOf.name}` +
            (pb.onBehalfOf.relationship
              ? ` (${pb.onBehalfOf.relationship}) — booked by ${pb.contactName} <${pb.contactEmail}>`
              : ` — booked by ${pb.contactName} <${pb.contactEmail}>`)
          : "") +
        (pb.notes ? `\nLatest user message: ${pb.notes}` : ""),
    });

    let ticketNumber: string | undefined;
    try {
      const ticket = await createTicket(db, {
        subject: `Appointment ${appt.referenceNumber} — ${targetName}`,
        description:
          `Type: ${pb.appointmentType}\n` +
          `Scheduled: ${pb.scheduledDate} at ${pb.scheduledTime}\n` +
          `For: ${targetName} <${targetEmail}>` +
          (target.phone ? ` / ${target.phone}` : "") +
          (pb.onBehalfOf?.name
            ? `\nBooked by: ${pb.contactName} <${pb.contactEmail}>` +
              (pb.onBehalfOf.relationship
                ? ` (relationship: ${pb.onBehalfOf.relationship})`
                : "")
            : "") +
          `\n\nRecent transcript:\n` +
          input.history
            .slice(-6)
            .map(
              (m) =>
                `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
            )
            .join("\n"),
        contactName: targetName,
        contactEmail: targetEmail,
        contactPhone: target.phone ?? undefined,
        priority: "medium",
        source: "api",
        createdBy: null,
        requestType: "general_inquiry",
      });
      ticketNumber = ticket.ticketNumber;
    } catch (err) {
      console.error("[agent] booking ticket creation failed", err);
    }

    let emailSent = false;
    try {
      const result = await sendAppointmentEmail({
        recipientEmail: targetEmail,
        recipientName: targetName,
        referenceNumber: appt.referenceNumber,
        ticketNumber,
        scheduledDate: pb.scheduledDate,
        scheduledTime: pb.scheduledTime,
        appointmentType: pb.appointmentType,
        language,
      });
      emailSent = result.success;
    } catch (err) {
      console.error("[agent] booking email send failed", err);
    }

    // Clear the pending booking buffer
    await clearHandoffFields(db, input.conversationId, ["pendingBooking"]);

    const greetName = input.contact.name
      ? input.contact.name.split(" ")[0]
      : null;
    const response =
      language === "ar"
        ? `${greetName ? `${greetName}، ` : ""}تم! ` +
          (ticketNumber
            ? `أنشأت تذكرة رقم ${ticketNumber} لحجز موعدك (${appt.referenceNumber}) في ${pb.scheduledDate} الساعة ${pb.scheduledTime}. `
            : `حجزت الموعد (${appt.referenceNumber}) في ${pb.scheduledDate} الساعة ${pb.scheduledTime}. `) +
          (emailSent
            ? `سيصل التأكيد بالتفاصيل إلى ${target.email} خلال دقائق.`
            : `سيؤكد فريقنا الموعد ويرسل التفاصيل إلى ${target.email} قريباً.`)
        : `${greetName ? `${greetName}, ` : ""}done! ` +
          (ticketNumber
            ? `I've raised ticket ${ticketNumber} for appointment ${appt.referenceNumber} on ${pb.scheduledDate} at ${pb.scheduledTime}. `
            : `Appointment ${appt.referenceNumber} reserved for ${pb.scheduledDate} at ${pb.scheduledTime}. `) +
          (emailSent
            ? `The confirmation is on its way to ${target.email}.`
            : `Our team will confirm and email the details to ${target.email}.`);

    return {
      handled: true,
      response,
      metadata: {
        intent: "create_booking",
        executed: true,
        referenceNumber: appt.referenceNumber,
        ticketNumber,
        scheduledDate: pb.scheduledDate,
        scheduledTime: pb.scheduledTime,
        appointmentType: pb.appointmentType,
        emailSent,
      },
    };
  } catch (err) {
    console.error("[agent] booking finalise failed", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    const isConflict = /already booked/i.test(errMsg);
    if (isConflict) {
      // Keep the pending booking so user can pick another time
      const response =
        language === "ar"
          ? "هذا الوقت محجوز للأسف. هل يمكنك اقتراح وقت آخر؟"
          : "That slot just got booked — could you suggest another time?";
      return {
        handled: true,
        response,
        metadata: { intent: "create_booking", executed: false, conflict: true },
      };
    }
    await clearHandoffFields(db, input.conversationId, ["pendingBooking"]);
    return {
      handled: true,
      response:
        language === "ar"
          ? "لم أتمكن من تأكيد الحجز الآن. هل تريد أن أحوّلك إلى أحد ممثلينا؟"
          : "I couldn't confirm the booking just now. Would you like me to connect you with a teammate?",
      metadata: { intent: "create_booking", executed: false, error: errMsg },
    };
  }
}

async function executeDeclinePending(
  db: Database,
  input: AgentInput,
  state: HandoffState
): Promise<AgentResult> {
  const language = input.language;
  const hadBooking = !!state.pendingBooking;
  const hadCancel = !!state.pendingCancel;
  const hadReschedule = !!state.pendingReschedule;
  await clearHandoffFields(db, input.conversationId, [
    "pendingBooking",
    "pendingCancel",
    "pendingReschedule",
  ]);
  if (!hadBooking && !hadCancel && !hadReschedule) {
    return { handled: false };
  }
  const response =
    language === "ar"
      ? "لا مشكلة، ألغيت الطلب. هل تحتاج شيئاً آخر؟"
      : "No problem — cancelled that request. Anything else I can help with?";
  return {
    handled: true,
    response,
    metadata: { intent: "decline_pending", cleared: true },
  };
}

// ── Tool: cancel_appointment ─────────────────────────────────────────────────

async function findRecentAppointmentForConversation(
  db: Database,
  conversationId: string,
  email?: string
): Promise<{
  referenceNumber: string;
  scheduledDate: string;
  scheduledTime: string;
  appointmentType: string;
} | null> {
  // Avoid extra imports — use a raw query through drizzle
  try {
    const { aiAppointments } = await import("../schema");
    const { desc, or } = await import("drizzle-orm");
    const where = email
      ? or(
          eq(aiAppointments.conversationId, conversationId),
          eq(aiAppointments.contactEmail, email)
        )
      : eq(aiAppointments.conversationId, conversationId);
    const rows = await db
      .select({
        referenceNumber: aiAppointments.referenceNumber,
        scheduledDate: aiAppointments.scheduledDate,
        scheduledTime: aiAppointments.scheduledTime,
        appointmentType: aiAppointments.appointmentType,
        status: aiAppointments.status,
      })
      .from(aiAppointments)
      .where(where)
      .orderBy(desc(aiAppointments.createdAt))
      .limit(5);
    const active = rows.find((r) => r.status !== "cancelled");
    return active ?? null;
  } catch {
    return null;
  }
}

async function executeCancelAppointment(
  db: Database,
  input: AgentInput
): Promise<AgentResult> {
  const language = input.language;
  // Try to find target ref number from message, or fall back to most recent
  let ref = extractAppointmentReference(input.message);
  let appt: {
    referenceNumber: string;
    scheduledDate: string;
    scheduledTime: string;
    appointmentType: string;
  } | null = null;

  if (!ref) {
    appt = await findRecentAppointmentForConversation(
      db,
      input.conversationId,
      input.contact.email ?? undefined
    );
    ref = appt?.referenceNumber ?? null;
  }

  if (!ref) {
    return {
      handled: true,
      response:
        language === "ar"
          ? "لم أجد موعداً مرتبطاً بهذه المحادثة. هل تستطيع مشاركة الرقم المرجعي (مثل ORA-APT-XXXXXX)؟"
          : "I couldn't find an appointment on this conversation. Could you share the reference number (e.g. ORA-APT-XXXXXX)?",
      metadata: { intent: "cancel_appointment", awaiting: "reference" },
    };
  }

  // Buffer pending cancel and ask for confirmation
  await mergeHandoffState(db, input.conversationId, {
    pendingCancel: {
      referenceNumber: ref,
      scheduledDate: appt?.scheduledDate ?? "",
      scheduledTime: appt?.scheduledTime ?? "",
      appointmentType: appt?.appointmentType ?? "",
    },
  });

  const detail =
    appt?.scheduledDate && appt?.scheduledTime
      ? language === "ar"
        ? ` (${appt.scheduledDate} الساعة ${appt.scheduledTime})`
        : ` (${appt.scheduledDate} at ${appt.scheduledTime})`
      : "";

  return {
    handled: true,
    response:
      language === "ar"
        ? `سأقوم بإلغاء الموعد ${ref}${detail}. هل تؤكد الإلغاء؟ (نعم / لا)`
        : `Just to confirm — I'll cancel ${ref}${detail}. Are you sure? (yes / no)`,
    metadata: { intent: "cancel_appointment", awaiting: "confirmation", ref },
  };
}

async function executeConfirmCancel(
  db: Database,
  input: AgentInput,
  state: HandoffState
): Promise<AgentResult> {
  const language = input.language;
  const pc = state.pendingCancel;
  if (!pc) return { handled: false };
  try {
    await cancelAppointment(db, pc.referenceNumber, input.conversationId);
    await clearHandoffFields(db, input.conversationId, ["pendingCancel"]);
    return {
      handled: true,
      response:
        language === "ar"
          ? `تم إلغاء الموعد ${pc.referenceNumber}. هل أساعدك في حجز موعد جديد؟`
          : `Done — appointment ${pc.referenceNumber} has been cancelled. Want me to set up a new one?`,
      metadata: {
        intent: "cancel_appointment",
        executed: true,
        referenceNumber: pc.referenceNumber,
      },
    };
  } catch (err) {
    console.error("[agent] cancel failed", err);
    await clearHandoffFields(db, input.conversationId, ["pendingCancel"]);
    return {
      handled: true,
      response:
        language === "ar"
          ? "لم أتمكن من إلغاء الموعد الآن. سأحوّلك إلى أحد ممثلينا."
          : "I couldn't cancel that just now — I'll connect you with a teammate.",
      metadata: { intent: "cancel_appointment", executed: false },
    };
  }
}

// ── Tool: reschedule_appointment ─────────────────────────────────────────────

async function executeRescheduleAppointment(
  db: Database,
  input: AgentInput
): Promise<AgentResult> {
  const language = input.language;
  let ref = extractAppointmentReference(input.message);
  let appt: {
    referenceNumber: string;
    scheduledDate: string;
    scheduledTime: string;
    appointmentType: string;
  } | null = null;

  if (!ref) {
    appt = await findRecentAppointmentForConversation(
      db,
      input.conversationId,
      input.contact.email ?? undefined
    );
    ref = appt?.referenceNumber ?? null;
  }

  if (!ref) {
    return {
      handled: true,
      response:
        language === "ar"
          ? "لم أجد موعداً لإعادة جدولته. ما هو الرقم المرجعي (مثل ORA-APT-XXXXXX)؟"
          : "I couldn't find an appointment to reschedule. What's the reference number (e.g. ORA-APT-XXXXXX)?",
      metadata: { intent: "reschedule_appointment", awaiting: "reference" },
    };
  }

  const newParsed = parseDateTime(input.message);

  if (!newParsed) {
    await mergeHandoffState(db, input.conversationId, {
      pendingReschedule: {
        referenceNumber: ref,
        fromDate: appt?.scheduledDate ?? "",
        fromTime: appt?.scheduledTime ?? "",
      },
    });
    return {
      handled: true,
      response:
        language === "ar"
          ? `بكل سرور — ما هو التاريخ والوقت الجديد للموعد ${ref}؟`
          : `Sure — what's the new date and time for ${ref}?`,
      metadata: { intent: "reschedule_appointment", awaiting: "datetime", ref },
    };
  }

  const windowError = validateBookingWindow(
    newParsed.date,
    newParsed.time,
    language
  );
  if (windowError) {
    return {
      handled: true,
      response: windowError,
      metadata: { intent: "reschedule_appointment", awaiting: "datetime", ref },
    };
  }

  await mergeHandoffState(db, input.conversationId, {
    pendingReschedule: {
      referenceNumber: ref,
      fromDate: appt?.scheduledDate ?? "",
      fromTime: appt?.scheduledTime ?? "",
      newDate: newParsed.date,
      newTime: newParsed.time,
    },
  });

  return {
    handled: true,
    response:
      language === "ar"
        ? `سأنقل الموعد ${ref} إلى ${newParsed.date} الساعة ${newParsed.time}. هل أؤكد؟ (نعم / لا)`
        : `I'll move ${ref} to ${newParsed.date} at ${newParsed.time}. Confirm? (yes / no)`,
    metadata: {
      intent: "reschedule_appointment",
      awaiting: "confirmation",
      ref,
      newDate: newParsed.date,
      newTime: newParsed.time,
    },
  };
}

async function executeConfirmReschedule(
  db: Database,
  input: AgentInput,
  state: HandoffState
): Promise<AgentResult> {
  const language = input.language;
  const pr = state.pendingReschedule;
  if (!pr || !pr.newDate || !pr.newTime) return { handled: false };
  try {
    const updated = await rescheduleAppointment(
      db,
      pr.referenceNumber,
      pr.newDate,
      pr.newTime
    );
    // Send updated email
    try {
      await sendAppointmentEmail({
        recipientEmail: input.contact.email ?? "",
        recipientName: input.contact.name ?? updated.contactName,
        referenceNumber: updated.referenceNumber,
        scheduledDate: updated.scheduledDate,
        scheduledTime: updated.scheduledTime,
        appointmentType: updated.appointmentType,
        language,
      });
    } catch {
      // best effort
    }
    await clearHandoffFields(db, input.conversationId, ["pendingReschedule"]);
    return {
      handled: true,
      response:
        language === "ar"
          ? `تم! الموعد ${updated.referenceNumber} الآن في ${pr.newDate} الساعة ${pr.newTime}. أرسلت التحديث بالبريد.`
          : `Done — ${updated.referenceNumber} is now ${pr.newDate} at ${pr.newTime}. I've emailed the update.`,
      metadata: {
        intent: "reschedule_appointment",
        executed: true,
        referenceNumber: updated.referenceNumber,
      },
    };
  } catch (err) {
    console.error("[agent] reschedule failed", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    const isConflict = /already booked/i.test(errMsg);
    if (isConflict) {
      await clearHandoffFields(db, input.conversationId, ["pendingReschedule"]);
      return {
        handled: true,
        response:
          language === "ar"
            ? "هذا الوقت محجوز. هل تختار وقتاً آخر؟"
            : "That slot's already booked — could you pick another time?",
        metadata: { intent: "reschedule_appointment", conflict: true },
      };
    }
    await clearHandoffFields(db, input.conversationId, ["pendingReschedule"]);
    return {
      handled: true,
      response:
        language === "ar"
          ? "لم أتمكن من إعادة الجدولة. سأحوّلك إلى أحد ممثلينا."
          : "I couldn't reschedule that — I'll connect you with a teammate.",
      metadata: { intent: "reschedule_appointment", executed: false },
    };
  }
}

// ── Tool: request_handover ───────────────────────────────────────────────────

async function executeRequestHandover(
  db: Database,
  input: AgentInput
): Promise<AgentResult> {
  const language = input.language;
  const contact = input.contact;

  // Open a high-priority ticket with the full transcript
  let ticketNumber: string | undefined;
  try {
    const ticket = await createTicket(db, {
      subject: `Human handover requested${contact.name ? ` — ${contact.name}` : ""}`,
      description:
        `User explicitly asked to speak to a human.\n` +
        `Identity: ${input.identity.type}` +
        (input.identity.firstName ? ` (${input.identity.firstName})` : "") +
        `\nContact: ${contact.name ?? "—"} <${contact.email ?? "—"}>` +
        (contact.phone ? ` / ${contact.phone}` : "") +
        `\nLatest message: ${input.message}\n\n` +
        `Recent transcript:\n` +
        input.history
          .slice(-12)
          .map(
            (m) =>
              `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
          )
          .join("\n"),
      contactName: contact.name ?? "Anonymous visitor",
      contactEmail: contact.email ?? "no-reply@ora.local",
      contactPhone: contact.phone ?? undefined,
      priority: "high",
      source: "api",
      createdBy: null,
      requestType: "general_inquiry",
    });
    ticketNumber = ticket.ticketNumber;
  } catch (err) {
    console.error("[agent] handover ticket creation failed", err);
  }

  // Mark conversation as handed_off
  try {
    await db
      .update(aiConversations)
      .set({ status: "handed_off", updatedAt: new Date() })
      .where(eq(aiConversations.id, input.conversationId));
  } catch (err) {
    console.error("[agent] handover status update failed", err);
  }

  const response =
    language === "ar"
      ? `بالطبع — أحوّلك الآن إلى أحد ممثلينا. ${ticketNumber ? `رقم المرجع: ${ticketNumber}. ` : ""}متوسط وقت الرد أقل من 10 دقائق.`
      : `Of course — I'm connecting you with a teammate now. ${ticketNumber ? `Reference: ${ticketNumber}. ` : ""}Average response is under 10 minutes.`;

  return {
    handled: true,
    response,
    metadata: { intent: "request_handover", ticketNumber },
  };
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
  let intent = detectIntent(input.message);

  // Load handoff state once — needed for confirm/decline detection and to
  // continue staged flows (booking, cancel, reschedule).
  const handoffState = await loadHandoffState(db, input.conversationId);
  const hasPending =
    !!handoffState.pendingBooking ||
    !!handoffState.pendingCancel ||
    !!handoffState.pendingReschedule;

  // If something is pending and the user replied with a yes/no, route to
  // the confirm/decline branches instead of the generic intent.
  if (hasPending && intent !== "request_handover") {
    const yn = detectYesNo(input.message);
    if (yn === "confirm") intent = "confirm_pending";
    else if (yn === "decline") intent = "decline_pending";
  }

  // Carry-over: if the assistant just asked for a date/time for a booking
  // OR a reschedule, and the user's reply contains a parseable date/time,
  // treat it as a continuation of that flow.
  if (intent === "none" || intent === "provide_contact") {
    const lastAssistant = [...input.history]
      .reverse()
      .find((m) => m.role === "assistant");
    const askedDateTime =
      lastAssistant &&
      /(date and time|what date|what time|when would|when works|when suits|new date|new time|متى يناسبك|التاريخ والوقت|التاريخ الجديد)/i.test(
        lastAssistant.content
      );
    if (askedDateTime && parseDateTime(input.message)) {
      if (handoffState.pendingReschedule) {
        intent = "reschedule_appointment";
      } else {
        intent = "create_booking";
      }
    }
  }

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

  if (intent === "request_handover") {
    return {
      ...(await executeRequestHandover(db, enrichedInput)),
      identity,
      contact: updatedContact,
    };
  }

  if (intent === "confirm_pending") {
    // Decide which pending flow to finalise
    if (handoffState.pendingBooking) {
      return {
        ...(await executeConfirmPending(db, enrichedInput, handoffState)),
        identity,
        contact: updatedContact,
      };
    }
    if (handoffState.pendingCancel) {
      return {
        ...(await executeConfirmCancel(db, enrichedInput, handoffState)),
        identity,
        contact: updatedContact,
      };
    }
    if (handoffState.pendingReschedule?.newDate) {
      return {
        ...(await executeConfirmReschedule(db, enrichedInput, handoffState)),
        identity,
        contact: updatedContact,
      };
    }
  }

  if (intent === "decline_pending") {
    return {
      ...(await executeDeclinePending(db, enrichedInput, handoffState)),
      identity,
      contact: updatedContact,
    };
  }

  if (intent === "cancel_appointment") {
    return {
      ...(await executeCancelAppointment(db, enrichedInput)),
      identity,
      contact: updatedContact,
    };
  }

  if (intent === "reschedule_appointment") {
    return {
      ...(await executeRescheduleAppointment(db, enrichedInput)),
      identity,
      contact: updatedContact,
    };
  }

  if (intent === "create_booking") {
    return {
      ...(await executeCreateBooking(db, enrichedInput)),
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
