import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

// ── Mock modules (established pattern: see app/api/privacy/privacy.test.ts) ────

const mockCookiesGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookiesGet(name),
  }),
}));

vi.mock("@/lib/cms/api/auth", () => ({
  SESSION_COOKIE_NAME: "ora_session",
  validateSession: vi.fn(),
}));

// Keep the real `hasPermission` (pure RBAC matching) so the gate's authorization
// decision is exercised for real; only the I/O-bound role/permission loaders are
// stubbed so the property can drive resolved permission sets directly.
vi.mock("@/lib/cms/rbac/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cms/rbac/engine")>();
  return {
    ...actual,
    loadUserRoles: vi.fn(),
    resolvePermissions: vi.fn(),
  };
});

// `server-gate.ts` imports the db + schema at module load; stub them since
// `requirePagesEdit` reaches the DB only through the mocked RBAC loaders.
vi.mock("@/lib/cms/db", () => ({ db: {} }));
vi.mock("@/lib/cms/schema", () => ({ siteSettings: {} }));

// ── Import after mocks ────────────────────────────────────────────────────────

import { requirePagesEdit } from "./server-gate";
import { validateSession } from "@/lib/cms/api/auth";
import { loadUserRoles, resolvePermissions } from "@/lib/cms/rbac/engine";

// ── Generators ────────────────────────────────────────────────────────────────

const PAGES_EDIT = "pages:edit";

// A pool of valid, non-wildcard permission strings that are NOT `pages:edit`.
// Excluding wildcards (`*:*`, `pages:*`) keeps "set contains 'pages:edit'"
// equivalent to the gate's `hasPermission(perms, 'pages:edit')` decision, so the
// biconditional is exact.
const OTHER_PERMS = [
  "pages:view",
  "pages:delete",
  "pages:create",
  "blog:edit",
  "blog:view",
  "users:manage",
  "media:upload",
  "roles:assign",
  "settings:read",
];

const otherPermSet = fc.uniqueArray(fc.constantFrom(...OTHER_PERMS), {
  maxLength: OTHER_PERMS.length,
});

describe("requirePagesEdit authorization gate (property)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Feature: live-page-editor, Property 8: Authorization gate denies without pages:edit
  // For any request session, the gate authorizes iff the session is authenticated
  // AND its resolved permissions include `pages:edit`; otherwise it denies.
  // Validates: Requirements 1.3, 1.5
  it("authorizes iff authenticated AND resolved permissions include pages:edit", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // authenticated?
        fc.boolean(), // permissions include pages:edit?
        otherPermSet, // arbitrary unrelated permissions
        async (authenticated, includesPagesEdit, otherPerms) => {
          vi.clearAllMocks();

          const perms = includesPagesEdit
            ? [...otherPerms, PAGES_EDIT]
            : [...otherPerms];

          if (authenticated) {
            // (b)/(c): valid session → drive resolved permissions
            mockCookiesGet.mockReturnValue({ value: "valid-token" });
            vi.mocked(validateSession).mockResolvedValue("user-123");
            vi.mocked(loadUserRoles).mockResolvedValue([
              { id: "role-1" },
            ] as never);
            vi.mocked(resolvePermissions).mockResolvedValue(perms);
          } else {
            // (a): anonymous → no session → no userId
            mockCookiesGet.mockReturnValue(undefined);
            vi.mocked(validateSession).mockResolvedValue(null);
          }

          const result = await requirePagesEdit();

          const expectedOk = authenticated && perms.includes(PAGES_EDIT);

          // Biconditional: ok === (authenticated AND perms include pages:edit)
          expect(result.ok).toBe(expectedOk);

          if (expectedOk) {
            // authorized → carries the userId, no denial reason
            expect(result).toEqual({ ok: true, userId: "user-123" });
          } else if (!authenticated) {
            // anonymous denial
            expect(result).toEqual({
              ok: false,
              reason: "unauthenticated",
            });
            // never resolves permissions for an anonymous request
            expect(resolvePermissions).not.toHaveBeenCalled();
          } else {
            // authenticated but lacking pages:edit
            expect(result).toEqual({ ok: false, reason: "forbidden" });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
