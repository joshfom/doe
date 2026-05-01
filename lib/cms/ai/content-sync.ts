import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { posts, knowledgeDocuments, knowledgeEmbeddings } from "../schema";
import { generateEmbedding } from "./gateway";

// ── Types ────────────────────────────────────────────────────────────────────

interface TiptapNode {
  type?: string;
  text?: string;
  content?: TiptapNode[];
  [key: string]: unknown;
}

// ── extractPlainText ─────────────────────────────────────────────────────────

/**
 * Recursively extracts text content from a Tiptap JSON structure.
 *
 * Tiptap JSON has the shape:
 *   { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "..." }] }] }
 *
 * This function traverses all `content` arrays and collects `text` fields,
 * joining paragraphs with newlines.
 */
export function extractPlainText(tiptapJson: unknown): string {
  if (!tiptapJson || typeof tiptapJson !== "object") {
    return "";
  }

  const node = tiptapJson as TiptapNode;

  // Leaf text node
  if (node.type === "text" && typeof node.text === "string") {
    return node.text;
  }

  // Recurse into content array
  if (Array.isArray(node.content)) {
    const parts = node.content.map((child) => extractPlainText(child));

    // Join block-level nodes (paragraph, heading, etc.) with newlines
    // but inline nodes (text, bold, etc.) without separator
    const isBlockLevel = node.type === "doc" || node.type === "bulletList" || node.type === "orderedList";
    const hasBlockChildren = node.content.some(
      (child) =>
        child.type === "paragraph" ||
        child.type === "heading" ||
        child.type === "blockquote" ||
        child.type === "listItem" ||
        child.type === "bulletList" ||
        child.type === "orderedList" ||
        child.type === "codeBlock" ||
        child.type === "horizontalRule" ||
        child.type === "table"
    );

    if (isBlockLevel || hasBlockChildren) {
      return parts.filter((p) => p.length > 0).join("\n");
    }

    return parts.join("");
  }

  return "";
}

// ── Chunking helper ──────────────────────────────────────────────────────────

/**
 * Splits text into chunks of approximately `chunkSize` characters,
 * breaking at sentence boundaries (. ! ?) when possible.
 */
function splitIntoChunks(text: string, chunkSize = 500): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const trimmed = text.trim();
  if (trimmed.length <= chunkSize) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining.trim());
      break;
    }

    // Look for a sentence boundary within the chunk window
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
      // Split after the sentence-ending punctuation
      splitAt = sentenceEnd + 1;
    } else {
      // No good sentence boundary — split at last space
      const lastSpace = window.lastIndexOf(" ");
      splitAt = lastSpace > chunkSize * 0.3 ? lastSpace : chunkSize;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks.filter((c) => c.length > 0);
}

// ── syncBlogPost ─────────────────────────────────────────────────────────────

/**
 * Syncs a blog post to the knowledge base.
 *
 * - On "publish" or "update": extracts plain text from Tiptap JSON,
 *   creates or updates the knowledge document, generates embeddings
 *   for each text chunk, and stores them in the vector store.
 * - On "delete": removes the knowledge document (cascade deletes embeddings).
 */
export async function syncBlogPost(
  db: Database,
  postId: string,
  action: "publish" | "update" | "delete"
): Promise<void> {
  if (action === "delete") {
    // Find and delete the knowledge document by sourceRefId
    const existing = await db
      .select({ id: knowledgeDocuments.id })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.sourceRefId, postId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .delete(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, existing[0].id));
    }

    return;
  }

  // Publish or update — fetch the post
  const postRows = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      locale: posts.locale,
      status: posts.status,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  if (postRows.length === 0) {
    throw new Error(`Blog post not found: ${postId}`);
  }

  const post = postRows[0];
  const plainText = extractPlainText(post.content);

  if (!plainText || plainText.trim().length === 0) {
    // Nothing to index — remove any existing document
    const existing = await db
      .select({ id: knowledgeDocuments.id })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.sourceRefId, postId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .delete(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, existing[0].id));
    }
    return;
  }

  // Upsert the knowledge document (match by sourceRefId)
  const existingDocs = await db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.sourceRefId, postId))
    .limit(1);

  let documentId: string;

  if (existingDocs.length > 0) {
    // Update existing document
    documentId = existingDocs[0].id;
    await db
      .update(knowledgeDocuments)
      .set({
        title: post.title,
        content: plainText,
        locale: post.locale,
        lastIndexedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, documentId));
  } else {
    // Create new document
    const inserted = await db
      .insert(knowledgeDocuments)
      .values({
        title: post.title,
        content: plainText,
        sourceType: "blog_sync",
        category: null,
        locale: post.locale,
        sourceRefId: postId,
        lastIndexedAt: new Date(),
      })
      .returning({ id: knowledgeDocuments.id });

    documentId = inserted[0].id;
  }

  // Delete old embeddings for this document
  await db
    .delete(knowledgeEmbeddings)
    .where(eq(knowledgeEmbeddings.documentId, documentId));

  // Split text into chunks and generate embeddings
  const chunks = splitIntoChunks(plainText);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding(chunks[i]);
    await db.insert(knowledgeEmbeddings).values({
      documentId,
      embedding,
      chunkIndex: i,
      chunkText: chunks[i],
    });
  }
}

// ── reindexAllBlogContent ────────────────────────────────────────────────────

/**
 * Re-indexes all published blog posts into the knowledge base.
 * Used for manual admin re-index action.
 *
 * Returns the count of successfully indexed posts and errors.
 */
export async function reindexAllBlogContent(
  db: Database
): Promise<{ indexed: number; errors: number }> {
  const publishedPosts = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.status, "published"));

  let indexed = 0;
  let errors = 0;

  for (const post of publishedPosts) {
    try {
      await syncBlogPost(db, post.id, "publish");
      indexed++;
    } catch (error) {
      console.error(
        `[Content Sync] Failed to index post ${post.id}:`,
        error
      );
      errors++;
    }
  }

  return { indexed, errors };
}
