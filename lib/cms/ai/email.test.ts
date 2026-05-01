import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildOtpEmailHtml } from "./email";

// ── Property-Based Tests ─────────────────────────────────────────────────────

describe("Feature: ai-otp-verification, Property 12: Email template contains all required elements in correct language", () => {
  /**
   * **Validates: Requirements 7.2, 7.3**
   *
   * For any valid recipient name, for any valid 6-digit OTP code, and for each
   * supported language ("en", "ar"), the rendered email HTML SHALL contain:
   * the ORA brand name, the OTP code, an expiry notice, a security warning,
   * and support contact information. When language is "ar", the template SHALL
   * contain Arabic text. When language is "en", the template SHALL contain
   * English text.
   */

  /** Generator for non-empty recipient names */
  const nameArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

  /** Generator for 6-digit OTP codes (zero-padded) */
  const otpCodeArb = fc
    .integer({ min: 0, max: 999999 })
    .map((n) => String(n).padStart(6, "0"));

  /** Generator for supported languages */
  const languageArb = fc.constantFrom<"en" | "ar">("en", "ar");

  it("rendered HTML contains ORA brand, OTP code, expiry notice, security warning, and support info for every language", () => {
    fc.assert(
      fc.property(nameArb, otpCodeArb, languageArb, (name, code, language) => {
        const html = buildOtpEmailHtml({
          recipientName: name,
          otpCode: code,
          language,
        });

        // ORA brand name is present
        expect(html).toContain("ORA");

        // The OTP code itself is present
        expect(html).toContain(code);

        // Support contact info
        expect(html).toContain("support@ora.ae");

        if (language === "en") {
          // English expiry notice
          expect(html).toContain("5 minutes");
          // English security warning
          expect(html).toContain("Do not share");
        }

        if (language === "ar") {
          // Arabic expiry notice
          expect(html).toContain("٥ دقائق");
          // Arabic security warning
          expect(html).toContain("لا تشارك");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("English template contains English text and correct lang attribute", () => {
    fc.assert(
      fc.property(nameArb, otpCodeArb, (name, code) => {
        const html = buildOtpEmailHtml({
          recipientName: name,
          otpCode: code,
          language: "en",
        });

        // English lang attribute
        expect(html).toContain('lang="en"');
        // English greeting
        expect(html).toContain("Hello");
        // English verification prompt
        expect(html).toContain("verification code");
        // English security warning label
        expect(html).toContain("Security Warning");
      }),
      { numRuns: 100 }
    );
  });

  it("Arabic template contains Arabic text and correct lang attribute", () => {
    fc.assert(
      fc.property(nameArb, otpCodeArb, (name, code) => {
        const html = buildOtpEmailHtml({
          recipientName: name,
          otpCode: code,
          language: "ar",
        });

        // Arabic lang attribute
        expect(html).toContain('lang="ar"');
        // RTL direction
        expect(html).toContain('dir="rtl"');
        // Arabic greeting
        expect(html).toContain("مرحباً");
        // Arabic verification prompt
        expect(html).toContain("رمز التحقق");
        // Arabic security warning label
        expect(html).toContain("تحذير أمني");
      }),
      { numRuns: 100 }
    );
  });
});
