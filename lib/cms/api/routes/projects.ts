import { Elysia } from "elysia";
import { eq, inArray, ne } from "drizzle-orm";
import { db } from "../../db";
import { projects, communities, mediaItems } from "../../schema";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import {
  listProjects,
  getProjectById,
  createProject,
  updateProject,
  archiveProject,
} from "../../projects/service";
import {
  createProjectSchema,
  updateProjectSchema,
} from "../../projects/validation";

function fieldErrorsFrom(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>
) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    errors[issue.path.map((p) => String(p)).join(".")] = issue.message;
  }
  return errors;
}

const readRoutes = new Elysia({ name: "projects-read" })
  .use(identityGuard)
  .use(requirePermission("projects:read"))

  .get("/projects", async ({ query }) => {
    const data = await listProjects(db, {
      communityId: query.communityId as string | undefined,
      status: query.status as string | undefined,
      includeArchived: query.includeArchived === "true",
    });
    return { data };
  })

  .get("/projects/:id", async ({ params, set }) => {
    const project = await getProjectById(db, params.id);
    if (!project) {
      set.status = 404;
      return { error: "Project not found" };
    }
    return { data: project };
  });

const writeRoutes = new Elysia({ name: "projects-write" })
  .use(identityGuard)
  .use(requirePermission("projects:manage"))

  .post("/projects", async ({ body, userId, set }) => {
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return {
        error: "Validation failed",
        details: fieldErrorsFrom(parsed.error.issues),
      };
    }

    try {
      const project = await createProject(db, parsed.data, userId);
      set.status = 201;
      return { data: project };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Community not found")) {
        set.status = 400;
        return { error: message };
      }
      if (message.includes("already exists")) {
        set.status = 409;
        return { error: message };
      }
      throw error;
    }
  })

  .patch("/projects/:id", async ({ params, body, userId, set }) => {
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return {
        error: "Validation failed",
        details: fieldErrorsFrom(parsed.error.issues),
      };
    }

    try {
      const project = await updateProject(db, params.id, parsed.data, userId);
      return { data: project };
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

  .delete("/projects/:id", async ({ params, userId, set }) => {
    try {
      await archiveProject(db, params.id, userId);
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

// ── Public route (no auth) ──────────────────────────────────────────────────
// Returns a non-archived project by slug along with its community and
// resolved media URLs for use by the public project landing page.
const publicProjectRoutes = new Elysia({ name: "projects-public" })
  .get("/projects/public/:slug", async ({ params, set }) => {
    const slug = params.slug;
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project || project.status === "archived") {
      set.status = 404;
      return { error: "Project not found" };
    }

    const [community] = await db
      .select()
      .from(communities)
      .where(eq(communities.id, project.communityId))
      .limit(1);

    // Collect every media id referenced by the project so the public response
    // can ship resolved URLs alongside the structured data.
    const mediaIds = new Set<string>();
    if (project.heroImageId) mediaIds.add(project.heroImageId);
    if (project.logoImageId) mediaIds.add(project.logoImageId);
    if (project.brochurePdfId) mediaIds.add(project.brochurePdfId);
    const gallery = Array.isArray(project.brochureGallery)
      ? (project.brochureGallery as unknown[]).filter(
          (v): v is string => typeof v === "string"
        )
      : [];
    for (const id of gallery) mediaIds.add(id);
    const floorplans = Array.isArray(project.floorplans)
      ? (project.floorplans as Array<Record<string, unknown>>)
      : [];
    for (const fp of floorplans) {
      if (typeof fp.imageId === "string") mediaIds.add(fp.imageId);
      if (typeof fp.pdfId === "string") mediaIds.add(fp.pdfId);
    }
    const amenities = Array.isArray(project.amenities)
      ? (project.amenities as Array<Record<string, unknown>>)
      : [];
    for (const a of amenities) {
      if (typeof a.imageId === "string") mediaIds.add(a.imageId);
    }

    const mediaMap: Record<string, { url: string; alt: string }> = {};
    if (mediaIds.size > 0) {
      const rows = await db
        .select({
          id: mediaItems.id,
          storageUrl: mediaItems.storageUrl,
          altText: mediaItems.altText,
        })
        .from(mediaItems)
        .where(inArray(mediaItems.id, Array.from(mediaIds)));
      for (const row of rows) {
        mediaMap[row.id] = {
          url: row.storageUrl,
          alt: row.altText ?? "",
        };
      }
    }

    return {
      data: {
        project,
        community: community ?? null,
        media: mediaMap,
      },
    };
  })
  .get("/projects/public", async ({ query }) => {
    // Lightweight list endpoint for landing pages / index pages.
    const communityId = query.communityId as string | undefined;
    const list = await db
      .select()
      .from(projects)
      .where(ne(projects.status, "archived"));
    const filtered = communityId
      ? list.filter((p) => p.communityId === communityId)
      : list;

    const heroIds = filtered
      .map((p) => p.heroImageId)
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

    // Communities referenced by the returned projects (for filter chips).
    const communityIds = Array.from(
      new Set(filtered.map((p) => p.communityId).filter(Boolean))
    );
    const communityRows = communityIds.length
      ? await db
          .select({
            id: communities.id,
            slug: communities.slug,
            nameEn: communities.nameEn,
            nameAr: communities.nameAr,
          })
          .from(communities)
          .where(inArray(communities.id, communityIds))
      : [];

    return { data: { projects: filtered, media, communities: communityRows } };
  });

export const projectsRoutes = new Elysia({ name: "projects" })
  .use(publicProjectRoutes)
  .use(readRoutes)
  .use(writeRoutes);
