import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_COUNTRY_ISO2,
  DEFAULT_DIAL_CODE,
  isValidE164,
  isValidEmail,
  isPhoneAcceptable,
  canSubmitPreCall,
  buildSessionInput,
  type PreCallFormState,
} from "./validation";

const validState = (over: Partial<PreCallFormState> = {}): PreCallFormState => ({
  phone: "+971501234567",
  phoneValid: true,
  email: "caller@example.com",
  name: "",
  consent: true,
  ...over,
});

describe("call-widget defaults", () => {
  it("defaults the country selector to UAE / +971 (Requirement 1.3)", () => {
    expect(DEFAULT_COUNTRY_ISO2).toBe("ae");
    expect(DEFAULT_DIAL_CODE).toBe("+971");
  });
});

describe("isValidE164 (Requirement 1.3)", () => {
  it("accepts canonical E.164 numbers", () => {
    expect(isValidE164("+971501234567")).toBe(true);
    expect(isValidE164("+14155552671")).toBe(true);
    expect(isValidE164("+442071838750")).toBe(true);
  });

  it("rejects non-E.164 input", () => {
    expect(isValidE164("0501234567")).toBe(false); // no +
    expect(isValidE164("+0501234567")).toBe(false); // leading 0 country code
    expect(isValidE164("+971 50 123 4567")).toBe(false); // spaces
    expect(isValidE164("+12")).toBe(false); // too short
    expect(isValidE164("+1234567890123456")).toBe(false); // > 15 digits
    expect(isValidE164("")).toBe(false);
    expect(isValidE164("not-a-number")).toBe(false);
  });

  it("never accepts a value without a leading + (property)", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{1,15}$/), (digits) => {
        expect(isValidE164(digits)).toBe(false);
      }),
    );
  });
});

describe("isValidEmail (Requirement 1.4)", () => {
  it("accepts RFC-format emails", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.com")).toBe(true);
  });

  it("rejects malformed emails", () => {
    expect(isValidEmail("plainaddress")).toBe(false);
    expect(isValidEmail("@no-local.com")).toBe(false);
    expect(isValidEmail("no-at-sign.com")).toBe(false);
    expect(isValidEmail("spaces in@email.com")).toBe(false);
    expect(isValidEmail("trailing@dot.")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("consent gating + optional name (Requirements 1.5, 1.6)", () => {
  it("blocks submission when consent is unchecked", () => {
    expect(canSubmitPreCall(validState({ consent: false }))).toBe(false);
    expect(buildSessionInput(validState({ consent: false }))).toBeNull();
  });

  it("permits submission when consent is checked and fields are valid", () => {
    expect(canSubmitPreCall(validState())).toBe(true);
  });

  it("permits submission with an empty name (name is optional)", () => {
    const input = buildSessionInput(validState({ name: "" }));
    expect(input).not.toBeNull();
    expect(input).not.toHaveProperty("name");
  });

  it("includes a trimmed name when provided", () => {
    const input = buildSessionInput(validState({ name: "  Sara  " }));
    expect(input?.name).toBe("Sara");
  });

  it("consent is a hard gate regardless of other fields (property)", () => {
    fc.assert(
      fc.property(
        fc.record({
          phone: fc.constantFrom("+971501234567", "0501234567", ""),
          phoneValid: fc.boolean(),
          email: fc.constantFrom("caller@example.com", "bad", ""),
          name: fc.string(),
        }),
        (partial) => {
          const state = validState({ ...partial, consent: false });
          // With consent false, submission is never allowed.
          expect(canSubmitPreCall(state)).toBe(false);
          expect(buildSessionInput(state)).toBeNull();
        },
      ),
    );
  });
});

describe("isPhoneAcceptable", () => {
  it("requires both library validity and E.164 shape when phoneValid is present", () => {
    expect(isPhoneAcceptable(validState({ phoneValid: false }))).toBe(false);
    expect(
      isPhoneAcceptable(validState({ phoneValid: true, phone: "0501234567" })),
    ).toBe(false);
    expect(isPhoneAcceptable(validState({ phoneValid: true }))).toBe(true);
  });

  it("falls back to E.164 check when phoneValid is undefined", () => {
    expect(
      isPhoneAcceptable({
        phone: "+971501234567",
        email: "a@b.co",
        name: "",
        consent: true,
      }),
    ).toBe(true);
  });
});

describe("buildSessionInput", () => {
  it("produces a CreateVoiceSessionInput with consent literal true and page passthrough", () => {
    const input = buildSessionInput(validState({ name: "Omar" }), "/projects/ora");
    expect(input).toEqual({
      phone: "+971501234567",
      email: "caller@example.com",
      consent: true,
      name: "Omar",
      page: "/projects/ora",
    });
  });

  it("omits page when not supplied", () => {
    const input = buildSessionInput(validState());
    expect(input).not.toHaveProperty("page");
  });
});
