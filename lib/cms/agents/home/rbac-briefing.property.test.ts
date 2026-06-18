// Feature: agentic-home, Property 1: An assembled Briefing or Combined_Report includes only the Stack_Items and figures the requesting user's RBAC role permits; any indeterminate or denied read is omitted (fail-closed).
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 4.5
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import fc from "fast-check";

/**
 * Property test for Property 1 (P-RBACBrief) of the Agent-First Home surface
 * (Design §Components #7 "RBAC-scoped briefings", §Property → test-placement
 * table — `lib/cms/agents/home/rbac-briefing.property.test.ts`, pg-mem).
 *
 * THE UNIT UNDER TEST is the real `assembleStack(ctx, deps)` from `stack.ts`.
 * The design fixes WHERE scoping happens: "Scoping is enforced AT the
 * dispatcher, not re-implemented in S5 … the Briefing_Workflow's contribution
 * is fail-closed assembly: it includes a record only when the dispatcher
 * affirmatively returned it, and treats any indeterminate/denied read as
 * omitted." This property guards exactly that contract:
 *
 *   Over a dispatcher that ENFORCES RBAC (role-clamps `list_stack` to the
 *   requesting user's permitted rows), the Stack `assembleStack` returns
 *   contains ONLY records that user's role permits — no record owned by another
 *   user ever appears — and:
 *     • an indeterminate read (a malformed/garbage entry within the result, a
 *       result that does not carry the requested `items` array) is OMITTED,
 *       never fabricated;
 *     • a denied read (the dispatch returns `{ ok: false }` — permission_denied,
 *       otp_required, validation_error, unknown_tool, handler_error) fails
 *       closed to `{ unavailable: true }` with NO fabricated items;
 *     • a dispatcher error (throw) or a timeout fails closed to
 *       `{ unavailable: true }` with NO fabricated items.
 *
 * HARNESS — pg-mem + the REAL `list_stack` handler (the design's preferred
 * backing). For the affirmative scenarios the injected dispatcher runs the
 * GENUINE production `list_stack` Catalog_Entry handler
 * (`home-capabilities.ts`'s `homeTaskToolEntries`) against an in-memory Postgres
 * seeded with a WORLD of tickets (Stack_Items) owned by several users. That
 * handler's own role-clamp WHERE clause (`createdBy = user OR assigneeId =
 * user`) is the RBAC enforcement — so the dispatcher genuinely enforces RBAC and
 * the property asserts `assembleStack` reflects exactly that permitted set,
 * never widening it. The node-postgres-over-pg-mem adapter mirrors the sibling
 * harness `lib/cms/agents/home/delegation-audit.property.test.ts`.
 *
 * For the fail-closed scenarios the dispatcher is a fault injector (denied /
 * malformed / throw / timeout); these need no DB and assert `assembleStack`'s
 * fail-closed interpretation of a non-affirmative {@link DispatchResult}.
 *
 * Identifiers are index-derived strings (`user_0`, `item_3`) with no long digit
 * runs, so the surface's defence-in-depth phone redaction (Property 8) is a
 * no-op here and set-equality on item ids is exact.
 */

import * as schema from "../../schema";
import type { Database } from "../../db";
import type { ToolContext } from "../../ai/tools/registry";
import type { DispatchResult, DispatchErrorCode } from "../../ai/tools/dispatch";
import { homeTaskToolEntries } from "../../ai/tools/home-capabilities";
import {
  assembleStack,
  isStackUnavailable,
  type StackContext,
  type StackDispatch,
} from "./stack";
import type { StackItem } from "./types";

const NUM_RUNS = 100;

// The genuine production list_stack Catalog_Entry — its handler role-clamps the
// read to the requesting user (the RBAC enforcement this property drives over).
const listStackEntry = homeTaskToolEntries.find((e) => e.name === "list_stack");
if (!listStackEntry) {
  throw new Error("rbac-briefing.property.test: list_stack entry not found");
}

// ── pg-mem world tables (minimal — exactly the columns list_stack reads) ───────
//
// The real handler issues a role-clamped, bounded Drizzle SELECT over `tickets`
// LEFT JOIN `party_identities` (for the salted `phone_hash` only). Only the
// columns it references need exist; ids are `text` so the index-derived,
// redaction-safe identifiers persist verbatim.
const WORLD_SQL = `
  CREATE TABLE "tickets" (
    "id" text PRIMARY KEY,
    "subject" text NOT NULL,
    "status" text NOT NULL,
    "scheduled_start" timestamp,
    "lead_party_id" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "created_by" text,
    "assignee_id" text
  );
  CREATE TABLE "party_identities" (
    "party_id" text NOT NULL,
    "kind" text NOT NULL,
    "value" text NOT NULL
  );
`;

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(WORLD_SQL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, mirroring the sibling dispatch tests.
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;
      const result = originalQuery(clean, values, cb);
      if (
        wantArray &&
        result &&
        typeof (result as Promise<unknown>).then === "function"
      ) {
        return (result as Promise<{ rows: Record<string, unknown>[] }>).then(
          (r) => ({ ...r, rows: r.rows.map((row) => Object.values(row)) })
        );
      }
      return result;
    }
    return originalQuery(config, values, cb);
  };

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
}

