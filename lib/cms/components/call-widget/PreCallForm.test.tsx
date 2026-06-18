import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/**
 * Task 13.3 — component-level form validation + consent gating (Req 1.3, 1.4,
 * 1.5, 1.6).
 *
 * `validation.test.ts` exhaustively covers the pure submit-gate logic
 * (`canSubmitPreCall` / `buildSessionInput`). These tests cover the *UI gate*:
 * that the rendered form disables submission until phone + email are valid and
 * consent is checked, and never invokes `onSubmit` while the consent box is
 * unchecked — even if a submit event is dispatched directly.
 *
 * `intl-tel-input/react` is mocked to a plain input that reports its value and
 * a simple E.164-shape validity, so the test runs without the library's runtime
 * utils download. `intl-tel-input/styles` is a side-effect CSS import and is
 * stubbed out.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("intl-tel-input/styles", () => ({}));

vi.mock("intl-tel-input/react", () => ({
  default: ({
    onChangeNumber,
    onChangeValidity,
    inputProps,
  }: {
    onChangeNumber: (n: string) => void;
    onChangeValidity: (v: boolean) => void;
    inputProps?: Record<string, unknown>;
  }) => (
    <input
      data-testid="call-widget-phone-input"
      aria-label={(inputProps?.["aria-label"] as string) ?? "Phone"}
      onBlur={inputProps?.onBlur as React.FocusEventHandler}
      onChange={(e) => {
        const value = e.target.value;
        onChangeNumber(value);
        // Mirror the library: a value in canonical E.164 shape is "valid".
        onChangeValidity(/^\+[1-9]\d{6,14}$/.test(value));
      }}
    />
  ),
}));

import { PreCallForm } from "./PreCallForm";

afterEach(cleanup);

// ── Helpers ───────────────────────────────────────────────────────────────────

function setup(onSubmit = vi.fn()) {
  render(
    <PreCallForm
      open
      locale="en"
      onClose={() => {}}
      onSubmit={onSubmit}
    />
  );
  return { onSubmit };
}

const submitBtn = () =>
  screen.getByTestId("call-widget-submit") as HTMLButtonElement;

function typePhone(value: string) {
  fireEvent.change(screen.getByTestId("call-widget-phone-input"), {
    target: { value },
  });
}

function typeEmail(value: string) {
  fireEvent.change(screen.getByTestId("call-widget-email-input"), {
    target: { value },
  });
}

function toggleConsent() {
  fireEvent.click(screen.getByTestId("call-widget-consent-checkbox"));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PreCallForm — consent gating (Requirement 1.5)", () => {
  it("disables submit until consent is checked, even with valid phone + email", () => {
    setup();
    typePhone("+971501234567");
    typeEmail("caller@example.com");

    // Valid contact details but no consent yet → still blocked.
    expect(submitBtn().disabled).toBe(true);

    toggleConsent();
    expect(submitBtn().disabled).toBe(false);
  });

  it("never calls onSubmit while consent is unchecked, even on a direct form submit", () => {
    const { onSubmit } = setup();
    typePhone("+971501234567");
    typeEmail("caller@example.com");

    // Dispatch the form's submit event directly (bypassing the disabled button)
    // to prove the handler itself gates on consent.
    const form = submitBtn().closest("form")!;
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the typed fields once phone, email and consent are all satisfied", () => {
    const { onSubmit } = setup();
    typePhone("+971501234567");
    typeEmail("caller@example.com");
    toggleConsent();

    fireEvent.click(submitBtn());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+971501234567",
        email: "caller@example.com",
        consent: true,
      })
    );
  });
});

describe("PreCallForm — phone/email validation gating (Requirements 1.3, 1.4)", () => {
  it("keeps submit disabled when the phone is not valid E.164 (Req 1.3)", () => {
    setup();
    typePhone("0501234567"); // no leading + → invalid
    typeEmail("caller@example.com");
    toggleConsent();
    expect(submitBtn().disabled).toBe(true);
  });

  it("keeps submit disabled when the email is malformed (Req 1.4)", () => {
    setup();
    typePhone("+971501234567");
    typeEmail("not-an-email");
    toggleConsent();
    expect(submitBtn().disabled).toBe(true);
  });

  it("shows the email error message after blur on a malformed email", () => {
    setup();
    typeEmail("not-an-email");
    fireEvent.blur(screen.getByTestId("call-widget-email-input"));
    expect(screen.getByTestId("call-widget-email-error")).toBeDefined();
  });
});

describe("PreCallForm — optional name (Requirement 1.6)", () => {
  it("submits without a name and omits it from the payload", () => {
    const { onSubmit } = setup();
    typePhone("+971501234567");
    typeEmail("caller@example.com");
    toggleConsent();

    fireEvent.click(submitBtn());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("name");
  });
});
