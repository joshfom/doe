import { Elysia } from "elysia";
import { db } from "../../db";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import { aiConversations, aiMessages } from "../../schema";
import { eq, desc, and, like, sql, count } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildConversationFilters(query: Record<string, string | undefined>) {
  const conditions = [];

  if (query.status) {
    conditions.push(
      eq(
        aiConversations.status,
        query.status as "active" | "resolved" | "handed_off" | "abandoned"
      )
    );
  }

  if (query.channel) {
    conditions.push(eq(aiConversations.channel, query.channel));
  }

  if (query.dateFrom) {
    conditions.push(
      sql`${aiConversations.createdAt} >= ${new Date(query.dateFrom)}`
    );
  }

  if (query.dateTo) {
    conditions.push(
      sql`${aiConversations.createdAt} <= ${new Date(query.dateTo)}`
    );
  }

  if (query.identified === "true") {
    conditions.push(
      sql`(${aiConversations.clientId} IS NOT NULL OR ${aiConversations.tenantId} IS NOT NULL)`
    );
  } else if (query.identified === "false") {
    conditions.push(
      sql`(${aiConversations.clientId} IS NULL AND ${aiConversations.tenantId} IS NULL)`
    );
  }

  if (query.search) {
    const term = `%${query.search}%`;
    conditions.push(
      sql`(
        ${aiConversations.participantName} ILIKE ${term}
        OR ${aiConversations.participantPhone} ILIKE ${term}
        OR ${aiConversations.id} IN (
          SELECT ${aiMessages.conversationId}
          FROM ${aiMessages}
          WHERE ${aiMessages.content} ILIKE ${term}
        )
      )`
    );
  }

  return conditions;
}

// ── Conversations routes (auth required) ─────────────────────────────────────

export const aiConversationsRoutes = new Elysia({ name: "ai-conversations" })
  .use(identityGuard)
  .use(requirePermission("ai:conversations:read"))

  // GET /ai/conversations — paginated list with filtering and search
  .get("/ai/conversations", async ({ query }) => {
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(query.limit ?? "20", 10) || 20)
    );
    const offset = (page - 1) * limit;

    const filters = buildConversationFilters(query);
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    // Get total count
    const [totalResult] = await db
      .select({ total: count() })
      .from(aiConversations)
      .where(whereClause);

    const total = totalResult?.total ?? 0;

    // Get paginated conversations with message count
    const conversations = await db
      .select({
        id: aiConversations.id,
        participantName: aiConversations.participantName,
        participantPhone: aiConversations.participantPhone,
        participantEmail: aiConversations.participantEmail,
        participantType: aiConversations.participantType,
        clientId: aiConversations.clientId,
        tenantId: aiConversations.tenantId,
        channel: aiConversations.channel,
        language: aiConversations.language,
        status: aiConversations.status,
        resolvedAt: aiConversations.resolvedAt,
        createdAt: aiConversations.createdAt,
        updatedAt: aiConversations.updatedAt,
        messageCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${aiMessages}
          WHERE ${aiMessages.conversationId} = "ai_conversations"."id"
        )`,
      })
      .from(aiConversations)
      .where(whereClause)
      .orderBy(desc(aiConversations.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: conversations,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  })

  // GET /ai/conversations/:id — full conversation with all messages
  .get("/ai/conversations/:id", async ({ params, set }) => {
    const { id } = params;

    // Get conversation record
    const [conversation] = await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.id, id))
      .limit(1);

    if (!conversation) {
      set.status = 404;
      return { error: "Conversation not found" };
    }

    // Get all messages ordered by createdAt
    const messages = await db
      .select({
        id: aiMessages.id,
        role: aiMessages.role,
        content: aiMessages.content,
        metadata: aiMessages.metadata,
        createdAt: aiMessages.createdAt,
      })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, id))
      .orderBy(aiMessages.createdAt);

    return {
      data: {
        ...conversation,
        messages,
      },
    };
  });

export default aiConversationsRoutes;
