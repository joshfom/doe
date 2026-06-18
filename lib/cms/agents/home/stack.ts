// lib/cms/agents/home/stack.ts
//
// Stack assembly for the Agent-First Home / Briefing Surface (S5, Design
// §Components #3 "The Briefing_Workflow" + #7 "RBAC-scoped briefings —
// Property P-RBACBrief").
//
// THE ONE RULE, preserved and load-bearing here: this module assembles the
// user's Stack ONLY by DISPATCHING the `list_stack` Catalog_Entry (and, where
// an item needs enriching, per-item Catalog_Entries) through the audited
// dispatcher. It imports NO Drizzle, holds no `db` handle, and never reads
// `tickets`/`leads_mirror`/`metrics_*` (or any table) directly — every read is
// a `dispatchTool` call so Zod → RBAC → OTP → audit → execute holds for the
// Stack exactly as for every other surface (Req 2.2, 6.1, 6.2). The dispatcher
// is INJECTED via {@link StackDeps.dispatch}, so the property test (task 6.2)
// can drive `assembleStack` over a `pg-mem`-backed RBAC-enforcing dispatcher
// (or any fake) with no real database.
//
// FAIL-CLOSED (Req 6.3, 6.4): RBAC scoping is enforced AT the dispatcher
// (`list_stack` already role-clamps the read to the requesting user's permitted
// rows). This module's contribution is to TRUST ONLY what the dispatcher
// affirmatively returns and to INVENT NOTHING: it includes a record only when
// the dispatch succeeded and the record is a well-formed Stack_Item, and treats
// any indeterminate / malformed / denied read as omitted. A dispatcher error,
// timeout, or a response that does not carry the requested Stack data yields
// the `{ unavailable: true }` marker (matching `Briefing.stack`'s union in
// `types.ts`) with NO fabricated or inferred items (Req 2.6).
//
// PRIVACY (Req 2.7, 9.4): every assembled item passes through the shared home
// redaction helper before it leaves this module — defence in depth over any raw
// phone a user may have typed into a title. A lead reference carries the salted
// `leadPhoneHash` only, which is not a raw phone and passes through unchanged.
//
// MEMORY (Req 6.5): Stack assembly draws on no Agent_Memory, so there is no
// cross-user memory read to scope here; the Home_Agent's own memory reads
// (`scope:"resource"` to the user) live with the agent (task 9.1), not here.
//
// Design references: §Components #3, §Components #7, §Data Models.
// Requirements: 2.2, 2.6, 6.1, 6.3, 6.4, 6.5.

import type { DispatchResult } from "../../ai/tools/dispatch";
import type { StackItem } from "./types";
import { redactHomeContent } from "./redact";

// ── Injected dispatcher contract ───────────────────────────────────────────────

/**
 * The injected, audited tool dispatcher this module assembles the Stack through
 * — a thin `callTool` over the S1 `dispatchTool`. Production binds the real
 * `db` handle and the home RBAC identity into this closure (so the dispatch
 * still runs Zod → RBAC → OTP → audit → execute); the property test (task 6.2)
 * injects a `pg-mem`-backed RBAC-enforcing fake. Either way `assembleStack`
 * holds no `db` and imports no Drizzle.
 *
 * It resolves to the same {@link DispatchResult} discriminated union the real
 * dispatcher returns — `{ ok: true, result }` or `{ ok: false, error }` — and,
 * like the real dispatcher, is expected not to throw; a thrown rejection is
 * nonetheless handled here as a fail-closed "unavailable" (Req 2.6).
 */
export type StackDispatch = (
  toolName: string,
  input: unknown,
) => Promise<DispatchResult>;

// ── ctx / deps shapes ──────────────────────────────────────────────────────────

/**
 * The requesting-user context an assembly is scoped to (Design §Components #7).
 * The RBAC clamp itself happens at the dispatcher against the requesting user's
 * identity; this context carries the period bounds and read filters the
 * Briefing_Workflow (task 7.1) wants the `list_stack` read clamped to.
 */
