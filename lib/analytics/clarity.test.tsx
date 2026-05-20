import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ClarityScript } from "./clarity";

// Mock consent-state module
vi.mock("./consent-state", () => ({
  getConsentState: vi.fn(),
}));

import { getConsentState } from "./consent-state";

const mockedGetConsentState = vi.mocked(getConsentState);

describe("ClarityScript", () => {
  beforeEach(() => {
    // Clear any scripts injected during tests
    document.querySelectorAll('script[src*="clarity.ms"]').forEach((el) => {
      el.parentNode?.removeChild(el);
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.querySelectorAll('script[src*="clarity.ms"]').forEach((el) => {
      el.parentNode?.removeChild(el);
    });
  });

  describe("Task 9.1: Injects Clarity script when clarityId is non-empty and consent granted", () => {
    it("injects a script tag with async attribute and correct src", () => {
      mockedGetConsentState.mockReturnValue({
        necessary: true,
        analytics: true,
        marketing: false,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      render(<ClarityScript clarityId="abc123" />);

      const script = document.querySelector(
        'script[src="https://www.clarity.ms/tag/abc123"]'
      ) as HTMLScriptElement | null;
      expect(script).not.toBeNull();
      expect(script?.async).toBe(true);
    });

    it("uses the provided clarityId in the script src (not hardcoded)", () => {
      mockedGetConsentState.mockReturnValue({
        necessary: true,
        analytics: true,
        marketing: true,
        timestamp: "2024-06-15T00:00:00.000Z",
      });

      render(<ClarityScript clarityId="xyz789" />);

      const script = document.querySelector(
        'script[src="https://www.clarity.ms/tag/xyz789"]'
      );
      expect(script).not.toBeNull();
    });

    it("initializes the clarity command queue on window", () => {
      mockedGetConsentState.mockReturnValue({
        necessary: true,
        analytics: true,
        marketing: false,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      render(<ClarityScript clarityId="test123" />);

      const win = window as unknown as Record<string, unknown>;
      expect(typeof win["clarity"]).toBe("function");
    });

    it("cleans up the script on unmount", () => {
      mockedGetConsentState.mockReturnValue({
        necessary: true,
        analytics: true,
        marketing: false,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      const { unmount } = render(<ClarityScript clarityId="cleanup123" />);

      const scriptBefore = document.querySelector(
        'script[src="https://www.clarity.ms/tag/cleanup123"]'
      );
      expect(scriptBefore).not.toBeNull();

      unmount();

      const scriptAfter = document.querySelector(
        'script[src="https://www.clarity.ms/tag/cleanup123"]'
      );
      expect(scriptAfter).toBeNull();
    });
  });

  describe("Task 9.2: Renders nothing if clarityId is empty or consent not granted", () => {
    it("renders nothing when clarityId is undefined", () => {
      mockedGetConsentState.mockReturnValue({
        necessary: true,
        analytics: true,
        marketing: true,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      const { container } = render(<ClarityScript />);

      expect(container.innerHTML).toBe("");
      const script = document.querySelector('script[src*="clarity.ms"]');
      expect(script).toBeNull();
    });

    it("renders nothing when clarityId is empty string", () => {
      mockedGetConsentState.mockReturnValue({
        necessary: true,
        analytics: true,
        marketing: true,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      const { container } = render(<ClarityScript clarityId="" />);

      expect(container.innerHTML).toBe("");
      const script = document.querySelector('script[src*="clarity.ms"]');
      expect(script).toBeNull();
    });

    it("renders nothing when consent state is null (no consent given)", () => {
      mockedGetConsentState.mockReturnValue(null);

      const { container } = render(<ClarityScript clarityId="abc123" />);

      expect(container.innerHTML).toBe("");
      const script = document.querySelector('script[src*="clarity.ms"]');
      expect(script).toBeNull();
    });

    it("renders nothing when analytics consent is false", () => {
      mockedGetConsentState.mockReturnValue({
        necessary: true,
        analytics: false,
        marketing: true,
        timestamp: "2024-01-01T00:00:00.000Z",
      });

      const { container } = render(<ClarityScript clarityId="abc123" />);

      expect(container.innerHTML).toBe("");
      const script = document.querySelector('script[src*="clarity.ms"]');
      expect(script).toBeNull();
    });
  });
});
