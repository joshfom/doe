/**
 * Tests for the Twin's confirm-before-commit gate (`propose_action` /
 * `confirm_action`): a high-impact write is staged (no mutation) and only
 * commits once the user confirms the single-use, user-bound token. The
 * underlying dispatch is injected, so these are pure unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  actionConfirmationEntries,
  CONFIRMABLE_HOME_TOOLS,
  setConfirmedActionExecutor,
  _resetConfirmedActionExecutorForTests,
  _resetActionConfirmationStoreForTests,
  type ConfirmedActionExecutor,
} from "./action-confirmation";
import type { CatalogEntry, ToolContext } from "./catalog";
import type { Database } from "../../db";

const db = {} as Database;
const ctx: ToolContext = {
  actor: "user-7",
  agentActor: "agent:home-twin",
  userId: "user-7",
};

function entryByName(name: string): CatalogEntry {
  const e = actionConfirmationEntries.find((x) => x.name === name);
  if (!e) throw new Error(`missing entry ${name}`);
  return e;
}

const propose = entryByName("propose_action");
const confirm = entryByName("confirm_action");

// Narrow helpers around the unknown-typed catalog handler I/O.
async function runPropose(input: unknown, c: ToolContext = ctx): Promise<any> {
  return propose.handler(db, c, propose.inputSchema.parse(input)) as Promise<any>;
}
async function runConfirm(input: unknown, c: ToolContext = ctx): Promise<any> {
  return confirm.handler(db, c, confirm.inputSchema.parse(input)) as Promise<any>;
}

beforeEach(() => {
  _resetActionConfirmationStoreForTests();
  _resetConfirmedActionExecutorForTests();
});
afterEach(() => {
  _resetConfirmedActionExecutorForTests();
});

describe("propose_action", () => {
  it("stages a confirmable high-impact write and issues a token (no mutation)", async () => {
    const exec = vi.fn();
    setConfirmedActionExecutor(exec as unknown as ConfirmedActionExecutor);

    const out = await runPropose({
      toolName: "assign_rep",
      args: { partyId: "p1", repId: "r9" },
      summary: "Reassign the Khalifa lead to Sara.",
      affectedCount: 1,
    });

    expect(out.staged).toBe(true);
    expect(out.requiresConfirmation).toBe(true);
    expect(out.toolName).toBe("assign_rep");
    expect(typeof out.token).toBe("string");
    expect(out.summary).toBe("Reassign the Khalifa lead to Sara.");
    expect(out.affectedCount).toBe(1);
    expect(typeof out.expiresAt).toBe("string");
    // Proposing NEVER executes the underlying tool.
    expect(exec).not.toHaveBeenCalled();
  });

  it("returns staged=false for a low-stakes tool (no confirm needed)", async () => {
    const out = await runPropose({ toolName: "complete_stack_item", args: {} });
    expect(out.staged).toBe(false);
    expect(out.requiresConfirmation).toBe(false);
    expect(out.token).toBeUndefined();
    expect(out.message).toMatch(/directly/i);
  });

  it("throws without an authenticated user", async () => {
    await expect(
      runPropose({ toolName: "assign_rep", args: {} }, { actor: "x" }),
    ).rejects.toThrow(/authenticated user/i);
  });

  it("only whitelists high-impact writes (not personal bookkeeping)", () => {
    expect(CONFIRMABLE_HOME_TOOLS.has("assign_rep")).toBe(true);
    expect(CONFIRMABLE_HOME_TOOLS.has("update_qualification")).toBe(true);
    expect(CONFIRMABLE_HOME_TOOLS.has("score_lead")).toBe(true);
    expect(CONFIRMABLE_HOME_TOOLS.has("queue_report_email")).toBe(true);
    expect(CONFIRMABLE_HOME_TOOLS.has("add_stack_item")).toBe(false);
    expect(CONFIRMABLE_HOME_TOOLS.has("complete_stack_item")).toBe(false);
  });
});

describe("confirm_action", () => {
  it("commits the staged action exactly once through the dispatcher", async () => {
    const exec = vi.fn(async () => ({ ok: true as const, result: { assigned: true } }));
    setConfirmedActionExecutor(exec as unknown as ConfirmedActionExecutor);

    const staged = await runPropose({
      toolName: "assign_rep",
      args: { partyId: "p1", repId: "r9" },
      summary: "Reassign.",
    });
    const out = await runConfirm({ token: staged.token });

    expect(out.executed).toBe(true);
    expect(out.toolName).toBe("assign_rep");
    expect(out.result).toEqual({ assigned: true });
    // The bound tool + args are replayed verbatim under the proposal's context.
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(db, ctx, "assign_rep", { partyId: "p1", repId: "r9" });
  });

  it("is single-use — a second confirm is refused and never re-runs the tool", async () => {
    const exec = vi.fn(async () => ({ ok: true as const, result: {} }));
    setConfirmedActionExecutor(exec as unknown as ConfirmedActionExecutor);

    const staged = await runPropose({ toolName: "score_lead", args: { partyId: "p1" } });
    await runConfirm({ token: staged.token });
    const second = await runConfirm({ token: staged.token });

    expect(second.executed).toBe(false);
    // Single-use: the token is dropped on first consume, so a replay can never
    // find it (non-replayable, same posture as the admin confirmation store).
    expect(second.reason).toBe("not_found");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("refuses a token belonging to another user (no execution)", async () => {
    const exec = vi.fn(async () => ({ ok: true as const, result: {} }));
    setConfirmedActionExecutor(exec as unknown as ConfirmedActionExecutor);

    const staged = await runPropose({ toolName: "assign_rep", args: {} });
    const out = await runConfirm(
      { token: staged.token },
      { actor: "intruder", agentActor: "agent:home-twin", userId: "intruder" },
    );

    expect(out.executed).toBe(false);
    expect(out.reason).toBe("wrong_user");
    expect(exec).not.toHaveBeenCalled();
  });

  it("refuses an unknown token with a re-issue prompt", async () => {
    const out = await runConfirm({ token: "00000000-0000-0000-0000-000000000000" });
    expect(out.executed).toBe(false);
    expect(out.reason).toBe("not_found");
    expect(out.message).toMatch(/propose the action again/i);
  });

  it("reports a clean failure when the bound tool itself fails", async () => {
    const exec = vi.fn(async () => ({
      ok: false as const,
      error: { code: "permission_denied", message: "no" },
    }));
    setConfirmedActionExecutor(exec as unknown as ConfirmedActionExecutor);

    const staged = await runPropose({ toolName: "assign_rep", args: {} });
    const out = await runConfirm({ token: staged.token });

    expect(out.executed).toBe(false);
    expect(out.error).toBe("permission_denied");
    expect(out.message).toMatch(/couldn't complete/i);
  });
});
