"use client";

/**
 * StepperField and FourSideStepperField — ORA-themed numeric controls with
 * a unit toggle for lengths (px, %, em, rem).
 *
 * Spec: custom-branded-page-builder — Requirements 6.2, 6.3
 *
 * `StepperField` is a single numeric input with +/− buttons and a unit
 * toggle across the four supported units. `FourSideStepperField` is the
 * composite used by Padding / Margin property sections: four steppers
 * (top, right, bottom, left) that share a single unit toggle. Changing
 * the unit updates ALL four sides simultaneously so the stored values
 * stay in a consistent unit — this is the behavior required by 6.3.
 *
 * Both components read ORA colors, typography, and border tokens from
 * `../inspector/tokens.ts`. Wiring into `FieldControlRegistry` happens
 * later (task 11.x breakpoint-aware wrapper / 6.x grouped spacing
 * property section). This file only exposes the presentational controls.
 */

import React from "react";
import { ORA_THEME } from "../inspector/tokens";

export type Unit = "px" | "%" | "em" | "rem";

export const STEPPER_UNITS: ReadonlyArray<Unit> = ["px", "%", "em", "rem"];

export interface StepperFieldValue {
  value: number;
  unit: Unit;
}

export interface StepperFieldProps {
  value: StepperFieldValue;
  onChange: (next: StepperFieldValue) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}

export interface FourSideStepperValue {
  top: StepperFieldValue;
  right: StepperFieldValue;
  bottom: StepperFieldValue;
  left: StepperFieldValue;
}

export interface FourSideStepperProps {
  value: FourSideStepperValue;
  onChange: (next: FourSideStepperValue) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Clamp a numeric value to [min, max]. Undefined bounds are ignored.
 */
function clamp(value: number, min: number | undefined, max: number | undefined): number {
  let next = value;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}

// ─────────────────────────────────────────────────────────────────────────
// StepperField (single side)
// ─────────────────────────────────────────────────────────────────────────

export function StepperField({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  label,
}: StepperFieldProps) {
  const reactId = React.useId();
  const inputId = `${reactId}-value`;
  const unitId = `${reactId}-unit`;

  const emit = (next: StepperFieldValue) => {
    onChange({ ...next, value: clamp(next.value, min, max) });
  };

  const handleInputChange = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    emit({ value: parsed, unit: value.unit });
  };

  const handleDecrement = () => {
    emit({ value: value.value - step, unit: value.unit });
  };

  const handleIncrement = () => {
    emit({ value: value.value + step, unit: value.unit });
  };

  const handleUnitChange = (nextUnit: Unit) => {
    emit({ value: value.value, unit: nextUnit });
  };

  const decrementDisabled = min !== undefined && value.value <= min;
  const incrementDisabled = max !== undefined && value.value >= max;

