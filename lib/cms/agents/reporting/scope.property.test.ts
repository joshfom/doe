import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  resolveReportScope,
  EXEC_SCOPE_PERMISSION,
  REP_SCOPE_PERMISSION,
  type RequestedScope,
  type ScopeResolution,
} from "./scope";

// Feature: agentic-reporting-twin, Property 7: For any set of RBAC permissions and any requested scope, `resolveReportScope` resolves to the broadest scope the permissions allow and never to a scope that includes analytics or records outside those permissions; a rep-level role with no org-wide permission and no explicit `repId` resolves to `rep` bound to the user's own `repId`; and a request that cannot be resolved to a single scope yields a clarification rather than a Pipeline_Summary_Tool invocation.

// ── Arbitraries ───────────────────────────────────────────────────────────────

/**
 * RBAC permission strings. We mix the two reporting permissions with arbitrary
 * noise permissions so the property holds across realistic permission sets that
 * carry unrelated grants.
 */
const noisePermArb = fc.constantFrom(
  "leads:read",
  "leads:write",
  "blog:publish",
  "report:export",
  "user:read",
  "deal:read",
);

/** A permission set that may or may not include each reporting permission, plus noise. */
const permsArb: fc.Arbitrary<string[]> = fc
  .record({
    exec: fc.boolean(),
    rep: fc.boolean(),
    noise: fc.array(noisePermArb, { maxLength: 5 }),
  })
  .map(({ exec, rep, noise }) => {
    const perms: string[] = [...noise];
    if (exec) perms.push(EXEC_SCOPE_PERMISSION);
    if (rep) perms.push(REP_SCOPE_PERMISSION);
    return perms;
  });

/** An identifier that is genuinely non-empty (the implementation treats "" as absent). */
const repIdArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => s.length > 0);

/** A scope dimension: the two known scopes, plus arbitrary unrecognised strings. */
const requestedScopeFieldArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom("exec", "rep"),
  // Unrecognised scope dimension — must yield a clarify on "scope".
  fc.constantFrom("team", "region", "", "EXEC", "global"),
) as fc.Arbitrary<RequestedScope["scope"]>;

const requestedArb: fc.Arbitrary<RequestedScope> = fc.record(
  {
    scope: requestedScopeFieldArb,
    period: fc.option(fc.constantFrom("all-time", "this-week", "this-month"), {
      nil: undefined,
    }),
    repId: fc.option(repIdArb, { nil: undefined }),
    ownRepId: fc.option(repIdArb, { nil: undefined }),
  },
  { requiredKeys: [] },
);

// ── Helpers ────────────────────────────────────────────────────────────────────

function canExecFrom(perms: string[]): boolean {
  return perms.includes(EXEC_SCOPE_PERMISSION);
}
function canRepFrom(perms: string[]): boolean {
  return perms.includes(REP_SCOPE_PERMISSION);
}

const NUM_RUNS = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Property 7: Report_Scope resolves to the broadest permitted scope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.7, 3.1, 3.3**
 *
 * Property 7: Report_Scope resolves to the broadest permitted scope.
 *
 * For any set of RBAC permissions and any requested scope, `resolveReportScope`
 * resolves to the broadest scope the permissions allow and never to a scope that
 * includes analytics or records outside those permissions; a rep-level role with
 * no org-wide permission and no explicit `repId` resolves to `rep` bound to the
 * user's own `repId`; and a request that cannot be resolved to a single scope
 * yields a clarification rather than a Pipeline_Summary_Tool invocation.
 */
