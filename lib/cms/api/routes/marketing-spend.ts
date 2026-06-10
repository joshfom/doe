import { Elysia } from "elysia";
import { desc, eq } from "drizzle-orm";
import { authGuard } from "../auth";
import { marketingSpend } from "../../schema";
import { db } from "../../db";

export const marketingSpendRoutes = new Elysia({ name: "marketing-spend" })
  .use(authGuard)

  // GET /marketing-spend — list recent entries (last 200)
  .get("/marketing-spend", async () => {
    const rows = await db
      .select()
      .from(marketingSpend)
      .orderBy(desc(marketingSpend.date), desc(marketingSpend.createdAt))
      .limit(200);
    return { data: rows };
  })

  // POST /marketing-spend — create a new entry
  .post("/marketing-spend", async ({ body, set }) => {
    const { date, channel, campaignId, adSetId, adId, spend, impressions, clicks, currency } =
      body as {
        date?: string;
        channel?: string;
        campaignId?: string;
        adSetId?: string | null;
        adId?: string | null;
        spend?: string;
        impressions?: number;
        clicks?: number;
        currency?: string;
      };

    if (!date || !channel || !campaignId || !spend) {
      set.status = 400;
      return { error: "date, channel, campaignId, and spend are required" };
    }

    const [created] = await db
      .insert(marketingSpend)
      .values({
        date,
        channel,
        campaignId,
        adSetId: adSetId || null,
        adId: adId || null,
        spend,
        impressions: impressions ?? 0,
        clicks: clicks ?? 0,
        currency: currency || "AED",
      })
      .returning();

    set.status = 201;
    return { data: created };
  })

  // DELETE /marketing-spend/:id — delete an entry
  .delete("/marketing-spend/:id", async ({ params, set }) => {
    const [deleted] = await db
      .delete(marketingSpend)
      .where(eq(marketingSpend.id, params.id))
      .returning();

    if (!deleted) {
      set.status = 404;
      return { error: "Not found" };
    }

    return { data: { id: deleted.id } };
  });
