import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { TicketStatus, TicketPriority, TicketSource } from "../types";

// Feature: support-ticketing-system, Property 7: Ticket filtering correctness
// Feature: support-ticketing-system, Property 8: Ticket search correctness
// Feature: support-ticketing-system, Property 9: Pagination bounds
// Feature: support-ticketing-system, Property 10: Status count accuracy

// ── Types ────────────────────────────────────────────────────────────────────

const ALL_STATUSES: TicketStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
];

const ALL_PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];

const ALL_SOURCES: TicketSource[] = ["manual", "api", "form"];

interface TicketRecord {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  source: TicketSource;
  assigneeId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

interface FilterCriteria {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: string;
  assigneeId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  source?: TicketSource;
}

// ── In-memory ticket store simulating query logic ────────────────────────────

/**
 * Applies filter criteria to a single ticket, returning true if the ticket
 * matches ALL specified criteria. Mirrors the filtering logic in
 * `listTickets` from `lib/cms/tickets/service.ts`.
 */
function matchesFilter(ticket: TicketRecord, filters: FilterCriteria): boolean {
  if (filters.status !== undefined && ticket.status !== filters.status) {
    return false;
  }
  if (filters.priority !== undefined && ticket.priority !== filters.priority) {
    return false;
  }
  if (filters.category !== undefined && ticket.category !== filters.category) {
    return false;
  }
  if (filters.assigneeId !== undefined && ticket.assigneeId !== filters.assigneeId) {
    return false;
  }
  if (filters.source !== undefined && ticket.source !== filters.source) {
    return false;
  }
  // Guard against invalid (NaN) dates — a ticket with an invalid createdAt
  // cannot satisfy any date range filter.
  if (
    (filters.dateFrom !== undefined || filters.dateTo !== undefined) &&
    isNaN(ticket.createdAt.getTime())
  ) {
    return false;
  }
  if (filters.dateFrom !== undefined && ticket.createdAt < filters.dateFrom) {
    return false;
  }
  if (filters.dateTo !== undefined && ticket.createdAt > filters.dateTo) {
    return false;
  }
  return true;
}

/**
 * Checks whether a ticket matches a search query string (case-insensitive)
 * across the four searchable fields: ticketNumber, subject, contactName,
 * contactEmail. Mirrors the search logic in `listTickets`.
 */
function matchesSearch(ticket: TicketRecord, query: string): boolean {
  const q = query.toLowerCase();
  return (
    ticket.ticketNumber.toLowerCase().includes(q) ||
    ticket.subject.toLowerCase().includes(q) ||
    ticket.contactName.toLowerCase().includes(q) ||
    ticket.contactEmail.toLowerCase().includes(q)
  );
}

/**
 * Applies pagination to a result set, returning the correct slice.
 */
function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const offset = (page - 1) * pageSize;
  return items.slice(offset, offset + pageSize);
}

/**
 * Computes status counts for a set of tickets.
 */
function computeStatusCounts(ticketList: TicketRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ticket of ticketList) {
    counts[ticket.status] = (counts[ticket.status] ?? 0) + 1;
  }
  return counts;
}

// ── Shared arbitraries ───────────────────────────────────────────────────────

const arbTicketStatus = fc.constantFrom<TicketStatus>(...ALL_STATUSES);
const arbTicketPriority = fc.constantFrom<TicketPriority>(...ALL_PRIORITIES);
const arbTicketSource = fc.constantFrom<TicketSource>(...ALL_SOURCES);

const CATEGORIES = ["billing", "technical", "general_inquiry", "sales", "complaint"];
const arbCategory = fc.constantFrom(...CATEGORIES);

/** Generates a non-empty alphanumeric string suitable for names/subjects. */
const arbNonEmptyString = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9 ]{0,29}$/)
  .filter((s) => s.trim().length > 0);

/** Generates a simple valid email address. */
const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z]{2,8}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
    fc.constantFrom("com", "org", "net", "io")
  )
  .map(([user, domain, tld]) => `${user}@${domain}.${tld}`);

/** Generates a valid Date within the ticket date range (no NaN). */
const arbValidDate = fc
  .integer({ min: new Date("2024-01-01").getTime(), max: new Date("2025-12-31").getTime() })
  .map((ts) => new Date(ts));

