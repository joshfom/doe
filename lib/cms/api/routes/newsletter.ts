import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { newsletterSubscriptions } from "../../schema";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const newsletterRoutes = new Elysia({ name: "newsletter" })
  .post("/newsletter/subscribe", async ({ body, set }) => {
    const {
      email,
      locale,
      sourcePath,
    } = (body ?? {}) as {
      email?: string;
      locale?: string;
      sourcePath?: string;
    };

    const normalizedEmail = (email ?? "").trim().toLowerCase();

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      set.status = 400;
      return { error: "Please provide a valid email address." };
    }

    const [existing] = await db
      .select({ id: newsletterSubscriptions.id })
      .from(newsletterSubscriptions)
      .where(eq(newsletterSubscriptions.email, normalizedEmail))
      .limit(1);

    if (existing) {
      return {
        data: {
          status: "already_subscribed",
          message: "You are already in our list.",
        },
      };
    }

    await db.insert(newsletterSubscriptions).values({
      email: normalizedEmail,
      locale: locale === "ar" ? "ar" : "en",
      sourcePath: typeof sourcePath === "string" ? sourcePath : null,
    });

    set.status = 201;
    return {
      data: {
        status: "subscribed",
        message: "Thanks. You are now on our newsletter list.",
      },
    };
  });
