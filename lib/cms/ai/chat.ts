import { eq, desc } from "drizzle-orm";
import type { Database } from "../db";
import { aiConversations, aiMessages } from "../schema";
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
import { bookAppointment, lookupClientAccount } from "./actions";
import type { AccountSummary } from "./actions";
import type { ChatMessage } from "./gateway";
import { handleOtpGate } from "./otp";
import type { OtpVerificationState } from "./otp";
import { runAgent, loadConversationContact } from "./agent";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatInput {
  message: string;
  conversationId?: string;
  phone?: string;
  email?: string;
  userId?: string;
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

  // ── Step 5.5: OTP verification gate ───────────────────────────────────────
  const otpGateResult = await handleOtpGate(
    db,
    conversationId,
    input.message,
    identity,
    language,
    otpVerificationState
  );

  if (otpGateResult.action === "respond") {
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

  // ── Step 5.75: Agent tool dispatch ────────────────────────────────────────
  // Lightweight agent that captures identity (name/email/phone) from the
  // user's message and executes deterministic tools (create ticket, send
  // OTP) before falling through to RAG. This is what makes the assistant
  // actually agentic — no LLM tool-calling JSON needed.
  const conversationContact = await loadConversationContact(db, conversationId);
  const agentResult = await runAgent(db, {
    conversationId,
    message: input.message,
    history: conversationHistory,
    identity,
    language,
    contact: conversationContact,
  });

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

  // ── Step 6: Detect action intents and augment context ────────────────────
  let actionPerformed: string | undefined;
  let accountContext: AccountSummary | undefined;

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
