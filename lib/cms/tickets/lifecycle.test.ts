import { describe, it, expect } from "vitest";
import {
  VALID_TRANSITIONS,
  isValidTransition,
} from "./lifecycle";
import type { TicketStatus } from "../types";

const ALL_STATUSES: TicketStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
];

describe("VALID_TRANSITIONS", () => {
  it("has an entry for every ticket status", () => {
    for (const status of ALL_STATUSES) {
      expect(VALID_TRANSITIONS).toHaveProperty(status);
      expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
    }
  });

  it("closed is a terminal state with no transitions", () => {
    expect(VALID_TRANSITIONS.closed).toEqual([]);
  });
});

describe("isValidTransition", () => {
  const validPairs: [TicketStatus, TicketStatus][] = [
    ["open", "assigned"],
    ["open", "in_progress"],
    ["assigned", "in_progress"],
    ["in_progress", "resolved"],
    ["resolved", "closed"],
    ["resolved", "in_progress"],
  ];

  it.each(validPairs)(
    "allows transition from %s to %s",
    (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    }
  );

  // Build the set of invalid pairs (all combos minus valid ones)
  const validSet = new Set(validPairs.map(([f, t]) => `${f}->${t}`));
  const invalidPairs = ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.filter((to) => !validSet.has(`${from}->${to}`)).map(
      (to) => [from, to] as [TicketStatus, TicketStatus]
    )
  );

  it.each(invalidPairs)(
    "rejects transition from %s to %s",
    (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    }
  );

  it("rejects self-transitions for all statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(isValidTransition(status, status)).toBe(false);
    }
  });
});