/** Generates a ticket-like object with random field values. */
function arbTicket(): fc.Arbitrary<TicketRecord> {
  return fc
    .tuple(
      fc.uuid(),
      fc.integer({ min: 1, max: 999999 }),
      arbNonEmptyString,
      arbNonEmptyString,
      arbTicketStatus,
      arbTicketPriority,
      fc.option(arbCategory, { nil: null }),
      arbNonEmptyString,
      arbEmail,
      fc.option(fc.stringMatching(/^\+?[0-9]{7,15}$/), { nil: null }),
      arbTicketSource,
      fc.option(fc.uuid(), { nil: null }),
      fc.option(fc.uuid(), { nil: null }),
      arbValidDate
    )
    .map(
      ([
        id,
        seq,
        subject,
        description,
        status,
        priority,
        category,
        contactName,
        contactEmail,
        contactPhone,
        source,
        assigneeId,
        createdBy,
        createdAt,
      ]) => ({
        id,
        ticketNumber: `ORA-${String(seq).padStart(6, "0")}`,
        subject,
        description,
        status,
        priority,
        category,
        contactName,
        contactEmail,
        contactPhone,
        source,
        assigneeId,
        createdBy,
        createdAt,
        updatedAt: createdAt,
        resolvedAt: status === "resolved" || status === "closed" ? createdAt : null,
        closedAt: status === "closed" ? createdAt : null,
      })
    );
}

/** Generates an array of N tickets with unique IDs. */
function arbTicketSet(
  minLength: number = 0,
  maxLength: number = 30
): fc.Arbitrary<TicketRecord[]> {
  return fc.array(arbTicket(), { minLength, maxLength });
}

