import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ConsentBanner } from "./consent-banner";

// Mock posthog-js
vi.mock("posthog-js", () => ({
  default: {
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    set_config: vi.fn(),
  },
}));

// Mock consent-state helpers
vi.mock("./consent-state", () => ({
  getConsentState: vi.fn(() => null),
  setConsentState: vi.fn(),
  hasConsentBeenGiven: vi.fn(() => false),
}));

import posthog from "posthog-js";
import { getConsentState, setConsentState, hasConsentBeenGiven } from "./consent-state";

describe("ConsentBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (hasConsentBeenGiven as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (getConsentState as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Task 8.2: Consent mode logic", () => {
    it('renders nothing when consentMode is "off"', () => {
      const { container } = render(<ConsentBanner consentMode="off" />);
      expect(container.innerHTML).toBe("");
    });

    it('shows banner with analytics unchecked when consentMode is "strict"', () => {
      render(<ConsentBanner consentMode="strict" />);
      const analyticsCheckbox = screen.getByLabelText("Analytics cookies") as HTMLInputElement;
      expect(analyticsCheckbox.checked).toBe(false);
    });

    it('shows banner with analytics pre-checked when consentMode is "balanced"', () => {
      render(<ConsentBanner consentMode="balanced" />);
      const analyticsCheckbox = screen.getByLabelText("Analytics cookies") as HTMLInputElement;
      expect(analyticsCheckbox.checked).toBe(true);
    });

    it("marketing toggle always starts off regardless of mode", () => {
      render(<ConsentBanner consentMode="balanced" />);
      const marketingCheckbox = screen.getByLabelText("Marketing cookies") as HTMLInputElement;
      expect(marketingCheckbox.checked).toBe(false);
    });
  });

  describe("Task 8.1: Banner UI elements", () => {
    it("renders three category toggles", () => {
      render(<ConsentBanner consentMode="strict" />);
      expect(screen.getByLabelText(/Necessary cookies/)).toBeTruthy();
      expect(screen.getByLabelText("Analytics cookies")).toBeTruthy();
      expect(screen.getByLabelText("Marketing cookies")).toBeTruthy();
    });

    it("necessary toggle is always checked and disabled", () => {
      render(<ConsentBanner consentMode="strict" />);
      const necessary = screen.getByLabelText(/Necessary cookies/) as HTMLInputElement;
      expect(necessary.checked).toBe(true);
      expect(necessary.disabled).toBe(true);
    });

    it("renders Accept All, Reject All, and Save Preferences buttons", () => {
      render(<ConsentBanner consentMode="strict" />);
      expect(screen.getByText("Accept All")).toBeTruthy();
      expect(screen.getByText("Reject All")).toBeTruthy();
      expect(screen.getByText("Save Preferences")).toBeTruthy();
    });
  });

  describe("Task 8.3: PostHog opt-in/opt-out", () => {
    it("calls posthog.opt_in_capturing and upgrades persistence on Accept All", () => {
      render(<ConsentBanner consentMode="strict" />);
      fireEvent.click(screen.getByText("Accept All"));

      expect(posthog.opt_in_capturing).toHaveBeenCalled();
      expect(posthog.set_config).toHaveBeenCalledWith({ persistence: "localStorage+cookie" });
      expect(setConsentState).toHaveBeenCalledWith(
        expect.objectContaining({ analytics: true, marketing: true })
      );
    });

    it("calls posthog.opt_out_capturing on Reject All", () => {
      render(<ConsentBanner consentMode="balanced" />);
      fireEvent.click(screen.getByText("Reject All"));

      expect(posthog.opt_out_capturing).toHaveBeenCalled();
      expect(setConsentState).toHaveBeenCalledWith(
        expect.objectContaining({ analytics: false, marketing: false })
      );
    });

    it("calls opt_in when Save is clicked with analytics checked", () => {
      render(<ConsentBanner consentMode="balanced" />);
      // Analytics is pre-checked in balanced mode
      fireEvent.click(screen.getByText("Save Preferences"));

      expect(posthog.opt_in_capturing).toHaveBeenCalled();
      expect(posthog.set_config).toHaveBeenCalledWith({ persistence: "localStorage+cookie" });
    });

    it("calls opt_out when Save is clicked with analytics unchecked", () => {
      render(<ConsentBanner consentMode="strict" />);
      // Analytics is unchecked in strict mode
      fireEvent.click(screen.getByText("Save Preferences"));

      expect(posthog.opt_out_capturing).toHaveBeenCalled();
    });
  });

  describe("Task 8.1/8.4: Banner visibility and persistent access point", () => {
    it("does not show banner if consent has already been given", () => {
      (hasConsentBeenGiven as ReturnType<typeof vi.fn>).mockReturnValue(true);
      render(<ConsentBanner consentMode="strict" />);

      // Banner dialog should not be visible
      expect(screen.queryByRole("dialog")).toBeNull();
      // Shield icon should be visible
      expect(screen.getByLabelText("Privacy settings")).toBeTruthy();
    });

    it("shows shield icon after banner is dismissed", () => {
      render(<ConsentBanner consentMode="strict" />);
      fireEvent.click(screen.getByText("Reject All"));

      // Banner should be gone, shield icon should appear
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByLabelText("Privacy settings")).toBeTruthy();
    });

    it("reopens banner when shield icon is clicked", () => {
      (hasConsentBeenGiven as ReturnType<typeof vi.fn>).mockReturnValue(true);
      render(<ConsentBanner consentMode="strict" />);

      fireEvent.click(screen.getByLabelText("Privacy settings"));
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });

  describe("Task 8.5: RTL support", () => {
    it('applies dir="rtl" when locale is "ar"', () => {
      render(<ConsentBanner consentMode="strict" locale="ar" />);
      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("dir")).toBe("rtl");
    });

    it('applies dir="ltr" when locale is "en"', () => {
      render(<ConsentBanner consentMode="strict" locale="en" />);
      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("dir")).toBe("ltr");
    });

    it("positions shield icon on right for RTL", () => {
      (hasConsentBeenGiven as ReturnType<typeof vi.fn>).mockReturnValue(true);
      render(<ConsentBanner consentMode="strict" locale="ar" />);
      const shield = screen.getByLabelText("إعدادات الخصوصية");
      expect(shield.className).toContain("right-4");
    });

    it("positions shield icon on left for LTR", () => {
      (hasConsentBeenGiven as ReturnType<typeof vi.fn>).mockReturnValue(true);
      render(<ConsentBanner consentMode="strict" locale="en" />);
      const shield = screen.getByLabelText("Privacy settings");
      expect(shield.className).toContain("left-4");
    });

    it("renders Arabic text when locale is ar", () => {
      render(<ConsentBanner consentMode="strict" locale="ar" />);
      expect(screen.getByText("إعدادات الخصوصية")).toBeTruthy();
      expect(screen.getByText("قبول الكل")).toBeTruthy();
      expect(screen.getByText("رفض الكل")).toBeTruthy();
      expect(screen.getByText("حفظ التفضيلات")).toBeTruthy();
    });
  });
});
