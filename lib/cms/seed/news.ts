/**
 * Seeds 4 demo news posts (press releases) for the News landing page.
 * One is marked as "featured" to demonstrate the hero layout.
 */
import { eq, and, sql } from "drizzle-orm";
import type { Database } from "../db";
import { posts, categories, postCategories, users } from "../schema";

const PRESS_RELEASE_CATEGORY = "Press Release";

const NEWS_POSTS = [
  {
    title:
      "ORA Developers Breaks Ground on BAYN and Opens Two New Sales Centers in Abu Dhabi and Dubai",
    slug: "ora-breaks-ground-bayn-sales-centers",
    featured: true,
    excerpt:
      "ORA Developers has officially broken ground on BAYN, its flagship coastal community in Ghantoot, while simultaneously opening two new sales centers in Abu Dhabi and Dubai to serve growing demand.",
    publishedAt: new Date("2025-12-04T10:00:00Z"),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ORA Developers has officially broken ground on BAYN, its flagship coastal community in Ghantoot, marking a significant milestone in the development of one of the UAE's most ambitious master-planned communities.",
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "The groundbreaking ceremony was attended by senior government officials and key stakeholders, signaling the project's transition from planning to active construction.",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [
            { type: "text", text: "Two New Sales Centers" },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "In tandem with the groundbreaking, ORA has opened dedicated sales centers in Abu Dhabi's Al Maryah Island and Dubai's DIFC, offering prospective buyers an immersive experience of the BAYN lifestyle through scale models, VR walkthroughs, and material samples.",
            },
          ],
        },
      ],
    },
  },
  {
    title:
      "ORA Developers Latest Study Reveals New Trends in UAE Home Buyer Preferences",
    slug: "ora-study-uae-home-buyer-trends",
    featured: false,
    excerpt:
      "A comprehensive study by ORA Developers reveals shifting preferences among UAE home buyers, with sustainability, wellness amenities, and waterfront living topping the priority list.",
    publishedAt: new Date("2025-10-01T09:00:00Z"),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ORA Developers has released findings from its latest market research study, surveying over 2,000 prospective home buyers across the UAE to understand evolving preferences in residential real estate.",
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "78% of respondents prioritize communities with dedicated wellness and fitness facilities",
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "65% indicate a strong preference for waterfront or water-adjacent properties",
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Sustainability certifications influence purchase decisions for 54% of buyers",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    title:
      "ORA Unveils BAYN A Coastal Community Development Bridging Abu Dhabi and Dubai",
    slug: "ora-unveils-bayn-coastal-community",
    featured: false,
    excerpt:
      "ORA Developers has lifted the curtain on BAYN, a visionary coastal community development where city energy meets coastal serenity without compromise.",
    publishedAt: new Date("2025-04-25T08:00:00Z"),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ORA Developers has lifted the curtain on BAYN, a visionary coastal community development where city energy meets coastal serenity without compromise. The 4.8 million square meter masterplan in Ghantoot was unveiled at a special launch event in the presence of influential business leaders and government representatives.",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [
            {
              type: "text",
              text: "A Masterplan Inspired by Land and Water",
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "BAYN's design is inspired by the site's natural history. At the core of the community lies a seamless connection to water with over seven kilometers of waterfront living, framed by 9,000 residences, including mansions, villas, townhouses, and apartments.",
            },
          ],
        },
      ],
    },
  },
  {
    title:
      "ORA Developers Accelerates UAE Growth with New Headquarters and Key Appointments",
    slug: "ora-accelerates-uae-growth-headquarters",
    featured: false,
    excerpt:
      "ORA Developers announces the establishment of a new UAE headquarters in Abu Dhabi alongside key executive appointments to drive the company's regional expansion.",
    publishedAt: new Date("2025-04-18T07:00:00Z"),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ORA Developers has announced the establishment of its new UAE headquarters in Abu Dhabi, reinforcing its commitment to the region's dynamic real estate sector and positioning itself for accelerated growth.",
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "The new headquarters, located in the heart of Abu Dhabi's business district, will serve as the operational hub for all UAE developments, including the flagship BAYN community in Ghantoot.",
            },
          ],
        },
      ],
    },
  },
];

export async function seedNews(db: Database): Promise<{ newsSeeded: number }> {
  // Check if news posts already exist
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.postType, "news"), eq(posts.locale, "en")));

  if ((existing?.count ?? 0) > 0) {
    console.log("[seed:news] News posts already exist, skipping.");
    return { newsSeeded: 0 };
  }

  // Get the first user as author
  const [author] = await db.select({ id: users.id }).from(users).limit(1);
  if (!author) {
    throw new Error("[seed:news] No users found. Seed users first.");
  }

  // Ensure "Press Release" category exists
  let [pressReleaseCat] = await db
    .select()
    .from(categories)
    .where(eq(categories.name, PRESS_RELEASE_CATEGORY))
    .limit(1);

  if (!pressReleaseCat) {
    const [inserted] = await db
      .insert(categories)
      .values({
        name: PRESS_RELEASE_CATEGORY,
        slug: "press-release",
      })
      .returning();
    pressReleaseCat = inserted;
  }

  // Insert news posts
  for (const newsData of NEWS_POSTS) {
    const namespace = crypto.randomUUID();
    const [inserted] = await db
      .insert(posts)
      .values({
        title: newsData.title,
        slug: newsData.slug,
        locale: "en",
        namespace,
        postType: "news",
        status: "published",
        content: newsData.content,
        excerpt: newsData.excerpt,
        featured: newsData.featured,
        authorId: author.id,
        publishedAt: newsData.publishedAt,
      })
      .returning();

    // Link to Press Release category
    if (pressReleaseCat) {
      await db.insert(postCategories).values({
        postId: inserted.id,
        categoryId: pressReleaseCat.id,
      });
    }
  }

  console.log(`[seed:news] Seeded ${NEWS_POSTS.length} news posts.`);
  return { newsSeeded: NEWS_POSTS.length };
}
