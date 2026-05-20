"use client";

/**
 * FieldControlRegistry — type-based dispatch from a Puck `Field` to an ORA
 * control component.
 *
 * Spec: custom-branded-page-builder — Requirements 7.1, 7.2, 7.3, 7.4
 *       (Preserve Existing Puck Block APIs)
 *
 * This module extends the existing `../inspector/InspectorFieldRenderer.tsx`
 * by formalising the field-type → renderer mapping as an overridable
 * registry. The registry is the single point the ConfigurationPanel (and,
 * in Slice 2, the inline editor's ConfigurationSheet) call into when
 * rendering a field — so downstream wrappers like the Slice 3
 * `BreakpointAwareFieldWrapper` (task 11.1) can decorate or replace
 * individual renderers without monkey-patching a module-scoped singleton.
 *
 * Behaviour
 * ---------
 * For each Puck field `type` the default registry dispatches to an ORA
 * control:
 *
 *   text      → OraTextField
 *   textarea  → OraTextField (multiline)
 *   number    → OraNumberField
 *   select    → OraSelect
 *   radio     → OraSelect                  [TODO task 4.2 — OraSegmentedControl]
 *   array     → InspectorFieldRenderer     [TODO task 4.x — OraArrayControl]
 *   object    → InspectorFieldRenderer     [TODO task 4.x — OraObjectControl]
 *   external  → InspectorFieldRenderer     [TODO task 4.x — OraExternalControl]
 *   slot      → InspectorFieldRenderer
 *   richtext  → InspectorFieldRenderer     [TODO — InlineToolbar, task 7]
 *   custom    → delegate to field.render   (preserves block APIs — Req 7.2/7.3/7.4)
 *
 * Types listed as TODO fall back to `InspectorFieldRenderer`, which itself
 * either routes to an ORA primitive or shows the existing "not yet
 * supported" placeholder. The fall-through is why this file is described
 * as _extending_ `InspectorFieldRenderer.tsx` rather than replacing it —
 * as dedicated ORA controls arrive they are slotted into the registry in
 * one place without touching any caller.
 *
 * Custom fields (Requirements 7.2, 7.3, 7.4)
 * ------------------------------------------
 * Block definitions in `lib/page-builder/config.ts` use `type: "custom"`
 * heavily (colour pickers, pin map editors, image upload fields, …). The
 * registry's `custom` entry delegates straight to the field's own `render`
 * function, passing Puck's documented `CustomFieldRender` contract. This
 * keeps existing block APIs intact: no block needs to import from
 * `builder-shell/`, and new blocks using only native Puck types render
 * through the shell without any registry change (Req 7.3).
 *
 * Override mechanism
 * ------------------
 * `FieldControlRegistryProvider` takes a partial `overrides` map that is
 * merged over the defaults for its subtree. Consumers read the merged map
 * via `useFieldControlRegistry()`. When no provider is mounted the hook
 * returns the default map — so the `<FieldControlRegistry>` dispatcher
 * component can be dropped into the existing `ConfigurationPanel` without
 * any additional wiring (the provider wrap-up in task 8.1 is what lets
 * slice 3 register the `BreakpointAwareFieldWrapper` decorator).
 */

import React from "react";
import type { Field } from "@puckeditor/core";
import {
  OraNumberField,
  OraSelect,
  OraTextField,
  type OraSelectOption,
} from "../inspector/controls/OraFields";
import { InspectorFieldRenderer } from "../inspector/InspectorFieldRenderer";
import { BREAKPOINT_AWARE_FIELDS } from "../../breakpoint-fields";
import { withBreakpointAwareness } from "./BreakpointAwareFieldWrapper";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Every Puck field carries a discriminant `type` string. We alias it so
 * callers (and the registry map below) stay in sync with `@puckeditor/core`
 * without having to re-type the union in every file.
 */
export type PuckFieldType = Field["type"];

/**
 * A single renderer. Matches the shape in `design.md` — `{ name, value,
 * field, onChange }` → `React.ReactElement`. The generic `T` is the prop's
 * value type; the registry map below uses `unknown` because the dispatcher
 * cannot know the concrete type at compile time.
 */
