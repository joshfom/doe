import { Elysia } from "elysia";
import { db } from "../../db";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import {
  aiConversations,
  aiMessages,
  knowledgeDocuments,
} from "../../schema";
import { sql } from "drizzle-orm";

// ── Analytics routes (auth required) ─────────────────────────────────────────

export const aiAnalyticsRoutes = new Elysia({ name: "ai-analytics" })
  .use(identityGuard)
  .use(requirePermission("ai:analytics:read"))

  // GET /ai/analytics — aggregated conversation stats
  .get("/ai/analytics", async () => {
    // Total conversations
    const totalResult = (await db.execute(
      sql`SELECT COUNT(*)::int AS total FROM ai_conversations`
    )).rows[0];
    const totalConversations = (totalResult as any)?.total ?? 0;

    // Conversations by status
    const statusRows = (await db.execute(
      sql`SELECT status, COUNT(*)::int AS count FROM ai_conversations GROUP BY status`
    )).rows;
    const conversationsByStatus = (statusRows as any[]).reduce(
      (acc: Record<string, number>, row: any) => {
        acc[row.status] = row.count;
        return acc;
      },
      {}
    );

    // Conversations by channel
    const channelRows = (await db.execute(
      sql`SELECT COALESCE(channel, 'unknown') AS channel, COUNT(*)::int AS count FROM ai_conversations GROUP BY channel`
    )).rows;
    const conversationsByChannel = (channelRows as any[]).reduce(
      (acc: Record<string, number>, row: any) => {
        acc[row.channel] = row.count;
        return acc;
      },
      {}
    );

    // Average messages per conversation
    const avgResult = (await db.execute(
      sql`SELECT COALESCE(AVG(msg_count), 0)::float AS avg_messages
          FROM (
            SELECT conversation_id, COUNT(*)::int AS msg_count
            FROM ai_messages
            GROUP BY conversation_id
          ) sub`
    )).rows[0];
    const avgMessagesPerConversation =
      Math.round(((avgResult as any)?.avg_messages ?? 0) * 100) / 100;

    // Handoff rate
    const handoffResult = (await db.execute(
      sql`SELECT
            COUNT(*) FILTER (WHERE status = 'handed_off')::int AS handoffs,
            COUNT(*)::int AS total
          FROM ai_conversations`
    )).rows[0];
    const handoffs = (handoffResult as any)?.handoffs ?? 0;
    const handoffTotal = (handoffResult as any)?.total ?? 1;
    const handoffRate =
      handoffTotal > 0
        ? Math.round((handoffs / handoffTotal) * 10000) / 100
        : 0;

    // Daily volume over time (last 30 days)
    const dailyVolumeRows = (await db.execute(
      sql`SELECT
            DATE(created_at) AS date,
            COUNT(*)::int AS count
          FROM ai_conversations
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at)
          ORDER BY date`
    )).rows;
    const dailyVolume = (dailyVolumeRows as any[]).map((row: any) => ({
      date: row.date,
      count: row.count,
    }));

    return {
      data: {
        totalConversations,
        conversationsByStatus,
        conversationsByChannel,
        avgMessagesPerConversation,
        handoffRate,
        dailyVolume,
      },
    };
  })

  // GET /ai/analytics/knowledge-base — KB health stats
  .get("/ai/analytics/knowledge-base", async () => {
    // Total indexed documents
    const totalResult = (await db.execute(
      sql`SELECT COUNT(*)::int AS total FROM knowledge_documents`
    )).rows[0];
    const totalDocuments = (totalResult as any)?.total ?? 0;

    // Documents by source type
    const sourceTypeRows = (await db.execute(
      sql`SELECT source_type, COUNT(*)::int AS count FROM knowledge_documents GROUP BY source_type`
    )).rows;
    const documentsBySourceType = (sourceTypeRows as any[]).reduce(
      (acc: Record<string, number>, row: any) => {
        acc[row.source_type] = row.count;
        return acc;
      },
      {}
    );

    // Last sync timestamp
    const lastSyncResult = (await db.execute(
      sql`SELECT MAX(last_indexed_at) AS last_sync FROM knowledge_documents`
    )).rows[0];
    const lastSyncTimestamp = (lastSyncResult as any)?.last_sync ?? null;

    // Stale documents (content updated after last indexing)
    const staleResult = (await db.execute(
      sql`SELECT COUNT(*)::int AS stale_count
          FROM knowledge_documents
          WHERE updated_at > last_indexed_at
            OR last_indexed_at IS NULL`
    )).rows[0];
    const staleDocuments = (staleResult as any)?.stale_count ?? 0;

    return {
      data: {
        totalDocuments,
        documentsBySourceType,
        lastSyncTimestamp,
        staleDocuments,
      },
    };
  });

export default aiAnalyticsRoutes;
