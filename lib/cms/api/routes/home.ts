// lib/cms/api/routes/home.ts
//
// The two Bun-mounted Elysia transports into the Agent-First Home / Briefing
// Surface (S5, Design §Architecture "Two transports into the dispatcher",
// §Components #1 the surface shell, #4 the Briefing_Cache, #10 live updates &
// observability). These routes attach to the EXISTING single Elysia `api`
// instance (`lib/cms/api/index.ts`) — there is NO second Elysia mount (Req
// 15.x): `homeRoutes` is a plugin the core `.use(...)`s exactly like
// `voiceRoutes` / `toolsRoutes` / `realtimeRoutes`. The Next bridge
// (`app/api/[...slugs]/route.ts`) is left untouched, including its
// `runtime = "nodejs"` / `dynamic = "force-dynamic"` settings (Req 1.8, 15.2).
//
// THREE handlers (all under the `/api/home` prefix), all gated by the existing
// session auth so an unauthenticated request serves no Briefing/chat (Req 1.2,
// 1.5 — mirrors `realtimeRoutes`' `identityGuard` + `requirePermission()`):
//
//   GET  /home/briefing  resolve the Briefing_Window from the user's local time
//                        → cache-first (`readBriefingCache`) → on miss run the
//                        `assembleBriefing` workflow → `writeBriefingCache` →
//                        serve the (phone-redacted) Briefing. An assembly
//                        failure returns `{ ok:false, reason }` so the surface
//                        shows "briefing unavailable" WITHOUT blocking chat
//                        (Req 1.6, 5.2, 5.3).
//   POST /home/chat      run one Home_Chat turn through `runHomeAgentTurn`
//                        (→ `homeAgent`). A non-ok turn (budget) or an
//                        unreachable agent returns a shape that tells the client
//                        to RETAIN the submitted input and that the turn could
//                        not be processed (Req 1.7).
//   GET  /home/health    the Agent_Availability_Check probe — returns the
//                        `AvailabilityProbe { available, latencyMs }` shape the
//                        surface's `useAgentAvailability` + `isDegraded` consume
//                        (Req 11.1; degrade.ts).
//
// SSE INVALIDATION LISTENER (Req 5.5). The home surface subscribes ONE
// process-local listener to the realtime bus (`subscribeToEvents`) that maps a
// Tool_Dispatcher mutation event affecting a user's Stack onto
// `invalidateBriefingCache(db, userId, currentPeriodDate)`, so the next request
// re-assembles and reflects the change. It is wired on `onStart` — i.e. only
// when the single Elysia app is `.listen()`ed on the Bun/container mount (where
// durable connections live), never on the Next `.handle()` bridge — mirroring
// how `realtimeRoutes`' SSE stream is effective only on the Bun mount.
//
// [container-only] (Design §13; Req 15.4, 15.5). The Home_Agent + Briefing
// workflow run on the container/worker tier. This route module is statically
// imported by the core `api` (and therefore by the Next bridge), so it must NOT
// statically import `@mastra/core` (via `home-agent.ts`). The chat handler and
// the health probe therefore DYNAMICALLY import the agent module inside the
// handler, so the heavy runtime is pulled in only when a turn/probe actually
// runs on the container tier — exactly the placement `home-agent.ts`'s header
// requires. The briefing workflow + cache + dispatch carry no `@mastra` import,
// so they are imported statically.
//
// Design references: §Architecture (two transports), §Components #1, #4, #10.
// Requirements: 1.2, 1.6, 1.7, 5.2, 5.5, 13.1, 13.6.

import { Elysia } from "elysia";

import { db } from "../../db";
import { identityGuard, requirePermission } from "../../rbac/middleware";
import { subscribeToEvents } from "../../realtime/subscribe";
import type { DoeEvent, DoeEventType } from "../../realtime/events";
import {
  readBriefingCache,
  writeBriefingCache,
  invalidateBriefingCache,
  type CacheKey,
} from "../../agents/home/briefing-cache";
import {
  resolveBriefingWindow,
  type BriefingWindow,
} from "../../agents/home/window";
import type { AvailabilityProbe } from "../../agents/home/degrade";
import type {
  BriefingInput,
  BriefingResult,
} from "../../agents/workflows/briefing-workflow";
import type { Briefing } from "../../agents/home/types";
import type { Database } from "../../db";

// ── Window / period resolution from the request (Req 1.2, 3.3, 3.6) ───────────

