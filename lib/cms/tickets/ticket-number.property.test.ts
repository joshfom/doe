import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { formatTicketNumber, parseTicketNumber } from "./ticket-number";

// Feature: support-ticketing-system, Property 1: Ticket number round-trip

// ── Shared arbitraries ───────────────────────────────────────────────────────

/** Generates a positive integer in the valid 6-digit ticket range (1–999999). */
const arbTicketSequence = fc.integer({ min: 1, max: 999999 });

/**
 * Generates a valid ticket number string matching the ORA-XXXXXX pattern.
 * The numeric portion is zero-padded to exactly 6 digits.
 */
const arbTicketNumberString = arbTicketSequence.map(
  (n) => `ORA-${String(n).padStart(6, "0")}`
);

// ─────────────────────────────────────────────────────────────────────────────
// Property 1: Ticket number round-trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 1.4, 15.2, 15.4**
 *
 * Property 1: Ticket number round-trip
 *
 * For any positive integer N (within the 6-digit range 1–999999), formatting
 * N as a ticket number via `formatTicketNumber` and then parsing it back via
 * `parseTicketNumber` should return the original integer N. Conversely, for
 * any valid ticket number string matching the `ORA-XXXXXX` pattern, parsing
 * then reformatting should produce the original string.
 */
// Feature: support-ticketing-system, Property 1: Ticket number round-trip
describe("Feature: support-ticketing-system, Property 1: Ticket number round-trip", () => {
  it("format then parse returns the original integer", () => {
    fc.assert(
      fc.property(arbTicketSequence, (n) => {
        const formatted = formatTicketNumber(n);
        const parsed = parseTicketNumber(formatted);

        // Parsing must succeed (non-null)
        expect(parsed).not.toBeNull();

        // Round-trip: parsed value equals the original integer
        expect(parsed).toBe(n);
      }),
      { numRuns: 20 }
    );
  });

  it("parse then format returns the original string", () => {
    fc.assert(
      fc.property(arbTicketNumberString, (ticketNumber) => {
        const parsed = parseTicketNumber(ticketNumber);

        // Parsing a valid ticket number must succeed
        expect(parsed).not.toBeNull();

        const reformatted = formatTicketNumber(parsed!);

        // Round-trip: reformatted string equals the original
        expect(reformatted).toBe(ticketNumber);
      }),
      { numRuns: 20 }
    );
  });
});
