/**
 * Confirm-before-commit for the employee Twin (Home_Agent) — the `propose_action`
 * / `confirm_action` pair.
 *
 * The digital-twin concept is that the agent acts ON BEHALF of the signed-in
 * employee, but the employee gets to DOUBLE-CHECK a high-impact change before it
 * commits. This module is the generic, human-in-the-loop gate that makes that
 * real for everyday Twin writes — the same shape the admin destructive flow
 * (`propose_admin_action` / `confirm_admin_action`) already uses, generalised so
 * any whitelisted home write can be staged:
 *
 *   1. The Twin calls `propose_action(toolName, args, summary)` for a high-impact
 *      write. NOTHING is mutated; a single-use, user-bound, short-TTL token is
 *      issued and a human-readable `summary` is returned for the UI card / spoken
 *      read-back.
 *   2. The employee reviews it (a confirmation card on screen, or the spoken
 *      "shall I go ahead?" on a voice call) and approves.
 *   3. `confirm_action(token)` consumes the token and dispatches the bound tool
 *      EXACTLY ONCE through the unchanged audited `dispatchTool`, under the same
 *      identity the proposal ran under — so RBAC, OTP, and audit are identical to
 *      a direct call; the gate adds the human checkpoint, nothing else.
 *
 * Only WHITELISTED, high-impact writes are confirmable (reassigning a lead,
 * editing qualification, changing a tier, sending a report). Trivial personal
 * bookkeeping (adding/completing your own task) is NOT gated — `propose_action`
 * tells the Twin to just do those directly — so the gate never slows the Twin
 * down for low-stakes work.
 *
 * No new migration: the in-memory store mirrors the admin flow's seam default;
 * a durable `admin_confirmations`-backed store can be injected later via
 * {@link setActionConfirmationStore} exactly as the admin flow does.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { Database } from "../../db";
import type { CatalogEntry, ToolContext } from "./catalog";
import type { DispatchResult } from "./dispatch";

// Literals (not imported from home-capabilities) to avoid a static import cycle:
// home-capabilities imports THIS module's entries at load time, while this
// module only reaches `dispatchTool` dynamically at call time.
const HOME_TWIN_ACTOR = "agent:home-twin";
const homeToolPermission = (name: string) => `home:tool:${name}`;

/** The confirm-before-commit tool names the Home_Agent binds. */
export const HOME_CONFIRM_TOOL_NAMES = [
  "propose_action",
  "confirm_action",
] as const;

/**
 * The high-impact Home_Agent write tools that REQUIRE a human confirm before
 * they commit: anything that reassigns ownership, mutates a Lead, or sends
 * something outbound. Trivial personal writes (`add_stack_item`,
 * `complete_stack_item`) are intentionally absent — the Twin performs those
 * directly without a confirmation round-trip.
 */
export const CONFIRMABLE_HOME_TOOLS: ReadonlySet<string> = new Set([
  "assign_rep", // reassigns a Lead's owner — touches someone else's pipeline
  "update_qualification", // mutates a Lead's captured facts
  "score_lead", // changes a Lead's tier
  "queue_report_email", // sends an outbound report
]);

/** Single-use confirmation TTL — 5 minutes, mirroring the admin flow. */
export const ACTION_CONFIRMATION_TTL_MS = 5 * 60_000;

// ── Token store ───────────────────────────────────────────────────────────────

/** A staged, not-yet-committed action bound to one user. */
export interface ActionConfirmationRecord {
  token: string;
  userId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  affectedCount: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export type ActionConfirmationRejectReason =
  | "not_found"
  | "wrong_user"
  | "expired"
  | "already_consumed";

export type ActionConfirmationConsumeResult =
  | { ok: true; record: ActionConfirmationRecord }
  | { ok: false; reason: ActionConfirmationRejectReason };

/** The confirmation-token store contract (mirrors the admin flow's store). */
export interface ActionConfirmationStore {
  issue(
    db: Database,
    rec: Omit<ActionConfirmationRecord, "token" | "expiresAt" | "consumedAt">,
    ttlMs: number,
  ): Promise<ActionConfirmationRecord>;
  consume(
    db: Database,
    token: string,
    userId: string,
  ): Promise<ActionConfirmationConsumeResult>;
}

/** Default in-memory store — single-process, non-durable (seam default). */
export class InMemoryActionConfirmationStore implements ActionConfirmationStore {
  private readonly tokens = new Map<string, ActionConfirmationRecord>();