export type FieldRenderer<T = unknown> = (props: {
  name: string;
  value: T;
  field: Field;
  onChange: (next: T) => void;
}) => React.ReactElement;

/**
 * The full registry — one renderer per Puck field type. Consumers override
 * individual entries via `FieldControlRegistryProvider`.
 */
export type FieldRendererMap = Record<PuckFieldType, FieldRenderer>;

// ---------------------------------------------------------------------------
// Small coercion helpers (mirrored from InspectorFieldRenderer to keep the
// default renderers self-contained and avoid a circular import).
// ---------------------------------------------------------------------------

function fieldLabel(name: string, field: Field): string {
  if (field.label) return field.label;
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

// ---------------------------------------------------------------------------
// Default renderers
// ---------------------------------------------------------------------------

const renderText: FieldRenderer<unknown> = ({ name, value, field, onChange }) => {
  if (field.type !== "text") {
    return <InspectorFieldRenderer name={name} field={field} value={value} onChange={onChange} />;
  }
  return (
    <OraTextField
      label={fieldLabel(name, field)}
      value={asString(value)}
      onChange={(v) => onChange(v)}
      placeholder={field.placeholder}
    />
  );
};

const renderTextarea: FieldRenderer<unknown> = ({ name, value, field, onChange }) => {
  if (field.type !== "textarea") {
    return <InspectorFieldRenderer name={name} field={field} value={value} onChange={onChange} />;
  }
  return (
    <OraTextField
      label={fieldLabel(name, field)}
      value={asString(value)}
      onChange={(v) => onChange(v)}
      placeholder={field.placeholder}
      multiline
    />
  );
};

const renderNumber: FieldRenderer<unknown> = ({ name, value, field, onChange }) => {
  if (field.type !== "number") {
    return <InspectorFieldRenderer name={name} field={field} value={value} onChange={onChange} />;
  }
  return (
    <OraNumberField
      label={fieldLabel(name, field)}
      value={asNumber(value)}
      onChange={(v) => onChange(v)}
      min={field.min}
      max={field.max}
      step={field.step}
    />
  );
};

const renderSelectOrRadio: FieldRenderer<unknown> = ({
  name,
  value,
  field,
  onChange,
}) => {
  // Radio falls back to OraSelect today. TODO (task 4.2): swap in
  // `OraSegmentedControl` for `type: "radio"` so radios render as an ORA
  // segmented control per Requirement 6.1.
  if (field.type !== "select" && field.type !== "radio") {
    return <InspectorFieldRenderer name={name} field={field} value={value} onChange={onChange} />;
  }
  const selectOptions = optionsToSelect(field.options);
  return (
    <OraSelect
      label={fieldLabel(name, field)}
      value={asString(value, selectOptions[0]?.value ?? "")}
      options={selectOptions}
      onChange={(v) => {
        // Coerce back to the option's original primitive type so we never
        // widen `number`/`boolean`/`null` options to strings on write.
        const original = field.options.find((o) => String(o.value) === v);
        onChange(original?.value ?? v);
      }}
    />
  );
};

const renderCustom: FieldRenderer<unknown> = ({ name, value, field, onChange }) => {
  if (field.type !== "custom") {
    return <InspectorFieldRenderer name={name} field={field} value={value} onChange={onChange} />;
  }
  // Requirements 7.2, 7.3, 7.4 — delegate to the block's own render
  // function so existing custom fields in `lib/page-builder/config.ts`
  // (colour pickers, pin map editors, image upload fields, …) keep working
  // without modification.
  return (
    <div style={{ marginBottom: 12 }}>
      {field.render({
        field: field as never,
        name,
        id: `ora-field-${name}`,
        value,
        onChange: (v: unknown) => onChange(v),
      } as never)}
    </div>
  );
};

/**
 * Fallback that routes through `InspectorFieldRenderer`. Used for field
 * types the registry does not yet own a dedicated ORA control for
 * (`array`, `object`, `external`, `slot`, `richtext`). Until dedicated ORA
 * controls ship (tasks 4.x and 7.x), these types either hit an ORA
 * primitive inside InspectorFieldRenderer or its built-in "not yet
 * supported" placeholder — identical behaviour to pre-registry.
 */
const renderViaInspector: FieldRenderer<unknown> = ({ name, value, field, onChange }) => (
  <InspectorFieldRenderer name={name} field={field} value={value} onChange={onChange} />
);

export const defaultFieldRendererMap: FieldRendererMap = {
  text: renderText,
  textarea: renderTextarea,
  number: renderNumber,
  select: renderSelectOrRadio,
  radio: renderSelectOrRadio,
  array: renderViaInspector, // TODO: OraArrayControl
  object: renderViaInspector, // TODO: OraObjectControl
  external: renderViaInspector, // TODO: OraExternalControl
  slot: renderViaInspector,
  richtext: renderViaInspector, // TODO: integrate InlineToolbar (task 7)
  custom: renderCustom,
};

// ---------------------------------------------------------------------------
// Context + provider
// ---------------------------------------------------------------------------

/**
 * Context holding the active (potentially overridden) registry. The default
 * value is the full default map, so consumers that render
 * `<FieldControlRegistry>` without mounting a provider still get the full
 * registry — the provider is for overrides, not for availability.
 */
const FieldControlRegistryContext = React.createContext<FieldRendererMap>(
  defaultFieldRendererMap,
);
FieldControlRegistryContext.displayName = "FieldControlRegistryContext";

export interface FieldControlRegistryProviderProps {
  /**
   * Partial override map merged over the defaults. Pass only the field
   * types you want to replace — all other types continue to use the
   * default renderer. Nested providers merge onto the outer scope (the
   * nearer provider wins for any type it specifies).
   */
  overrides?: Partial<FieldRendererMap>;
  children: React.ReactNode;
}

/**
 * Wrap any subtree to override one or more field renderers. Task 8.1
 * wraps `BuilderShell` with this provider; slice 3's
 * `BreakpointAwareFieldWrapper` uses it to decorate spacing/sizing field
 * renderers without mutating the default map.
 */
export function FieldControlRegistryProvider({
  overrides,
  children,
}: FieldControlRegistryProviderProps) {
  const outer = React.useContext(FieldControlRegistryContext);
  const merged = React.useMemo<FieldRendererMap>(() => {
    if (!overrides) return outer;
    return { ...outer, ...overrides };
  }, [outer, overrides]);
  return (
    <FieldControlRegistryContext.Provider value={merged}>
      {children}
    </FieldControlRegistryContext.Provider>
  );
}

/**
 * Hook — returns the merged registry map visible to the calling component.
 * When no provider is mounted, returns `defaultFieldRendererMap`.
 */
export function useFieldControlRegistry(): FieldRendererMap {
  return React.useContext(FieldControlRegistryContext);
}

// ---------------------------------------------------------------------------
// Dispatcher component
// ---------------------------------------------------------------------------

export interface FieldControlRegistryProps {
  name: string;
  field: Field;
  value: unknown;
  onChange: (next: unknown) => void;
}

/**
 * Dispatcher — looks up the renderer for `field.type` in the active
 * registry and invokes it. This is the component callers use (e.g. the
 * ConfigurationPanel) so field rendering is driven by the registry rather
 * than a hardcoded switch in every panel.
 */
export function FieldControlRegistry({
  name,
  field,
  value,
  onChange,
}: FieldControlRegistryProps) {
  const registry = useFieldControlRegistry();
  const base =
    (registry[field.type as PuckFieldType] as FieldRenderer | undefined) ??
    renderViaInspector;
  // Slice 3 (task 11.2): when the field's *name* is in
  // BREAKPOINT_AWARE_FIELDS, decorate the base renderer so the value is
  // resolved/written through the active breakpoint slot. Content fields
  // (text, content, href, src, alt, label) are never in the registry, so
  // they remain scalar (Req 11.5).
  const renderer = BREAKPOINT_AWARE_FIELDS.has(name)
    ? withBreakpointAwareness(base)
    : base;
  return renderer({ name, field, value, onChange });
}
