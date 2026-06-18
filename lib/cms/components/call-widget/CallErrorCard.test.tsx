import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { CallErrorCard } from "./CallErrorCard";
import { callI18n, errorCopy, type CallErrorKind } from "./strings";

/**
 * Task 13.3 — focused unit tests for the three error-card branches (Req 2.5,
 * 2.6, 2.7). `VoiceCallSession.test.tsx` already proves the lifecycle reaches
 * each `errorKind`; these tests pin the *rendered copy* and recovery affordances
 * for every branch and locale, which the lifecycle test only checks by
 * `data-error-kind`. Kept minimal and table-driven to avoid over-testing.
 */

afterEach(cleanup);

const KINDS: CallErrorKind[] = ["mic-denied", "token-failure", "agent-timeout"];

describe("CallErrorCard — each error branch (Requirements 2.5, 2.6, 2.7)", () => {
  it.each(KINDS)(
    "renders the %s branch with its title, body, retry and fallback (en)",
    (kind) => {
      const onRetry = vi.fn();
      render(<CallErrorCard kind={kind} locale="en" onRetry={onRetry} />);

      const card = screen.getByTestId("call-error-card");
      expect(card.getAttribute("data-error-kind")).toBe(kind);
      // It is an assertive alert so screen readers announce the failure.
      expect(card.getAttribute("role")).toBe("alert");

      const { title, body } = errorCopy(kind, callI18n.en);
      expect(screen.getByText(title)).toBeDefined();
      expect(screen.getByText(body)).toBeDefined();

      // A retry affordance and a fallback message are always offered (Req 2.5–2.7).
      expect(screen.getByTestId("call-error-retry").textContent).toContain(
        callI18n.en.retry
      );
      expect(screen.getByText(callI18n.en.fallback)).toBeDefined();
    }
  );

  it.each(KINDS)("fires onRetry when the retry button is clicked (%s)", (kind) => {
    const onRetry = vi.fn();
    render(<CallErrorCard kind={kind} locale="en" onRetry={onRetry} />);

    fireEvent.click(screen.getByTestId("call-error-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders Arabic copy for each branch when locale is ar", () => {
    for (const kind of KINDS) {
      const { title, body } = errorCopy(kind, callI18n.ar);
      render(<CallErrorCard kind={kind} locale="ar" onRetry={() => {}} />);
      expect(screen.getByText(title)).toBeDefined();
      expect(screen.getByText(body)).toBeDefined();
      expect(screen.getByText(callI18n.ar.fallback)).toBeDefined();
      cleanup();
    }
  });

  it("distinguishes the three branches with distinct titles", () => {
    const titles = new Set(KINDS.map((k) => errorCopy(k, callI18n.en).title));
    expect(titles.size).toBe(3);
  });
});

describe("errorCopy mapping (Requirements 2.5, 2.6, 2.7)", () => {
  it("maps mic-denied to the microphone copy", () => {
    expect(errorCopy("mic-denied", callI18n.en)).toEqual({
      title: callI18n.en.errorMicTitle,
      body: callI18n.en.errorMicBody,
    });
  });

  it("maps token-failure to the connection copy", () => {
    expect(errorCopy("token-failure", callI18n.en)).toEqual({
      title: callI18n.en.errorTokenTitle,
      body: callI18n.en.errorTokenBody,
    });
  });

  it("maps agent-timeout to the no-answer copy", () => {
    expect(errorCopy("agent-timeout", callI18n.en)).toEqual({
      title: callI18n.en.errorTimeoutTitle,
      body: callI18n.en.errorTimeoutBody,
    });
  });
});
