import { Elysia } from "elysia";
import { eq, and, gt } from "drizzle-orm";
import {
  hashPassword,
  verifyPassword,
} from "better-auth/crypto";
import { generateRandomString } from "better-auth/crypto";
import { db } from "../db";
import { users, sessions, brokerProfiles, brokerCompanies, roles, userRoles } from "../schema";
import { loadUserRoles, resolvePermissions } from "../rbac/engine";
import { permissionCache } from "../rbac/permission-cache";

export const SESSION_COOKIE_NAME = "ora_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Cookie attributes shared by every endpoint that writes the session cookie.
 *
 * - `secure` is enabled in production so HTTPS-only deployments (Vercel,
 *   Cloudflare, etc.) actually persist + send the cookie on subsequent
 *   requests. Without it, some browsers (notably Safari/ITP) will accept
 *   the cookie but treat it as transient and silently drop it on POST
 *   navigations, producing 401s on actions like clone-locale that work
 *   fine over local HTTP.
 * - `sameSite: "lax"` is sufficient because admin + API share an origin.
 */
const SESSION_COOKIE_BASE = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

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
 * Resolve identity context (roles, permissions, broker info) for a user.
 * Uses the permission cache to avoid repeated DB lookups.
 */
async function resolveIdentityContext(userId: string, userType: string) {
  // Check cache first
  const cached = permissionCache.get(userId);
  let roleNames: string[];
  let permissionStrings: string[];

  if (cached) {
    roleNames = cached.roles;
    permissionStrings = cached.permissions;
  } else {
    const userRolesResult = await loadUserRoles(db, userId);
    roleNames = userRolesResult.map((r) => r.name);
    permissionStrings = await resolvePermissions(db, userRolesResult);
    permissionCache.set(userId, {
      roles: roleNames,
      permissions: permissionStrings,
    });
  }

  // Load broker-specific context if applicable
  let broker: {
    companyId: string;
    companyName: string;
    companyStatus: string;
    isCompanyAdmin: boolean;
    profileStatus: string;
  } | undefined;

  if (userType === "broker") {
    const [profile] = await db
      .select({
        companyId: brokerProfiles.companyId,
        companyName: brokerCompanies.companyName,
        companyStatus: brokerCompanies.status,
        isCompanyAdmin: brokerProfiles.isCompanyAdmin,
        profileStatus: brokerProfiles.status,
      })
      .from(brokerProfiles)
      .innerJoin(
        brokerCompanies,
        eq(brokerProfiles.companyId, brokerCompanies.id)
      )
      .where(eq(brokerProfiles.userId, userId))
      .limit(1);

    if (profile) {
      broker = {
        companyId: profile.companyId,
        companyName: profile.companyName,
        companyStatus: profile.companyStatus,
        isCompanyAdmin: profile.isCompanyAdmin,
        profileStatus: profile.profileStatus,
      };
    }
  }

  return { roleNames, permissionStrings, broker };
}

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

    // Reject login for users with null password_hash (e.g. broker pre-credential users)
    if (!user.passwordHash) {
      set.status = 401;
      return { error: "Invalid credentials" };
    }

    // Check if account is deactivated
    if (!user.isActive) {
      set.status = 401;
      return { error: "Account is deactivated" };
    }

    const valid = await verifyPassword({
      hash: user.passwordHash,
      password,
    });

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
      ...SESSION_COOKIE_BASE,
      value: token,
      maxAge: SESSION_MAX_AGE_MS / 1000,
    });

    // Bust any stale cached permissions for this user so freshly granted
    // roles take effect on the next request.
    permissionCache.invalidate(user.id);

    // Resolve identity context for login response
    const { roleNames, permissionStrings, broker } = await resolveIdentityContext(user.id, user.userType);

    return {
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
        userType: user.userType,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        roles: roleNames,
        permissions: permissionStrings,
        ...(broker ? { broker } : {}),
      },
    };
  })
  .post("/auth/logout", async ({ cookie, set }) => {
    const token = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;

    if (token) {
      // Best-effort: invalidate the cached permissions for the owner of
      // this session before deleting it.
      const userId = await validateSession(token);
      if (userId) permissionCache.invalidate(userId);
      await db.delete(sessions).where(eq(sessions.token, token));
    }

    cookie[SESSION_COOKIE_NAME].set({
      ...SESSION_COOKIE_BASE,
      value: "",
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
      .values({ name, email, passwordHash, userType: "employee", emailVerified: true })
      .returning();

    // Auto-grant super_admin role to new employee registrations.
    // (The panel is internal — register flow is gated by deployment, not by
    // public access. Without this, fresh users have zero permissions and the
    // sidebar appears empty.)
    const [superAdminRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.name, "super_admin"), eq(roles.userType, "employee")))
      .limit(1);
    if (superAdminRole) {
      await db
        .insert(userRoles)
        .values({ userId: user.id, roleId: superAdminRole.id })
        .onConflictDoNothing();
    }

    // Auto-login after registration
    const token = generateRandomString(48, "a-z", "A-Z", "0-9");
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

    await db.insert(sessions).values({
      userId: user.id,
      token,
      expiresAt,
    });

    cookie[SESSION_COOKIE_NAME].set({
      ...SESSION_COOKIE_BASE,
      value: token,
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
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        userType: users.userType,
        isActive: users.isActive,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      set.status = 401;
      return { error: "Not authenticated" };
    }

    // Resolve identity context (roles, permissions, broker info)
    const { roleNames, permissionStrings, broker } = await resolveIdentityContext(user.id, user.userType);

    return {
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
        userType: user.userType,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        roles: roleNames,
        permissions: permissionStrings,
        ...(broker ? { broker } : {}),
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
