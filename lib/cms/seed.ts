import { count, and, eq } from "drizzle-orm";
import type { Database } from "./db";
import { pages, siteSettings } from "./schema";

export async function seedSystemPages(db: Database): Promise<void> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(pages);

  if (total > 0) return;

  const homeNamespace = crypto.randomUUID();
  const contactNamespace = crypto.randomUUID();

  const emptyPageData = { root: { props: {} }, content: [] };

  await db.insert(pages).values([
    {
      title: "Home",
      slug: "/",
      locale: "en",
      namespace: homeNamespace,
      status: "draft",
      isSystem: true,
      data: emptyPageData,
    },
    {
      title: "Home",
      slug: "/",
      locale: "ar",
      namespace: homeNamespace,
      status: "draft",
      isSystem: true,
      data: emptyPageData,
    },
    {
      title: "Contact",
      slug: "contact",
      locale: "en",
      namespace: contactNamespace,
      status: "draft",
      isSystem: true,
      data: emptyPageData,
    },
    {
      title: "Contact",
      slug: "contact",
      locale: "ar",
      namespace: contactNamespace,
      status: "draft",
      isSystem: true,
      data: emptyPageData,
    },
  ]);

  // Set the EN home page as the home_page_id site setting
  const [enHome] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.slug, "/"), eq(pages.locale, "en")))
    .limit(1);

  if (enHome) {
    await db.insert(siteSettings).values({
      key: "home_page_id",
      value: enHome.id,
    });
  }
}
