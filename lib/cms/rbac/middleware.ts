import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE_NAME, validateSession } from "../api/auth";
import { db } from "../db";
import { users, brokerProfiles, brokerCompanies } from "../schema";
import {
  type UserType,
  loadUserRoles,
  resolvePermissions,
  hasPermission,
} from "./engine";
import { permissionCache } from "./permission-cache";

// ── Constants ────────────────────────────────────────────────────────────────

export const PORTAL_TYPE_MAP: Record<string, UserType> = {
  "/ora-panel": "employee",
  "/broker-portal": "broker",
  "/client-portal": "client",
  "/vendor-portal": "vendor",
};

// ── Shared permission cache instance ─────────────────────────────────────────
// Sourced from a dedicated module so it stays in sync with the cache used by
// /auth/session. See lib/cms/rbac/permission-cache.ts.

// ── identityGuard ────────────────────────────────────────────────────────────

/**
 * Elysia plugin that extends `authGuard` with identity context.
 * After authGuard derives userId, loads user record and validates
 * active status, email verification, and broker-specific checks.
 *
 * Derives: userType, isActive, emailVerified, brokerContext (for broker users)
 */
export const identityGuard = new Elysia({ name: "identityGuard" })
  .derive({ as: "scoped" }, async ({ cookie, set }) => {
    const token = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;
    const userId = await validateSession(token);
    if (!userId) {
      set.status = 401;
    }
    return { userId: (userId ?? "") as string };
  })
  .derive({ as: "scoped" }, async ({ userId, set }) => {
    if (!userId) {
      return {
        userType: null as unknown as UserType,
        isActive: false,
        emailVerified: false,
        brokerContext: null as {
          companyId: string;
          companyStatus: string;
          profileStatus: string;
          isCompanyAdmin: boolean;
        } | null,
      };
    }
    const [user] = await db
      .select({
        userType: users.userType,
        isActive: users.isActive,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      set.status = 401;
      return {
        userType: null as unknown as UserType,
        isActive: false,
        emailVerified: false,
        brokerContext: null as {
          companyId: string;
          companyStatus: string;
          profileStatus: string;
          isCompanyAdmin: boolean;
        } | null,
      };
    }

    let brokerContext: {
      companyId: string;
      companyStatus: string;
      profileStatus: string;
      isCompanyAdmin: boolean;
    } | null = null;

    if (user.userType === "broker") {
      const [profile] = await db
        .select({
          companyId: brokerProfiles.companyId,
          profileStatus: brokerProfiles.status,
          isCompanyAdmin: brokerProfiles.isCompanyAdmin,
          companyStatus: brokerCompanies.status,
        })
        .from(brokerProfiles)
        .innerJoin(
          brokerCompanies,
          eq(brokerProfiles.companyId, brokerCompanies.id)
        )
        .where(eq(brokerProfiles.userId, userId))
        .limit(1);

      if (profile) {
        brokerContext = {
          companyId: profile.companyId,
          companyStatus: profile.companyStatus,
          profileStatus: profile.profileStatus,
          isCompanyAdmin: profile.isCompanyAdmin,
        };
      }
    }

    return {
      userType: user.userType as UserType,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      brokerContext,
    };
  })
  .onBeforeHandle(
    { as: "scoped" },
    ({ userType, isActive, emailVerified, brokerContext, set }) => {
      if (!userType) {
        set.status = 401;
        return { error: "Not authenticated" };
      }

      if (!isActive) {
        set.status = 401;
        return { error: "Account is deactivated" };
      }

      if (!emailVerified) {
        set.status = 401;
        return { error: "Email not verified" };
      }

      if (userType === "broker" && brokerContext) {
        if (brokerContext.profileStatus !== "active") {
          set.status = 403;
          return { error: "Access denied: broker profile inactive" };
        }
        if (brokerContext.companyStatus !== "active") {
          set.status = 403;
          return { error: "Access denied: company not active" };
        }
      }
    }
  );

// ── portalGuard ──────────────────────────────────────────────────────────────

/**
 * Factory function that returns an Elysia plugin verifying the user's
 * userType matches the expected portal. Applied before role/permission
 * loading for fail-fast behavior.
 */
export function portalGuard(portal: string) {
  const expectedType = PORTAL_TYPE_MAP[portal];

  return new Elysia({ name: `portalGuard:${portal}` }).onBeforeHandle(
    { as: "scoped" },
    (ctx: any) => {
      if (!expectedType || ctx.userType !== expectedType) {
        ctx.set.status = 403;
        return { error: "Access denied: portal type mismatch" };
      }
    }
  );
}

// ── requirePermission ────────────────────────────────────────────────────────

/**
 * Factory function that returns an Elysia plugin checking the user
 * has the required permission. If no permission string is provided,
 * only valid authentication is required (identity checks already passed).
 */
export function requirePermission(permission?: string) {
  return new Elysia({
    name: `requirePermission:${permission ?? "auth-only"}`,
  })
    .derive({ as: "scoped" }, async (ctx: any) => {
      const userId: string = ctx.userId;

      // Check cache first
      const cached = permissionCache.get(userId);
      if (cached) {
        return {
          resolvedRoles: cached.roles,
          resolvedPermissions: cached.permissions,
        };
      }

      // Load from DB
      const userRolesResult = await loadUserRoles(db, userId);
      const roleNames = userRolesResult.map((r) => r.name);
      const perms = await resolvePermissions(db, userRolesResult);

      // Cache the result
      permissionCache.set(userId, {
        roles: roleNames,
        permissions: perms,
      });

      return {
        resolvedRoles: roleNames,
        resolvedPermissions: perms,
      };
    })
    .onBeforeHandle({ as: "scoped" }, (ctx: any) => {
      // If no permission declared, only authentication is required (already validated)
      if (!permission) return;

      const resolvedPermissions: string[] = ctx.resolvedPermissions ?? [];

      if (!hasPermission(resolvedPermissions, permission)) {
        ctx.set.status = 403;
        return {
          error: "Access denied: insufficient permissions",
          required: permission,
        };
      }
    });
}

// ── requireAdmin ─────────────────────────────────────────────────────────────

/**
 * Elysia plugin that gates a route to platform administrators only.
 *
 * Used by destructive, platform-wide operations such as `POST /api/demo/reset`
 * (DOE Voice Surface, task 18.2 / Req 14.7), which wipes the demo dataset and
 * must never be reachable by an ordinary authenticated user.
 *
 * "Admin" is the global RBAC wildcard `*:*` — the permission held only by the
 * `super_admin` role (see `ROLE_PERMISSION_MAP` in `rbac/seed.ts`). Resolving
 * permissions and checking the wildcard reuses the same machinery as
 * `requirePermission`, so this stays consistent with every other guarded route.
 *
 * Compose it after `identityGuard` (which establishes the authenticated
 * `userId`), exactly like `requirePermission`:
 *
 * ```ts
 * new Elysia().use(identityGuard).use(requireAdmin)
 * ```
 */
export const requireAdmin = new Elysia({ name: "requireAdmin" })
  .derive({ as: "scoped" }, async (ctx: any) => {
    const userId: string = ctx.userId;

    const cached = permissionCache.get(userId);
    if (cached) {
      return {
        resolvedRoles: cached.roles,
        resolvedPermissions: cached.permissions,
      };
    }

    const userRolesResult = await loadUserRoles(db, userId);
    const roleNames = userRolesResult.map((r) => r.name);
    const perms = await resolvePermissions(db, userRolesResult);

    permissionCache.set(userId, {
      roles: roleNames,
      permissions: perms,
    });

    return {
      resolvedRoles: roleNames,
      resolvedPermissions: perms,
    };
  })
  .onBeforeHandle({ as: "scoped" }, (ctx: any) => {
    const resolvedPermissions: string[] = ctx.resolvedPermissions ?? [];

    // Admin == the global `*:*` wildcard (super_admin). `hasPermission` returns
    // true for any required permission when `*:*` is present, so we check the
    // wildcard directly to demand full admin rather than a narrow grant.
    if (!resolvedPermissions.includes("*:*")) {
      ctx.set.status = 403;
      return {
        error: "Access denied: admin privileges required",
      };
    }
  });
