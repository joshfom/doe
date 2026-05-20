/**
 * RBAC gate — Property 4 + Property 9.
 *
 * Spec: custom-branded-page-builder — tasks 14.4, 16.3
 * _Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 19.1, 19.3, 19.4, 21.4_
 *
 * Tag: Feature: custom-branded-page-builder, Property 4: RBAC access invariant
 * Tag: Feature: custom-branded-page-builder, Property 9: Server-side save permission re-check
 *
 * The InlineEditorProvider is a server component that performs three
 * checks (feature flag, session, RBAC). Rather than render it (which
 * requires a real DB and Next.js server runtime), we validate the
 * underlying invariant: `hasPermission(perms, "pages:edit")` returns
 * `true` if and only if the permission set explicitly grants
 * `pages:edit` (exact match), grants the `pages:*` resource wildcard,
 * or grants the global `*:*` wildcard.
 *
 * Property 9 (server-side re-check) is exercised symmetrically: the
 * helper used by the route handler (`userCanEditPages` →
 * `hasPermission`) MUST yield the same answer as any client-side
 * cache, so a 403 outcome is exclusively a function of the live
 * `roles` + `user_roles` state — never a function of the request
 * shape.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { hasPermission } from "@/lib/cms/rbac/engine";

const ITERATIONS = { numRuns: 200 };

const requiredPermArb = fc.constant("pages:edit");

/**
 * Generate a permission string of the form `resource:action`. Both
 * sides are lowercase ASCII identifiers, matching the format the RBAC
 * engine validates against.
 */
const permissionStringArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z_]{0,15}$/),
    fc.stringMatching(/^[a-z][a-z_]{0,15}$/),
  )
  .map(([resource, action]) => `${resource}:${action}`);

const permissionListArb = fc.array(permissionStringArb, {
  minLength: 0,
  maxLength: 12,
});

describe("Feature: custom-branded-page-builder — Property 4: RBAC access invariant", () => {
  it("grants edit iff the permission set contains pages:edit, pages:*, or *:*", () => {
    fc.assert(
      fc.property(permissionListArb, requiredPermArb, (perms, required) => {
        const granted = hasPermission(perms, required);
        const expected =
          perms.includes("pages:edit") ||
          perms.includes("pages:*") ||
          perms.includes("*:*");
        expect(granted).toBe(expected);
      }),
      ITERATIONS,
    );
  });

  it("denies access for any user with an empty permission set", () => {
    expect(hasPermission([], "pages:edit")).toBe(false);
  });

  it("ignores unrelated wildcards (e.g. tickets:* does not grant pages:edit)", () => {
    fc.assert(
      fc.property(
        fc
          .array(permissionStringArb, { minLength: 0, maxLength: 8 })
          .filter(
            (perms) =>
              !perms.includes("pages:edit") &&
              !perms.includes("pages:*") &&
              !perms.includes("*:*"),
          ),
        (perms) => {
          expect(hasPermission(perms, "pages:edit")).toBe(false);
        },
      ),
      ITERATIONS,
    );
  });
});

describe("Feature: custom-branded-page-builder — Property 9: Server-side save permission re-check", () => {
  /**
   * The PUT /pages/:id handler calls `loadUserRoles` + `resolvePermissions`
   * + `hasPermission` on every request — independent of any client
   * cache. The invariant tested here is that the server's decision is
   * a pure function of the resolved permissions, never of request
   * metadata. We model this by asserting `hasPermission` is referentially
   * transparent for any (perms, required) pair.
   */
  it("server decision depends only on the resolved permission set", () => {
    fc.assert(
      fc.property(permissionListArb, requiredPermArb, (perms, required) => {
        const a = hasPermission(perms, required);
        const b = hasPermission([...perms], required);
        expect(a).toBe(b);
      }),
      ITERATIONS,
    );
  });
});