// ── World model ────────────────────────────────────────────────────────────────

type ItemShape = "task" | "lead" | "appointment";
type TicketStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed";

interface WorldItem {
  createdByIdx: number;
  hasAssignee: boolean;
  assigneeIdx: number;
  shape: ItemShape;
  status: TicketStatus;
}

interface World {
  numUsers: number;
  requesterIdx: number;
  items: WorldItem[];
}

const userId = (i: number) => `user_${i}`;
const itemId = (i: number) => `item_${i}`;
const partyId = (i: number) => `party_${i}`;
const phoneHash = (i: number) => `hashvalue_${i}`; // letters + a short (<4) digit run → redaction-safe
const titleFor = (i: number) => `stack_item_${i}`;

/** An item is permitted for the requester iff the role-clamp WHERE clause admits it. */
function isPermitted(item: WorldItem, requesterIdx: number): boolean {
  return (
    item.createdByIdx === requesterIdx ||
    (item.hasAssignee && item.assigneeIdx === requesterIdx)
  );
}

/** Seed the full world (permitted AND non-permitted rows) so the clamp must filter. */
async function seedWorld(db: Database, world: World): Promise<void> {
  for (let i = 0; i < world.items.length; i++) {
    const it = world.items[i];
    const lead = it.shape === "lead" ? partyId(i) : null;
    const scheduled = it.shape === "appointment" ? "2024-06-01T10:00:00.000Z" : null;
    const assignee = it.hasAssignee ? userId(it.assigneeIdx) : null;

    await db.execute(sql`
      INSERT INTO tickets (id, subject, status, scheduled_start, lead_party_id, created_by, assignee_id)
      VALUES (${itemId(i)}, ${titleFor(i)}, ${it.status}, ${scheduled}, ${lead}, ${userId(
      it.createdByIdx
    )}, ${assignee})
    `);

    if (lead) {
      await db.execute(sql`
        INSERT INTO party_identities (party_id, kind, value)
        VALUES (${lead}, ${"phone_hash"}, ${phoneHash(i)})
      `);
    }
  }
}

// ── Generators ───────────────────────────────────────────────────────────────

const itemArb = (numUsers: number): fc.Arbitrary<WorldItem> =>
  fc.record({
    createdByIdx: fc.integer({ min: 0, max: numUsers - 1 }),
    hasAssignee: fc.boolean(),
    assigneeIdx: fc.integer({ min: 0, max: numUsers - 1 }),
    shape: fc.constantFrom<ItemShape>("task", "lead", "appointment"),
    status: fc.constantFrom<TicketStatus>(
      "open",
      "assigned",
      "in_progress",
      "resolved",
      "closed"
    ),
  });

const worldArb: fc.Arbitrary<World> = fc
  .integer({ min: 2, max: 5 })
  .chain((numUsers) =>
    fc.record({
      numUsers: fc.constant(numUsers),
      requesterIdx: fc.integer({ min: 0, max: numUsers - 1 }),
      items: fc.array(itemArb(numUsers), { minLength: 0, maxLength: 10 }),
    })
  );

/**
 * Garbage entries that MUST fail the module's fail-closed `isStackItem` guard —
 * primitives, nulls, wrong-typed fields, an unknown kind, an empty id, a missing
 * id. None is a well-formed Stack_Item, so each must be OMITTED (Req 6.3, 6.4).
 */
const garbageEntryArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.string(),
  fc.boolean(),
  fc.constant({}),
  // wrong types
  fc.record({ id: fc.integer(), kind: fc.string(), title: fc.string() }),
  // unknown kind
  fc.constant({
    id: "garbage_kind",
    kind: "not_a_real_kind",
    title: "x",
    status: "open",
    dueAt: null,
  }),
  // empty id
  fc.constant({ id: "", kind: "task", title: "x", status: "open", dueAt: null }),
  // missing id
  fc.constant({ kind: "task", title: "x", status: "open", dueAt: null }),
  // bad status
  fc.constant({ id: "bad_status", kind: "task", title: "x", status: "pending", dueAt: null })
);

