import { describe, it, expect, beforeEach } from "vitest";
import {
  detectAdminIntent,
  parseDateWindow,
  runAdminAgent,
  _resetPendingActionsForTests,
  type AdminIntent,
} from "./admin-agent";

// Minimal fake of the drizzle-style fluent builder used by admin-agent reports.
// Each chain ends in a thenable so `await db.select()...` resolves.
function buildFakeDb(rows: Record<string, unknown[]>): {
  db: unknown;
  setRows: (key: string, value: unknown[]) => void;
  calls: string[];
} {
  const calls: string[] = [];
  const tableNameOf = (t: unknown): string => {
    if (!t || typeof t !== "object") return "unknown";
    // drizzle tables expose Symbol.for('drizzle:Name') / OriginalName etc.
    // Our fake schema objects below carry `__tableName`.
    const named = t as { __tableName?: string };
    return named.__tableName ?? "unknown";
  };

  const makeSelectChain = (key: string) => {
    const result = rows[key] ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = (table: unknown) => {
      const tableKey = `${key}:${tableNameOf(table)}`;
      calls.push(tableKey);
      return {
        where: () => Promise.resolve(result),
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.resolve(result) }),
          }),
          orderBy: () => ({ limit: () => Promise.resolve(result) }),
        }),
        orderBy: () => ({ limit: () => Promise.resolve(result) }),
        limit: () => Promise.resolve(result),
        then: (cb: (v: unknown[]) => unknown) => Promise.resolve(result).then(cb),
      };
    };
    return chain;
  };

  // We map by call order using a counter when caller chains many parallel selects.
  let selectIdx = 0;
  const selectKeys = Object.keys(rows);

  const db = {
    select: (_cols?: unknown) => {
      const key = selectKeys[selectIdx % Math.max(1, selectKeys.length)] ?? "default";
      selectIdx += 1;
      return makeSelectChain(key);
    },
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(rows.update ?? []),
        }),
      }),
    }),
    insert: () => ({ values: () => Promise.resolve() }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
  };

  return {
    db,
    setRows: (k, v) => {
      rows[k] = v;
    },
    calls,
  };
}

beforeEach(() => {
  _resetPendingActionsForTests();
});

// ── detectAdminIntent ────────────────────────────────────────────────────────

describe("detectAdminIntent", () => {
  const cases: Array<[string, AdminIntent]> = [
    ["help", "help"],
    ["what can you do?", "help"],
    ["give me an overview", "report_overview"],
    ["dashboard summary please", "report_overview"],
    ["how many projects do we have?", "report_projects"],
    ["list recent clients", "report_clients"],
    ["how many leads this week?", "report_leads"],
    ["show me recent leads", "list_recent_leads"],
    ["how many tickets are open?", "list_open_tickets"],
    ["list open tickets", "list_open_tickets"],
    ["show appointments today", "list_recent_appointments"],
    ["how many appointments?", "report_appointments"],
    ["mark all bookings from this week as completed", "bulk_complete_bookings"],
    ["cancel all appointments today", "bulk_cancel_bookings"],
    ["close all resolved tickets", "bulk_close_tickets"],
    ["please cancel ORA-APT-ABC123", "cancel_appointment"],
    ["reschedule ORA-APT-ABC123 to tomorrow", "reschedule_appointment"],
    ["change status of ORA-000123 to closed", "change_ticket_status"],
    ["how many tickets do i have today", "my_tickets"],
    ["my open tickets", "my_tickets"],
    ["tickets assigned to me", "my_tickets"],
    ["do i have appointments today", "my_appointments"],
    ["my appointments this week", "my_appointments"],
    ["what is my most important ticket", "my_top_priority"],
    ["my top priority ticket", "my_top_priority"],
    ["what did the ai do today", "my_ai_actions"],
    ["show me my ai actions", "my_ai_actions"],
    ["what's the weather", "unknown"],
  ];

  for (const [msg, expected] of cases) {
    it(`classifies "${msg}" as ${expected}`, () => {
      expect(detectAdminIntent(msg)).toBe(expected);
    });
  }
});

// ── parseDateWindow ──────────────────────────────────────────────────────────

describe("parseDateWindow", () => {
  // Wed 2024-06-12 12:00 UTC (a Wednesday)
  const now = new Date("2024-06-12T12:00:00Z");

  it("returns null when no window phrase present", () => {
    expect(parseDateWindow("hello", now)).toBeNull();
  });

  it("recognises today", () => {
    const w = parseDateWindow("appointments today", now);
    expect(w?.label).toBe("today");
    expect(w?.start.toDateString()).toBe(now.toDateString());
  });

  it("recognises yesterday", () => {
    const w = parseDateWindow("leads yesterday", now);
    expect(w?.label).toBe("yesterday");
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    expect(w?.start.toDateString()).toBe(y.toDateString());
  });

  it("recognises this week (Monday-anchored)", () => {
    const w = parseDateWindow("leads this week", now);
    expect(w?.label).toBe("this week");
    expect(w?.start.getDay()).toBe(1); // Monday
  });

  it("recognises last week (7-day span)", () => {
    const w = parseDateWindow("leads last week", now);
    expect(w?.label).toBe("last week");
    const span =
      (w!.end.getTime() - w!.start.getTime()) / (1000 * 60 * 60 * 24);
    expect(span).toBeGreaterThan(5.9);
    expect(span).toBeLessThan(7);
  });

  it("recognises this month", () => {
    const w = parseDateWindow("leads this month", now);
    expect(w?.label).toBe("this month");
    expect(w?.start.getDate()).toBe(1);
  });
});

// ── runAdminAgent help / unknown paths (no DB needed) ────────────────────────

describe("runAdminAgent — text-only intents", () => {
  it("returns help text for 'help'", async () => {
    const { db } = buildFakeDb({});
    const res = await runAdminAgent(db as never, {
      userId: "user-1",
      message: "help",
    });
    expect(res.response.length).toBeGreaterThan(20);
    expect(res.pendingAction).toBeUndefined();
  });

  it("returns a friendly message for unknown intent", async () => {
    const { db } = buildFakeDb({});
    const res = await runAdminAgent(db as never, {
      userId: "user-1",
      message: "what is the meaning of life",
    });
    expect(res.response).toMatch(/(not sure|don't|help|understand)/i);
  });
});

// ── Confirmation token lifecycle ────────────────────────────────────────────

describe("runAdminAgent — confirmation token", () => {
  it("rejects an unknown confirmation token", async () => {
    const { db } = buildFakeDb({});
    const res = await runAdminAgent(db as never, {
      userId: "user-1",
      message: "(confirm)",
      confirmationToken: "00000000-0000-4000-8000-000000000000",
    });
    expect(res.response).toMatch(/(expired|invalid|not.*found|no.*pending)/i);
  });
});
