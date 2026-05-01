import { Elysia } from "elysia";
import { z } from "zod";
import { db } from "../../db";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import { knowledgeDocuments, knowledgeEmbeddings } from "../../schema";
import { eq, and, like, sql, count, desc } from "drizzle-orm";
import { generateEmbedding } from "../../ai/gateway";
import { reindexAllBlogContent } from "../../ai/content-sync";

// ── Request validation schemas ───────────────────────────────────────────────

const createDocumentSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().min(1, "Content is required"),
  sourceType: z.enum(["manual", "blog_sync", "construction_update", "faq", "policy"]),
  category: z.string().nullable().optional(),
  locale: z.enum(["en", "ar"]),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  content: z.string().min(1, "Content is required").optional(),
  sourceType: z.enum(["manual", "blog_sync", "construction_update", "faq", "policy"]).optional(),
  category: z.string().nullable().optional(),
  locale: z.enum(["en", "ar"]).optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function splitIntoChunks(text: string, chunkSize = 500): string[] {
  if (!text || text.trim().length === 0) return [];
  const trimmed = text.trim();
  if (trimmed.length <= chunkSize) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining.trim());
      break;
    }

    const window = remaining.slice(0, chunkSize);
    const sentenceEnd = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf(".\n"),
      window.lastIndexOf("!\n"),
      window.lastIndexOf("?\n")
    );

    let splitAt: number;
    if (sentenceEnd > chunkSize * 0.3) {
      splitAt = sentenceEnd + 1;
    } else {
      const lastSpace = window.lastIndexOf(" ");
      splitAt = lastSpace > chunkSize * 0.3 ? lastSpace : chunkSize;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks.filter((c) => c.length > 0);
}

// ── Knowledge base routes (auth required) ────────────────────────────────────

