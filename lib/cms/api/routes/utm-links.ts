import { Elysia } from "elysia";
import { desc, and, like } from "drizzle-orm";
import { authGuard } from "../auth";
import { utmLinks } from "../../schema";
import { db } from "../../db";

export const utmLinksRoutes = new Elysia({
  name: "utm-links",
})
  .use(authGuard)

  // GET /utm-links — Fetch history (last 500), with optional project/campaign filters
  .get("/utm-links", async ({ userId, query, set }) => {
    const { project, campaign } = query as {
      project?: string;
      campaign?: string;
    };

    const conditions = [];
    if (project) {
      conditions.push(like(utmLinks.project, `%${project}%`));
    }
    if (campaign) {
      conditions.push(like(utmLinks.utmCampaign, `%${campaign}%`));
    }

    const rows = await db
      .select()
      .from(utmLinks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(utmLinks.createdAt))
      .limit(500);

    return { data: rows };
  })

  // POST /utm-links — Save a generated UTM link
  .post("/utm-links", async ({ body, userId, set }) => {
    const {
      destinationUrl,
      utmSource,
      utmMedium,
      utmCampaign,
      utmTerm,
      utmContent,
      taggedUrl,
      project,
    } = body as {
      destinationUrl: string;
      utmSource: string;
      utmMedium: string;
      utmCampaign: string;
      utmTerm?: string;
      utmContent?: string;
      taggedUrl: string;
      project?: string;
    };

    if (!destinationUrl || !utmSource || !utmMedium || !utmCampaign || !taggedUrl) {
      set.status = 400;
      return { error: "Missing required fields: destinationUrl, utmSource, utmMedium, utmCampaign, taggedUrl" };
    }

    const [inserted] = await db
      .insert(utmLinks)
      .values({
        destinationUrl,
        utmSource,
        utmMedium,
        utmCampaign,
        utmTerm: utmTerm || null,
        utmContent: utmContent || null,
        taggedUrl,
        project: project || null,
        createdBy: userId,
      })
      .returning();

    return { data: inserted };
  });
