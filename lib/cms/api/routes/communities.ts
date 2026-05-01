import { Elysia } from "elysia";
import { eq, ne, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import {
  listCommunities,
  getCommunityById,
  createCommunity,
  updateCommunity,
  archiveCommunity,
} from "../../communities/service";
import {
  createCommunitySchema,
  updateCommunitySchema,
} from "../../communities/validation";
import { communities, projects, mediaItems } from "../../schema";

function fieldErrorsFrom(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    errors[issue.path.map((p) => String(p)).join(".")] = issue.message;
  }
  return errors;
}

const readRoutes = new Elysia({ name: "communities-read" })
  .use(identityGuard)
  .use(requirePermission("communities:read"))

  .get("/communities", async ({ query }) => {
    const includeArchived = query.includeArchived === "true";
    const data = await listCommunities(db, { includeArchived });
    return { data };
  })

  .get("/communities/:id", async ({ params, set }) => {
    const community = await getCommunityById(db, params.id);
    if (!community) {
      set.status = 404;
      return { error: "Community not found" };
    }
    return { data: community };
  });

const writeRoutes = new Elysia({ name: "communities-write" })
  .use(identityGuard)
  .use(requirePermission("communities:manage"))

  .post("/communities", async ({ body, userId, set }) => {
    const parsed = createCommunitySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return {
        error: "Validation failed",
        details: fieldErrorsFrom(parsed.error.issues),
      };
    }

    try {
      const community = await createCommunity(db, parsed.data, userId);
      set.status = 201;
      return { data: community };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already exists")) {
        set.status = 409;
        return { error: message };
      }
      throw error;
    }
  })

  .patch("/communities/:id", async ({ params, body, userId, set }) => {
    const parsed = updateCommunitySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return {
        error: "Validation failed",
        details: fieldErrorsFrom(parsed.error.issues),
      };
    }

    try {
      const community = await updateCommunity(db, params.id, parsed.data, userId);
      return { data: community };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        set.status = 404;
        return { error: message };
      }
      if (message.includes("already exists")) {
        set.status = 409;
        return { error: message };
      }
      throw error;
    }
  })

  .delete("/communities/:id", async ({ params, userId, set }) => {
    try {
      await archiveCommunity(db, params.id, userId);
      return { data: { id: params.id, archived: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        set.status = 404;
        return { error: message };
      }
      throw error;
    }
  });

// ── Public routes (no auth) ──────────────────────────────────────────────────
const publicCommunityRoutes = new Elysia({ name: "communities-public" })
  .get("/communities/public", async () => {
    const list = await db
      .select()
      .from(communities)
      .where(ne(communities.status, "archived"));

    const heroIds = list
      .map((c) => c.heroImageId)
      .filter((v): v is string => !!v);
    const media: Record<string, { url: string; alt: string }> = {};
    if (heroIds.length > 0) {
      const rows = await db
        .select({
          id: mediaItems.id,
          storageUrl: mediaItems.storageUrl,
          altText: mediaItems.altText,
        })
        .from(mediaItems)
        .where(inArray(mediaItems.id, Array.from(new Set(heroIds))));
      for (const row of rows) {
        media[row.id] = { url: row.storageUrl, alt: row.altText ?? "" };
      }
    }

    // Project counts per community (non-archived)
    const allProjects = await db
      .select({ id: projects.id, communityId: projects.communityId })
      .from(projects)
      .where(ne(projects.status, "archived"));
    const projectCounts: Record<string, number> = {};
    for (const p of allProjects) {
      projectCounts[p.communityId] = (projectCounts[p.communityId] ?? 0) + 1;
    }

    return { data: { communities: list, media, projectCounts } };
  })

  .get("/communities/public/:slug", async ({ params, set }) => {
    const slug = params.slug;
    const [community] = await db
      .select()
      .from(communities)
      .where(eq(communities.slug, slug))
      .limit(1);
    if (!community || community.status === "archived") {
      set.status = 404;
      return { error: "Community not found" };
    }

    const list = await db
      .select()
      .from(projects)
      .where(eq(projects.communityId, community.id));
    const filtered = list.filter((p) => p.status !== "archived");

    const heroIds = new Set<string>();
    if (community.heroImageId) heroIds.add(community.heroImageId);
    if (community.logoImageId) heroIds.add(community.logoImageId);
    for (const p of filtered) {
      if (p.heroImageId) heroIds.add(p.heroImageId);
    }

    const media: Record<string, { url: string; alt: string }> = {};
    if (heroIds.size > 0) {
      const rows = await db
        .select({
          id: mediaItems.id,
          storageUrl: mediaItems.storageUrl,
          altText: mediaItems.altText,
        })
        .from(mediaItems)
        .where(inArray(mediaItems.id, Array.from(heroIds)));
      for (const row of rows) {
        media[row.id] = { url: row.storageUrl, alt: row.altText ?? "" };
      }
    }

    return {
      data: { community, projects: filtered, media },
    };
  });

export const communitiesRoutes = new Elysia({ name: "communities" })
  .use(publicCommunityRoutes)
  .use(readRoutes)
  .use(writeRoutes);