// Feature: agentic-reporting-twin, Property 7: Report_Scope resolves to the broadest permitted scope
describe("Feature: agentic-reporting-twin, Property 7: Report_Scope resolves to the broadest permitted scope", () => {
  it("never resolves a scope the permissions do not grant", () => {
    fc.assert(
      fc.property(permsArb, requestedArb, (perms, requested) => {
        const result = resolveReportScope(perms, requested);
        const canExec = canExecFrom(perms);
        const canRep = canRepFrom(perms);

        if (result.kind === "scope") {
          if (result.scope.scope === "exec") {
            // An exec (org-wide) scope is only ever resolved for an exec-capable role.
            expect(canExec).toBe(true);
          } else {
            // A rep scope requires SOME reporting permission (exec may drill into a rep).
            expect(canExec || canRep).toBe(true);
            // A resolved rep scope always carries a concrete repId.
            expect(typeof result.scope.repId).toBe("string");
            expect(result.scope.repId!.length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("resolves to the broadest permitted scope (exec when org-wide permitted and no rep drilldown requested)", () => {
    fc.assert(
      fc.property(permsArb, requestedArb, (perms, requested) => {
        const canExec = canExecFrom(perms);
        if (!canExec) return; // only assert the broadest-scope rule for exec-capable roles

        const result = resolveReportScope(perms, requested);
        const wantsRep =
          requested.scope === "rep" ||
          (requested.scope === undefined &&
            typeof requested.repId === "string" &&
            requested.repId.length > 0);
        const wantsExec = requested.scope === "exec";
        const unrecognised =
          requested.scope !== undefined && !wantsRep && !wantsExec;

        if (unrecognised) {
          // An unrecognised scope dimension is unresolvable → clarify.
          expect(result.kind).toBe("clarify");
          return;
        }

        if (!wantsRep) {
          // No rep drilldown requested → broadest scope is exec.
          expect(result.kind).toBe("scope");
          expect((result as Extract<ScopeResolution, { kind: "scope" }>).scope.scope).toBe(
            "exec",
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a rep-level role with no org-wide permission and no explicit repId clamps to its own repId", () => {
    fc.assert(
      fc.property(
        fc.array(noisePermArb, { maxLength: 5 }),
        // requested scope: rep or unspecified (no explicit repId), with an ownRepId available
        fc.constantFrom<RequestedScope["scope"]>(undefined, "rep"),
        repIdArb,
        fc.option(fc.constantFrom("all-time", "this-week"), { nil: undefined }),
        (noise, scope, ownRepId, period) => {
          // Rep-level role: has rep permission, no exec permission.
          const perms = [...noise, REP_SCOPE_PERMISSION];
          const requested: RequestedScope = { scope, period, ownRepId };

          const result = resolveReportScope(perms, requested);

          expect(result.kind).toBe("scope");
          const resolved = (
            result as Extract<ScopeResolution, { kind: "scope" }>
          ).scope;
          expect(resolved.scope).toBe("rep");
          // Bound to the user's OWN repId (Requirement 3.3).
          expect(resolved.repId).toBe(ownRepId);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a rep-level role with no org-wide permission, no explicit repId, and no own repId yields clarify (not a scope)", () => {
    fc.assert(
      fc.property(
        fc.array(noisePermArb, { maxLength: 5 }),
        fc.constantFrom<RequestedScope["scope"]>(undefined, "rep"),
        fc.option(fc.constantFrom("all-time", "this-week"), { nil: undefined }),
        (noise, scope, period) => {
          const perms = [...noise, REP_SCOPE_PERMISSION];
          const requested: RequestedScope = { scope, period };

          const result = resolveReportScope(perms, requested);

          // Unresolvable to a single scope → clarify on the missing repId.
          expect(result.kind).toBe("clarify");
          expect((result as Extract<ScopeResolution, { kind: "clarify" }>).missing).toBe(
            "repId",
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("denies when the user holds no reporting permission for any scope", () => {
    fc.assert(
      fc.property(
        fc.array(noisePermArb, { maxLength: 6 }),
        requestedArb,
        (noise, requested) => {
          // Strip any reporting permission that noise might (it cannot) contain.
          const perms = noise.filter(
            (p) => p !== EXEC_SCOPE_PERMISSION && p !== REP_SCOPE_PERMISSION,
          );

          const result = resolveReportScope(perms, requested);

          expect(result.kind).toBe("deny");
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("an unresolvable (unrecognised) scope dimension yields clarify, never a scope invocation", () => {
    fc.assert(
      fc.property(
        permsArb,
        fc.constantFrom("team", "region", "global", "EXEC", ""),
        fc.option(repIdArb, { nil: undefined }),
        fc.option(repIdArb, { nil: undefined }),
        (perms, badScope, repId, ownRepId) => {
          // Only meaningful when the user actually has some reporting permission;
          // otherwise the deny gate takes precedence (asserted separately above).
          if (!canExecFrom(perms) && !canRepFrom(perms)) return;

          const result = resolveReportScope(perms, {
            scope: badScope as RequestedScope["scope"],
            repId,
            ownRepId,
          });

          expect(result.kind).toBe("clarify");
          expect((result as Extract<ScopeResolution, { kind: "clarify" }>).missing).toBe(
            "scope",
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
