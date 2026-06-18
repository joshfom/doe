import { eq, desc } from "drizzle-orm";
import type { Database } from "../db";
import { aiConversations, aiMessages, otpRecords } from "../schema";
import {
  resolveIdentityByPhone,
  resolveIdentityByEmail,
  resolveIdentityBySession,
} from "./identity";
import type { IdentityResult } from "./identity";
import { detectLanguage } from "./language";
import { isWithinScope, loadScopeConfig } from "./scope";
import { processQuery } from "./rag";
import type { QueryResult } from "./rag";
import { bookAppointment, lookupClientAccount, lookupClientPayments } from "./actions";
import type { AccountSummary, ClientPaymentPlanSummary } from "./actions";
import type { ChatMessage } from "./gateway";
import { handleOtpGate } from "./otp";
import type { OtpVerificationState } from "./otp";
import { runAgent, loadConversationContact, detectIntent } from "./agent";
import type { AgentIntent, AgentInput, AgentResult } from "./agent";
// Migration_Switch (Requirements 7, 14). Imported from the switch module
// directly — NOT from the agents barrel (`../agents`) — because the barrel
// re-exports the Mastra runtime. `migration-switch.ts` pulls in no Mastra code
// (only the db + schema), so the public chat flow stays free of the Mastra
// runtime on the Next.js serverless route. The agent path itself is loaded
// lazily (dynamic import) only when a capability is actually routed to it.
import { serveCapability, type Capability } from "../agents/migration-switch";
import { getPostHogServer } from "@/lib/analytics/posthog-server";
import { hashIdentifier } from "@/lib/analytics/hash-identifier";
import type { AttributionData } from "@/lib/analytics/types";
import { captureChatLead } from "../leads/capture";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatInput {
  message: string;
  conversationId?: string;
  phone?: string;
  email?: string;
  userId?: string;
  /** Attribution data from the ora_attribution cookie, passed by the route handler. */
  attribution?: AttributionData | null;
}

export interface ChatResponse {
  message: string;
  conversationId: string;
  language: "en" | "ar";
  identityType: string;
  metadata?: {
    retrievedDocIds: string[];
    actionPerformed?: string;
  };
}

// ── Intent Detection ─────────────────────────────────────────────────────────

const BOOKING_KEYWORDS = ["book", "appointment", "schedule", "meeting"];
const ACCOUNT_KEYWORDS = ["my account", "my unit", "my status"];
const PAYMENT_KEYWORDS = [
  "payment",
  "installment",
  "instalment",
  "due",
  "invoice",
  "paid",
  "balance",
  "remaining",
  "down payment",
  "handover payment",
  "overdue",
  "دفعة",
  "دفعات",
  "قسط",
  "أقساط",
  "مدفوع",
  "مستحق",
  "متأخرة",
  "الرصيد",
  "الفاتورة",
];
const CAPABILITIES_KEYWORDS = [
  "what can you do",
  "what are your capabilities",
  "what do you do",
  "how can you help",
  "your capabilities",
  "ماذا يمكنك",
  "ماذا تستطيع",
  "ما هي قدراتك",
  "كيف يمكنك مساعدتي",
];

function detectBookingIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return BOOKING_KEYWORDS.some((kw) => lower.includes(kw));
}

function detectAccountIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return ACCOUNT_KEYWORDS.some((kw) => lower.includes(kw));
}

function detectPaymentIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return PAYMENT_KEYWORDS.some((kw) => lower.includes(kw));
}

function detectCapabilitiesIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return CAPABILITIES_KEYWORDS.some((kw) => lower.includes(kw));
}