  private pruneExpired(now: number): void {
    for (const [token, rec] of this.tokens) {
      if (rec.expiresAt.getTime() < now) this.tokens.delete(token);
    }
  }

  async issue(
    _db: Database,
    rec: Omit<ActionConfirmationRecord, "token" | "expiresAt" | "consumedAt">,
    ttlMs: number,
  ): Promise<ActionConfirmationRecord> {
    const now = Date.now();
    this.pruneExpired(now);
    const record: ActionConfirmationRecord = {
      ...rec,
      token: randomUUID(),
      expiresAt: new Date(now + ttlMs),
      consumedAt: null,
    };
    this.tokens.set(record.token, record);
    return record;
  }

  async consume(
    _db: Database,
    token: string,
    userId: string,
  ): Promise<ActionConfirmationConsumeResult> {
    const rec = this.tokens.get(token);
    if (!rec) return { ok: false, reason: "not_found" };
    if (rec.userId !== userId) return { ok: false, reason: "wrong_user" };
    if (rec.consumedAt) return { ok: false, reason: "already_consumed" };
    if (rec.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: "expired" };
    }
    // Single-use: stamp consumed and drop it so it can never be replayed.
    rec.consumedAt = new Date();
    this.tokens.delete(token);
    return { ok: true, record: { ...rec } };
  }

  /** Test-only: clear all issued tokens. */
  _resetForTests(): void {
    this.tokens.clear();
  }
}

let actionConfirmationStore: ActionConfirmationStore =
  new InMemoryActionConfirmationStore();

export function getActionConfirmationStore(): ActionConfirmationStore {
  return actionConfirmationStore;
}

export function setActionConfirmationStore(store: ActionConfirmationStore): void {
  actionConfirmationStore = store;
}

export function _resetActionConfirmationStoreForTests(): void {
  actionConfirmationStore = new InMemoryActionConfirmationStore();
}

// ── Confirmed-action executor (the commit) ────────────────────────────────────

/**
 * Executes a confirmed action by re-dispatching the bound tool through the
 * audited `dispatchTool` under the SAME context the proposal ran in (so RBAC /
 * OTP / audit are identical to a direct call). Injectable for tests; the default
 * imports `dispatchTool` LAZILY so this module never statically pulls
 * `dispatch.ts` (which imports the home catalog) into an import cycle.
 */