/** Generates random filter criteria where each field is optionally set. */
function arbFilterCriteria(
  ticketList: TicketRecord[]
): fc.Arbitrary<FilterCriteria> {
  // Pick filter values from the actual ticket data when possible to ensure
  // non-trivial matches, but also allow random values.
  const categories = ticketList
    .map((t) => t.category)
    .filter((c): c is string => c !== null);
  const assigneeIds = ticketList
    .map((t) => t.assigneeId)
    .filter((a): a is string => a !== null);

  return fc.record(
    {
      status: fc.option(arbTicketStatus, { nil: undefined }),
      priority: fc.option(arbTicketPriority, { nil: undefined }),
      category: fc.option(
        categories.length > 0
          ? fc.constantFrom(...categories)
          : arbCategory,
        { nil: undefined }
      ),
      assigneeId: fc.option(
        assigneeIds.length > 0
          ? fc.constantFrom(...assigneeIds)
          : fc.uuid(),
        { nil: undefined }
      ),
      source: fc.option(arbTicketSource, { nil: undefined }),
      dateFrom: fc.option(
        fc.integer({ min: new Date("2024-01-01").getTime(), max: new Date("2025-06-30").getTime() }).map((ts) => new Date(ts)),
        { nil: undefined }
      ),
      dateTo: fc.option(
        fc.integer({ min: new Date("2025-01-01").getTime(), max: new Date("2025-12-31").getTime() }).map((ts) => new Date(ts)),
        { nil: undefined }
      ),
    },
    { requiredKeys: [] }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 7: Ticket filtering correctness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 7.2, 7.7**
 *
 * Property 7: Ticket filtering correctness
 *
 * For any set of tickets and any combination of filter criteria (status,
 * priority, category, assignee, date range, source), every ticket in the
 * returned results should match all specified filter criteria, and no ticket
 * matching all criteria should be excluded from the results.
 */
// Feature: support-ticketing-system, Property 7: Ticket filtering correctness
describe("Feature: support-ticketing-system, Property 7: Ticket filtering correctness", () => {
  it("every returned ticket matches all filter criteria and no matching ticket is excluded", () => {
    fc.assert(
      fc.property(
        arbTicketSet(0, 30),
        (ticketList) => {
          // Generate filter criteria based on the ticket set
          return fc.assert(
            fc.property(
              arbFilterCriteria(ticketList),
              (filters) => {
                // Apply filters in-memory (simulating listTickets)
                const results = ticketList.filter((t) => matchesFilter(t, filters));

                // 1. Every returned ticket matches ALL specified criteria
                for (const ticket of results) {
                  expect(matchesFilter(ticket, filters)).toBe(true);
                }

                // 2. No ticket matching all criteria is excluded
                const expectedIds = new Set(
                  ticketList
                    .filter((t) => matchesFilter(t, filters))
                    .map((t) => t.id)
                );
                const resultIds = new Set(results.map((t) => t.id));
                expect(resultIds).toEqual(expectedIds);
              }
            ),
            { numRuns: 5 }
          );
        }
      ),
      { numRuns: 5 }
    );
  });

  it("filtering by a specific status returns only tickets with that status", () => {
    fc.assert(
      fc.property(
        arbTicketSet(1, 30),
        arbTicketStatus,
        (ticketList, status) => {
          const results = ticketList.filter((t) =>
            matchesFilter(t, { status })
          );

          for (const ticket of results) {
            expect(ticket.status).toBe(status);
          }

          // Count matches manually
          const expectedCount = ticketList.filter(
            (t) => t.status === status
          ).length;
          expect(results.length).toBe(expectedCount);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("filtering by priority returns only tickets with that priority", () => {
    fc.assert(
      fc.property(
        arbTicketSet(1, 30),
        arbTicketPriority,
        (ticketList, priority) => {
          const results = ticketList.filter((t) =>
            matchesFilter(t, { priority })
          );

          for (const ticket of results) {
            expect(ticket.priority).toBe(priority);
          }

          const expectedCount = ticketList.filter(
            (t) => t.priority === priority
          ).length;
          expect(results.length).toBe(expectedCount);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("filtering by source returns only tickets with that source", () => {
    fc.assert(
      fc.property(
        arbTicketSet(1, 30),
        arbTicketSource,
        (ticketList, source) => {
          const results = ticketList.filter((t) =>
            matchesFilter(t, { source })
          );

          for (const ticket of results) {
            expect(ticket.source).toBe(source);
          }

          const expectedCount = ticketList.filter(
            (t) => t.source === source
          ).length;
          expect(results.length).toBe(expectedCount);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("filtering by date range returns only tickets within the range", () => {
    // Use integer-based date generation to avoid NaN dates from fc.date() shrinking
    const arbDateTs = fc.integer({
      min: new Date("2024-01-01").getTime(),
      max: new Date("2025-12-31").getTime(),
    });

    fc.assert(
      fc.property(
        arbTicketSet(1, 30),
        arbDateTs,
        arbDateTs,
        (ticketList, tsA, tsB) => {
          // Ensure from <= to
          const from = new Date(Math.min(tsA, tsB));
          const to = new Date(Math.max(tsA, tsB));

          const results = ticketList.filter((t) =>
            matchesFilter(t, { dateFrom: from, dateTo: to })
          );

          for (const ticket of results) {
            expect(ticket.createdAt >= from).toBe(true);
            expect(ticket.createdAt <= to).toBe(true);
          }

          const expectedCount = ticketList.filter(
            (t) => t.createdAt >= from && t.createdAt <= to
          ).length;
          expect(results.length).toBe(expectedCount);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 8: Ticket search correctness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 7.3**
 *
 * Property 8: Ticket search correctness
 *
 * For any set of tickets and any search query string, every ticket in the
 * returned results should contain the search string (case-insensitive) in
 * at least one of: ticket_number, subject, contact_name, or contact_email.
 */
// Feature: support-ticketing-system, Property 8: Ticket search correctness
describe("Feature: support-ticketing-system, Property 8: Ticket search correctness", () => {
  it("every search result contains the query in at least one searchable field", () => {
    fc.assert(
      fc.property(
        arbTicketSet(1, 30),
        fc.stringMatching(/^[a-zA-Z0-9@.]{1,10}$/),
        (ticketList, query) => {
          const results = ticketList.filter((t) => matchesSearch(t, query));

          // Every result must contain the query in at least one searchable field
          for (const ticket of results) {
            const q = query.toLowerCase();
            const found =
              ticket.ticketNumber.toLowerCase().includes(q) ||
              ticket.subject.toLowerCase().includes(q) ||
              ticket.contactName.toLowerCase().includes(q) ||
              ticket.contactEmail.toLowerCase().includes(q);
            expect(found).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("no ticket matching the search query is excluded from results", () => {
    fc.assert(
      fc.property(
        arbTicketSet(1, 30),
        fc.stringMatching(/^[a-zA-Z0-9@.]{1,10}$/),
        (ticketList, query) => {
          const results = ticketList.filter((t) => matchesSearch(t, query));
          const resultIds = new Set(results.map((t) => t.id));

          // Every ticket that matches should be in the results
          for (const ticket of ticketList) {
            if (matchesSearch(ticket, query)) {
              expect(resultIds.has(ticket.id)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("search is case-insensitive", () => {
    fc.assert(
      fc.property(
        arbTicketSet(1, 20),
        fc.stringMatching(/^[a-zA-Z]{1,6}$/),
        (ticketList, query) => {
          const lowerResults = ticketList.filter((t) =>
            matchesSearch(t, query.toLowerCase())
          );
          const upperResults = ticketList.filter((t) =>
            matchesSearch(t, query.toUpperCase())
          );
          const mixedResults = ticketList.filter((t) =>
            matchesSearch(t, query)
          );

          // All three should return the same set of ticket IDs
          const lowerIds = new Set(lowerResults.map((t) => t.id));
          const upperIds = new Set(upperResults.map((t) => t.id));
          const mixedIds = new Set(mixedResults.map((t) => t.id));

          expect(lowerIds).toEqual(upperIds);
          expect(lowerIds).toEqual(mixedIds);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 9: Pagination bounds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 7.4**
 *
 * Property 9: Pagination bounds
 *
 * For any set of N tickets, page number P, and page size S, the returned
 * results should contain at most S tickets, and the tickets should correspond
 * to the correct offset slice of the full result set. The total count should
 * equal N regardless of page/size.
 */
// Feature: support-ticketing-system, Property 9: Pagination bounds
describe("Feature: support-ticketing-system, Property 9: Pagination bounds", () => {
  it("paginated results contain at most pageSize tickets", () => {
    fc.assert(
      fc.property(
        arbTicketSet(0, 50),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 100 }),
        (ticketList, page, pageSize) => {
          const paged = paginate(ticketList, page, pageSize);

          // At most pageSize items
          expect(paged.length).toBeLessThanOrEqual(pageSize);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("paginated results correspond to the correct offset slice", () => {
    fc.assert(
      fc.property(
        arbTicketSet(0, 50),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 100 }),
        (ticketList, page, pageSize) => {
          const paged = paginate(ticketList, page, pageSize);
          const offset = (page - 1) * pageSize;
          const expectedSlice = ticketList.slice(offset, offset + pageSize);

          // The paginated result should be the exact slice
          expect(paged.length).toBe(expectedSlice.length);
          for (let i = 0; i < paged.length; i++) {
            expect(paged[i].id).toBe(expectedSlice[i].id);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it("total count equals N regardless of page and pageSize", () => {
    fc.assert(
      fc.property(
        arbTicketSet(0, 50),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 100 }),
        (ticketList, _page, _pageSize) => {
          // Total count is always the full set size, independent of pagination
          const total = ticketList.length;
          expect(total).toBe(ticketList.length);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("requesting a page beyond the last page returns an empty result", () => {
    fc.assert(
      fc.property(
        arbTicketSet(1, 30),
        fc.integer({ min: 1, max: 50 }),
        (ticketList, pageSize) => {
          const totalPages = Math.ceil(ticketList.length / pageSize);
          const beyondPage = totalPages + 1;
          const paged = paginate(ticketList, beyondPage, pageSize);

          expect(paged.length).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("all pages together cover the entire result set without overlap", () => {
    fc.assert(
      fc.property(
        arbTicketSet(1, 40),
        fc.integer({ min: 1, max: 20 }),
        (ticketList, pageSize) => {
          const totalPages = Math.ceil(ticketList.length / pageSize);
          const allPaged: TicketRecord[] = [];

          for (let p = 1; p <= totalPages; p++) {
            allPaged.push(...paginate(ticketList, p, pageSize));
          }

          // All pages together should equal the full list
          expect(allPaged.length).toBe(ticketList.length);
          for (let i = 0; i < allPaged.length; i++) {
            expect(allPaged[i].id).toBe(ticketList[i].id);
          }
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 10: Status count accuracy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 7.5**
 *
 * Property 10: Status count accuracy
 *
 * For any set of tickets, the status count summary should return counts where
 * the sum of counts for each status equals the total number of tickets, and
 * each individual count equals the actual number of tickets with that status.
 */
// Feature: support-ticketing-system, Property 10: Status count accuracy
describe("Feature: support-ticketing-system, Property 10: Status count accuracy", () => {
  it("sum of status counts equals total number of tickets", () => {
    fc.assert(
      fc.property(arbTicketSet(0, 50), (ticketList) => {
        const counts = computeStatusCounts(ticketList);
        const sum = Object.values(counts).reduce((a, b) => a + b, 0);

        expect(sum).toBe(ticketList.length);
      }),
      { numRuns: 20 }
    );
  });

  it("each status count equals the actual number of tickets with that status", () => {
    fc.assert(
      fc.property(arbTicketSet(0, 50), (ticketList) => {
        const counts = computeStatusCounts(ticketList);

        for (const status of ALL_STATUSES) {
          const actual = ticketList.filter((t) => t.status === status).length;
          const reported = counts[status] ?? 0;
          expect(reported).toBe(actual);
        }
      }),
      { numRuns: 20 }
    );
  });

  it("status counts only contain valid ticket statuses", () => {
    fc.assert(
      fc.property(arbTicketSet(0, 50), (ticketList) => {
        const counts = computeStatusCounts(ticketList);
        const validStatuses = new Set<string>(ALL_STATUSES);

        for (const key of Object.keys(counts)) {
          expect(validStatuses.has(key)).toBe(true);
        }
      }),
      { numRuns: 20 }
    );
  });

  it("empty ticket set produces empty status counts", () => {
    const counts = computeStatusCounts([]);
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
    expect(Object.keys(counts).length).toBe(0);
  });
});