const CAPABILITIES_REPLY_EN =
  "Here is the full capability set of the ORA AI assistant — useful as an internal demo overview:\n\n" +
  "**Knowledge & Information**\n" +
  "- Answer questions about ORA communities, projects, units, amenities, and policies using a vector-indexed knowledge base.\n" +
  "- Bilingual: detects English or Arabic per turn and replies in the same language without mixing.\n" +
  "- Stays strictly in scope — refuses off-topic or sensitive prompts and offers human handoff.\n\n" +
  "**Identity & Authentication**\n" +
  "- Captures name, email, and phone from natural conversation and persists them on the conversation.\n" +
  "- Resolves identity against `aiClients` and `aiTenants` tables and upgrades visitor → client/tenant on the fly.\n" +
  "- OTP flow on demand: generates a 6-digit code, hashes it (SHA-256), stores it with 5-minute expiry, and emails the plain code via Resend (`sendOtpEmail`).\n" +
  "- OTP verification gate (`handleOtpGate`) protects sensitive queries (account, payments, unit details).\n\n" +
  "**Account & Personalization (post-OTP)**\n" +
  "- Look up account, unit details, construction progress, handover dates.\n" +
  "- Tenant ↔ contractor disambiguation when the same email/phone has multiple roles.\n\n" +
  "**Service Tickets (deterministic tool, real DB writes)**\n" +
  "- Auto-detects intent: move-in / move-out / gate pass / vendor access / construction material delivery / NOC / general inquiry.\n" +
  "- Asks for missing required fields (name, email, phone) before creating the ticket.\n" +
  "- Calls `createTicket` and returns a real ticket number; logs an audit entry; emails status updates.\n\n" +
  "**Appointments**\n" +
  "- Detects booking intent (site visit, consultation, payment discussion, maintenance) and gathers details for handoff.\n\n" +
  "**Site Navigation**\n" +
  "- Returns clickable links to CMS pages — e.g. \"take me to contact\" → looks up the published page in the current locale and replies with `[Title](/en/contact)`.\n" +
  "- Falls back to the LLM when the page can't be found.\n\n" +
  "**Human Handoff**\n" +
  "- `escalateSensitiveQuery` and `initiateHandoff` route the conversation to a human agent with full transcript context.\n\n" +
  "**Observability & Safety**\n" +
  "- Every conversation, message, OTP attempt, and ticket write is persisted in Postgres with audit logging.\n" +
  "- Cloudflare AI Gateway proxies all LLM + embedding calls (Workers AI Llama 3.1/3.3, BGE embeddings).\n\n" +
  "Try saying: *\"open a move-in ticket\"*, *\"send me the OTP\"*, or *\"take me to the contact page\"*.";

const CAPABILITIES_REPLY_AR =
  "هذه القائمة الكاملة لقدرات مساعد ORA الذكي — مخصصة للعرض التجريبي الداخلي:\n\n" +
  "**المعرفة والمعلومات**\n" +
  "- الإجابة عن الأسئلة حول مجتمعات ومشاريع ووحدات ومرافق وسياسات ORA باستخدام قاعدة معرفية مفهرسة.\n" +
  "- ثنائي اللغة: يكتشف الإنجليزية أو العربية ويرد بنفس اللغة دون خلط.\n" +
  "- يبقى ضمن النطاق فقط — يرفض الأسئلة الخارجة عن الموضوع ويعرض التحويل إلى موظف بشري.\n\n" +
  "**الهوية والتحقق**\n" +
  "- يلتقط الاسم والبريد والهاتف من المحادثة ويحفظها على سجل المحادثة.\n" +
  "- يطابق الهوية مع جداول العملاء والمستأجرين ويحدّث الزائر إلى عميل/مستأجر تلقائياً.\n" +
  "- إرسال رمز OTP مكوّن من ٦ أرقام (مشفّر SHA-256، صلاحية ٥ دقائق) عبر البريد.\n" +
  "- بوابة تحقّق OTP تحمي الاستعلامات الحساسة (الحساب، الدفعات، تفاصيل الوحدة).\n\n" +
  "**الحساب والتخصيص (بعد التحقق)**\n" +
  "- الاطلاع على الحساب، تفاصيل الوحدة، تقدّم الإنشاء، وتواريخ التسليم.\n" +
  "- التمييز بين المستأجر والمقاول عند تطابق البريد/الهاتف لأكثر من دور.\n\n" +
  "**تذاكر الخدمة (أداة فعلية تكتب على قاعدة البيانات)**\n" +
  "- اكتشاف نوع الطلب تلقائياً: انتقال للداخل/الخارج، تصريح بوابة، دخول موردين، توصيل مواد بناء، شهادات عدم ممانعة، استفسار عام.\n" +
  "- طلب الحقول الناقصة (الاسم، البريد، الهاتف) قبل فتح التذكرة.\n" +
  "- استدعاء `createTicket` وإرجاع رقم تذكرة حقيقي مع تسجيل تدقيقي وإشعار بريدي.\n\n" +
  "**المواعيد**\n" +
  "- اكتشاف نية الحجز (زيارة موقع، استشارة، مناقشة دفع، صيانة) وجمع التفاصيل للتحويل.\n\n" +
  "**التنقل في الموقع**\n" +
  "- إرجاع روابط قابلة للنقر لصفحات CMS — مثل \"خذني إلى صفحة اتصل بنا\" يبحث في الصفحات المنشورة ويرسل `[العنوان](/ar/contact)`.\n\n" +
  "**التحويل البشري**\n" +
  "- `escalateSensitiveQuery` و `initiateHandoff` يحوّلان المحادثة لموظف بشري مع كامل السياق.\n\n" +
  "**المراقبة والأمان**\n" +
  "- كل محادثة ورسالة ومحاولة OTP وكتابة تذكرة محفوظة في Postgres مع تدقيق.\n" +
  "- جميع نداءات النموذج عبر Cloudflare AI Gateway (Workers AI Llama 3.1/3.3 و BGE).\n\n" +
  "جرّب: *\"افتح تذكرة انتقال\"*، *\"أرسل لي رمز التحقق\"*، أو *\"خذني إلى صفحة اتصل بنا\"*.";