export const aiKnowledgeBaseRoutes = new Elysia({ name: "ai-knowledge-base" })
  .use(identityGuard)
  .use(requirePermission("ai:knowledge-base:manage"))

  // GET /ai/knowledge-base — list knowledge documents with filtering
  .get("/ai/knowledge-base", async ({ query }) => {
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(query.limit ?? "20", 10) || 20)
    );
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query.sourceType) {
      conditions.push(
        eq(
          knowledgeDocuments.sourceType,
          query.sourceType as "manual" | "blog_sync" | "construction_update" | "faq" | "policy"
        )
      );
    }

    if (query.category) {
      conditions.push(eq(knowledgeDocuments.category, query.category));
    }

    if (query.locale) {
      conditions.push(
        eq(knowledgeDocuments.locale, query.locale as "en" | "ar")
      );
    }

    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        sql`(${knowledgeDocuments.title} ILIKE ${term} OR ${knowledgeDocuments.content} ILIKE ${term})`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [totalResult] = await db
      .select({ total: count() })
      .from(knowledgeDocuments)
      .where(whereClause);

    const total = totalResult?.total ?? 0;

    // Get paginated documents
    const documents = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        content: knowledgeDocuments.content,
        sourceType: knowledgeDocuments.sourceType,
        category: knowledgeDocuments.category,
        locale: knowledgeDocuments.locale,
        sourceRefId: knowledgeDocuments.sourceRefId,
        lastIndexedAt: knowledgeDocuments.lastIndexedAt,
        createdAt: knowledgeDocuments.createdAt,
        updatedAt: knowledgeDocuments.updatedAt,
      })
      .from(knowledgeDocuments)
      .where(whereClause)
      .orderBy(desc(knowledgeDocuments.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: documents,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  })

  // POST /ai/knowledge-base — create manual knowledge document
  .post("/ai/knowledge-base", async ({ body, set }) => {
    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    const { title, content, sourceType, category, locale } = parsed.data;

    // Create the knowledge document
    const [document] = await db
      .insert(knowledgeDocuments)
      .values({
        title,
        content,
        sourceType,
        category: category ?? null,
        locale,
        lastIndexedAt: new Date(),
      })
      .returning();

    // Generate embeddings for the content
    const chunks = splitIntoChunks(content);
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i]);
      await db.insert(knowledgeEmbeddings).values({
        documentId: document.id,
        embedding,
        chunkIndex: i,
        chunkText: chunks[i],
      });
    }

    set.status = 201;
    return { data: document };
  })

  // PUT /ai/knowledge-base/:id — update knowledge document
  .put("/ai/knowledge-base/:id", async ({ params, body, set }) => {
    const { id } = params;

    const parsed = updateDocumentSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    // Check if document exists
    const [existing] = await db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Knowledge document not found" };
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const data = parsed.data;

    if (data.title !== undefined) updates.title = data.title;
    if (data.content !== undefined) updates.content = data.content;
    if (data.sourceType !== undefined) updates.sourceType = data.sourceType;
    if (data.category !== undefined) updates.category = data.category;
    if (data.locale !== undefined) updates.locale = data.locale;

    // If content changed, regenerate embeddings
    const contentChanged = data.content !== undefined && data.content !== existing.content;
    if (contentChanged) {
      updates.lastIndexedAt = new Date();
    }

    const [updated] = await db
      .update(knowledgeDocuments)
      .set(updates)
      .where(eq(knowledgeDocuments.id, id))
      .returning();

    // Regenerate embeddings if content changed
    if (contentChanged) {
      // Delete old embeddings
      await db
        .delete(knowledgeEmbeddings)
        .where(eq(knowledgeEmbeddings.documentId, id));

      // Generate new embeddings
      const newContent = data.content!;
      const chunks = splitIntoChunks(newContent);
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await generateEmbedding(chunks[i]);
        await db.insert(knowledgeEmbeddings).values({
          documentId: id,
          embedding,
          chunkIndex: i,
          chunkText: chunks[i],
        });
      }
    }

    return { data: updated };
  })

  // DELETE /ai/knowledge-base/:id — delete knowledge document and embeddings
  .delete("/ai/knowledge-base/:id", async ({ params, set }) => {
    const { id } = params;

    const [existing] = await db
      .select({ id: knowledgeDocuments.id })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Knowledge document not found" };
    }

    // Delete document (cascade will delete embeddings)
    await db
      .delete(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id));

    return { data: { success: true } };
  })

  // POST /ai/knowledge-base/reindex — trigger full blog content re-index
  .post("/ai/knowledge-base/reindex", async () => {
    const result = await reindexAllBlogContent(db);
    return { data: result };
  })

  // POST /ai/knowledge-base/reembed-all — regenerate embeddings for every
  // knowledge document. Use this after switching the embedding model or AI
  // gateway, or after seeding documents without embeddings.
  .post("/ai/knowledge-base/reembed-all", async ({ set }) => {
    const allDocs = await db
      .select({
        id: knowledgeDocuments.id,
        content: knowledgeDocuments.content,
      })
      .from(knowledgeDocuments);

    let documentsProcessed = 0;
    let chunksGenerated = 0;
    const failures: Array<{ documentId: string; error: string }> = [];

    for (const doc of allDocs) {
      try {
        // Drop existing embeddings for this document.
        await db
          .delete(knowledgeEmbeddings)
          .where(eq(knowledgeEmbeddings.documentId, doc.id));

        // Re-chunk and embed.
        const chunks = splitIntoChunks(doc.content);
        for (let i = 0; i < chunks.length; i++) {
          const embedding = await generateEmbedding(chunks[i]);
          await db.insert(knowledgeEmbeddings).values({
            documentId: doc.id,
            embedding,
            chunkIndex: i,
            chunkText: chunks[i],
          });
          chunksGenerated++;
        }

        await db
          .update(knowledgeDocuments)
          .set({ lastIndexedAt: new Date() })
          .where(eq(knowledgeDocuments.id, doc.id));

        documentsProcessed++;
      } catch (err) {
        failures.push({
          documentId: doc.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (failures.length > 0 && documentsProcessed === 0) {
      // Total failure — surface as 500 so the client shows an error state.
      set.status = 500;
    }

    return {
      data: {
        documentsProcessed,
        chunksGenerated,
        totalDocuments: allDocs.length,
        failures,
      },
    };
  });

export default aiKnowledgeBaseRoutes;