export interface StackContext {
  /** The requesting user's identity — the subject the dispatcher role-clamps to. */
  userId: string;
  /**
   * The requesting user's RBAC roles, when the caller has them resolved. Carried
   * for the workflow's convenience and forwarded to the dispatcher context by
   * the caller; scoping is still enforced AT the dispatcher, not here.
   */
  roles?: readonly string[];
  /** Inclusive lower bound (ISO) on an item's creation time; omitted reads all. */
  periodStart?: string;
  /** Inclusive upper bound (ISO) on an item's creation time; omitted reads all. */
  periodEnd?: string;
  /** Filter to open or done items; `all` (the default) returns both. */
  status?: "open" | "done" | "all";
  /** Soft cap forwarded to `list_stack` (the tool hard-caps regardless). */
  limit?: number;
}

/**
 * The injected collaborators for an assembly (Design §Components #3). Carries
 * the audited {@link StackDispatch} and an optional clock / timeout so a slow or
 * hung dispatch degrades to the `{ unavailable: true }` marker rather than
 * blocking the Briefing (Req 2.6). The property test injects a fake dispatcher
 * here; production injects the real `callTool`.
 */
export interface StackDeps {
  /** The audited dispatcher the Stack is assembled through (REQUIRED). */
  dispatch: StackDispatch;
  /** Clock injection point (defaults to `Date.now`); reserved for callers. */
  now?: () => Date;
  /**
   * Optional ceiling, in ms, on the `list_stack` dispatch. When the dispatch
   * does not settle within this budget the assembly fails closed to
   * `{ unavailable: true }` (Req 2.6). Omitted / non-positive → no timeout race.
   */
  timeoutMs?: number;
}

/** The "Stack could not be retrieved" marker, matching `Briefing.stack`'s union (Req 2.6). */
export type StackUnavailable = { unavailable: true };

/** The result of an assembly: the user's permitted Stack, or the unavailable marker. */
export type StackResult = StackItem[] | StackUnavailable;

// ── Constants ──────────────────────────────────────────────────────────────────

/** The Catalog_Entry the Stack is read through (the audited boundary). */
const LIST_STACK_TOOL = "list_stack";

/** The single source of the unavailable marker, so callers can compare by value. */
const UNAVAILABLE: StackUnavailable = { unavailable: true };

// ── Fail-closed validation of dispatcher-returned records ──────────────────────

const STACK_ITEM_KINDS = new Set<StackItem["kind"]>([
  "task",
  "lead_followup",
  "appointment",
]);

/**
 * Runtime, fail-closed guard that a value the dispatcher returned is a
 * well-formed {@link StackItem}. Anything that is not affirmatively a complete,
 * correctly-typed item is treated as indeterminate and omitted (Req 6.3, 6.4) —
 * the module never coerces a partial record into an item or invents fields.
 *
 * NB: this module deliberately does NOT import the `list_stack` output schema
 * from `home-capabilities.ts` (which imports Drizzle) — keeping THE ONE RULE's
 * "no Drizzle" boundary intact. This local guard is the structural contract.
 */
function isStackItem(value: unknown): value is StackItem {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return false;
  if (typeof o.kind !== "string" || !STACK_ITEM_KINDS.has(o.kind as StackItem["kind"])) {
    return false;
  }
  if (typeof o.title !== "string") return false;
  if (o.status !== "open" && o.status !== "done") return false;
  if (!(o.dueAt === null || typeof o.dueAt === "string")) return false;
  if (
    !(
      o.leadPhoneHash === undefined ||
      o.leadPhoneHash === null ||
      typeof o.leadPhoneHash === "string"
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Normalize an affirmatively-validated record into a clean {@link StackItem},
 * carrying ONLY the contract fields so no stray property the dispatcher
 * returned leaks into Briefing content.
 */
function toStackItem(value: StackItem): StackItem {
  return {
    id: value.id,
    kind: value.kind,
    title: value.title,
    status: value.status,
    dueAt: value.dueAt ?? null,
    leadPhoneHash: value.leadPhoneHash ?? null,
  };
}

// ── Timeout race ───────────────────────────────────────────────────────────────

/** Sentinel resolved when a dispatch exceeds {@link StackDeps.timeoutMs}. */
const TIMED_OUT = Symbol("stack_dispatch_timeout");

/**
 * Race a dispatch against an optional timeout. Resolves to {@link TIMED_OUT} on
 * either a timeout OR a rejection, so a slow/hung/throwing dispatch always
 * degrades to the fail-closed "unavailable" path rather than propagating
 * (Req 2.6). With no positive timeout the dispatch promise is returned as-is
 * (its rejection, if any, is caught by {@link assembleStack}).
 */
function raceTimeout(
  promise: Promise<DispatchResult>,
  timeoutMs?: number,
): Promise<DispatchResult | typeof TIMED_OUT> {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(TIMED_OUT);
      },
    );
  });
}

