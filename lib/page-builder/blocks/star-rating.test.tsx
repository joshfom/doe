// @vitest-environment jsdom
/**
 * Unit tests for the shared star-rating renderer (`star-rating.tsx`).
 *
 * Scope: this file covers task 4 — the `renderStarRating(n)` renderer and its
 * `clampRating(n)` helper:
 *   - clamping (negative, over-5, fractional, non-numeric),
 *   - the count of filled vs. empty stars,
 *   - the accessible `role="img"` + `aria-label="Rated N out of 5"` wrapper and
 *     that the individual icons are hidden from assistive technology.
 *
 * Filled stars render the lucide `Star` with `fill="currentColor"` and empty
 * stars with `fill="none"`, so a filled-count assertion queries the rendered
 * SVGs by their `fill` attribute — hence the jsdom environment.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Shared helpers" → `blocks/star-rating.tsx`
 * Validates: Requirements 2.7, 13.6
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  renderStarRating,
  clampRating,
  MAX_RATING,
} from "./star-rating";

/** Render a rating and return its `role="img"` wrapper element. */
function renderRating(n: number): HTMLElement {
  const { container } = render(renderStarRating(n));
  const wrapper = container.querySelector('[role="img"]');
  if (!wrapper) throw new Error("expected a role=img wrapper");
  return wrapper as HTMLElement;
}

/** Count the filled (`fill="currentColor"`) star SVGs inside a wrapper. */
function filledCount(wrapper: HTMLElement): number {
  return wrapper.querySelectorAll('svg[fill="currentColor"]').length;
}

/** Count the empty (`fill="none"`) star SVGs inside a wrapper. */
function emptyCount(wrapper: HTMLElement): number {
  return wrapper.querySelectorAll('svg[fill="none"]').length;
}

describe("clampRating", () => {
  it("clamps negative ratings to 0", () => {
    expect(clampRating(-1)).toBe(0);
    expect(clampRating(-100)).toBe(0);
    expect(clampRating(-Infinity)).toBe(0);
  });

  it("clamps ratings over the maximum to the maximum", () => {
    expect(clampRating(6)).toBe(MAX_RATING);
    expect(clampRating(100)).toBe(MAX_RATING);
    expect(clampRating(Infinity)).toBe(MAX_RATING);
  });

  it("passes whole in-range ratings through unchanged", () => {
    expect(clampRating(0)).toBe(0);
    expect(clampRating(3)).toBe(3);
    expect(clampRating(5)).toBe(5);
  });

  it("floors fractional in-range ratings", () => {
    expect(clampRating(2.9)).toBe(2);
    expect(clampRating(4.5)).toBe(4);
    expect(clampRating(0.9)).toBe(0);
  });

  it("treats non-numeric ratings as 0", () => {
    expect(clampRating(NaN)).toBe(0);
    expect(clampRating(undefined as unknown as number)).toBe(0);
  });
});

describe("renderStarRating — star counts", () => {
  it("always renders exactly MAX_RATING stars total", () => {
    for (const n of [0, 1, 3, 5]) {
      const wrapper = renderRating(n);
      expect(wrapper.querySelectorAll("svg").length).toBe(MAX_RATING);
    }
  });

  it("fills exactly N stars for an in-range rating", () => {
    const wrapper = renderRating(3);
    expect(filledCount(wrapper)).toBe(3);
    expect(emptyCount(wrapper)).toBe(MAX_RATING - 3);
  });

  it("fills no stars for a 0 rating", () => {
    const wrapper = renderRating(0);
    expect(filledCount(wrapper)).toBe(0);
    expect(emptyCount(wrapper)).toBe(MAX_RATING);
  });

  it("fills all stars for a 5 rating", () => {
    const wrapper = renderRating(5);
    expect(filledCount(wrapper)).toBe(MAX_RATING);
    expect(emptyCount(wrapper)).toBe(0);
  });

  it("clamps a negative rating to zero filled stars", () => {
    const wrapper = renderRating(-2);
    expect(filledCount(wrapper)).toBe(0);
  });

  it("clamps an over-5 rating to all filled stars", () => {
    const wrapper = renderRating(9);
    expect(filledCount(wrapper)).toBe(MAX_RATING);
  });

  it("floors a fractional rating's filled count", () => {
    const wrapper = renderRating(3.8);
    expect(filledCount(wrapper)).toBe(3);
  });
});

describe("renderStarRating — accessibility", () => {
  it("exposes the rating as a single role=img with a descriptive label", () => {
    const wrapper = renderRating(4);
    expect(wrapper.getAttribute("role")).toBe("img");
    expect(wrapper.getAttribute("aria-label")).toBe("Rated 4 out of 5");
  });

  it("uses the clamped value in the accessible label", () => {
    expect(renderRating(-3).getAttribute("aria-label")).toBe("Rated 0 out of 5");
    expect(renderRating(8).getAttribute("aria-label")).toBe("Rated 5 out of 5");
    expect(renderRating(2.7).getAttribute("aria-label")).toBe("Rated 2 out of 5");
  });

  it("hides the individual star icons from assistive technology", () => {
    const wrapper = renderRating(3);
    const stars = wrapper.querySelectorAll("svg");
    expect(stars.length).toBe(MAX_RATING);
    stars.forEach((star) => {
      expect(star.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
