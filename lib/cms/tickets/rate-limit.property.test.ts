import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { RateLimiter } from "./rate-limit";

// Feature: support-ticketing-system, Property 14: Rate limiter enforcement

// ── Shared arbitraries ───────────────────────────────────────────────────────

/** Generates a valid IPv4 address string. */
const arbIpAddress = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 })
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Generates a small maxRequests value for testing (1–20). */
const arbMaxRequests = fc.integer({ min: 1, max: 20 });

// ─────────────────────────────────────────────────────────────────────────────
// Property 14: Rate limiter enforcement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 5.3**
 *
 * Property 14: Rate limiter enforcement
 *
 * For any IP address, the rate limiter should allow the first 5 requests
 * within a 15-minute window and reject subsequent requests. After the window
 * expires, the counter should reset and allow new requests.
 */
// Feature: support-ticketing-system, Property 14: Rate limiter enforcement
describe("Feature: support-ticketing-system, Property 14: Rate limiter enforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first maxRequests calls and rejects the next one", () => {
    fc.assert(
      fc.property(arbIpAddress, arbMaxRequests, (ip, maxRequests) => {
        const windowMs = 100;
        const limiter = new RateLimiter(maxRequests, windowMs);

        // The first maxRequests calls should all be allowed
        for (let i = 0; i < maxRequests; i++) {
          expect(limiter.isAllowed(ip)).toBe(true);
          limiter.record(ip);
        }

        // The (maxRequests+1)th call should be rejected
        expect(limiter.isAllowed(ip)).toBe(false);
      }),
      { numRuns: 20 }
    );
  });

  it("different IPs have independent counters", () => {
    fc.assert(
      fc.property(
        arbIpAddress,
        arbIpAddress.filter((ip) => ip !== "1.1.1.1"),
        arbMaxRequests,
        (ip1, ip2, maxRequests) => {
          // Ensure the two IPs are distinct
          fc.pre(ip1 !== ip2);

          const windowMs = 100;
          const limiter = new RateLimiter(maxRequests, windowMs);

          // Exhaust the limit for ip1
          for (let i = 0; i < maxRequests; i++) {
            limiter.record(ip1);
          }

          // ip1 should be blocked
          expect(limiter.isAllowed(ip1)).toBe(false);

          // ip2 should still be allowed (independent counter)
          expect(limiter.isAllowed(ip2)).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  it("counter resets after the window expires", () => {
    fc.assert(
      fc.property(arbIpAddress, arbMaxRequests, (ip, maxRequests) => {
        const windowMs = 100;
        const limiter = new RateLimiter(maxRequests, windowMs);

        // Exhaust the limit
        for (let i = 0; i < maxRequests; i++) {
          limiter.record(ip);
        }

        // Should be blocked
        expect(limiter.isAllowed(ip)).toBe(false);

        // Advance time past the window
        vi.advanceTimersByTime(windowMs + 1);

        // Should be allowed again after window expires
        expect(limiter.isAllowed(ip)).toBe(true);
      }),
      { numRuns: 20 }
    );
  });

  it("uses default configuration of 5 requests per 15-minute window", () => {
    fc.assert(
      fc.property(arbIpAddress, (ip) => {
        const limiter = new RateLimiter(); // defaults: 5 requests, 15 min

        // First 5 requests should be allowed
        for (let i = 0; i < 5; i++) {
          expect(limiter.isAllowed(ip)).toBe(true);
          limiter.record(ip);
        }

        // 6th request should be rejected
        expect(limiter.isAllowed(ip)).toBe(false);

        // Advance time past the 15-minute window
        vi.advanceTimersByTime(15 * 60 * 1000 + 1);

        // Should be allowed again
        expect(limiter.isAllowed(ip)).toBe(true);
      }),
      { numRuns: 20 }
    );
  });
});
