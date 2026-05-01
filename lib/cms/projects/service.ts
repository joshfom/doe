import { eq, and, desc, ne } from "drizzle-orm";
import type { Database } from "../db";
import { projects, communities } from "../schema";
import { logAudit } from "../audit";
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "./validation";

export type Project = typeof projects.$inferSelect;

export interface ProjectFilters {
  communityId?: string;
  status?: string;
  includeArchived?: boolean;
}

export async function listProjects(
  db: Database,
  filters: ProjectFilters = {}
): Promise<Project[]> {
  const conditions = [] as ReturnType<typeof eq>[];
  if (filters.communityId) {
    conditions.push(eq(projects.communityId, filters.communityId));
  }
  if (filters.status) {
    conditions.push(eq(projects.status, filters.status as Project["status"]));
  }
  if (!filters.includeArchived) {
    conditions.push(ne(projects.status, "archived"));
  }
  const where = conditions.length === 0
    ? undefined
    : conditions.length === 1
      ? conditions[0]
      : and(...conditions);

  const q = db.select().from(projects).orderBy(desc(projects.createdAt));
  return where ? await q.where(where) : await q;
}

export async function getProjectById(
  db: Database,
  id: string
): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  return row ?? null;
}

export async function getProjectBySlug(
  db: Database,
  communityId: string,
  slug: string
): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.communityId, communityId), eq(projects.slug, slug))
    )
    .limit(1);
  return row ?? null;
}

async function assertCommunityExists(
  db: Database,
  communityId: string
): Promise<void> {
  const [c] = await db
    .select({ id: communities.id })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (!c) {
    throw new Error("Community not found");
  }
}

export async function createProject(
  db: Database,
  input: CreateProjectInput,
  userId: string
): Promise<Project> {
  await assertCommunityExists(db, input.communityId);

  const collision = await getProjectBySlug(db, input.communityId, input.slug);
  if (collision) {
    throw new Error(
      `Project with slug "${input.slug}" already exists in this community`
    );
  }

  const [inserted] = await db
    .insert(projects)
    .values({
      communityId: input.communityId,
      slug: input.slug,
      nameEn: input.nameEn,
      nameAr: input.nameAr ?? null,
      shortDescriptionEn: input.shortDescriptionEn ?? null,
      shortDescriptionAr: input.shortDescriptionAr ?? null,
      longDescriptionEn: input.longDescriptionEn ?? null,
      longDescriptionAr: input.longDescriptionAr ?? null,
      status: input.status ?? "planning",
      heroImageId: input.heroImageId ?? null,
      logoImageId: input.logoImageId ?? null,
      brochurePdfId: input.brochurePdfId ?? null,
      brochureGallery: input.brochureGallery ?? null,
      floorplans: input.floorplans ?? null,
      amenities: input.amenities ?? null,
      locationLat: input.locationLat ?? null,
      locationLng: input.locationLng ?? null,
      locationHighlights: input.locationHighlights ?? null,
      paymentPlans: input.paymentPlans ?? null,
      expectedHandoverDate: input.expectedHandoverDate ?? null,
      totalUnits: input.totalUnits ?? null,
      availableUnits: input.availableUnits ?? null,
      developer: input.developer ?? null,
      contractor: input.contractor ?? null,
      architect: input.architect ?? null,
      seoMeta: input.seoMeta ?? null,
    })
    .returning();

  await logAudit(db, {
    userId,
    action: "project_create",
    entityType: "project",
    entityId: inserted.id,
    summary: `Project "${inserted.nameEn}" created`,
  });

  return inserted;
}

export async function updateProject(
  db: Database,
  id: string,
  input: UpdateProjectInput,
  userId: string
): Promise<Project> {
  const existing = await getProjectById(db, id);
  if (!existing) {
    throw new Error("Project not found");
  }

  if (input.slug && input.slug !== existing.slug) {
    const collision = await getProjectBySlug(
      db,
      existing.communityId,
      input.slug
    );
    if (collision && collision.id !== id) {
      throw new Error(
        `Project with slug "${input.slug}" already exists in this community`
      );
    }
  }

  const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  const fields: (keyof UpdateProjectInput)[] = [
    "slug",
    "nameEn",
    "nameAr",
    "shortDescriptionEn",
    "shortDescriptionAr",
    "longDescriptionEn",
    "longDescriptionAr",
    "status",
    "heroImageId",
    "logoImageId",
    "brochurePdfId",
    "brochureGallery",
    "floorplans",
    "amenities",
    "locationLat",
    "locationLng",
    "locationHighlights",
    "paymentPlans",
    "expectedHandoverDate",
    "totalUnits",
    "availableUnits",
    "developer",
    "contractor",
    "architect",
    "seoMeta",
  ];
  for (const f of fields) {
    const v = input[f];
    if (v !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (set as any)[f] = v;
    }
  }

  const [updated] = await db
    .update(projects)
    .set(set)
    .where(eq(projects.id, id))
    .returning();

  await logAudit(db, {
    userId,
    action: "project_update",
    entityType: "project",
    entityId: id,
    summary: `Project "${updated.nameEn}" updated`,
  });

  return updated;
}

export async function archiveProject(
  db: Database,
  id: string,
  userId: string
): Promise<void> {
  const existing = await getProjectById(db, id);
  if (!existing) {
    throw new Error("Project not found");
  }

  await db
    .update(projects)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(projects.id, id));

  await logAudit(db, {
    userId,
    action: "project_archive",
    entityType: "project",
    entityId: id,
    summary: `Project "${existing.nameEn}" archived`,
  });
}