// ── Migration_Switch: text intent → migrated Capability ──────────────────────

/**
 * Maps a deterministic {@link AgentIntent} to the Migration_Switch
 * {@link Capability} that may serve it via the Mastra text agent. Only the ten
 * migrated text capabilities (Requirement 8.1) are mappable; control intents
 * (`confirm_pending`, `decline_pending`, `none`) have no agent equivalent and
 * always run the deterministic path.
 *
 * The migration order itself is governed per-capability by the
 * `agent_migration_flags` table (decisions.md Decision 5); this map only says
 * which capability a turn is about. With every flag defaulting to deterministic,
 * `serveCapability` runs `runAgent` and never loads the Mastra runtime.
 */
const INTENT_TO_CAPABILITY: Partial<Record<AgentIntent, Capability>> = {
  create_lead: "create_lead",
  register_lead: "register_lead",
  create_ticket: "create_ticket",
  create_booking: "create_booking",
  cancel_appointment: "cancel_appointment",
  reschedule_appointment: "reschedule_appointment",
  request_otp: "request_otp",
  request_handover: "request_handover",
  navigate: "navigate",
  provide_contact: "provide_contact",
};

// ── handleChatMessage ────────────────────────────────────────────────────────

/**
 * Orchestrates the full chat flow:
 * 1. Load or create conversation
 * 2. Resolve identity
 * 3. Detect language
 * 4. Update conversation with identity and language
 * 5. Check scope boundary
 * 6. Detect action intents and augment context
 * 7. Process query through RAG pipeline
 * 8. Persist user message and assistant response
 * 9. Return response with metadata
 *
 * DATA ISOLATION GUARANTEE:
 * Personalized data (client records, tenant records, unit details) is ONLY
 * injected into the RAG context when the user's identity is confirmed
 * (identity.type !== "visitor"). Unidentified users receive only public
 * knowledge base content. Account lookup (Step 6) is gated behind an
 * identity check, ensuring no client/tenant data leaks to anonymous visitors.
 * Admin access to client/tenant/conversation data is separately protected
 * by identityGuard + requirePermission middleware on all /api/ai/* admin
 * routes, with audit logging via logAudit on every write operation.
 */
export async function handleChatMessage(
  db: Database,
  input: ChatInput
): Promise<ChatResponse> {
  const result = await handleChatMessageInner(db, input);
  // Best-effort: keep an at-a-glance summary of where the conversation is
  // for the admin panel and human handover.
  try {
    const { writeConversationSummary } = await import("./conversation-summary");
    await writeConversationSummary(db, {
      conversationId: result.conversationId,
      identityType:
        (result.identityType as "client" | "tenant" | "visitor") ?? "visitor",
      lastUserMessage: input.message,
      lastAssistantMessage: result.message,
      actionPerformed: result.metadata?.actionPerformed ?? undefined,
    });
  } catch (err) {
    console.error("[chat] summary write failed", err);
  }
  return result;
}