export type ConfirmedActionExecutor = (
  db: Database,
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<DispatchResult>;

const defaultExecutor: ConfirmedActionExecutor = async (db, ctx, toolName, args) => {
  const { dispatchTool } = await import("./dispatch");
  // `ctx` is already a ToolContext (actor = requesting user, agentActor =
  // home-twin); forward it verbatim so the commit replays the proposal's exact
  // authorization. Default the agent identity if a caller omitted it.
  return dispatchTool(db, toolName, args, {
    ...ctx,
    agentActor: ctx.agentActor ?? HOME_TWIN_ACTOR,
  });
};

let confirmedActionExecutor: ConfirmedActionExecutor = defaultExecutor;

export function setConfirmedActionExecutor(exec: ConfirmedActionExecutor): void {
  confirmedActionExecutor = exec;
}

export function _resetConfirmedActionExecutorForTests(): void {
  confirmedActionExecutor = defaultExecutor;
}

const REISSUE_PROMPT =
  "That confirmation is no longer valid — propose the action again so I can " +
  "re-issue a fresh confirmation.";

/**
 * Preserve per-entry input/output typing (the handler input is inferred from
 * the entry's Zod schema) while collecting the entries into one
 * `CatalogEntry[]` — mirrors the `entry()` helper in home-capabilities.ts.
 */
function entry<I, O>(e: CatalogEntry<I, O>): CatalogEntry {
  return e as unknown as CatalogEntry;
}

// ── Catalog entries ───────────────────────────────────────────────────────────

const proposeActionInputSchema = z.object({
  /** The high-impact home tool to stage (must be confirmable). */
  toolName: z.string().min(1),
  /** The exact arguments to replay verbatim on confirm. */
  args: z.record(z.string(), z.unknown()).default({}),
  /** A plain-language summary of the change, for the review card / spoken read-back. */
  summary: z.string().max(280).optional(),
  /** Approximate number of records affected, for the review UI. */
  affectedCount: z.number().int().nonnegative().optional(),
});

const proposeActionOutputSchema = z.object({
  /** True when a confirmation token was issued; false when no confirm is needed. */
  staged: z.boolean(),
  /** True only when the caller must confirm before the change commits. */
  requiresConfirmation: z.boolean(),
  toolName: z.string(),
  /** The single-use confirmation token (present iff `staged`). */
  token: z.string().optional(),
  /** Human-readable summary the surface renders / speaks. */
  summary: z.string(),
  affectedCount: z.number().int().nonnegative().optional(),
  /** ISO-8601 future expiry (present iff `staged`). */
  expiresAt: z.string().optional(),
  /** Guidance for the agent when no confirmation is needed. */
  message: z.string().optional(),
});

const proposeActionEntry = entry({
  name: "propose_action",
  description:
    "Stage a HIGH-IMPACT change (reassigning a lead, editing qualification, " +
    "changing a tier, sending a report) for the user to confirm BEFORE it " +
    "commits. Performs NO change: it returns a single-use confirmation token " +
    "and a plain-language summary to show or read back to the user, who then " +
    "approves via confirm_action. If the named tool does not need confirmation " +
    "(e.g. adding or completing your own task), it returns staged=false — just " +
    "perform that tool directly instead.",
  inputSchema: proposeActionInputSchema,
  outputSchema: proposeActionOutputSchema,
  requiresOtp: false,
  permission: homeToolPermission("propose_action"),
  auditActor: HOME_TWIN_ACTOR,
  handler: async (db, ctx, input) => {
    const userId = ctx.userId;
    if (!userId) {
      throw new Error("propose_action requires an authenticated user in context");
    }
    if (!CONFIRMABLE_HOME_TOOLS.has(input.toolName)) {
      return {
        staged: false,
        requiresConfirmation: false,
        toolName: input.toolName,
        summary: input.summary ?? "",
        message:
          `${input.toolName} does not need confirmation — perform it directly.`,
      };
    }
    const summary = input.summary ?? `Confirm ${input.toolName}`;
    const record = await getActionConfirmationStore().issue(
      db,
      {
        userId,
        toolName: input.toolName,
        args: input.args,
        summary,
        affectedCount: input.affectedCount ?? 0,
      },
      ACTION_CONFIRMATION_TTL_MS,
    );
    return {
      staged: true,
      requiresConfirmation: true,
      toolName: input.toolName,
      token: record.token,
      summary,
      affectedCount: record.affectedCount,
      expiresAt: record.expiresAt.toISOString(),
    };
  },
});

const confirmActionInputSchema = z.object({
  /** The single-use token returned by propose_action. */
  token: z.string().min(1),
});

const confirmActionOutputSchema = z.object({
  /** True when the staged action committed; false when the token was refused. */
  executed: z.boolean(),
  toolName: z.string().optional(),
  /** Set when refused: why the token could not be honoured. */
  reason: z
    .enum(["not_found", "wrong_user", "expired", "already_consumed"])
    .optional(),
  /** User-facing message — the re-issue prompt on refusal, or the outcome. */
  message: z.string(),
  /** The committed tool's result payload, when it executed. */
  result: z.unknown().optional(),
  /** A dispatch error code when the bound tool itself failed. */
  error: z.string().optional(),
});

const confirmActionEntry = entry({
  name: "confirm_action",
  description:
    "Commit a change previously staged by propose_action, using its " +
    "confirmation token. Executes the bound action exactly once through the " +
    "audited dispatcher, then invalidates the token. An expired, already-used, " +
    "or wrong-user token is refused with a re-issue prompt and changes nothing.",
  inputSchema: confirmActionInputSchema,
  outputSchema: confirmActionOutputSchema,
  requiresOtp: false,
  permission: homeToolPermission("confirm_action"),
  auditActor: HOME_TWIN_ACTOR,
  handler: async (db, ctx, input) => {
    const userId = ctx.userId;
    if (!userId) {
      throw new Error("confirm_action requires an authenticated user in context");
    }
    const consumed = await getActionConfirmationStore().consume(
      db,
      input.token,
      userId,
    );
    if (!consumed.ok) {
      return { executed: false, reason: consumed.reason, message: REISSUE_PROMPT };
    }
    const { toolName, args } = consumed.record;
    const result = await confirmedActionExecutor(db, ctx, toolName, args);
    if (!result.ok) {
      return {
        executed: false,
        toolName,
        message: `That didn't go through — ${toolName} couldn't complete.`,
        error: result.error.code,
      };
    }
    return {
      executed: true,
      toolName,
      message: "Done.",
      result: result.result,
    };
  },
});

/** The confirm-before-commit Catalog_Entries the Home_Agent binds. */
export const actionConfirmationEntries: CatalogEntry[] = [
  proposeActionEntry,
  confirmActionEntry,
];
