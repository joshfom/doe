import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateOtp, hashOtp, verifyOtp, maskEmail, classifyQuery } from "./otp";

// ── generateOtp ──────────────────────────────────────────────────────────────

describe("generateOtp", () => {
  it("returns a 6-digit zero-padded code", () => {
    const { code } = generateOtp();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("returns a 64-character lowercase hex hash", () => {
    const { hash } = generateOtp();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns an expiresAt roughly 5 minutes in the future", () => {
    const before = Date.now();
    const { expiresAt } = generateOtp();
    const after = Date.now();

    const fiveMinMs = 5 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + fiveMinMs - 50);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + fiveMinMs + 50);
  });

  it("hash matches the code via verifyOtp", () => {
    const { code, hash } = generateOtp();
    expect(verifyOtp(code, hash)).toBe(true);
  });
});

// ── hashOtp ──────────────────────────────────────────────────────────────────

describe("hashOtp", () => {
  it("produces a 64-character hex string", () => {
    expect(hashOtp("123456")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input yields same hash", () => {
    expect(hashOtp("000000")).toBe(hashOtp("000000"));
  });

  it("produces different hashes for different codes", () => {
    expect(hashOtp("000000")).not.toBe(hashOtp("000001"));
  });

  it("hash is not equal to the original code", () => {
    const code = "123456";
    expect(hashOtp(code)).not.toBe(code);
  });
});

// ── verifyOtp ────────────────────────────────────────────────────────────────

describe("verifyOtp", () => {
  it("returns true for matching code and hash", () => {
    const code = "654321";
    const hash = hashOtp(code);
    expect(verifyOtp(code, hash)).toBe(true);
  });

  it("returns false for non-matching code", () => {
    const hash = hashOtp("111111");
    expect(verifyOtp("222222", hash)).toBe(false);
  });

  it("returns false for empty code against a valid hash", () => {
    const hash = hashOtp("123456");
    expect(verifyOtp("", hash)).toBe(false);
  });
});

// ── maskEmail ────────────────────────────────────────────────────────────────

describe("maskEmail", () => {
  it("masks the local part preserving first and last character", () => {
    expect(maskEmail("ahmed@example.com")).toBe("a***d@example.com");
  });

  it("handles a 3-character local part", () => {
    expect(maskEmail("abc@test.com")).toBe("a*c@test.com");
  });

  it("does not mask a 2-character local part", () => {
    expect(maskEmail("ab@test.com")).toBe("ab@test.com");
  });

  it("does not mask a 1-character local part", () => {
    expect(maskEmail("a@test.com")).toBe("a@test.com");
  });

  it("returns the input unchanged if no @ is present", () => {
    expect(maskEmail("noemail")).toBe("noemail");
  });

  it("handles a long local part", () => {
    expect(maskEmail("longusername@domain.org")).toBe("l**********e@domain.org");
  });
});


// ── Property-Based Tests ─────────────────────────────────────────────────────

describe("Feature: ai-otp-verification, Property 6: OTP generation produces valid 6-digit codes", () => {
  /**
   * **Validates: Requirements 2.1**
   *
   * For any call to generateOtp(), the returned code SHALL be a string of
   * exactly 6 numeric characters representing an integer in [0, 999999],
   * and the returned hash SHALL be a 64-character lowercase hexadecimal string.
   */
  it("code is exactly 6 numeric characters with value in [0, 999999]", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const { code } = generateOtp();

        // Exactly 6 numeric characters
        expect(code).toMatch(/^\d{6}$/);
        expect(code).toHaveLength(6);

        // Numeric value in range [0, 999999]
        const numericValue = parseInt(code, 10);
        expect(numericValue).toBeGreaterThanOrEqual(0);
        expect(numericValue).toBeLessThanOrEqual(999999);
      }),
      { numRuns: 100 }
    );
  });

  it("hash is a 64-character lowercase hexadecimal string", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const { hash } = generateOtp();

        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 100 }
    );
  });

  it("expiresAt is approximately 5 minutes in the future", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const before = Date.now();
        const { expiresAt } = generateOtp();
        const after = Date.now();

        const fiveMinMs = 5 * 60 * 1000;
        expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + fiveMinMs - 50);
        expect(expiresAt.getTime()).toBeLessThanOrEqual(after + fiveMinMs + 50);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 8: OTP hash round-trip verification ─────────────────────────────

