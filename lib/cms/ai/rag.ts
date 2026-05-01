import { sql } from "drizzle-orm";
import type { Database } from "../db";
import type { ChatMessage } from "./gateway";
import { generateEmbedding, generateCompletion } from "./gateway";
import type { IdentityResult } from "./identity";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RetrievedDocument {
  id: string;
  documentId: string;
  title: string;
  chunkText: string;
  chunkIndex: number;
  locale: string;
  category: string | null;
  similarity: number;
}

export interface RAGContext {
  retrievedDocuments: RetrievedDocument[];
  conversationHistory: ChatMessage[];
  identityContext: IdentityResult | null;
  language: "en" | "ar";
  currentQuery: string;
}

export interface QueryInput {
  query: string;
  language: "en" | "ar";
  conversationHistory?: ChatMessage[];
  identityContext?: IdentityResult | null;
  topK?: number;
  threshold?: number;
}

export interface QueryResult {
  response: string;
  retrievedDocuments: RetrievedDocument[];
  language: "en" | "ar";
}

// ── retrieveContext ──────────────────────────────────────────────────────────

/**
 * Generates a query embedding and performs pgvector similarity search against
 * the knowledge_embeddings table joined with knowledge_documents.
 *
 * Results are filtered by the relevance threshold and ordered so that
 * documents matching the conversation language appear first, with
 * other-locale documents included as fallback.
 */
export async function retrieveContext(
  db: Database,
  query: string,
  language: "en" | "ar",
  topK: number,
  threshold: number
): Promise<RetrievedDocument[]> {
  const queryEmbedding = await generateEmbedding(query);

  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const results = await db.execute(sql`
    SELECT
      ke.id,
      ke.document_id AS "documentId",
      kd.title,
      ke.chunk_text AS "chunkText",
      ke.chunk_index AS "chunkIndex",
      kd.locale,
      kd.category,
      1 - (ke.embedding <=> ${embeddingStr}::vector) AS similarity
    FROM knowledge_embeddings ke
    JOIN knowledge_documents kd ON kd.id = ke.document_id
    WHERE 1 - (ke.embedding <=> ${embeddingStr}::vector) >= ${threshold}
    ORDER BY
      CASE WHEN kd.locale = ${language} THEN 0 ELSE 1 END,
      similarity DESC
    LIMIT ${topK}
  `);

  const documents: RetrievedDocument[] = (results.rows as any[]).map(
    (row: any) => ({
      id: row.id,
      documentId: row.documentId,
      title: row.title,
      chunkText: row.chunkText,
      chunkIndex: row.chunkIndex,
      locale: row.locale,
      category: row.category,
      similarity: Number(row.similarity),
    })
  );

  // Log retrieved document IDs and similarity scores
  console.log(
    "[RAG] Retrieved documents:",
    documents.map((d) => ({
      documentId: d.documentId,
      title: d.title,
      similarity: d.similarity.toFixed(4),
    }))
  );

  return documents;
}

// ── buildPrompt ──────────────────────────────────────────────────────────────

/**
 * Constructs the LLM prompt with system instructions, retrieved documents,
 * conversation history, user identity context, and the current query.
 */
