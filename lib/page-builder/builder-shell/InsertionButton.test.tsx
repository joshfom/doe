// @vitest-environment jsdom

/**
 * InsertionButton — unit tests.
 *
 * Spec: builder-outline-tree-and-toolbar — Task 3.2
 * _Requirements: 4.4, 4.6, 4.7, 6.6_
 *
 * Verifies:
 * 1. aria-label generation:
 *    - "Add component after {label}" when both adjacent labels are known
 *    - "Add component after {label}" when only the after-label is known
 *    - "Add component before {label}" when only the before-label is known
 *    - "Add component at start of list" when neither adjacent label is known
 * 2. Hidden by default (the visual layer is faded to opacity 0 via the
 *    --ora-ib-opacity custom property; revealed on hover/focus by CSS)
 * 3. onActivate is called with (anchorEl, zone, index) on click
 * 4. Keyboard activation via Enter and Space — verified through the native
 *    button contract (Enter/Space on a focused `<button type="button">`
 *    dispatches a `click` event in the browser; our handler routes through
 *    onClick). jsdom does not auto-translate keydown→click for buttons, so
 *    we additionally exercise the activation paths via the synthetic click
 *    a real browser would emit.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InsertionButton, buildInsertionAriaLabel } from "./InsertionButton";

// ─── aria-label resolution ──────────────────────────────────────────────────

describe("buildInsertionAriaLabel", () => {
  it("returns 'Add component after {after}' when both labels are present", () => {
    expect(buildInsertionAriaLabel("Heading", "Image")).toBe(
      "Add component after Heading",
    );
  });

  it("returns 'Add component after {after}' when only after-label is present", () => {
    expect(buildInsertionAriaLabel("Heading", null)).toBe(
      "Add component after Heading",
    );
  });

  it("returns 'Add component before {before}' when only before-label is present", () => {
    expect(buildInsertionAriaLabel(null, "Image")).toBe(
      "Add component before Image",
    );
  });

  it("returns 'Add component at start of list' when neither label is present", () => {
    expect(buildInsertionAriaLabel(null, null)).toBe(
      "Add component at start of list",
    );
  });
});

// ─── Component behavior ─────────────────────────────────────────────────────

describe("InsertionButton", () => {
  it("renders a native <button type='button'> as the activation target", () => {
    render(
      <InsertionButton
        zone="root:default-zone"
        index={0}
        afterLabel={null}
        beforeLabel={null}
        onActivate={vi.fn()}
      />,
    );
    const button = screen.getByRole("button");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
  });

  describe("aria-label", () => {
    it("uses 'after {label}' when afterLabel is provided", () => {
      render(
        <InsertionButton
          zone="root:default-zone"
          index={1}
          afterLabel="Heading"
          beforeLabel="Image"
          onActivate={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Add component after Heading" }),
      ).toBeDefined();
    });

    it("uses 'at start of list' when no adjacent labels are provided (empty zone)", () => {
      render(
        <InsertionButton
          zone="root:default-zone"
          index={0}
          afterLabel={null}
          beforeLabel={null}
          onActivate={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", {
          name: "Add component at start of list",
        }),
      ).toBeDefined();
    });

    it("uses 'after {label}' for the trailing slot of a non-empty zone", () => {
      // afterLabel known, beforeLabel null → reads as the slot at end of list
      // ("after" the last component reads more naturally than "at end of list"
      // when a meaningful anchor is available).
      render(
        <InsertionButton
          zone="root:default-zone"
          index={2}
          afterLabel="Footer"
          beforeLabel={null}
          onActivate={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Add component after Footer" }),
      ).toBeDefined();
    });

    it("uses 'before {label}' for the leading slot of a non-empty zone", () => {
      // afterLabel null, beforeLabel known → reads as the slot at start of
      // list (anchored to the first existing component).
      render(
        <InsertionButton
          zone="root:default-zone"
          index={0}
          afterLabel={null}
          beforeLabel="Hero"
          onActivate={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Add component before Hero" }),
      ).toBeDefined();
    });
  });

  describe("default visibility", () => {
    it("renders the visual layer with the --ora-ib-opacity fade variable initialised to 0", () => {
      // The button itself remains pointer-active (so hover can reveal the
      // visual). The visual layer's opacity is driven by a CSS custom
      // property so :hover / :focus-visible can transition it. We assert
      // the initial state of that custom property on the root element.
      render(
        <InsertionButton
          zone="root:default-zone"
          index={0}
          afterLabel={null}
          beforeLabel={null}
          onActivate={vi.fn()}
        />,
      );
      const button = screen.getByRole("button");

      // The CSS rule sets `--ora-ib-opacity: 0` on the root class. Read it
      // off the rendered stylesheet via getComputedStyle. jsdom resolves
      // custom properties from <style> tags appended to <head>, which our
      // component does on mount.
      const opacityVar = getComputedStyle(button)
        .getPropertyValue("--ora-ib-opacity")
        .trim();
      expect(opacityVar).toBe("0");
    });

    it("applies the hidden-by-default class so CSS can drive the fade", () => {
      // Belt-and-braces check: the root class is what the stylesheet keys
      // off. If the class were missing, the fade rule would never apply.
      render(
        <InsertionButton
          zone="root:default-zone"
          index={0}
          afterLabel={null}
          beforeLabel={null}
          onActivate={vi.fn()}
        />,
      );
      const button = screen.getByRole("button");
      expect(button.classList.contains("ora-insertion-button")).toBe(true);
    });
  });

  describe("activation", () => {
    it("calls onActivate with (buttonElement, zone, index) on click", () => {
      const onActivate = vi.fn();
      render(
        <InsertionButton
          zone="section-1:content"
          index={3}
          afterLabel="Heading"
          beforeLabel="Image"
          onActivate={onActivate}
        />,
      );
      const button = screen.getByRole("button");
      fireEvent.click(button);

      expect(onActivate).toHaveBeenCalledTimes(1);
      const [anchorEl, zone, index] = onActivate.mock.calls[0];
      expect(anchorEl).toBe(button);
      expect(zone).toBe("section-1:content");
      expect(index).toBe(3);
    });

    it("stops click propagation so the underlying canvas does not steal selection", () => {
      // The root canvas listens for clicks to drive selection. The button
      // calls event.stopPropagation() to keep that from firing while the
      // picker is being opened. Verify by attaching a parent listener that
      // should NOT receive the bubbled click.
      const onActivate = vi.fn();
      const onParentClick = vi.fn();
      render(
        <div onClick={onParentClick} data-testid="parent">
          <InsertionButton
            zone="root:default-zone"
            index={0}
            afterLabel={null}
            beforeLabel={null}
            onActivate={onActivate}
          />
        </div>,
      );
      fireEvent.click(screen.getByRole("button"));
      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onParentClick).not.toHaveBeenCalled();
    });

    it("activates via Enter — native button semantics route Enter through onClick", () => {
      // HTML buttons activate on Enter by dispatching a synthetic click
      // event (https://html.spec.whatwg.org/multipage/form-control-infor
      // mation-from.html#implicit-submission). jsdom does not perform this
      // translation, but the contract holds in any real browser because
      // the element is a `<button type="button">` with no preventDefault
      // on keydown. We assert the contract two ways:
      //   (a) the element is a native button (Enter activation guaranteed
      //       by the platform), and
      //   (b) the synthetic click that Enter produces routes onActivate.
      const onActivate = vi.fn();
      render(
        <InsertionButton
          zone="root:default-zone"
          index={0}
          afterLabel="Heading"
          beforeLabel={null}
          onActivate={onActivate}
        />,
      );
      const button = screen.getByRole("button") as HTMLButtonElement;
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");

      // Simulate the keystroke and the click the platform emits in
      // response. Calling button.click() is what jsdom uses to model the
      // native activation behaviour.
      fireEvent.keyDown(button, { key: "Enter" });
      button.click();

      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onActivate.mock.calls[0][1]).toBe("root:default-zone");
      expect(onActivate.mock.calls[0][2]).toBe(0);
    });

    it("activates via Space — native button semantics route Space through onClick", () => {
      // Same contract as Enter; Space activation is the second half of
      // the HTML button keyboard pattern.
      const onActivate = vi.fn();
      render(
        <InsertionButton
          zone="root:default-zone"
          index={2}
          afterLabel="Footer"
          beforeLabel={null}
          onActivate={onActivate}
        />,
      );
      const button = screen.getByRole("button") as HTMLButtonElement;
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");

      fireEvent.keyDown(button, { key: " " });
      button.click();

      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onActivate.mock.calls[0][1]).toBe("root:default-zone");
      expect(onActivate.mock.calls[0][2]).toBe(2);
    });

    it("does not call onActivate when no activation event is fired", () => {
      // Sanity check that the handler is event-driven, not invoked at
      // mount time.
      const onActivate = vi.fn();
      render(
        <InsertionButton
          zone="root:default-zone"
          index={0}
          afterLabel={null}
          beforeLabel={null}
          onActivate={onActivate}
        />,
      );
      expect(onActivate).not.toHaveBeenCalled();
    });
  });
});