  return (
    <div style={rowStyle}>
      <label htmlFor={inputId} style={labelStyle}>
        {label}
      </label>
      <div style={controlGroupStyle}>
        <button
          type="button"
          onClick={handleDecrement}
          disabled={decrementDisabled}
          aria-label={`Decrease ${label}`}
          aria-controls={inputId}
          style={stepButtonStyle(decrementDisabled)}
        >
          −
        </button>
        <input
          id={inputId}
          type="number"
          value={Number.isFinite(value.value) ? value.value : ""}
          onChange={(e) => handleInputChange(e.target.value)}
          min={min}
          max={max}
          step={step}
          aria-label={label}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={handleIncrement}
          disabled={incrementDisabled}
          aria-label={`Increase ${label}`}
          aria-controls={inputId}
          style={stepButtonStyle(incrementDisabled)}
        >
          +
        </button>
        <UnitToggle
          id={unitId}
          value={value.unit}
          onChange={handleUnitChange}
          ariaLabel={`${label} unit`}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FourSideStepperField (shared unit across top/right/bottom/left)
// ─────────────────────────────────────────────────────────────────────────

type Side = "top" | "right" | "bottom" | "left";

const SIDES: ReadonlyArray<Side> = ["top", "right", "bottom", "left"];

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function FourSideStepperField({
  value,
  onChange,
  label,
  min = 0,
  max,
  step = 1,
}: FourSideStepperProps) {
  const reactId = React.useId();
  const unitId = `${reactId}-unit`;

  // Single shared unit. By construction of this component every side holds
  // the same unit; we read from `top` and on change rewrite all four at
  // once so stored values stay consistent.
  const sharedUnit: Unit = value.top.unit;

  const sideAriaLabel = (side: Side) =>
    label ? `${label} ${side}` : `${capitalize(side)}`;

  const handleSideChange = (side: Side, next: StepperFieldValue) => {
    onChange({
      ...value,
      [side]: { value: clamp(next.value, min, max), unit: next.unit },
    });
  };

  // Requirement 6.3: changing the unit updates all four sides simultaneously.
  const handleUnitChange = (nextUnit: Unit) => {
    onChange({
      top: { value: value.top.value, unit: nextUnit },
      right: { value: value.right.value, unit: nextUnit },
      bottom: { value: value.bottom.value, unit: nextUnit },
      left: { value: value.left.value, unit: nextUnit },
    });
  };

  return (
    <div
      role="group"
      aria-label={label ?? "Four-side stepper"}
      style={groupStyle}
    >
      {label ? <div style={groupLabelStyle}>{label}</div> : null}

      <div style={{ display: "grid", gap: 6 }}>
        {SIDES.map((side) => {
          const sideValue = value[side];
          const ariaLabel = sideAriaLabel(side);
          return (
            <SideRow
              key={side}
              side={side}
              ariaLabel={ariaLabel}
              value={sideValue}
              min={min}
              max={max}
              step={step}
              onChange={(next) => handleSideChange(side, next)}
            />
          );
        })}
      </div>

      <div style={unitRowStyle}>
        <label htmlFor={unitId} style={unitLabelStyle}>
          Unit
        </label>
        <UnitToggle
          id={unitId}
          value={sharedUnit}
          onChange={handleUnitChange}
          ariaLabel={label ? `${label} unit` : "Unit"}
        />
      </div>
    </div>
  );
}

function SideRow({
  side,
  ariaLabel,
  value,
  min,
  max,
  step,
  onChange,
}: {
  side: Side;
  ariaLabel: string;
  value: StepperFieldValue;
  min: number | undefined;
  max: number | undefined;
  step: number;
  onChange: (next: StepperFieldValue) => void;
}) {
  const reactId = React.useId();
  const inputId = `${reactId}-${side}`;

  const handleInputChange = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange({ value: parsed, unit: value.unit });
  };

  const decrementDisabled = min !== undefined && value.value <= min;
  const incrementDisabled = max !== undefined && value.value >= max;

  return (
    <div style={sideRowStyle}>
      <label htmlFor={inputId} style={sideLabelStyle}>
        {capitalize(side)}
      </label>
      <div style={controlGroupStyle}>
        <button
          type="button"
          onClick={() => onChange({ value: value.value - step, unit: value.unit })}
          disabled={decrementDisabled}
          aria-label={`Decrease ${ariaLabel}`}
          aria-controls={inputId}
          style={stepButtonStyle(decrementDisabled)}
        >
          −
        </button>
        <input
          id={inputId}
          type="number"
          value={Number.isFinite(value.value) ? value.value : ""}
          onChange={(e) => handleInputChange(e.target.value)}
          min={min}
          max={max}
          step={step}
          aria-label={ariaLabel}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={() => onChange({ value: value.value + step, unit: value.unit })}
          disabled={incrementDisabled}
          aria-label={`Increase ${ariaLabel}`}
          aria-controls={inputId}
          style={stepButtonStyle(incrementDisabled)}
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared unit toggle
// ─────────────────────────────────────────────────────────────────────────

function UnitToggle({
  id,
  value,
  onChange,
  ariaLabel,
}: {
  id: string;
  value: Unit;
  onChange: (next: Unit) => void;
  ariaLabel: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as Unit)}
      aria-label={ariaLabel}
      style={unitSelectStyle}
    >
      {STEPPER_UNITS.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: ORA_THEME.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
};

const rowStyle: React.CSSProperties = {
  marginBottom: 12,
  fontFamily: "inherit",
};

const controlGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 4,
};

const stepButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: 28,
  padding: 0,
  fontSize: 14,
  lineHeight: 1,
  color: disabled ? ORA_THEME.muted : ORA_THEME.charcoal,
  background: disabled ? ORA_THEME.creamLight : ORA_THEME.white,
  border: `1px solid ${ORA_THEME.border}`,
  borderRadius: 0,
  cursor: disabled ? "not-allowed" : "pointer",
  fontFamily: "inherit",
});

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 48,
  padding: "6px 8px",
  fontSize: 13,
  fontFamily: "inherit",
  color: ORA_THEME.charcoal,
  background: ORA_THEME.white,
  border: `1px solid ${ORA_THEME.border}`,
  borderRadius: 0,
  outline: "none",
  boxSizing: "border-box",
  textAlign: "center",
};

const unitSelectStyle: React.CSSProperties = {
  width: 64,
  padding: "6px 6px",
  fontSize: 12,
  fontFamily: "inherit",
  color: ORA_THEME.charcoal,
  background: ORA_THEME.white,
  border: `1px solid ${ORA_THEME.border}`,
  borderRadius: 0,
  outline: "none",
  boxSizing: "border-box",
};

const groupStyle: React.CSSProperties = {
  marginBottom: 12,
  fontFamily: "inherit",
};

const groupLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: ORA_THEME.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 8,
};

const sideRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "56px 1fr",
  alignItems: "center",
  gap: 8,
};

const sideLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: ORA_THEME.charcoal,
  textTransform: "none",
  letterSpacing: 0,
};

const unitRowStyle: React.CSSProperties = {
  marginTop: 10,
  display: "grid",
  gridTemplateColumns: "56px 1fr",
  alignItems: "center",
  gap: 8,
};

const unitLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: ORA_THEME.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};
