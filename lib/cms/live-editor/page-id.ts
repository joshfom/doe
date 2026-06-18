/**
 * Pure page-identifier validator for the live page editor route
 * (`/ora-panel/live/[id]`).
 *
 * Chosen format: canonical UUID (8-4-4-4-12 lowercase/uppercase hex).
 *
 * Rationale — grounded in the codebase:
 * - The `pages` table primary key is a Postgres UUID:
 *   `id: uuid("id").primaryKey().defaultRandom()` (see `lib/cms/schema.ts`),
 *   so every real page id is a canonical UUID.
 * - The same canonical UUID shape
 *   (`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`) is already
 *   used as the project-wide "this is a page/block id" pattern in the builder
 *   tests (e.g. `lib/page-builder/builder-shell/id-leak.property.test.ts`,
 *   `StatusBar.breadcrumb.test.tsx`).
 *
 * We validate format only (not UUID version/variant): any well-formed canonical
 * UUID is accepted. This is intentionally version-agnostic so the validator
 * stays correct if the id-generation strategy changes between UUID versions,
 * while still rejecting non-UUID inputs (slugs, empty strings, path traversal,
 * arbitrary text) before any database/API lookup.
 *
 * The regex is fully anchored (`^...$`) because this validates the entire id,
 * not a substring within larger text.
 *
 * Pure function: no I/O, no side effects — safe to import from the server route
 * to gate `[id]` before any `fetchPageById` call (Requirement 1.7).
 */
const PAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns `true` if and only if `id` matches the expected page-identifier
 * format (a canonical UUID). Returns `false` for any other input, including
 * empty strings and non-string values received at runtime.
 */
export function isValidPageId(id: string): boolean {
  if (typeof id !== "string") return false;
  return PAGE_ID_PATTERN.test(id);
}