/**
 * Result payloads that do NOT carry the requested `{ items: StackItem[] }`
 * shape — `assembleStack` must treat each as "did not return the requested
 * data" and fail closed to unavailable (Req 2.6).
 */
const malformedResultArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.string(),
  fc.constant({}),
  fc.record({ items: fc.integer() }),
  fc.record({ items: fc.string() }),
  fc.constant({ notItems: [] }),
  fc.constant({ items: null })
);

const errorCodeArb: fc.Arbitrary<DispatchErrorCode> = fc.constantFrom(
  "unknown_tool",
  "validation_error",
  "permission_denied",
  "otp_required",
  "handler_error"
);

type Scenario =
  | { kind: "permitted" }
  | { kind: "mixed_items"; garbage: unknown[] }
  | { kind: "denied"; code: DispatchErrorCode }
  | { kind: "malformed_result"; result: unknown }
  | { kind: "throws" }
  | { kind: "timeout" };

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
  fc.constant<Scenario>({ kind: "permitted" }),
  fc
    .array(garbageEntryArb, { minLength: 1, maxLength: 6 })
    .map<Scenario>((garbage) => ({ kind: "mixed_items", garbage })),
  errorCodeArb.map<Scenario>((code) => ({ kind: "denied", code })),
  malformedResultArb.map<Scenario>((result) => ({
    kind: "malformed_result",
    result,
  })),
  fc.constant<Scenario>({ kind: "throws" }),
  fc.constant<Scenario>({ kind: "timeout" })
);

// Interleave the real permitted items with garbage so order can't be relied on.
function interleave(real: unknown[], garbage: unknown[]): unknown[] {
  const out: unknown[] = [];
  const max = Math.max(real.length, garbage.length);
  for (let i = 0; i < max; i++) {
    if (i < garbage.length) out.push(garbage[i]);
    if (i < real.length) out.push(real[i]);
  }
  return out;
}

// ── Property 1 ──────────────────────────────────────────────────────────────

describe("Stack assembly — Property 1: RBAC-scoped and fail-closed (P-RBACBrief)", () => {
  it(
    "Feature: agentic-home, Property 1: over a dispatcher enforcing RBAC, the assembled Stack contains only the requesting user's permitted records; indeterminate/denied reads are omitted and errors/timeouts fail closed with no fabricated items",
    async () => {
      await fc.assert(
        fc.asyncProperty(worldArb, scenarioArb, async (world, scenario) => {
          const requester = userId(world.requesterIdx);
          const ctx: StackContext = { userId: requester };

          // The set of item ids the requester's role permits — the ONLY ids that
          // may appear in an affirmatively-assembled Stack.
          const permittedIds = new Set(
            world.items
              .map((it, idx) => ({ it, idx }))
              .filter(({ it }) => isPermitted(it, world.requesterIdx))
              .map(({ idx }) => itemId(idx))
          );

          // Run the real list_stack handler under the requesting user's ctx, so
          // its role-clamp WHERE clause is the genuine RBAC enforcement.
          const runRealHandler = async (
            db: Database,
            input: unknown
          ): Promise<{ items: unknown[]; truncatedAt: number }> => {
            const parsed = listStackEntry.inputSchema.parse(input);
            const result = await listStackEntry.handler(
              db,
              { actor: requester, userId: requester } as ToolContext,
              parsed as never
            );
            return result as { items: unknown[]; truncatedAt: number };
          };

          let dispatch: StackDispatch;
          let timeoutMs: number | undefined;
          let mem: IMemoryDb | undefined;

          if (scenario.kind === "permitted" || scenario.kind === "mixed_items") {
            const built = buildDb();
            mem = built.mem;
            await seedWorld(built.db, world);
            dispatch = async (toolName, input) => {
              expect(toolName).toBe("list_stack");
              const real = await runRealHandler(built.db, input);
              if (scenario.kind === "mixed_items") {
                // The RBAC-enforcing read returned the permitted rows; splice in
                // garbage the module must omit without fabricating anything.
                return {
                  ok: true,
                  result: {
                    items: interleave(real.items, scenario.garbage),
                    truncatedAt: real.truncatedAt,
                  },
                };
              }
              return { ok: true, result: real };
            };
          } else if (scenario.kind === "denied") {
            dispatch = async () => ({
              ok: false,
              error: { code: scenario.code, message: "denied by dispatcher" },
            });
          } else if (scenario.kind === "malformed_result") {
            dispatch = async () => ({ ok: true, result: scenario.result });
          } else if (scenario.kind === "throws") {
            dispatch = async () => {
              throw new Error("dispatcher boom");
            };
          } else {
            // timeout: a dispatch that never settles, raced against a tiny budget.
            timeoutMs = 5;
            dispatch = () => new Promise<DispatchResult>(() => {});
          }

          const out = await assembleStack(ctx, { dispatch, timeoutMs });

          void mem; // pg-mem instances are GC'd; nothing to close.

          if (scenario.kind === "permitted" || scenario.kind === "mixed_items") {
            // Affirmative read → a (possibly empty) Stack, never unavailable.
            expect(isStackUnavailable(out)).toBe(false);
            const items = out as StackItem[];
            const ids = new Set(items.map((i) => i.id));

            // RBAC-scoped: the assembled set is EXACTLY the permitted set — every
            // returned item is permitted, and every permitted item is present.
            expect(ids).toEqual(permittedIds);
            // No record owned by another user ever appears (fail-closed widen-never).
            for (const item of items) {
              expect(permittedIds.has(item.id)).toBe(true);
            }
            // Nothing fabricated: garbage entries are omitted, count == permitted.
            expect(items.length).toBe(permittedIds.size);
          } else {
            // Denied / indeterminate / error / timeout → fail closed to the
            // unavailable marker with NO fabricated items (Req 2.6, 6.3, 6.4).
            expect(isStackUnavailable(out)).toBe(true);
            expect(out).toEqual({ unavailable: true });
          }
        }),
        { numRuns: NUM_RUNS }
      );
    }
  );
});

