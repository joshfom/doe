// @vitest-environment jsdom

/**
 * StepperField / FourSideStepperField — unit tests.
 *
 * Spec: custom-branded-page-builder — Requirement 6.3
 *
 * The critical behavior under test (Req 6.3):
 *   "WHEN the padding unit toggle is changed, THE Configuration_Panel SHALL
 *    update the unit for all four padding Stepper_Field instances
 *    simultaneously and persist the unit with the field value."
 *
 * FourSideStepperField exposes a single shared unit toggle across
 * top/right/bottom/left. Changing that toggle must emit an onChange with
 * ALL four sides sharing the new unit — not one side at a time. That
 * guarantee is what keeps stored padding values in a consistent unit,
 * which other parts of the system assume when serializing to CSS.
 *
 * These are pure presentational components with no external deps beyond
 * React and the ORA tokens, so no mocks are needed. Tests drive the
 * components directly via @testing-library/react, matching the style of
 * ../configuration-panel/ConfigurationPanel.test.tsx.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import {
  StepperField,
  FourSideStepperField,
  type StepperFieldValue,
  type FourSideStepperValue,
} from "./StepperField";

// ── Fixtures ────────────────────────────────────────────────────────────────

const px = (n: number): StepperFieldValue => ({ value: n, unit: "px" });

function makeFourSides(
  top: number,
  right: number,
  bottom: number,
  left: number,
  unit: StepperFieldValue["unit"] = "px",
): FourSideStepperValue {
  return {
    top: { value: top, unit },
    right: { value: right, unit },
    bottom: { value: bottom, unit },
    left: { value: left, unit },
  };
}

// ── StepperField (single) ───────────────────────────────────────────────────

describe("StepperField", () => {
  it("increments by `step` when + is clicked", () => {
    const onChange = vi.fn();
    render(
      <StepperField
        label="Padding"
        value={px(10)}
        step={4}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Increase Padding" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ value: 14, unit: "px" });
  });

  it("decrements by `step` when − is clicked", () => {
    const onChange = vi.fn();
    render(
      <StepperField
        label="Padding"
        value={px(10)}
        step={3}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Decrease Padding" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ value: 7, unit: "px" });
  });

  it("disables the decrement button at min and the increment button at max", () => {
    // At min: decrement disabled, increment enabled.
    const { rerender } = render(
      <StepperField
        label="Padding"
        value={px(0)}
        min={0}
        max={100}
        onChange={() => {}}
      />,
    );

    const decreaseAtMin = screen.getByRole("button", {
      name: "Decrease Padding",
    }) as HTMLButtonElement;
    const increaseAtMin = screen.getByRole("button", {
      name: "Increase Padding",
    }) as HTMLButtonElement;
    expect(decreaseAtMin.disabled).toBe(true);
    expect(increaseAtMin.disabled).toBe(false);

    // At max: increment disabled, decrement enabled.
    rerender(
      <StepperField
        label="Padding"
        value={px(100)}
        min={0}
        max={100}
        onChange={() => {}}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Decrease Padding",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Increase Padding",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("emits the same value with the new unit when the unit select changes", () => {
    const onChange = vi.fn();
    render(
      <StepperField
        label="Padding"
        value={px(24)}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Padding unit" }), {
      target: { value: "%" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ value: 24, unit: "%" });
  });
});

// ── FourSideStepperField ────────────────────────────────────────────────────

describe("FourSideStepperField", () => {
  it("updates all four sides to the new unit when the shared unit toggle changes (Req 6.3)", () => {
    // All four sides start in the same unit, which is the invariant the
    // component maintains.
    const initial = makeFourSides(8, 16, 8, 16, "px");
    const onChange = vi.fn();

    render(
      <FourSideStepperField
        label="Padding"
        value={initial}
        onChange={onChange}
      />,
    );

    // There is exactly one shared unit combobox for the group.
    fireEvent.change(screen.getByRole("combobox", { name: "Padding unit" }), {
      target: { value: "%" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as FourSideStepperValue;

    // The guarantee under test: every side now holds the new unit, and
    // each side's numeric value is unchanged.
    expect(next.top).toEqual({ value: 8, unit: "%" });
    expect(next.right).toEqual({ value: 16, unit: "%" });
    expect(next.bottom).toEqual({ value: 8, unit: "%" });
    expect(next.left).toEqual({ value: 16, unit: "%" });
  });

  it("only updates the changed side when a single side value changes", () => {
    const initial = makeFourSides(8, 16, 8, 16, "px");
    const onChange = vi.fn();

    render(
      <FourSideStepperField
        label="Padding"
        value={initial}
        onChange={onChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Increase Padding top" }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as FourSideStepperValue;

    // Top incremented by default step of 1; the other three sides are untouched.
    expect(next.top).toEqual({ value: 9, unit: "px" });
    expect(next.right).toEqual(initial.right);
    expect(next.bottom).toEqual(initial.bottom);
    expect(next.left).toEqual(initial.left);
  });

  it("gives each side a distinct accessible name scoped by the label", () => {
    render(
      <FourSideStepperField
        label="Padding"
        value={makeFourSides(0, 0, 0, 0)}
        onChange={() => {}}
      />,
    );

    // When a label is provided, side inputs are named "<label> <side>".
    expect(
      screen.getByRole("spinbutton", { name: "Padding top" }),
    ).toBeDefined();
    expect(
      screen.getByRole("spinbutton", { name: "Padding right" }),
    ).toBeDefined();
    expect(
      screen.getByRole("spinbutton", { name: "Padding bottom" }),
    ).toBeDefined();
    expect(
      screen.getByRole("spinbutton", { name: "Padding left" }),
    ).toBeDefined();

    // Sanity: the group itself is labeled by the prop.
    expect(
      screen.getByRole("group", { name: "Padding" }),
    ).toBeDefined();
  });

  it("falls back to capitalized side names when no label is provided", () => {
    const { container } = render(
      <FourSideStepperField
        value={makeFourSides(0, 0, 0, 0)}
        onChange={() => {}}
      />,
    );

    // Without a label, each side input is named by the side alone.
    for (const name of ["Top", "Right", "Bottom", "Left"]) {
      expect(
        within(container).getByRole("spinbutton", { name }),
      ).toBeDefined();
    }
  });
});