// ── assembleStack ──────────────────────────────────────────────────────────────

/**
 * Assemble the requesting user's Stack for the current period by DISPATCHING
 * `list_stack` (and, where needed, per-item Catalog_Entries) through the
 * injected audited dispatcher — never by reading the database directly
 * (Req 2.2).
 *
 * Returns the user's Stack as a {@link StackItem}[] (possibly empty — an empty
 * Stack is a legitimate state, not an error), OR `{ unavailable: true }`
 * (Req 2.6) when the dispatcher errors, times out, or returns a response that
 * does not carry the requested Stack data. In the unavailable case NO items are
 * fabricated or inferred.
 *
 * Fail-closed (Req 6.3, 6.4): only records the dispatch affirmatively returned
 * AND that validate as well-formed Stack_Items are included; any malformed /
 * indeterminate record is omitted. RBAC scoping is enforced at the dispatcher
 * (`list_stack` role-clamps to the requesting user), so this module trusts the
 * returned set and never widens it.
 *
 * Every included item is phone-redacted before return (Req 2.7, 9.4).
 *
 * @param ctx  The requesting user identity / roles and period/read filters.
 * @param deps The injected dispatcher and optional clock / timeout.
 */
export async function assembleStack(
  ctx: StackContext,
  deps: StackDeps,
): Promise<StackResult> {
  // Fail-closed on a missing subject: with no requesting user there is nothing
  // the role permits, and the dispatcher cannot scope a read — treat as
  // unavailable rather than dispatching an unscoped read (Req 6.4).
  if (!ctx.userId) {
    return UNAVAILABLE;
  }

  const input = {
    ...(ctx.periodStart ? { periodStart: ctx.periodStart } : {}),
    ...(ctx.periodEnd ? { periodEnd: ctx.periodEnd } : {}),
    status: ctx.status ?? "all",
    ...(typeof ctx.limit === "number" ? { limit: ctx.limit } : {}),
  };

  // Dispatch the audited Stack read. Any throw/timeout degrades to unavailable
  // — the dispatcher is expected not to throw, but we never let one escape.
  let outcome: DispatchResult | typeof TIMED_OUT;
  try {
    outcome = await raceTimeout(deps.dispatch(LIST_STACK_TOOL, input), deps.timeoutMs);
  } catch {
    return UNAVAILABLE;
  }

  // Timed out, or the dispatcher returned a structured error (incl. RBAC denial,
  // OTP gate, validation, handler error): no Stack data → unavailable, no
  // fabricated items (Req 2.6).
  if (outcome === TIMED_OUT || !outcome.ok) {
    return UNAVAILABLE;
  }

  // The affirmative result must carry the requested `{ items, truncatedAt }`
  // shape. A response that does not carry the requested Stack data is treated as
  // "did not return the requested data" → unavailable (Req 2.6).
  const result = outcome.result;
  if (typeof result !== "object" || result === null) {
    return UNAVAILABLE;
  }
  const rawItems = (result as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) {
    return UNAVAILABLE;
  }

  // Include only affirmatively-returned, well-formed records; omit any
  // indeterminate/malformed entry (Req 6.3, 6.4). Never invent an item.
  const items: StackItem[] = rawItems
    .filter(isStackItem)
    .map(toStackItem);

  // Defence-in-depth redaction before the Stack leaves the module (Req 2.7,
  // 9.4). The salted `leadPhoneHash` is not a raw phone and is unaffected.
  return redactHomeContent(items);
}

/**
 * Narrow a {@link StackResult} to the unavailable marker. A small, intention-
 * revealing helper for the Briefing_Workflow (task 7.1) and the surface so the
 * `StackItem[]` vs `{ unavailable: true }` union is discriminated at one place.
 */
export function isStackUnavailable(result: StackResult): result is StackUnavailable {
  return !Array.isArray(result) && result.unavailable === true;
}