async function handleChatMessageInner(
  db: Database,
  input: ChatInput
): Promise<ChatResponse> {
  // ── Step 1: Load or create conversation ──────────────────────────────────
  let conversationId = input.conversationId;
  let conversationHistory: ChatMessage[] = [];
  let otpVerificationState: OtpVerificationState = "not_required";

  if (conversationId) {
    // Load existing conversation
    const [existing] = await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.id, conversationId))
      .limit(1);

    if (!existing) {
      // Conversation not found — create a new one
      conversationId = undefined;
    } else {
      // Capture OTP verification state from the loaded conversation
      otpVerificationState =
        (existing.otpVerificationState as OtpVerificationState) ?? "not_required";

      // ── OTP session timeout ─────────────────────────────────────────────
      // Verification is sticky for OTP_SESSION_TTL_MINUTES (20). After that
      // the user must re-verify. Without this, a stale tab from yesterday
      // would still bypass the gate. Implementation: pull the most recent
      // `verifiedAt` from otpRecords for this conversation and downgrade
      // the state to "expired" if it's older than the TTL.
      if (otpVerificationState === "verified") {
        const OTP_SESSION_TTL_MINUTES = 20;
        const [latestVerified] = await db
          .select({ verifiedAt: otpRecords.verifiedAt })
          .from(otpRecords)
          .where(eq(otpRecords.conversationId, conversationId!))
          .orderBy(desc(otpRecords.verifiedAt))
          .limit(1);

        const verifiedAt = latestVerified?.verifiedAt;
        if (verifiedAt) {
          const ageMs = Date.now() - new Date(verifiedAt).getTime();
          if (ageMs > OTP_SESSION_TTL_MINUTES * 60 * 1000) {
            otpVerificationState = "expired";
            await db
              .update(aiConversations)
              .set({ otpVerificationState: "expired", updatedAt: new Date() })
              .where(eq(aiConversations.id, conversationId!));
          }
        }
      }

      // Load recent messages (up to 30) for context. We then trim by an
      // approximate character budget so we don't blow past model context
      // limits as the conversation grows over many days.
      const HISTORY_LIMIT = 30;
      const HISTORY_CHAR_BUDGET = 12_000; // ~3k tokens, leaves room for RAG + system prompt

      const messages = await db
        .select({
          role: aiMessages.role,
          content: aiMessages.content,
          createdAt: aiMessages.createdAt,
        })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, conversationId!))
        .orderBy(desc(aiMessages.createdAt))
        .limit(HISTORY_LIMIT);

      // messages is newest-first. Walk newest → oldest, accumulating up to
      // the char budget, then reverse to get chronological order.
      let usedChars = 0;
      const kept: typeof messages = [];
      for (const m of messages) {
        const cost = m.content.length;
        if (kept.length > 0 && usedChars + cost > HISTORY_CHAR_BUDGET) break;
        kept.push(m);
        usedChars += cost;
      }
      kept.reverse();

      conversationHistory = kept.map((m) => ({
        role: m.role as ChatMessage["role"],
        content: m.content,
      }));

      // Welcome-back hint: if there are prior messages and the last one
      // is older than 12h, give the assistant a nudge to acknowledge the
      // return without sounding generic. We inject this as a system message
      // at the start of the kept history so it has the highest precedence
      // among the conversation context but does not pollute the user-visible
      // transcript.
      if (kept.length > 0) {
        const lastCreatedAt = kept[kept.length - 1].createdAt;
        const lastTs = lastCreatedAt instanceof Date ? lastCreatedAt.getTime() : null;
        if (lastTs !== null) {
          const gapMs = Date.now() - lastTs;
          const TWELVE_HOURS = 12 * 60 * 60 * 1000;
          if (gapMs > TWELVE_HOURS) {
            const hours = Math.round(gapMs / (60 * 60 * 1000));
            const days = Math.round(gapMs / (24 * 60 * 60 * 1000));
            const gapLabel =
              days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : `${hours} hour${hours === 1 ? "" : "s"}`;
            conversationHistory.unshift({
              role: "system",
              content:
                `(Internal note: this user is returning after ${gapLabel} away. ` +
                `If their last open thread is still relevant — a ticket, a permit, an OTP step, ` +
                `an unanswered question — briefly acknowledge it and offer to follow up before answering ` +
                `the new question. Don't be generic; reference the specific thing they were working on.)`,
            });
          }
        }
      }
    }
  }

  if (!conversationId) {
    // Create a new conversation (otpVerificationState defaults to "not_required")
    const [newConversation] = await db
      .insert(aiConversations)
      .values({
        participantPhone: input.phone ?? null,
        participantEmail: input.email ?? null,
        participantType: "visitor",
        channel: "web",
        language: "en",
        status: "active",
      })
      .returning({ id: aiConversations.id });

    conversationId = newConversation.id;

    // Task 19.1: Capture ai_conversation_started on first message
    try {
      const posthog = getPostHogServer();
      if (posthog) {
        const attribution = input.attribution;
        posthog.capture({
          distinctId: input.email ? hashIdentifier(input.email) : input.phone ? hashIdentifier(input.phone) : conversationId,
          event: "ai_conversation_started",
          properties: {
            conversationId,
            ...(attribution?.first_touch && {
              first_touch_source: attribution.first_touch.utm_source,
              first_touch_medium: attribution.first_touch.utm_medium,
              first_touch_campaign: attribution.first_touch.utm_campaign,
            }),
            ...(attribution?.last_touch && {
              last_touch_source: attribution.last_touch.utm_source,
              last_touch_medium: attribution.last_touch.utm_medium,
              last_touch_campaign: attribution.last_touch.utm_campaign,
            }),
            ...(attribution?.last_touch?.utm_campaign && {
              utm_campaign: attribution.last_touch.utm_campaign,
            }),
          },
        });
      }
    } catch (err) {
      console.error("[chat] ai_conversation_started capture failed", err);
    }

    // ── Lead Engine capture ──────────────────────────────────────────────
    // The marketing-site chat popup is a lead source: route the opening enquiry
    // into the durable inbound_leads ledger so it becomes a first-class lead in
    // the Lead Engine. Fire-and-forget + idempotent by conversation id (exactly
    // one lead per conversation) — it never blocks or fails the chat turn.
    void captureChatLead(db, {
      conversationId,
      message: input.message,
      email: input.email,
      phone: input.phone,
      attribution: input.attribution,
    });
  }

  // ── Step 2: Resolve identity ─────────────────────────────────────────────
  let identity: IdentityResult = { type: "visitor", units: [] };

  if (input.userId) {
    identity = await resolveIdentityBySession(db, input.userId);
  } else if (input.phone) {
    identity = await resolveIdentityByPhone(db, input.phone);
  } else if (input.email) {
    identity = await resolveIdentityByEmail(db, input.email);
  }

  // Fallback: if no request-level identity, use whatever email/phone was
  // captured on this conversation in a previous turn (the agent persists
  // these as soon as the user types them). Without this fallback every
  // follow-up turn looks like a fresh visitor and the OTP gate stops
  // protecting personal data.
  if (identity.type === "visitor") {
    const storedContact = await loadConversationContact(db, conversationId);
    if (storedContact.email) {
      identity = await resolveIdentityByEmail(db, storedContact.email);
    } else if (storedContact.phone) {
      identity = await resolveIdentityByPhone(db, storedContact.phone);
    }
  }

  // ── Step 3: Detect language ──────────────────────────────────────────────
  const language = detectLanguage(input.message);

  // ── Step 4: Update conversation with identity and language ───────────────
  const updateData: Record<string, unknown> = {
    language,
    updatedAt: new Date(),
  };

  if (identity.type !== "visitor") {
    updateData.participantType = identity.type;
    updateData.participantName = identity.firstName ?? null;
    if (identity.clientId) {
      updateData.clientId = identity.clientId;
    }
    if (identity.tenantId) {
      updateData.tenantId = identity.tenantId;
    }
  }

  await db
    .update(aiConversations)
    .set(updateData)
    .where(eq(aiConversations.id, conversationId));

  // ── Step 5: Check scope boundary ─────────────────────────────────────────
  const scopeConfig = await loadScopeConfig(db);
  const inScope = isWithinScope(input.message, scopeConfig);

  if (!inScope) {
    const declineMessage =
      language === "ar"
        ? "عذراً، هذا السؤال خارج نطاق خدمات ORA. يمكنني مساعدتك في الاستفسارات المتعلقة بالعقارات والمجتمعات والخدمات التي نقدمها."
        : "I'm sorry, that question is outside the scope of ORA services. I can help you with inquiries related to our real estate properties, communities, and services.";

    // Persist user message and decline response
    await db.insert(aiMessages).values([
      {
        conversationId,
        role: "user",
        content: input.message,
      },
      {
        conversationId,
        role: "assistant",
        content: declineMessage,
        metadata: { outOfScope: true },
      },
    ]);

    return {
      message: declineMessage,
      conversationId,
      language,
      identityType: identity.type,
      metadata: {
        retrievedDocIds: [],
      },
    };
  }

  // ── Step 5.5: Agent tool dispatch (must run BEFORE the OTP gate) ──────────
  // The agent extracts name/email/phone from the user's message, persists
  // them on the conversation, upgrades the identity from visitor → client/
  // tenant on the fly, and executes deterministic tools (create ticket,
  // send OTP, navigate). Running this BEFORE the OTP gate is critical:
  // otherwise a freshly-typed email looks like a "general" message to the
  // gate, identity stays "visitor", and personal data leaks through RAG.
  const previousIdentityType = identity.type;
  const conversationContact = await loadConversationContact(db, conversationId);
  const agentInput: AgentInput = {
    conversationId,
    message: input.message,
    history: conversationHistory,
    identity,
    language,
    contact: conversationContact,
    attribution: input.attribution,
  };

  // Migration_Switch (Requirements 7, 8, 14): when the detected text intent maps
  // to a migrated Capability, route it through `serveCapability`. With the
  // capability's `agent_migration_flags` row defaulting to deterministic, this
  // runs the existing `runAgent` and never touches the Mastra runtime; only a
  // capability flagged `mode = "agent" && enabled` is served by the text agent,
  // and any agent-path error falls back to `runAgent` for that capability
  // (Requirements 7.2, 7.3, 14.2, 14.3). The agent path is imported lazily
  // (dynamic `import`) so Mastra is never bundled onto the Next.js serverless
  // route (Requirement 15.3).
  const capability = INTENT_TO_CAPABILITY[detectIntent(input.message)];
  const agentResult: AgentResult = capability
    ? await serveCapability(
        db,
        capability,
        async () => {
          const { runTextAgentTurn } = await import("../agents/text-agent");
          return runTextAgentTurn(
            db,
            {
              conversationId,
              message: input.message,
              history: conversationHistory,
              identity,
              language,
              contact: conversationContact,
            },
            capability,
          );
        },
        () => runAgent(db, agentInput),
      )
    : await runAgent(db, agentInput);

  // Upgrade the working identity if the agent learned more about the user.
  if (agentResult.identity) {
    identity = agentResult.identity;
  }

  if (agentResult.handled && agentResult.response) {
    await db.insert(aiMessages).values([
      { conversationId, role: "user", content: input.message },
      {
        conversationId,
        role: "assistant",
        content: agentResult.response,
        metadata: {
          agent: true,
          ...(agentResult.metadata ?? {}),
        },
      },
    ]);

    return {
      message: agentResult.response,
      conversationId,
      language,
      identityType: identity.type,
      metadata: {
        retrievedDocIds: [],
        actionPerformed: (agentResult.metadata?.intent as string) ?? "agent_tool",
      },
    };
  }

  // If the agent just upgraded a visitor to a recognized client/tenant
  // (because they typed their email or phone), greet them by name and offer
  // OTP before answering anything personal. This stops the worst leak: bot
  // confirming "you have unit B-101 at Marina Heights" purely because the
  // user said "jfomubod@example.com".
  if (
    previousIdentityType === "visitor" &&
    identity.type !== "visitor" &&
    otpVerificationState !== "verified"
  ) {
    const firstName = identity.firstName ?? "there";
    const greeting =
      language === "ar"
        ? `${firstName}، سعيد بعودتك! \u{1F642} \u062f\u0639\u0646\u064a \u0623\u062a\u062d\u0642\u0642 \u0623\u0646\u0647 \u0623\u0646\u062a \u0641\u0639\u0644\u0627\u064b \u0642\u0628\u0644 \u0623\u0646 \u0623\u0641\u062a\u062d \u062a\u0641\u0627\u0635\u064a\u0644 \u062d\u0633\u0627\u0628\u0643 \u2014 \u0627\u0644\u062e\u0635\u0648\u0635\u064a\u0629 \u0623\u0648\u0644\u0627\u064b. \u0647\u0644 \u0623\u0631\u0633\u0644 \u0644\u0643 \u0631\u0645\u0632 \u062a\u062d\u0642\u0642 \u0639\u0644\u0649 \u0628\u0631\u064a\u062f\u0643 \u0627\u0644\u0645\u0633\u062c\u0644\u061f \u0628\u0625\u0645\u0643\u0627\u0646\u0643 \u0627\u0644\u0627\u0633\u062a\u0645\u0631\u0627\u0631 \u0628\u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0639\u0627\u0645\u0629 \u062f\u0648\u0646 \u062a\u062d\u0642\u0642.`
        : `${firstName}, great to see you again! Before I open up account details, I just need to make sure it's really you — privacy first. Want me to send a quick verification code to your registered email? Happy to keep answering general questions in the meantime.`;

    await db.insert(aiMessages).values([
      { conversationId, role: "user", content: input.message },
      {
        conversationId,
        role: "assistant",
        content: greeting,
        metadata: { agent: true, identityUpgrade: true, awaitingOtp: true },
      },
    ]);

    return {
      message: greeting,
      conversationId,
      language,
      identityType: identity.type,
      metadata: { retrievedDocIds: [], actionPerformed: "identity_upgrade" },
    };
  }

  // ── Step 5.6: OTP verification gate ───────────────────────────────────────
  const otpGateResult = await handleOtpGate(
    db,
    conversationId,
    input.message,
    identity,
    language,
    otpVerificationState
  );

  if (otpGateResult.action === "respond") {
    // If the gate just succeeded verification AND there's a buffered personal
    // question waiting to be answered, run RAG against the buffered question
    // and append the answer to the "You're verified! ✓" preface so the user
    // doesn't have to retype.
    if (otpGateResult.pendingQuery) {
      // Refresh OTP state — gate just flipped it to "verified"
      otpVerificationState = "verified";

      // Refresh identity (post-verify we want full unit lookup)
      const verifiedAccount = await lookupClientAccount(db, identity);
      const verifiedIdentity: IdentityResult = verifiedAccount
        ? { ...identity, units: verifiedAccount.units }
        : identity;

      try {
        const rag = await processQuery(db, {
          query: otpGateResult.pendingQuery,
          language,
          conversationHistory,
          identityContext: verifiedIdentity,
          otpVerified: true,
          analyticsContext: {
            distinctId: conversationId!,
            traceId: conversationId!,
            conversationId: conversationId!,
          },
        });

        const combined = `${otpGateResult.response!}\n\n${rag.response}`;

        await db.insert(aiMessages).values([
          { conversationId, role: "user", content: input.message },
          {
            conversationId,
            role: "assistant",
            content: combined,
            metadata: {
              otpGate: true,
              queryCategory: otpGateResult.queryCategory,
              replayedQuery: otpGateResult.pendingQuery,
            },
          },
        ]);

        return {
          message: combined,
          conversationId,
          language,
          identityType: verifiedIdentity.type,
          metadata: {
            retrievedDocIds: rag.retrievedDocuments.map((d) => d.documentId),
            actionPerformed: "otp_verified_and_replay",
          },
        };
      } catch (err) {
        console.error("[chat] Replay after OTP verify failed", err);
        // Fall through to plain verified response below
      }
    }

    // OTP gate intercepted — persist user message and gate response, return early
    await db.insert(aiMessages).values([
      {
        conversationId,
        role: "user",
        content: input.message,
      },
      {
        conversationId,
        role: "assistant",
        content: otpGateResult.response!,
        metadata: { otpGate: true, queryCategory: otpGateResult.queryCategory },
      },
    ]);

    return {
      message: otpGateResult.response!,
      conversationId,
      language,
      identityType: identity.type,
      metadata: {
        retrievedDocIds: [],
      },
    };
  }

  // ── Step 6: Detect action intents and augment context ────────────────────
  let actionPerformed: string | undefined;
  let accountContext: AccountSummary | undefined;
  let paymentContext: ClientPaymentPlanSummary[] | undefined;

  // Fast-path: capabilities question — no need to call the LLM.
  if (detectCapabilitiesIntent(input.message)) {
    const capabilitiesReply =
      language === "ar" ? CAPABILITIES_REPLY_AR : CAPABILITIES_REPLY_EN;

    await db.insert(aiMessages).values([
      { conversationId, role: "user", content: input.message },
      {
        conversationId,
        role: "assistant",
        content: capabilitiesReply,
        metadata: { actionPerformed: "capabilities_reply" },
      },
    ]);

    return {
      message: capabilitiesReply,
      conversationId,
      language,
      identityType: identity.type,
      metadata: { retrievedDocIds: [], actionPerformed: "capabilities_reply" },
    };
  }

  if (detectBookingIntent(input.message)) {
    // Don't auto-book — acknowledge intent and ask for details
    actionPerformed = "booking_intent_detected";
  }

  if (
    detectAccountIntent(input.message) &&
    identity.type !== "visitor"
  ) {
    // Augment with account data
    accountContext = await lookupClientAccount(db, identity);
    actionPerformed = actionPerformed
      ? `${actionPerformed},account_lookup`
      : "account_lookup";
  }

  // Payment lookup: only for verified clients asking about payments. The
  // OTP gate above ensures payment questions cannot reach this point unless
  // the user has already verified their identity.
  if (
    detectPaymentIntent(input.message) &&
    identity.type === "client" &&
    identity.clientId &&
    otpVerificationState === "verified"
  ) {
    paymentContext = await lookupClientPayments(db, identity.clientId);
    if (paymentContext.length > 0) {
      actionPerformed = actionPerformed
        ? `${actionPerformed},payment_lookup`
        : "payment_lookup";
    }
  }

  // ── Step 7: Process query through RAG pipeline ───────────────────────────
  // Build identity context with account data if available
  const identityContext: IdentityResult = accountContext
    ? {
        ...identity,
        units: accountContext.units,
      }
    : identity;

  const ragResult: QueryResult = await processQuery(db, {
    query: input.message,
    language,
    conversationHistory,
    identityContext,
    paymentContext,
    otpVerified: otpVerificationState === "verified",
    analyticsContext: {
      distinctId: conversationId!,
      traceId: conversationId!,
      conversationId: conversationId!,
    },
  });

  // Build response (no user-visible source attribution — internal metadata only)
  const responseMessage = ragResult.response;
  const retrievedDocIds = ragResult.retrievedDocuments.map((d) => d.documentId);

  // ── Step 8: Persist user message and assistant response ──────────────────
  await db.insert(aiMessages).values([
    {
      conversationId,
      role: "user",
      content: input.message,
    },
    {
      conversationId,
      role: "assistant",
      content: responseMessage,
      metadata: {
        retrievedDocIds,
        similarityScores: ragResult.retrievedDocuments.map((d) => d.similarity),
        actionPerformed: actionPerformed ?? null,
      },
    },
  ]);

  // ── Step 9: Return response ──────────────────────────────────────────────
  return {
    message: responseMessage,
    conversationId,
    language,
    identityType: identity.type,
    metadata: {
      retrievedDocIds,
      actionPerformed,
    },
  };
}
