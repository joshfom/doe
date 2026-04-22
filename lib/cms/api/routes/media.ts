import { Elysia } from "elysia";
import { eq, or, ilike, and, desc } from "drizzle-orm";
import { authGuard } from "../auth";
import { mediaItems, mediaReferences } from "../../schema";
import { db } from "../../db";
import { createStorageBackend } from "../../storage";
import { logAudit } from "../../audit";
import path from "path";

// ── Public routes (no auth) ──────────────────────────────────────────────────

const publicMedia = new Elysia({ name: "media-public" })
  .get("/media", async ({ query }) => {
    const { search, mimeType } = query as {
      search?: string;
      mimeType?: string;
    };

    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(mediaItems.filename, `%${search}%`),
          ilike(mediaItems.altText, `%${search}%`)
        )
      );
    }

    if (mimeType) {
      conditions.push(eq(mediaItems.mimeType, mimeType));
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select()
      .from(mediaItems)
      .where(whereClause)
      .orderBy(desc(mediaItems.createdAt));

    return { data: items };
  });

// ── Authenticated routes ─────────────────────────────────────────────────────

const protectedMedia = new Elysia({ name: "media-protected" })
  .use(authGuard)

  // POST /media — Upload file
  .post("/media", async ({ body, userId, set }) => {
    const formBody = body as { file?: File; altText?: string };
    const file = formBody.file;
    const altText = formBody.altText ?? "";

    if (!file || !(file instanceof File)) {
      set.status = 400;
      return { error: "File is required" };
    }

    const storage = createStorageBackend();

    // Generate unique filename with timestamp suffix
    const ext = path.extname(file.name) || "";
    const baseName = path.basename(file.name, ext).replace(/[^a-zA-Z0-9-_]/g, "_");
    const uniqueFilename = `${baseName}-${Date.now()}${ext}`;

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const storageUrl = await storage.upload(buffer, uniqueFilename, file.type);

    // Determine storage backend type from env
    const backendType = (process.env.STORAGE_BACKEND === "s3"
      ? "s3"
      : process.env.STORAGE_BACKEND === "r2"
        ? "r2"
        : "local") as "local" | "s3" | "r2";

    const [created] = await db
      .insert(mediaItems)
      .values({
        filename: file.name,
        altText,
        mimeType: file.type,
        fileSize: buffer.length,
        storageUrl,
        storageBackend: backendType,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "media",
      entityId: created.id,
      summary: `Uploaded media "${file.name}"`,
    });

    set.status = 201;
    return { data: created };
  })

  // DELETE /media/:id — Delete media (with reference check)
  .delete("/media/:id", async ({ params, userId, set }) => {
    const { id } = params;

    // Fetch the media item
    const [item] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id))
      .limit(1);

    if (!item) {
      set.status = 404;
      return { error: "Media item not found" };
    }

    // Check for references
    const refs = await db
      .select({
        pageId: mediaReferences.pageId,
      })
      .from(mediaReferences)
      .where(eq(mediaReferences.mediaId, id));

    if (refs.length > 0) {
      const referencingPageIds = refs.map((r) => r.pageId);
      set.status = 409;
      return {
        error: "Cannot delete media item that is referenced by pages",
        referencingPageIds,
      };
    }

    // Delete file from storage
    const storage = createStorageBackend();
    try {
      await storage.delete(item.storageUrl);
    } catch {
      // File may already be missing from storage — continue with DB cleanup
    }

    // Delete DB record
    await db.delete(mediaItems).where(eq(mediaItems.id, id));

    await logAudit(db, {
      userId,
      action: "delete",
      entityType: "media",
      entityId: id,
      summary: `Deleted media "${item.filename}"`,
    });

    return { data: { success: true } };
  })

  // PUT /media/:id — Update alt text
  .put("/media/:id", async ({ params, body, userId, set }) => {
    const { id } = params;
    const { altText } = body as { altText?: string };

    const [existing] = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Media item not found" };
    }

    const [updated] = await db
      .update(mediaItems)
      .set({ altText: altText ?? "" })
      .where(eq(mediaItems.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "media",
      entityId: id,
      summary: `Updated alt text for media "${existing.filename}"`,
    });

    return { data: updated };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const mediaRoutes = new Elysia({ name: "media" })
  .use(publicMedia)
  .use(protectedMedia);
