import { Elysia } from "elysia";
import { eq, and, gt } from "drizzle-orm";
import {
  hashPassword,
  verifyPassword,
} from "better-auth/crypto";
import { generateRandomString } from "better-auth/crypto";
import { db } from "../db";
import { users, sessions } from "../schema";

export const SESSION_COOKIE_NAME = "ora_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Validate a session token against the database.
 * Returns the userId if valid, null otherwise.
 */
export async function validateSession(
  token: string | undefined
): Promise<string | null> {
  if (!token) return null;

  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return session?.userId ?? null;
}

/**
 * Hash a password using Better Auth's crypto utilities.
 * Re-exported for use in seed scripts and tests.
 */
export { hashPassword };

/**
 * Elysia plugin that provides auth endpoints:
 * - POST /auth/login
 * - POST /auth/logout
 * - GET  /auth/session
 */
export const authPlugin = new Elysia({ name: "auth" })
  .post("/auth/login", async ({ body, set, cookie }) => {
    const { email, password } = body as { email: string; password: string };

    if (!email || !password) {
      set.status = 400;
      return { error: "Email and password are required" };
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      set.status = 401;
      return { error: "Invalid credentials" };
    }

    const valid = await verifyPassword(user.passwordHash, password);

    if (!valid) {
      set.status = 401;
      return { error: "Invalid credentials" };
    }

    const token = generateRandomString(48, "a-z", "A-Z", "0-9");
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

    await db.insert(sessions).values({
      userId: user.id,
      token,
      expiresAt,
    });

    cookie[SESSION_COOKIE_NAME].set({
      value: token,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_MS / 1000,
    });

    return {
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
      },
    };
  })
  .post("/auth/logout", async ({ cookie, set }) => {
    const token = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;

    if (token) {
      await db.delete(sessions).where(eq(sessions.token, token));
    }

    cookie[SESSION_COOKIE_NAME].set({
      value: "",
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });

    set.status = 200;
    return { data: { success: true } };
  })
  .post("/auth/register", async ({ body, set, cookie }) => {
    const { name, email, password } = body as {
      name: string;
      email: string;
      password: string;
    };

    if (!name || !email || !password) {
      set.status = 400;
      return { error: "Name, email, and password are required" };
    }

    if (password.length < 8) {
      set.status = 400;
      return { error: "Password must be at least 8 characters" };
    }

    // Check if email already exists
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      set.status = 409;
      return { error: "An account with this email already exists" };
    }

    const passwordHash = await hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash })
      .returning();

    // Auto-login after registration
    const token = generateRandomString(48, "a-z", "A-Z", "0-9");
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

    await db.insert(sessions).values({
      userId: user.id,
      token,
      expiresAt,
    });

    cookie[SESSION_COOKIE_NAME].set({
      value: token,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_MS / 1000,
    });

    set.status = 201;
    return {
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
      },
    };
  })
  .get("/auth/session", async ({ cookie, set }) => {
    const token = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;
    const userId = await validateSession(token);

    if (!userId) {
      set.status = 401;
      return { error: "Not authenticated" };
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      set.status = 401;
      return { error: "Not authenticated" };
    }

    return {
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
      },
    };
  });

/**
 * Auth guard — use with `.use(authGuard)` on route groups that require authentication.
 * Derives `userId` into the request context. Returns 401 if session is invalid.
 *
 * Usage in route files:
 * ```ts
 * const protectedRoutes = new Elysia()
 *   .use(authGuard)
 *   .post("/something", ({ userId }) => { ... })
 * ```
 */
export const authGuard = new Elysia({ name: "authGuard" })
  .derive({ as: "scoped" }, async ({ cookie, set }) => {
    const token = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;
    const userId = await validateSession(token);

    if (!userId) {
      set.status = 401;
    }

    return { userId: userId as string };
  })
  .onBeforeHandle({ as: "scoped" }, ({ userId, set }) => {
    if (!userId) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
  });