// ── Explicit examples — one per fail-closed mode + the core RBAC clamp ─────────

describe("Stack assembly — explicit examples (Req 6.1, 6.3, 6.4)", () => {
  it("RBAC clamp: only the requesting user's own items appear, none from another user", async () => {
    const { db } = buildDb();
    const world: World = {
      numUsers: 2,
      requesterIdx: 0,
      items: [
        { createdByIdx: 0, hasAssignee: false, assigneeIdx: 0, shape: "task", status: "open" },
        { createdByIdx: 1, hasAssignee: false, assigneeIdx: 1, shape: "task", status: "open" },
        { createdByIdx: 1, hasAssignee: true, assigneeIdx: 0, shape: "lead", status: "assigned" },
      ],
    };
    await seedWorld(db, world);

    const dispatch: StackDispatch = async (_tool, input) => {
      const parsed = listStackEntry.inputSchema.parse(input);
      const result = await listStackEntry.handler(
        db,
        { actor: userId(0), userId: userId(0) } as ToolContext,
        parsed as never
      );
      return { ok: true, result };
    };

    const out = await assembleStack({ userId: userId(0) }, { dispatch });
    expect(isStackUnavailable(out)).toBe(false);
    const ids = new Set((out as StackItem[]).map((i) => i.id));
    // item_0 (created by user_0) and item_2 (assigned to user_0) — NOT item_1.
    expect(ids).toEqual(new Set([itemId(0), itemId(2)]));
  });

  it("denied read → unavailable, no fabricated items", async () => {
    const dispatch: StackDispatch = async () => ({
      ok: false,
      error: { code: "permission_denied", message: "nope" },
    });
    const out = await assembleStack({ userId: userId(0) }, { dispatch });
    expect(out).toEqual({ unavailable: true });
  });

  it("indeterminate (result has no items array) → unavailable", async () => {
    const dispatch: StackDispatch = async () => ({ ok: true, result: {} });
    const out = await assembleStack({ userId: userId(0) }, { dispatch });
    expect(out).toEqual({ unavailable: true });
  });

  it("dispatcher throw → unavailable", async () => {
    const dispatch: StackDispatch = async () => {
      throw new Error("boom");
    };
    const out = await assembleStack({ userId: userId(0) }, { dispatch });
    expect(out).toEqual({ unavailable: true });
  });

  it("timeout → unavailable", async () => {
    const dispatch: StackDispatch = () => new Promise<DispatchResult>(() => {});
    const out = await assembleStack(
      { userId: userId(0) },
      { dispatch, timeoutMs: 5 }
    );
    expect(out).toEqual({ unavailable: true });
  });

  it("missing requesting user → unavailable (fail-closed, no unscoped read)", async () => {
    let called = false;
    const dispatch: StackDispatch = async () => {
      called = true;
      return { ok: true, result: { items: [], truncatedAt: 100 } };
    };
    const out = await assembleStack({ userId: "" }, { dispatch });
    expect(out).toEqual({ unavailable: true });
    expect(called).toBe(false);
  });
});