describe("Feature: ai-otp-verification, Property 8: OTP hash round-trip verification", () => {
  /**
   * **Validates: Requirements 3.6, 6.4**
   *
   * For any 6-digit numeric string, generating the hash via hashOtp(code)
   * and then calling verifyOtp(code, hash) SHALL return true.
   * Additionally, the hash SHALL NOT equal the original code.
   */
  it("verifyOtp(code, hashOtp(code)) returns true for any 6-digit code", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999999 }).map((n) => String(n).padStart(6, "0")),
        (code) => {
          const hash = hashOtp(code);
          expect(verifyOtp(code, hash)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("hashOtp(code) never equals the original code", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999999 }).map((n) => String(n).padStart(6, "0")),
        (code) => {
          const hash = hashOtp(code);
          expect(hash).not.toBe(code);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ── Property 5: Query classification keyword correctness ─────────────────────

describe("Feature: ai-otp-verification, Property 5: Query classification keyword correctness", () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * For any message containing at least one keyword from a specific category's
   * keyword list, classifyQuery SHALL return that category. For any message
   * containing no keywords from any category list, classifyQuery SHALL return
   * "general". When keywords from multiple categories are present, sensitive
   * takes priority over payment, which takes priority over personal.
   */

  const sensitiveKeywords = [
    "payment dispute",
    "refund",
    "account change",
    "financial correction",
  ];

  const paymentKeywords = [
    "payment status",
    "make payment",
    "payment method",
    "installment",
  ];

  const personalKeywords = [
    "my unit",
    "my account",
    "my status",
    "construction progress",
    "lease",
    "handover",
  ];

  const allKeywords = [
    ...sensitiveKeywords,
    ...paymentKeywords,
    ...personalKeywords,
  ];

  const identityTypeArb = fc.oneof(
    fc.constant("client" as const),
    fc.constant("tenant" as const),
    fc.constant("visitor" as const)
  );

  // Generator for filler text that does NOT contain any category keyword.
  // Uses fc.array of safe characters joined into a string, then filtered.
  const safeFillerArb = fc
    .array(fc.constantFrom(..."abcdefghijkmnopqrtuvwxyz0123456789 "), {
      minLength: 0,
      maxLength: 30,
    })
    .map((chars) => chars.join(""))
    .filter((s) => !allKeywords.some((kw) => s.toLowerCase().includes(kw)));

  it("single sensitive keyword → classifies as sensitive", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...sensitiveKeywords),
        safeFillerArb,
        safeFillerArb,
        identityTypeArb,
        (keyword, prefix, suffix, identity) => {
          const message = `${prefix} ${keyword} ${suffix}`;
          expect(classifyQuery(message, identity)).toBe("sensitive");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("single payment keyword → classifies as payment", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...paymentKeywords),
        safeFillerArb,
        safeFillerArb,
        identityTypeArb,
        (keyword, prefix, suffix, identity) => {
          const message = `${prefix} ${keyword} ${suffix}`;
          expect(classifyQuery(message, identity)).toBe("payment");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("single personal keyword → classifies as personal", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...personalKeywords),
        safeFillerArb,
        safeFillerArb,
        identityTypeArb,
        (keyword, prefix, suffix, identity) => {
          const message = `${prefix} ${keyword} ${suffix}`;
          expect(classifyQuery(message, identity)).toBe("personal");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no keywords → classifies as general", () => {
    fc.assert(
      fc.property(safeFillerArb, identityTypeArb, (message, identity) => {
        expect(classifyQuery(message, identity)).toBe("general");
      }),
      { numRuns: 100 }
    );
  });

  it("multi-category: sensitive + payment → sensitive wins", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...sensitiveKeywords),
        fc.constantFrom(...paymentKeywords),
        safeFillerArb,
        identityTypeArb,
        (sensitiveKw, paymentKw, filler, identity) => {
          const message = `${filler} ${sensitiveKw} and ${paymentKw}`;
          expect(classifyQuery(message, identity)).toBe("sensitive");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("multi-category: sensitive + personal → sensitive wins", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...sensitiveKeywords),
        fc.constantFrom(...personalKeywords),
        safeFillerArb,
        identityTypeArb,
        (sensitiveKw, personalKw, filler, identity) => {
          const message = `${filler} ${sensitiveKw} and ${personalKw}`;
          expect(classifyQuery(message, identity)).toBe("sensitive");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("multi-category: payment + personal → payment wins", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...paymentKeywords),
        fc.constantFrom(...personalKeywords),
        safeFillerArb,
        identityTypeArb,
        (paymentKw, personalKw, filler, identity) => {
          const message = `${filler} ${paymentKw} and ${personalKw}`;
          expect(classifyQuery(message, identity)).toBe("payment");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("multi-category: all three → sensitive wins", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...sensitiveKeywords),
        fc.constantFrom(...paymentKeywords),
        fc.constantFrom(...personalKeywords),
        identityTypeArb,
        (sensitiveKw, paymentKw, personalKw, identity) => {
          const message = `${sensitiveKw} ${paymentKw} ${personalKw}`;
          expect(classifyQuery(message, identity)).toBe("sensitive");
        }
      ),
      { numRuns: 100 }
    );
  });
});
