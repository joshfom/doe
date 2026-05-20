// @vitest-environment jsdom
/**
 * SelectionOverlay — clears selection when clicking non-annotated DOM.
 *
 * Spec: custom-branded-page-builder — task 15.7
 * _Validates: Requirements 8.3_
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { useInlineSelection } from "./useInlineSelection";

function Harness() {
  const { selectedId, selectedEl } = useInlineSelection(true);
  return (
    <div>
      <div data-puck-id="block-1" data-testid="block-1" style={{ width: 10, height: 10 }}>
        block 1
      </div>
      <div data-testid="non-block">non-block area</div>
      <div data-testid="readout">
        {selectedId ?? "none"}-{selectedEl ? "el" : "noel"}
      </div>
    </div>
  );
}

describe("Feature: custom-branded-page-builder — useInlineSelection", () => {
  it("selects on click of an annotated element and clears on click of an unannotated element", () => {
    render(<Harness />);

    const block = screen.getByTestId("block-1");
    act(() => {
      block.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });
    expect(screen.getByTestId("readout").textContent).toBe("block-1-el");

    const non = screen.getByTestId("non-block");
    act(() => {
      non.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });
    expect(screen.getByTestId("readout").textContent).toBe("none-noel");
  });
});