export function buildPrompt(context: RAGContext): string {
  const parts: string[] = [];

  // System instructions — ORA Jarvis persona
  parts.push(
    "You are ORA AI — the in-house concierge for ORA Developers. " +
      "Think of yourself as a calm, capable Jarvis-style assistant: warm, lightly witty, " +
      "always respectful, and never sleazy or over-familiar. Use a regional touch sparingly " +
      "(e.g. \"yalla\", \"of course\") only when it fits the moment. Keep replies concise."
  );
  parts.push(
    "GROUND RULES:\n" +
      "- Answer using the provided knowledge base context and the user's account data only.\n" +
      "- If the answer is not in the context, say so honestly and offer to connect a human agent.\n" +
      "- Never invent prices, payment plans, handover dates, legal terms, or contractual figures.\n" +
      "- Never give legal, tax, or investment advice. Defer to the relevant ORA team.\n" +
      "- Treat any out-of-band payment request (links, wallets, crypto) as fraud — warn the user.\n" +
      "- Personal/account/payment data requires verified identity; if not verified, ask politely.\n" +
      "- Never mention \"sources\", \"context\", \"knowledge base\", \"documents\", or quote internal labels — " +
      "speak naturally as if the information is your own.\n" +
      "- Do NOT mix languages in a single reply. Match the language of the user's latest message exactly. " +
      "If the user wrote English, reply 100% in English with NO Arabic words, including greetings (no \"مرحبا\", no \"يا\"). " +
      "If the user wrote Arabic, reply 100% in Arabic."
  );
  parts.push(
    "TICKET / PERMIT FLOW (very important):\n" +
      "- Before creating any ticket, sending any email, or scheduling anything, you MUST first collect " +
      "the requester's identity in this order: full name, email address, mobile phone number. \n" +
      "- Never claim to have sent an OTP or email unless the user explicitly received and confirmed it. " +
      "You do not send OTPs yourself — only confirm what has actually happened.\n" +
      "- Move-in permits apply ONLY when a community is handed over and the requester is the tenant or owner " +
      "of a delivered unit. If the project is still under construction, a move-in permit is NOT valid yet.\n" +
      "- If a user asks for a move-in permit during construction phase, clarify: are you (a) the tenant/owner " +
      "of an already-handed-over unit, or (b) a contractor / delivery company bringing construction materials " +
      "or workers to the site? Then route them to the right ticket: 'move_in' for handed-over units, " +
      "'construction_material_delivery' or 'vendor_access' for contractors and material trucks.\n" +
      "- For contractor / construction deliveries, collect: company name, contact person, email, phone, " +
      "vehicle plate numbers, materials being delivered, requested date and time window, and the " +
      "destination unit / plot. A human approver signs off before access is granted.\n" +
      "- For tenant move-in, collect: full name, email, phone, unit number, move date, mover company name, " +
      "and truck plate numbers. Confirm the unit is handed over before promising approval."
  );
  parts.push(
    "CAPABILITIES YOU CAN OFFER:\n" +
      "- Answer questions about ORA communities, projects, units, amenities, and policies.\n" +
      "- Look up the user's own account, units, construction progress, and handover info (after OTP).\n" +
      "- Book site visits, consultations, payment discussions, or maintenance appointments.\n" +
      "- Open a service ticket, including permits: move-in, move-out, gate pass, vendor access,\n" +
      "  construction material delivery, technician visits, NOC. Contractors are welcome — collect\n" +
      "  contractor details, vehicles, materials, and dates so a human can approve.\n" +
      "- Hand off to a human owner when the request is sensitive or out of scope."
  );

  if (context.language === "ar") {
    parts.push(
      "Respond in Arabic only. Do not include any English words, English greetings, or Latin script. " +
        "Use clear modern standard Arabic with light, professional warmth."
    );
  } else {
    parts.push(
      "Respond in English only. Do not include any Arabic words or Arabic script — no \"مرحبا\", no \"يا\", " +
        "no transliterations like \"yalla\" unless the user used it first. Professional, friendly tone."
    );
  }

  // Identity context
  if (context.identityContext && context.identityContext.type !== "visitor") {
    const identity = context.identityContext;
    parts.push("");
    parts.push("--- User Identity ---");
    parts.push(`Type: ${identity.type}`);
    if (identity.firstName) {
      parts.push(`Name: ${identity.firstName}`);
    }
    if (identity.units.length > 0) {
      parts.push("Associated Units:");
      for (const unit of identity.units) {
        parts.push(
          `  - ${unit.projectName} ${unit.unitNumber} (${unit.unitType}, Status: ${unit.status}` +
            (unit.constructionProgress != null
              ? `, Progress: ${unit.constructionProgress}%`
              : "") +
            (unit.estimatedHandoverDate
              ? `, Handover: ${unit.estimatedHandoverDate}`
              : "") +
            ")"
        );
      }
    }
  }

  // Retrieved documents
  if (context.retrievedDocuments.length > 0) {
    parts.push("");
    parts.push("--- Knowledge Base Context ---");
    for (const doc of context.retrievedDocuments) {
      parts.push(`[Source: ${doc.title}]`);
      parts.push(doc.chunkText);
      parts.push("");
    }
  }

  // Conversation history
  if (context.conversationHistory.length > 0) {
    parts.push("");
    parts.push("--- Conversation History ---");
    for (const msg of context.conversationHistory) {
      const label = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
      parts.push(`${label}: ${msg.content}`);
    }
  }

  // Current query
  parts.push("");
  parts.push("--- Current Query ---");
  parts.push(context.currentQuery);

  return parts.join("\n");
}

// ── processQuery ─────────────────────────────────────────────────────────────

/**
 * Orchestrates the full RAG pipeline:
 * 1. Embed the query
 * 2. Retrieve relevant context documents
 * 3. Build the prompt with context, history, and identity
 * 4. Generate a completion from the LLM
 * 5. Return the response with metadata
 */
export async function processQuery(
  db: Database,
  input: QueryInput
): Promise<QueryResult> {
  const topK = input.topK ?? 5;
  const threshold = input.threshold ?? 0.5;

  // Step 1 & 2: Retrieve context (embedding is generated inside retrieveContext)
  const retrievedDocuments = await retrieveContext(
    db,
    input.query,
    input.language,
    topK,
    threshold
  );

  // Step 3: Build the prompt
  const ragContext: RAGContext = {
    retrievedDocuments,
    conversationHistory: input.conversationHistory ?? [],
    identityContext: input.identityContext ?? null,
    language: input.language,
    currentQuery: input.query,
  };

  const prompt = buildPrompt(ragContext);

  // Step 4: Generate completion
  const messages: ChatMessage[] = [
    { role: "system", content: prompt },
    { role: "user", content: input.query },
  ];

  const response = await generateCompletion(messages);

  // Step 5: Return result with metadata
  return {
    response,
    retrievedDocuments,
    language: input.language,
  };
}