/**
 * The optional local-time hints a client may pass so the Briefing_Window is
 * resolved from the USER's local time rather than the server's (Req 1.2, 3.3).
 * Both are optional; absent, the server's own clock is used.
 *
 *   - `now`      — an ISO instant to resolve "now" at (defaults to the server's
 *                  current time). Lets a test pin the instant.
 *   - `tzOffset` — minutes to ADD to UTC to reach the user's local wall clock
 *                  (e.g. Dubai `+240`). Applied to `now` to derive the local
 *                  hour/minute and the local calendar `periodDate`.
 */
export interface BriefingTimeHints {
  now?: string;
  tzOffset?: number;
}

/** A resolved Briefing_Window + the local calendar day it covers. */
export type WindowResolution =
  | { ok: true; window: BriefingWindow; periodDate: string }
  | { ok: false; reason: "window_unresolved" };

function parseTzOffset(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Resolve the current Briefing_Window and local `periodDate` (YYYY-MM-DD) from
 * the request's time hints. The user's local instant is `now + tzOffset`; its
 * wall-clock hour/minute classify the window (task 1's pure
 * `resolveBriefingWindow`) and its calendar day is the period. An unresolvable
 * local time (bad `now`, or a window the partition rejects) yields
 * `window_unresolved` (Req 3.6) so the route serves no Briefing.
 */
export function resolveWindowAndPeriod(
  hints: BriefingTimeHints = {},
  serverNow: () => Date = () => new Date()
): WindowResolution {
  const baseMs =
    typeof hints.now === "string" && hints.now.trim() !== ""
      ? Date.parse(hints.now)
      : serverNow().getTime();
  if (Number.isNaN(baseMs)) {
    return { ok: false, reason: "window_unresolved" };
  }

  const offsetMin = parseTzOffset(hints.tzOffset);
  const localMs = baseMs + offsetMin * 60_000;
  if (!Number.isFinite(localMs)) {
    return { ok: false, reason: "window_unresolved" };
  }

  const local = new Date(localMs);
  try {
    const window = resolveBriefingWindow({
      hour: local.getUTCHours(),
      minute: local.getUTCMinutes(),
    });
    const periodDate = local.toISOString().slice(0, 10);
    return { ok: true, window, periodDate };
  } catch {
    // resolveBriefingWindow throws RangeError on an unresolvable local time.
    return { ok: false, reason: "window_unresolved" };
  }
}

// ── GET /home/briefing — cache-first briefing service (Req 5.2, 5.3, 1.6) ─────

/** The Briefing the route serves, or a structured unavailable reason. */
export type BriefingServeResult =
  | { ok: true; briefing: Briefing; cached: boolean }
  | { ok: false; reason: "window_unresolved" | "assembly_failed" };

/**
 * Injected collaborators for {@link serveBriefing}, so the cache-first vs miss
 * paths are unit-testable over fakes without a real DB or the agent runtime.
 * Production wires these to the live cache accessors + the `assembleBriefing`
 * workflow bound to the audited in-process dispatcher.
 */
export interface BriefingServiceDeps {
  /** Read a non-expired cached Briefing (defaults to {@link readBriefingCache}). */
  readCache: (db: Database, key: CacheKey, now?: Date) => Promise<Briefing | null>;
  /** Store an assembled Briefing (defaults to {@link writeBriefingCache}). */
  writeCache: (
    db: Database,
    key: CacheKey,
    b: Briefing,
    ttlMinutes?: number
  ) => Promise<void>;
  /** Assemble a Briefing via the workflow over the audited dispatcher. */
  assemble: (input: BriefingInput) => Promise<BriefingResult>;
  /** Clock injection (defaults to `new Date()`), forwarded to the cache read. */
  now?: () => Date;
}

/**
 * Serve a Briefing for `(userId, window, periodDate)` cache-first (Design
 * §Components #4):
 *   1. A non-expired cache hit is served verbatim and the workflow is NOT run
 *      (Req 5.2). The cached body was already phone-redacted at assembly time
 *      (`assembleBriefing` redacts before returning) and stored redacted, so it
 *      is served as-is — re-redacting would be redundant and would corrupt
 *      date-shaped fields (Req 2.7, 9.4 are upheld upstream).
 *   2. On a miss the `assembleBriefing` workflow runs (returning an
 *      already-redacted Briefing); on success the result is stored
 *      (`writeBriefingCache`) and served (Req 5.3); a write failure is swallowed
 *      inside the cache writer and the Briefing is still served (Req 5.6). An
 *      assembly failure returns `{ ok:false, reason }` and stores nothing (Req
 *      3.6, 3.7) so the surface can show "briefing unavailable" without blocking
 *      chat (Req 1.6).
 */
export async function serveBriefing(
  database: Database,
  params: { userId: string; roles: string[]; window: BriefingWindow; periodDate: string },
  deps: BriefingServiceDeps
): Promise<BriefingServeResult> {
  const now = deps.now ?? (() => new Date());
  const key: CacheKey = {
    userId: params.userId,
    window: params.window,
    periodDate: params.periodDate,
  };

  // 1. Cache-first: a non-expired hit is served without re-running the workflow.
  //    The cached body is already phone-redacted (stored redacted at assembly).
  const cached = await deps.readCache(database, key, now());
  if (cached) {
    return { ok: true, briefing: cached, cached: true };
  }

  // 2. Miss → assemble (returns an already-redacted Briefing), store on success,
  //    serve.
  const result = await deps.assemble({
    userId: params.userId,
    window: params.window,
    periodDate: params.periodDate,
    roles: params.roles,
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  await deps.writeCache(database, key, result.briefing);
  return { ok: true, briefing: result.briefing, cached: false };
}

/**
 * Build the live {@link BriefingServiceDeps}: the real cache accessors and the
 * `assembleBriefing` workflow bound to the AUDITED in-process dispatcher
 * (`callTool`-over-`dispatchTool`) under the home identity AND scoped to the
 * requesting user (so the per-row RBAC clamp in `list_stack` keys to the user,
 * Req 6.1, 6.2). The `@mastra`-free workflow/dispatch are dynamically imported
 * so this module stays free of a static `@mastra` dependency on the Next bridge.
 */
async function liveBriefingDeps(userId: string): Promise<BriefingServiceDeps> {
  const [{ dispatchTool }, { HOME_AGENT_ACTOR }, { assembleBriefing }] =
    await Promise.all([
      import("../../ai/tools/dispatch"),
      import("../../ai/tools/home-capabilities"),
      import("../../agents/workflows/briefing-workflow"),
    ]);

  // The audited dispatcher the Stack + figures are read through. Permission is
  // checked against the home actor (which holds the home:tool:* grants) while
  // the per-row clamp uses the requesting user's id (Req 6.1, 6.2, 8.2).
  const dispatch = (toolName: string, input: unknown) =>
    dispatchTool(db, toolName, input, { actor: HOME_AGENT_ACTOR, userId });

  return {
    readCache: readBriefingCache,
    writeCache: writeBriefingCache,
    assemble: (input: BriefingInput) => assembleBriefing(input, { dispatch }),
  };
}

// ── POST /home/chat — Home_Chat turn (Req 1.7) ────────────────────────────────

/** The body a Home_Chat turn accepts. */
export interface HomeChatBody {
  message?: unknown;
  history?: unknown;
  /** Session-only demo persona override (the panel persona toggle). */
  persona?: unknown;
}

/** The structured chat response surfaced to the client. */
export type HomeChatResponse =
  | { ok: true; response: string; modelTier: string; toolResults?: HomeChatToolResult[] }
  | {
      ok: false;
      /** The turn could not be processed; the client retains its input (Req 1.7). */
      retainInput: true;
      reason: "budget_exceeded" | "agent_unreachable" | "invalid_input";
      message: string;
    };

/** A structured tool result passed to the client for card rendering. */
export interface HomeChatToolResult {
  toolName: string;
  result: unknown;
}

function parseHistory(raw: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ role: string; content: string }> = [];
  for (const m of raw) {
    if (
      m &&
      typeof m === "object" &&
      typeof (m as { role?: unknown }).role === "string" &&
      typeof (m as { content?: unknown }).content === "string"
    ) {
      out.push({
        role: (m as { role: string }).role,
        content: (m as { content: string }).content,
      });
    }
  }
  return out;
}

/**
 * Run one Home_Chat turn and map the outcome to a client-facing response. A
 * non-ok turn (budget) or an unreachable/throwing agent yields
 * `{ ok:false, retainInput:true, ... }` so the surface keeps the submitted
 * input in the composer and shows the turn could not be processed (Req 1.7).
 * The `runTurn` dependency is injected for unit testing; production binds it to
 * the dynamically-imported `runHomeAgentTurn`.
 */
export async function runHomeChatTurn(
  params: { userId: string; roles: string[]; body: HomeChatBody },
  runTurn: (input: {
    userId: string;
    roles: string[];
    message: string;
    history?: Array<{ role: string; content: string }>;
    personaRole?: string;
  }) => Promise<
    | { ok: true; response: string; modelTier: string; toolResults?: HomeChatToolResult[] }
    | { ok: false; reason: "budget_exceeded" }
  >
): Promise<HomeChatResponse> {
  const message =
    typeof params.body.message === "string" ? params.body.message.trim() : "";
  if (!message) {
    return {
      ok: false,
      retainInput: true,
      reason: "invalid_input",
      message: "A non-empty message is required.",
    };
  }

  let outcome:
    | { ok: true; response: string; modelTier: string; toolResults?: HomeChatToolResult[] }
    | { ok: false; reason: "budget_exceeded" };
  try {
    outcome = await runTurn({
      userId: params.userId,
      roles: params.roles,
      message,
      history: parseHistory(params.body.history),
      personaRole:
        typeof params.body.persona === "string" && params.body.persona.trim()
          ? params.body.persona.trim()
          : undefined,
    });
  } catch {
    // The Home_Agent could not be reached on the runtime (Req 1.7).
    return {
      ok: false,
      retainInput: true,
      reason: "agent_unreachable",
      message: "The home assistant could not be reached. Your message was kept.",
    };
  }

  if (!outcome.ok) {
    return {
      ok: false,
      retainInput: true,
      reason: outcome.reason,
      message: "The turn could not be completed. Your message was kept.",
    };
  }

  return {
    ok: true,
    response: outcome.response,
    modelTier: outcome.modelTier,
    toolResults: outcome.toolResults,
  };
}

// ── GET /home/health — Agent_Availability_Check probe (Req 11.1) ──────────────

/**
 * Probe whether the Home_Agent / Mastra_Runtime is responsive, returning the
 * `AvailabilityProbe { available, latencyMs }` shape the surface's
 * `useAgentAvailability` + `isDegraded` consume (degrade.ts). The probe is a
 * lightweight readiness check — it loads the agent runtime module and confirms
 * the `homeAgent` is constructed — NOT a model call, so it spends no tokens. A
 * thrown load (or a failed tier guard) reports `available:false`. `loadAgent`
 * and `now` are injected for testing; production dynamically imports the agent
 * so `@mastra` stays off the static import graph.
 */
export async function probeAgentHealth(
  loadAgent: () => Promise<unknown> = async () => {
    const mod = await import("../../agents/home-agent");
    // Refuse on the serverless tier exactly as a real turn would (Req 15.5).
    mod.assertHomeContainerTier();
    return mod.homeAgent;
  },
  now: () => number = () => Date.now()
): Promise<AvailabilityProbe> {
  const start = now();
  try {
    const agent = await loadAgent();
    const latencyMs = Math.max(0, now() - start);
    return { available: agent != null, latencyMs };
  } catch {
    const latencyMs = Math.max(0, now() - start);
    return { available: false, latencyMs };
  }
}

// ── SSE-bus invalidation listener (Req 5.5) ───────────────────────────────────

/**
 * The bus event types that represent a Tool_Dispatcher mutation able to change
 * a user's Stack (the leads/follow-ups that appear in a Briefing). A mutation
 * of one of these for a given user invalidates that user's cached Briefings for
 * the current period date (Req 5.5). Kept as a configurable set so new
 * Stack-affecting mutation events can be added without touching the listener.
 */
export const STACK_MUTATION_EVENT_TYPES: ReadonlySet<DoeEventType> = new Set<DoeEventType>([
  "lead.routed",
  "lead.unrouted",
  "lead.resolved",
  "lead.conflict",
  "lead.enriched",
  "lead.nudged",
]);

/** Payload keys, in priority order, that identify the user a mutation affects. */
const AFFECTED_USER_KEYS = [
  "userId",
  "repId",
  "assigneeId",
  "ownerId",
  "createdBy",
] as const;

/** Extract the affected user id from an event payload, or null when absent. */
export function affectedUserId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  for (const key of AFFECTED_USER_KEYS) {
    const value = p[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/** Format a `Date` as a `YYYY-MM-DD` calendar day (the cache period key). */
function toPeriodDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Injected collaborators for the invalidation listener (testing seam). */
export interface BriefingInvalidationDeps {
  /** Invalidate a user's cached briefings (defaults to {@link invalidateBriefingCache}). */
  invalidate?: (db: Database, userId: string, periodDate: string) => Promise<void>;
  /** Clock for the current period date (defaults to `new Date()`). */
  now?: () => Date;
}

/**
 * Build the bus listener that maps a Tool_Dispatcher mutation event onto a
 * Briefing_Cache invalidation (Req 5.5). For a Stack-affecting mutation event
 * carrying an affected user, it invalidates that user's cached Briefings for
 * the current period date so the next request re-assembles and reflects the
 * change. Events that are not Stack mutations, or carry no resolvable user, are
 * ignored. The invalidation is fire-and-forget; a failure is logged, never
 * thrown back into the fan-out.
 */
export function createBriefingInvalidationListener(
  database: Database,
  deps: BriefingInvalidationDeps = {}
): (event: DoeEvent) => void {
  const invalidate = deps.invalidate ?? invalidateBriefingCache;
  const now = deps.now ?? (() => new Date());

  return (event: DoeEvent): void => {
    if (!STACK_MUTATION_EVENT_TYPES.has(event.type)) return;
    const userId = affectedUserId(event.payload);
    if (!userId) return;
    const periodDate = toPeriodDate(now());
    void invalidate(database, userId, periodDate).catch((err) => {
      console.error("[home] briefing-cache invalidation failed:", err);
    });
  };
}

/**
 * Subscribe the Briefing_Cache invalidation listener to the realtime bus and
 * return its unsubscribe function (Req 5.5). Called on the Bun/container mount
 * (via the route's `onStart`), where the durable LISTEN connection lives.
 */
export function subscribeBriefingInvalidation(
  database: Database = db,
  deps: BriefingInvalidationDeps = {}
): () => void {
  return subscribeToEvents(createBriefingInvalidationListener(database, deps));
}

// ── The Elysia plugin (attached to the single `api`, no second mount) ─────────

/**
 * The Home_Surface transports as one Elysia plugin the core `api` `.use(...)`s.
 * Auth mirrors `realtimeRoutes`: `identityGuard` establishes the authenticated
 * `userId` (401 otherwise, Req 1.5) and `requirePermission()` (auth-only)
 * derives the user's resolved roles for the read context. The invalidation
 * listener is subscribed on `onStart` so it is wired only when the single app
 * is `.listen()`ed on the Bun/container mount (Req 5.5) — never on the Next
 * `.handle()` bridge.
 */
export const homeRoutes = new Elysia({ name: "home", prefix: "/home" })
  .use(identityGuard)
  .use(requirePermission())
  .onStart(() => {
    // Durable, container-tier wiring: map dispatcher mutation events → cache
    // invalidation. Effective only on the Bun mount (Req 5.5).
    subscribeBriefingInvalidation();
  })

  // GET /home/briefing — resolve window → cache-first → assemble → serve.
  .get("/briefing", async (ctx: any) => {
    const userId: string = ctx.userId;
    const roles: string[] = ctx.resolvedRoles ?? [];
    const query = ctx.query ?? {};

    const resolution = resolveWindowAndPeriod({
      now: typeof query.now === "string" ? query.now : undefined,
      tzOffset: query.tzOffset,
    });
    if (!resolution.ok) {
      // Unresolvable window → no Briefing, but the surface still shows chat.
      return { data: { ok: false, reason: resolution.reason } };
    }

    const deps = await liveBriefingDeps(userId);
    const served = await serveBriefing(
      db,
      {
        userId,
        roles,
        window: resolution.window,
        periodDate: resolution.periodDate,
      },
      deps
    );

    return { data: served };
  })

  // POST /home/chat — one Home_Chat turn → homeAgent (retain-input-on-failure).
  .post("/chat", async (ctx: any) => {
    const userId: string = ctx.userId;
    const roles: string[] = ctx.resolvedRoles ?? [];

    const { runHomeAgentTurn } = await import("../../agents/home-agent");
    const response = await runHomeChatTurn(
      { userId, roles, body: (ctx.body ?? {}) as HomeChatBody },
      (input) => runHomeAgentTurn(input)
    );

    if (!response.ok) {
      // A retained-input failure is a normal, non-blocking outcome for the
      // surface; surface it with 200 + a structured body (Req 1.7).
      return { data: response };
    }
    return { data: response };
  })

  // GET /home/health — Agent_Availability_Check probe (AvailabilityProbe shape).
  .get("/health", async () => {
    const probe = await probeAgentHealth();
    return probe;
  });

export default homeRoutes;
