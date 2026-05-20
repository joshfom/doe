"use client";

/**
 * InspectorFieldRenderer
 *
 * Maps a Puck `Field` definition for the currently-selected component to an
 * ORA-styled control. For field types Puck describes natively (text, textarea,
 * number, select, radio) we render our own primitives; for `custom` fields we
 * delegate to the field's own `render` function (preserving today's behavior
 * for color pickers, pin map editors, etc.); unsupported field types (`array`,
 * `object`, `external`, `slot`) return `null` silently. Richtext fields are
 * edited inline on the canvas and are filtered out before reaching this renderer.
 */

import React from "react";
import type { Field } from "@puckeditor/core";
import {
  OraTextField,
  OraNumberField,
  OraSelect,
  type OraSelectOption,
} from "./controls/OraFields";

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

    case "object":
      // Render the object's nested fields recursively. This supports the
      // common pattern used by `_animation`, `_tracking`, and `_analytics`
      // where a group of related fields is expressed as an object with
      // `objectFields`.
      return (
        <ObjectFieldRenderer
          name={name}
          label={label}
          field={field as Field & { objectFields: Record<string, Field> }}
          value={value}
          onChange={onChange}
        />
      );

    case "array":
    case "external":
    case "slot":
    default:
      return null;
  }
}

/**
 * Renders a Puck `object` field as a labeled group of nested fields.
 * Nested values are read from the object value and updated immutably.
 */
function ObjectFieldRenderer({
  name,
  label,
  field,
  value,
  onChange,
}: {
  name: string;
  label: string;
  field: Field & { objectFields?: Record<string, Field> };
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const objectFields = field.objectFields;
  if (!objectFields || typeof objectFields !== "object") return null;

  const objectValue =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const handleChildChange = (childName: string, childValue: unknown) => {
    onChange({ ...objectValue, [childName]: childValue });
  };

  return (
    <div
      style={{
        marginBottom: 16,
        paddingTop: 12,
        borderTop: "1px solid #E8E4DF",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "#9A9A9A",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {Object.entries(objectFields).map(([childName, childField]) => {
          if (!childField) return null;
          if ((childField as { visible?: boolean }).visible === false)
            return null;
          return (
            <InspectorFieldRenderer
              key={`${name}.${childName}`}
              name={childName}
              field={childField}
              value={objectValue[childName]}
              onChange={(v) => handleChildChange(childName, v)}
            />
          );
        })}
      </div>
    </div>
  );
}
