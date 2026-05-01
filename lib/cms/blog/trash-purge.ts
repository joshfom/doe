import { eq, and, lt, sql } from "drizzle-orm";
import type { Database } from "../db";
import { posts, siteSettings } from "../schema";
import { logAudit } from "../audit";

const DEFAULT_RETENTION_DAYS = 3;

/**
 * Purge posts that have been trashed longer than the retention period.
 * Called on API startup and can be triggered via a cron endpoint.
 */
export async function purgeExpiredTrash(db: Database): Promise<number> {
  // Read retention days from site_settings (default 3)
  const setting = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, "blog_trash_retention_days"))
    .limit(1);

  const retentionDays =
    setting.length > 0 ? parseInt(setting[0].value, 10) || DEFAULT_RETENTION_DAYS : DEFAULT_RETENTION_DAYS;

  // Find trashed posts past the retention period
  const cutoff = sql`now() - interval '1 day' * ${retentionDays}`;

  const expiredPosts = await db
    .select({ id: posts.id, title: posts.title, locale: posts.locale, authorId: posts.authorId })
    .from(posts)
    .where(
      and(
        eq(posts.status, "trashed"),
        lt(posts.trashedAt, cutoff)
      )
    );

  // Hard-delete each expired post and log audit
  for (const post of expiredPosts) {
    await db.delete(posts).where(eq(posts.id, post.id));

    await logAudit(db, {
      userId: post.authorId,
      action: "auto_purge",
      entityType: "post",
      entityId: post.id,
      summary: `Auto-purged trashed post "${post.title}" (${post.locale}) after ${retentionDays} day retention`,
    });
  }

  return expiredPosts.length;
}
