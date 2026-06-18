/**
 * Agentic Reporting & C-Level Twin (S4) — Report_Scope resolution
 * (Design §Components #7 "Role-scoped access & scope resolution").
 *
 * `resolveReportScope` is a PURE function over the requesting user's already
 * resolved RBAC permission strings and the scope dimensions the request
 * supplied. It performs NO database access, no RBAC engine call, and no I/O —
 * it only decides which single Report_Scope the agent should fetch figures for,
 * or whether the request needs clarification, or whether the user holds no
 * reporting permission at all.
 *
 * The one rule it enforces (Requirement 3.1): resolve to the BROADEST scope the
 * user's permissions allow, and never to a scope that includes analytics or
 * records outside those permissions.
 *
 *   - exec (org-wide) is the broadest scope; it requires `report:scope:exec`.
 *   - rep (a single rep) requires `report:scope:rep` (an exec-capable role may
 *     also drill into a single rep, which stays within its permission).
 *
 * What this function deliberately does NOT do (Requirement 16.4 — do not
 * duplicate RBAC):
 *   - It does not enforce CROSS-REP denial (a rep-level user supplying another
 *     rep's `repId`). That is the dispatcher's job (Requirement 3.6): the
 *     function resolves the requested rep scope and `dispatchTool`'s RBAC check
 *     plus the scope-bound handler clamp deny the cross-rep read at execution.
 *   - It does not re-implement the RBAC permission engine. It only reads the
 *     already-resolved `perms` array a caller hands it.
 *
 * It does, however, signal the simple "no reporting permission for ANY scope"
 * case as `deny` (Requirement 3.7) so the agent never invokes the
 * Pipeline_Summary_Tool for a user who cannot read any report; the dispatcher
 * still independently enforces the same gate at execution.
 *
 * Design references: §Components #7, §Data Models (`ReportScope`,
 * `ScopeResolution`), §Correctness Properties (Property 7).
 * Requirements: 1.7, 3.1, 3.3, 3.7.
 */

// ── Report_Scope (shared with queryPipelineMetrics) ───────────────────────────

/**
 * The `{ scope, period, repId? }` selector for an analytics request (Design
 * §Data Models). `scope` is `exec` (org-wide) or `rep` (a single rep); `repId`
 * is required when `scope === "rep"`. The shape mirrors the input
 * `queryPipelineMetrics` accepts, so a resolved scope drives the single
 * `PipelineMetrics` read for the turn without translation.
 */
export interface ReportScope {
  /** "exec" (org-wide) or "rep" (a single rep). */
  scope: "exec" | "rep";
  /** Period label, e.g. "all-time", "this-week". */
  period: string;
  /** The rep identifier; present (and required) when `scope === "rep"`. */
  repId?: string;
}

// ── Resolution result ─────────────────────────────────────────────────────────

/**
 * The outcome of resolving a request to a single Report_Scope (Design
 * §Components #7):
 *
 *   - `scope`   — resolved to the broadest permitted Report_Scope.
 *   - `clarify` — the request cannot be reduced to a single scope; `missing`
 *                 names the ambiguous/missing scope dimension (Requirement 1.7).
 *                 The agent asks for clarification and does NOT invoke the
 *                 Pipeline_Summary_Tool.
 *   - `deny`    — the user holds no reporting permission for any scope
 *                 (Requirement 3.7). The dispatcher independently enforces the
 *                 same gate; this signal stops the agent before it tries.
 */
export type ScopeResolution =
  | { kind: "scope"; scope: ReportScope }
  | { kind: "clarify"; missing: string }
  | { kind: "deny"; reason: string };

/** The dimensions a request may supply, plus the caller's own rep id for clamping. */
export type RequestedScope = Partial<ReportScope> & {
  /** The requesting user's own `repId`, used to clamp a rep-level role (Req 3.3). */
  ownRepId?: string;
};

// ── Reporting permission strings (existing `resource:action` format) ──────────

/** Org-wide reporting permission — grants the broadest (`exec`) scope. */
export const EXEC_SCOPE_PERMISSION = "report:scope:exec";

/** Rep-level reporting permission — grants a single-rep (`rep`) scope. */
export const REP_SCOPE_PERMISSION = "report:scope:rep";

/** The default period label when a request supplies none (matches queryPipelineMetrics). */
const DEFAULT_PERIOD = "all-time";

// ── resolveReportScope ────────────────────────────────────────────────────────

function nonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Resolve a request to a single Report_Scope, clamping to the broadest scope the
 * user's permissions allow.
 *
 * Resolution rules (Design §Components #7):
 *
 *   1. No reporting permission for any scope → `deny` (Requirement 3.7).
 *   2. Rep-level role with no org-wide permission → always clamped to `rep`
 *      (the broadest it may read). With no explicit `repId`, it is bound to the
 *      user's own `repId` (Requirement 3.3); with no `repId` available at all,
 *      the scope is unresolvable → `clarify` on the missing `repId`.
 *   3. Exec-capable role:
 *        - an explicit `rep` request (or a bare `repId`) resolves to that rep
 *          scope (drilling into a rep stays within an exec permission); a `rep`
 *          request with no `repId` available is unresolvable → `clarify`.
 *        - otherwise resolves to the broadest permitted scope: `exec`.
 *   4. An unrecognised `scope` dimension is unresolvable → `clarify` on `scope`.
 *
 * Cross-rep denial (a rep-level role supplying another rep's `repId`) is NOT
 * decided here — it is left to the dispatcher (Requirement 3.6, 16.4).
 *
 * @param perms    the requesting user's already-resolved RBAC permission strings.
 * @param requested the scope dimensions the request supplied, plus `ownRepId`.
 */
export function resolveReportScope(
  perms: readonly string[],
  requested: RequestedScope = {}
): ScopeResolution {
  const canExec = perms.includes(EXEC_SCOPE_PERMISSION);
  const canRep = perms.includes(REP_SCOPE_PERMISSION);

  // (1) No reporting permission for any scope (Requirement 3.7).
  if (!canExec && !canRep) {
    return { kind: "deny", reason: "no reporting permission for any scope" };
  }

  const period = nonEmpty(requested.period) ? requested.period : DEFAULT_PERIOD;
  const requestedScope = requested.scope;
  const explicitRepId = nonEmpty(requested.repId) ? requested.repId : undefined;

  // A bare `repId` with no explicit scope signals rep intent.
  const wantsRep =
    requestedScope === "rep" ||
    (requestedScope === undefined && explicitRepId !== undefined);
  const wantsExec = requestedScope === "exec";

  // An unrecognised scope dimension cannot be resolved to a single scope (Req 1.7).
  if (requestedScope !== undefined && !wantsRep && !wantsExec) {
    return { kind: "clarify", missing: "scope" };
  }

  // (2) Rep-level role with no org-wide permission → clamp to rep (Requirement 3.1, 3.3).
  if (!canExec) {
    const repId = explicitRepId ?? requested.ownRepId;
    if (!nonEmpty(repId)) {
      // No explicit repId and no own repId to clamp to → unresolvable (Req 1.7).
      return { kind: "clarify", missing: "repId" };
    }
    return { kind: "scope", scope: { scope: "rep", period, repId } };
  }

  // (3) Exec-capable role.
  if (wantsRep) {
    const repId = explicitRepId ?? requested.ownRepId;
    if (!nonEmpty(repId)) {
      return { kind: "clarify", missing: "repId" };
    }
    return { kind: "scope", scope: { scope: "rep", period, repId } };
  }

  // Broadest permitted scope for an exec-capable role: exec (Requirement 3.1).
  return { kind: "scope", scope: { scope: "exec", period } };
}
