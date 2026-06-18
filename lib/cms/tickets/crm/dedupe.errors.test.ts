import { describe, it, expect } from "vitest";

import type { Database } from "../../db";
import { resolveLeadByMatchKeys, type DedupeResult } from "./dedupe";

/**
 * Unit tests for the dedupe error paths (task 3.5; design §2; Requirements 2.9,
 * 2.10, 2.11).
 *
 * Each error case — empty input, un-normalizable phone, and unparsable email —
 * must return the typed `{ kind: "error", code }` result and SHALL NOT attempt
 * any party-graph match. Because every error returns BEFORE any query is issued,
 * we pass a `db` whose query surface THROWS if touched: a passing test therefore
 * doubles as proof that "no match was attempted". (The happy/match/conflict
 * paths run against pg-mem in the dedupe property tests; here we only exercise
 * the pre-query guards, so no database is needed.)
 */

/**
 * A `db` stand-in whose every query entrypoint throws. If `resolveLeadByMatchKeys`
 * issued a lookup, the thrown error would surface as a rejected promise and fail
 * the test — so reaching a clean `error` result proves no match was attempted.
 */
function throwingDb(): Database {
  const explode = () => {
    throw new Error("DB query attempted — dedupe should have short-circuited");
  };
  return new Proxy(
    {},
    {
      get() {
        return explode;
      },
    }
  ) as unknown as Database;
}

describe("resolveLeadByMatchKeys — error paths attempt no match", () => {
  it("empty input (no phone/email/sfLeadId) → empty_input, no match attempted (Req 2.9)", async () => {
    const result = await resolveLeadByMatchKeys(throwingDb(), {});

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("empty_input");
      expect(result.message).toMatch(/no phone, email, or sfLeadId/i);
    }
  });

  it("empty input where keys are present but all undefined → empty_input (Req 2.9)", async () => {
    const result = await resolveLeadByMatchKeys(throwingDb(), {
      phone: undefined,
      email: undefined,
      sfLeadId: undefined,
    });

    expect(result).toEqual<DedupeResult>({
      kind: "error",
      code: "empty_input",
      message: "no phone, email, or sfLeadId supplied",
    });
  });

  it("invalid phone (un-normalizable) → invalid_phone, no phone match attempted (Req 2.10)", async () => {
    const result = await resolveLeadByMatchKeys(throwingDb(), {
      phone: "not-a-phone",
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid_phone");
      expect(result.message).toContain("not-a-phone");
    }
  });

  it("empty-string phone → invalid_phone, no phone match attempted (Req 2.10)", async () => {
    const result = await resolveLeadByMatchKeys(throwingDb(), { phone: "" });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid_phone");
    }
  });

  it("invalid email (not a valid address) → invalid_email, no email match attempted (Req 2.11)", async () => {
    const result = await resolveLeadByMatchKeys(throwingDb(), {
      email: "notanemail",
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid_email");
      expect(result.message).toContain("notanemail");
    }
  });

  it("email missing a domain → invalid_email, no email match attempted (Req 2.11)", async () => {
    const result = await resolveLeadByMatchKeys(throwingDb(), {
      email: "user@",
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid_email");
    }
  });

  it("invalid phone is rejected before a valid email is consulted (phone-first order, Req 2.10)", async () => {
    // Phone is evaluated first; an un-normalizable phone short-circuits with
    // invalid_phone even though the email here is well-formed — and still no
    // query is attempted.
    const result = await resolveLeadByMatchKeys(throwingDb(), {
      phone: "@@@",
      email: "valid@example.com",
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid_phone");
    }
  });
});
