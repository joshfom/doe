"use client";

import React from "react";
import { ORA_THEME } from "../tokens";

const baseInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 13,
  fontFamily: "inherit",
  color: ORA_THEME.charcoal,
  background: ORA_THEME.white,
  border: `1px solid ${ORA_THEME.border}`,
  borderRadius: 0,
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: ORA_THEME.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
};

interface BaseFieldProps {
  label: string;
  id?: string;
  description?: string;
}

export function FieldShell({
  label,
  id,
  description,
  children,
}: BaseFieldProps & { children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      {children}
      {description ? (
        <div style={{ fontSize: 11, color: ORA_THEME.muted, marginTop: 4 }}>{description}</div>
      ) : null}
    </div>
  );
}

export interface OraTextFieldProps extends BaseFieldProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

export function OraTextField({
  label,
  id,
  description,
  value,
  onChange,
  placeholder,
  multiline,
}: OraTextFieldProps) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  return (
    <FieldShell label={label} id={fieldId} description={description}>
      {multiline ? (
        <textarea
          id={fieldId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          style={{ ...baseInputStyle, resize: "vertical", minHeight: 60 }}
        />
      ) : (
        <input
          id={fieldId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={baseInputStyle}
        />
      )}
    </FieldShell>
  );
}

export interface OraNumberFieldProps extends BaseFieldProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function OraNumberField({
  label,
  id,
  description,
  value,
  onChange,
  min,
  max,
  step,
}: OraNumberFieldProps) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  return (
    <FieldShell label={label} id={fieldId} description={description}>
      <input
        id={fieldId}
        type="number"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
        min={min}
        max={max}
        step={step}
        style={baseInputStyle}
      />
    </FieldShell>
  );
}

export interface OraSelectOption<T extends string = string> {
  label: string;
  value: T;
}

export interface OraSelectProps<T extends string = string> extends BaseFieldProps {
  value: T;
  options: ReadonlyArray<OraSelectOption<T>>;
  onChange: (next: T) => void;
}

export function OraSelect<T extends string = string>({
  label,
  id,
  description,
  value,
  options,
  onChange,
}: OraSelectProps<T>) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  return (
    <FieldShell label={label} id={fieldId} description={description}>
      <select
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={baseInputStyle}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export interface OraToggleProps extends BaseFieldProps {
  value: boolean;
  onChange: (next: boolean) => void;
}

export function OraToggle({ label, id, description, value, onChange }: OraToggleProps) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  return (
    <div style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <label htmlFor={fieldId} style={{ ...labelStyle, marginBottom: 0 }}>
        {label}
      </label>
      <button
        id={fieldId}
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        style={{
          width: 36,
          height: 20,
          padding: 2,
          background: value ? ORA_THEME.gold : ORA_THEME.border,
          border: "none",
          borderRadius: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: value ? "flex-end" : "flex-start",
        }}
      >
        <span
          style={{
            display: "block",
            width: 16,
            height: 16,
            background: ORA_THEME.white,
          }}
        />
      </button>
      {description ? (
        <div style={{ fontSize: 11, color: ORA_THEME.muted }}>{description}</div>
      ) : null}
    </div>
  );
}

export interface OraSliderFieldProps extends BaseFieldProps {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

export function OraSliderField({
  label,
  id,
  description,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: OraSliderFieldProps) {
  const reactId = React.useId();
  const fieldId = id ?? reactId;
  return (
    <FieldShell label={`${label}${unit ? ` (${unit})` : ""}`} id={fieldId} description={description}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          id={fieldId}
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          style={{ ...baseInputStyle, width: 70, padding: "4px 6px" }}
          aria-label={`${label} value`}
        />
      </div>
    </FieldShell>
  );
}
