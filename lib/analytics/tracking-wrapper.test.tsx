import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { TrackingWrapper } from "./tracking-wrapper";

// Mock posthog-js
vi.mock("posthog-js", () => ({
  default: {
    capture: vi.fn(),
  },
}));

import posthog from "posthog-js";

describe("TrackingWrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("Task 15.1: data-ph-capture-attribute-* attributes and unique element IDs", () => {
    it("emits data-ph-capture-attribute-event_name when trackAsEvent is true", () => {
      const { container } = render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="cta_clicked"
          elementId="test-cta"
        >
          <button>Click me</button>
        </TrackingWrapper>
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.getAttribute("data-ph-capture-attribute-event_name")).toBe(
        "cta_clicked"
      );
    });

    it("emits data-ph-capture-attribute-{key} for each event property", () => {
      const { container } = render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="cta_clicked"
          eventProperties={{ project_id: "marina", unit_type: "2br" }}
          elementId="test-props"
        >
          <button>Click me</button>
        </TrackingWrapper>
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(
        wrapper.getAttribute("data-ph-capture-attribute-project_id")
      ).toBe("marina");
      expect(
        wrapper.getAttribute("data-ph-capture-attribute-unit_type")
      ).toBe("2br");
    });

    it("does not emit data attributes when trackAsEvent is false", () => {
      const { container } = render(
        <TrackingWrapper
          trackAsEvent={false}
          eventName="cta_clicked"
          eventProperties={{ project_id: "marina" }}
          elementId="test-no-track"
        >
          <button>Click me</button>
        </TrackingWrapper>
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(
        wrapper.getAttribute("data-ph-capture-attribute-event_name")
      ).toBeNull();
      expect(
        wrapper.getAttribute("data-ph-capture-attribute-project_id")
      ).toBeNull();
    });

    it("uses an explicit elementId verbatim and auto-generates unique ids otherwise", () => {
      // An explicit elementId is honoured as-is (author's choice).
      const { container: explicit } = render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="cta_clicked"
          elementId="shared-id"
        >
          <span>Explicit</span>
        </TrackingWrapper>
      );
      expect((explicit.firstElementChild as HTMLElement).id).toBe("shared-id");

      // Two auto-generated wrappers for the same event name get distinct,
      // SSR-stable ids (via useId) — no module-level collision bookkeeping.
      // Rendered as SIBLINGS in one tree, mirroring real page usage.
      const { container: siblings } = render(
        <div>
          <TrackingWrapper trackAsEvent={true} eventName="cta_clicked">
            <span>First</span>
          </TrackingWrapper>
          <TrackingWrapper trackAsEvent={true} eventName="cta_clicked">
            <span>Second</span>
          </TrackingWrapper>
        </div>
      );

      const wrappers = siblings.querySelectorAll(":scope > div > div");
      const idA = (wrappers[0] as HTMLElement).id;
      const idB = (wrappers[1] as HTMLElement).id;
      expect(idA.startsWith("track-cta_clicked")).toBe(true);
      expect(idB.startsWith("track-cta_clicked")).toBe(true);
      expect(idA).not.toBe(idB);
    });

    it("uses display: contents on the wrapper div", () => {
      const { container } = render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="section_viewed"
          elementId="test-display"
        >
          <div>Content</div>
        </TrackingWrapper>
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.display).toBe("contents");
    });
  });

  describe("Task 15.2: IntersectionObserver for section_viewed", () => {
    it("fires section_viewed after 1s of visibility at threshold", () => {
      // Mock IntersectionObserver
      let observerCallback: IntersectionObserverCallback | null = null;
      const mockObserve = vi.fn();
      const mockDisconnect = vi.fn();

      class MockIntersectionObserver {
        constructor(callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) {
          observerCallback = callback;
        }
        observe = mockObserve;
        disconnect = mockDisconnect;
        unobserve = vi.fn();
        root = null;
        rootMargin = "";
        thresholds = [] as number[];
        takeRecords = () => [] as IntersectionObserverEntry[];
      }

      vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

      render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="section_viewed"
          visibilityThreshold={50}
          elementId="test-visibility"
        >
          <div>Section content</div>
        </TrackingWrapper>
      );

      expect(mockObserve).toHaveBeenCalled();

      // Simulate intersection
      act(() => {
        observerCallback!(
          [{ isIntersecting: true, intersectionRatio: 0.6 }] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver
        );
      });

      // Before 1 second, no event fired
      expect(posthog.capture).not.toHaveBeenCalled();

      // After 1 second
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(posthog.capture).toHaveBeenCalledWith("section_viewed", {
        element_id: "test-visibility",
        event_name: "section_viewed",
      });

      vi.unstubAllGlobals();
    });

    it("does not fire section_viewed if element leaves viewport before 1s", () => {
      let observerCallback: IntersectionObserverCallback | null = null;
      const mockObserve = vi.fn();
      const mockDisconnect = vi.fn();

      class MockIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe = mockObserve;
        disconnect = mockDisconnect;
        unobserve = vi.fn();
        root = null;
        rootMargin = "";
        thresholds = [] as number[];
        takeRecords = () => [] as IntersectionObserverEntry[];
      }

      vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

      render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="section_viewed"
          visibilityThreshold={50}
          elementId="test-no-fire"
        >
          <div>Section content</div>
        </TrackingWrapper>
      );

      // Enter viewport
      act(() => {
        observerCallback!(
          [{ isIntersecting: true, intersectionRatio: 0.6 }] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver
        );
      });

      // Leave viewport after 500ms
      act(() => {
        vi.advanceTimersByTime(500);
      });

      act(() => {
        observerCallback!(
          [{ isIntersecting: false, intersectionRatio: 0 }] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver
        );
      });

      // Advance past 1s total
      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(posthog.capture).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("only fires section_viewed once per mount", () => {
      let observerCallback: IntersectionObserverCallback | null = null;
      const mockObserve = vi.fn();
      const mockDisconnect = vi.fn();

      class MockIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe = mockObserve;
        disconnect = mockDisconnect;
        unobserve = vi.fn();
        root = null;
        rootMargin = "";
        thresholds = [] as number[];
        takeRecords = () => [] as IntersectionObserverEntry[];
      }

      vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

      render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="section_viewed"
          visibilityThreshold={50}
          elementId="test-once"
        >
          <div>Section content</div>
        </TrackingWrapper>
      );

      // First intersection
      act(() => {
        observerCallback!(
          [{ isIntersecting: true, intersectionRatio: 0.6 }] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver
        );
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(posthog.capture).toHaveBeenCalledTimes(1);

      // Second intersection (scroll away and back)
      act(() => {
        observerCallback!(
          [{ isIntersecting: false, intersectionRatio: 0 }] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver
        );
      });

      act(() => {
        observerCallback!(
          [{ isIntersecting: true, intersectionRatio: 0.6 }] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver
        );
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Still only fired once
      expect(posthog.capture).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });

  describe("Task 15.3: conversion_value_aed in event properties", () => {
    it("includes conversion_value_aed as data attribute when conversionValue is set", () => {
      const { container } = render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="cta_clicked"
          conversionValue={1500}
          elementId="test-conversion"
        >
          <button>Buy now</button>
        </TrackingWrapper>
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(
        wrapper.getAttribute("data-ph-capture-attribute-conversion_value_aed")
      ).toBe("1500");
    });

    it("does not include conversion_value_aed when conversionValue is not set", () => {
      const { container } = render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="cta_clicked"
          elementId="test-no-conversion"
        >
          <button>Click me</button>
        </TrackingWrapper>
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(
        wrapper.getAttribute("data-ph-capture-attribute-conversion_value_aed")
      ).toBeNull();
    });

    it("includes conversion_value_aed in section_viewed event properties", () => {
      let observerCallback: IntersectionObserverCallback | null = null;
      const mockObserve = vi.fn();
      const mockDisconnect = vi.fn();

      class MockIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }
        observe = mockObserve;
        disconnect = mockDisconnect;
        unobserve = vi.fn();
        root = null;
        rootMargin = "";
        thresholds = [] as number[];
        takeRecords = () => [] as IntersectionObserverEntry[];
      }

      vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

      render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="section_viewed"
          conversionValue={2500}
          visibilityThreshold={50}
          elementId="test-conv-visibility"
        >
          <div>Section</div>
        </TrackingWrapper>
      );

      act(() => {
        observerCallback!(
          [{ isIntersecting: true, intersectionRatio: 0.6 }] as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver
        );
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(posthog.capture).toHaveBeenCalledWith("section_viewed", {
        element_id: "test-conv-visibility",
        event_name: "section_viewed",
        conversion_value_aed: 2500,
      });

      vi.unstubAllGlobals();
    });
  });

  describe("Task 26.2: replayUnmask attribute", () => {
    it("emits data-ph-no-capture='false' when replayUnmask is true", () => {
      const { container } = render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="cta_clicked"
          replayUnmask={true}
        >
          <button>Click me</button>
        </TrackingWrapper>
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.getAttribute("data-ph-no-capture")).toBe("false");
    });

    it("does not emit data-ph-no-capture when replayUnmask is false", () => {
      const { container } = render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="cta_clicked"
          replayUnmask={false}
        >
          <button>Click me</button>
        </TrackingWrapper>
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.hasAttribute("data-ph-no-capture")).toBe(false);
    });

    it("does not emit data-ph-no-capture when replayUnmask is undefined", () => {
      const { container } = render(
        <TrackingWrapper
          trackAsEvent={true}
          eventName="cta_clicked"
        >
          <button>Click me</button>
        </TrackingWrapper>
      );

      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.hasAttribute("data-ph-no-capture")).toBe(false);
    });
  });
});
