import { eq, desc, ne } from "drizzle-orm";
import type { Database } from "../db";
import { communities } from "../schema";
import { logAudit } from "../audit";
import type {
  CreateCommunityInput,
  UpdateCommunityInput,
} from "./validation";

export type Community = typeof communities.$inferSelect;

export async function listCommunities(
  db: Database,
  opts: { includeArchived?: boolean } = {}
): Promise<Community[]> {
  const query = db.select().from(communities).orderBy(desc(communities.createdAt));
  if (opts.includeArchived) {
    return await query;
  }
  return await db
    .select()
    .from(communities)
    .where(ne(communities.status, "archived"))
    .orderBy(desc(communities.createdAt));
}

export async function getCommunityById(
  db: Database,
  id: string
): Promise<Community | null> {
  const [row] = await db
    .select()
    .from(communities)
    .where(eq(communities.id, id))
    .limit(1);
  return row ?? null;
}

export async function getCommunityBySlug(
  db: Database,
  slug: string
): Promise<Community | null> {
  const [row] = await db
    .select()
    .from(communities)
    .where(eq(communities.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function createCommunity(
  db: Database,
  input: CreateCommunityInput,
  userId: string
): Promise<Community> {
  const existing = await getCommunityBySlug(db, input.slug);
  if (existing) {
    throw new Error(`Community with slug "${input.slug}" already exists`);
  }

  const [inserted] = await db
    .insert(communities)
    .values({
      slug: input.slug,
      nameEn: input.nameEn,
      nameAr: input.nameAr ?? null,
      descriptionEn: input.descriptionEn ?? null,
      descriptionAr: input.descriptionAr ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      country: input.country ?? "AE",
      locationLat: input.locationLat ?? null,
      locationLng: input.locationLng ?? null,
      heroImageId: input.heroImageId ?? null,
      logoImageId: input.logoImageId ?? null,
      status: input.status ?? "active",
      seoMeta: input.seoMeta ?? null,
    })
    .returning();

  await logAudit(db, {
    userId,
    action: "community_create",
    entityType: "community",
    entityId: inserted.id,
    summary: `Community "${inserted.nameEn}" created`,
  });

  return inserted;
}

export async function updateCommunity(
  db: Database,
  id: string,
  input: UpdateCommunityInput,
  userId: string
): Promise<Community> {
  const existing = await getCommunityById(db, id);
  if (!existing) {
    throw new Error("Community not found");
  }

  if (input.slug && input.slug !== existing.slug) {
    const collision = await getCommunityBySlug(db, input.slug);
    if (collision && collision.id !== id) {
      throw new Error(`Community with slug "${input.slug}" already exists`);
    }
  }

  const [updated] = await db
    .update(communities)
    .set({
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.nameEn !== undefined && { nameEn: input.nameEn }),
      ...(input.nameAr !== undefined && { nameAr: input.nameAr }),
      ...(input.descriptionEn !== undefined && {
        descriptionEn: input.descriptionEn,
      }),
      ...(input.descriptionAr !== undefined && {
        descriptionAr: input.descriptionAr,
      }),
      ...(input.city !== undefined && { city: input.city }),
      ...(input.region !== undefined && { region: input.region }),
      ...(input.country !== undefined && { country: input.country }),
      ...(input.locationLat !== undefined && {
        locationLat: input.locationLat,
      }),
      ...(input.locationLng !== undefined && {
        locationLng: input.locationLng,
      }),
      ...(input.heroImageId !== undefined && {
        heroImageId: input.heroImageId,
      }),
      ...(input.logoImageId !== undefined && {
        logoImageId: input.logoImageId,
      }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.seoMeta !== undefined && { seoMeta: input.seoMeta ?? null }),
      updatedAt: new Date(),
    })
    .where(eq(communities.id, id))
    .returning();

  await logAudit(db, {
    userId,
    action: "community_update",
    entityType: "community",
    entityId: id,
    summary: `Community "${updated.nameEn}" updated`,
  });

  return updated;
}

export async function archiveCommunity(
  db: Database,
  id: string,
  userId: string
): Promise<void> {
  const existing = await getCommunityById(db, id);
  if (!existing) {
    throw new Error("Community not found");
  }

  await db
    .update(communities)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(communities.id, id));

  await logAudit(db, {
    userId,
    action: "community_archive",
    entityType: "community",
    entityId: id,
    summary: `Community "${existing.nameEn}" archived`,
  });
}
