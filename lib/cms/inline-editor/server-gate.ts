/**
 * Server-side inline-editor gate.
 *
 * Spec: custom-branded-page-builder — task 15.5 support
 * _Requirements: 8.3, 9.1, 9.2, 16.1, 19.1_
 *
 * Single source of truth for "is this request allowed to mount inline
 * editor affordances?". Used by `InlineEditorProvider` (to decide
 * whether to render the editor chunk) and by the public page routes
 * (to decide whether to pass `editMode={true}` to `PageRenderer`,
 * which adds `data-puck-id` annotations the editor needs to map
 * clicks to blocks).
 *
 * Anonymous visitors and users without `pages:edit` ALWAYS resolve to
 * `false` here, preserving the byte-identity invariant for the public
 * HTML (Req 16.1, Property 5).
 *
 * The check is intentionally server-only — feature flag, session, and
 * RBAC are all read fresh on every request, so revoking a permission
 * takes effect on the next page navigation without any client cache
 * invalidation.
 */

import { cookies } from "next/headers";
import { db } from "@/lib/cms/db";
import { siteSettings } from "@/lib/cms/schema";
import { SESSION_COOKIE_NAME, validateSession } from "@/lib/cms/api/auth";
import {
  hasPermission,
  loadUserRoles,
  resolvePermissions,
} from "@/lib/cms/rbac/engine";
import { resolveFeatureFlag } from "@/lib/cms/hooks/feature-flag-utils";

/**
 * Result of the `pages:edit` authorization gate.
 *
 * - `{ ok: true; userId }` — the request has an authenticated session whose
 *   resolved permissions include `pages:edit`.
 * - `{ ok: false; reason: "unauthenticated" }` — no valid session.
 * - `{ ok: false; reason: "forbidden" }` — authenticated, but lacking
 *   `pages:edit`.
 */
export type RequirePagesEditResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unauthenticated" | "forbidden" };

/**
 * Reusable server-side `pages:edit` authorization gate.
 *
 * Encapsulates the session + RBAC machinery
 * (`validateSession` → `loadUserRoles` → `resolvePermissions` →
 * `hasPermission(.., 'pages:edit')`) **without** the `inline_editor`
 * feature-flag check — the live editor route is the canonical editing
 * surface and is not gated by the old experimental rollout flag.
 *
 * Session and RBAC are read fresh on every call (no caching), so a revoked
 * permission takes effect on the next navigation without any client cache
 * invalidation.
 */
export async function requirePagesEdit(): Promise<RequirePagesEditResult> {
  // Authenticated session — DB-backed, not just cookie presence.
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  const userId = await validateSession(token);
  if (!userId) return { ok: false, reason: "unauthenticated" };

  // RBAC — `pages:edit` is the gating permission.
  const roles = await loadUserRoles(db, userId);
  const perms = await resolvePermissions(db, roles);
  if (!hasPermission(perms, "pages:edit")) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, userId };
}

export async function canMountInlineEditor(): Promise<boolean> {
  // Feature flag — never mount unless the rollout is on.
  const settingsRows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings);
  if (!resolveFeatureFlag("inline_editor", settingsRows)) return false;

  // Session + RBAC machinery is shared with the live editor route.
  const gate = await requirePagesEdit();
  return gate.ok;
}
