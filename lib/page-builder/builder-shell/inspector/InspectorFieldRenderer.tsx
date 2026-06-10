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
import { InspectorRichtextField } from "./controls/InspectorRichtextField";

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

    case "richtext":
      // Richtext fields are normally edited inline on the canvas. Inside
      // array items (which are collapsed by default and aren't reachable
      // via inline selection), we mount a compact Tiptap editor here so
      // users can format text without leaving the panel. The editor
      // emits HTML which the public renderer sanitises before painting.
      return (
        <InspectorRichtextField
          label={label}
          value={asString(value)}
          onChange={onChange}
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
      return (
        <ArrayFieldRenderer
          name={name}
          label={label}
          field={
            field as Field & {
              arrayFields?: Record<string, Field>;
              defaultItemProps?: Record<string, unknown>;
              getItemSummary?: (item: Record<string, unknown>, i?: number) => string;
              min?: number;
              max?: number;
            }
          }
          value={value}
          onChange={onChange}
        />
      );

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

/**
 * Renders a Puck `array` field with full add / remove / reorder /
 * collapsible-item editing. Each item exposes its `arrayFields` via the
 * same recursive renderer, so nested arrays and rich field types work
 * without further plumbing.
 */
function ArrayFieldRenderer({
  name,
  label,
  field,
  value,
  onChange,
}: {
  name: string;
  label: string;
  field: Field & {
    arrayFields?: Record<string, Field>;
    defaultItemProps?: Record<string, unknown> | ((index: number) => Record<string, unknown>);
    getItemSummary?: (item: Record<string, unknown>, i?: number) => React.ReactNode;
    min?: number;
    max?: number;
  };
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const arrayFields = field.arrayFields;
  const items: Record<string, unknown>[] = React.useMemo(
    () => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []),
    [value],
  );
  const [openIndex, setOpenIndex] = React.useState<number | null>(
    items.length > 0 ? 0 : null,
  );

  const min = typeof field.min === "number" ? field.min : 0;
  const max = typeof field.max === "number" ? field.max : Infinity;
  const canAdd = items.length < max;
  const canRemove = items.length > min;

  const buildDefaultItem = (index: number): Record<string, unknown> => {
    const dip = field.defaultItemProps;
    if (typeof dip === "function") return { ...(dip(index) ?? {}) };
    if (dip && typeof dip === "object") return { ...dip };
    return {};
  };

  const updateItem = (index: number, patch: Record<string, unknown>) => {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
    setOpenIndex((cur) =>
      cur === index ? null : cur != null && cur > index ? cur - 1 : cur,
    );
  };

  const moveItem = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
    setOpenIndex(to);
  };

  const addItem = () => {
    const next = [...items, buildDefaultItem(items.length)];
    onChange(next);
    setOpenIndex(next.length - 1);
  };

  const fmtSummary = (item: Record<string, unknown>, i: number): string => {
    if (typeof field.getItemSummary === "function") {
      try {
        const s = field.getItemSummary(item, i);
        if (typeof s === "string") return s;
        if (s != null) return String(s);
      } catch {
        // fall through to default
      }
    }
    return `Item ${i + 1}`;
  };

  if (!arrayFields || typeof arrayFields !== "object") return null;

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

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "#7A7A7A",
              padding: "10px 12px",
              border: "1px dashed #D9D5CE",
              background: "#FAF8F4",
              textAlign: "center",
            }}
          >
            No items yet — click “Add item” to create one.
          </div>
        ) : null}

        {items.map((item, i) => {
          const isOpen = openIndex === i;
          return (
            <div
              key={i}
              style={{
                border: "1px solid #E8E4DF",
                background: "#FFFFFF",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto",
                  alignItems: "center",
                  gap: 4,
                  padding: 6,
                  background: isOpen ? "#F5F3F0" : "#F9F7F5",
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#2C2C2C",
                    padding: "4px 6px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={fmtSummary(item, i)}
                >
                  <span style={{ fontSize: 10, color: "#7A7A7A" }}>
                    {isOpen ? "▼" : "▶"}
                  </span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtSummary(item, i)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                  aria-label={`Move item ${i + 1} up`}
                  style={{
                    ...itemActionButtonStyle,
                    opacity: i === 0 ? 0.4 : 1,
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(i, 1)}
                  disabled={i === items.length - 1}
                  title="Move down"
                  aria-label={`Move item ${i + 1} down`}
                  style={{
                    ...itemActionButtonStyle,
                    opacity: i === items.length - 1 ? 0.4 : 1,
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  disabled={!canRemove}
                  title="Remove"
                  aria-label={`Remove item ${i + 1}`}
                  style={{
                    ...itemActionButtonStyle,
                    opacity: canRemove ? 1 : 0.4,
                    color: "#B0413E",
                  }}
                >
                  ✕
                </button>
              </div>

              {isOpen ? (
                <div
                  style={{
                    padding: "10px 10px 12px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    borderTop: "1px solid #E8E4DF",
                  }}
                >
                  {Object.entries(arrayFields).map(([childName, childField]) => {
                    if (!childField) return null;
                    if ((childField as { visible?: boolean }).visible === false)
                      return null;
                    return (
                      <InspectorFieldRenderer
                        key={`${name}.${i}.${childName}`}
                        name={childName}
                        field={childField}
                        value={item[childName]}
                        onChange={(v) => updateItem(i, { [childName]: v })}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        <button
          type="button"
          onClick={addItem}
          disabled={!canAdd}
          style={{
            marginTop: 4,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: canAdd ? "#2C2C2C" : "#9A9A9A",
            background: "#FFFFFF",
            border: "1px solid #E8E4DF",
            cursor: canAdd ? "pointer" : "not-allowed",
            opacity: canAdd ? 1 : 0.6,
          }}
        >
          + Add item
        </button>
      </div>
    </div>
  );
}

const itemActionButtonStyle: React.CSSProperties = {
  fontSize: 12,
  width: 26,
  height: 26,
  padding: 0,
  border: "1px solid #E8E4DF",
  background: "#FFFFFF",
  cursor: "pointer",
  color: "#2C2C2C",
};
