import { PermissionCache } from "./cache";

/**
 * Process-wide permission cache shared by both:
 *   - lib/cms/api/auth.ts (powers `/auth/session` → drives sidebar permissions)
 *   - lib/cms/rbac/middleware.ts (powers `requirePermission` → drives API access)
 *
 * Lives in its own module to avoid a circular import between auth.ts and
 * middleware.ts, and to ensure both surfaces share a single source of truth.
 * Invalidate via `permissionCache.invalidate(userId)` whenever a user's
 * roles/permissions change (login, logout, role grant, role revoke).
 */
export const permissionCache = new PermissionCache();
