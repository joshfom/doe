"use client";

/**
 * InspectorFieldRenderer
 *
 * Maps a Puck `Field` definition for the currently-selected component to an
 * ORA-styled control. For field types Puck describes natively (text, textarea,
 * number, select, radio) we render our own primitives; for `custom` fields we
 * delegate to the field's own `render` function (preserving today's behavior
 * for color pickers, pin map editors, etc.); `array`, `object`, `external`,
 * `slot`, and `richtext` fall back to a "not yet supported" placeholder so we
 * never crash an unknown field.
 */

import React from "react";
import type { Field } from "@puckeditor/core";
import {
  OraTextField,
  OraNumberField,
  OraSelect,
  type OraSelectOption,
} from "./controls/OraFields";
import { ORA_THEME } from "./tokens";

export interface InspectorFieldRendererProps {
  name: string;
  field: Field;
  value: unknown;
  onChange: (next: unknown) => void;
}

function fieldLabel(name: string, field: Field): string {
  if (field.label) return field.label;
  // Convert camelCase to Title Case
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionsToSelect(
  options: ReadonlyArray<{ label: string; value: unknown }>,
): OraSelectOption[] {
  return options.map((o) => ({ label: o.label, value: String(o.value) }));
}

const placeholderStyle: React.CSSProperties = {
  fontSize: 12,
  color: ORA_THEME.muted,
  padding: 8,
  border: `1px dashed ${ORA_THEME.border}`,
  marginBottom: 12,
};

export function InspectorFieldRenderer({
  name,
  field,
  value,
  onChange,
}: InspectorFieldRendererProps) {
  const label = fieldLabel(name, field);

  switch (field.type) {
    case "text":
      return (
        <OraTextField
          label={label}
          value={asString(value)}
          onChange={onChange}
          placeholder={field.placeholder}
        />
      );

    case "textarea":
      return (
        <OraTextField
          label={label}
          value={asString(value)}
          onChange={onChange}
          placeholder={field.placeholder}
          multiline
        />
      );

    case "number":
      return (
        <OraNumberField
          label={label}
          value={asNumber(value)}
          onChange={onChange}
          min={field.min}
          max={field.max}
          step={field.step}
        />
      );

    case "select":
    case "radio":
      return (
        <OraSelect
          label={label}
          value={asString(value, optionsToSelect(field.options)[0]?.value ?? "")}
          options={optionsToSelect(field.options)}
          onChange={(v) => {
            // Coerce back to original primitive type if possible
            const original = field.options.find((o) => String(o.value) === v);
            onChange(original?.value ?? v);
          }}
        />
      );

    case "custom":
      // Delegate to the field's own render function. We synthesise the props
      // shape Puck passes — reusing the existing custom field UIs unchanged.
      return (
        <div style={{ marginBottom: 12 }}>
          {field.render({
            field: field as never,
            name,
            id: `inspector-${name}`,
            value,
            onChange: (v: unknown) => onChange(v),
          } as never)}
        </div>
      );

    case "array":
    case "object":
    case "external":
    case "slot":
    case "richtext":
    default:
      return (
        <div style={placeholderStyle}>
          <strong style={{ display: "block", marginBottom: 4 }}>{label}</strong>
          Editing this field type ({field.type}) is not yet supported in the new
          inspector. Use the legacy editor for now.
        </div>
      );
  }
}
