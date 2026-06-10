/**
 * Tracking fields for any Puck component — per-section event tracking configuration.
 * Allows content editors to attach analytics event tracking to any component
 * without writing code.
 */

import React from "react";
import type { CSSProperties } from "react";
import { EVENT_VOCABULARY } from "./events";
import {
  getCustomEventNames,
  subscribeCustomEvents,
} from "./custom-events-store";

const C = { bg: "#F9F7F5", border: "#E8E4DF", text: "#2C2C2C", muted: "#9A9A9A", inactive: "#F5F3F0", inactiveText: "#6B6B6B", active: "#2C2C2C", activeText: "#FFF" };
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const labelStyle: CSSProperties = { fontSize: 11, color: C.muted, minWidth: 55, flexShrink: 0 };
const selectStyle: CSSProperties = {
  height: 28, border: `1px solid ${C.border}`, borderRadius: 0, fontSize: 12,
  color: C.text, background: "#FFF", outline: "none", boxSizing: "border-box",
  flex: 1, padding: "0 20px 0 6px", appearance: "none", WebkitAppearance: "none", cursor: "pointer",
};

interface P { value: unknown; onChange: (v: unknown) => void; readOnly?: boolean; }

function sel(p: P, label: string, opts: { l: string; v: string; disabled?: boolean }[]) {
  const cur = (p.value as string) || opts[0]?.v || "";
  return React.createElement("div", { style: rowStyle },
    React.createElement("span", { style: labelStyle }, label),
    React.createElement("div", { style: { position: "relative", flex: 1 } },
      React.createElement("select", {
        value: cur,
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => p.onChange(e.target.value),
        disabled: p.readOnly,
        style: selectStyle,
      },
        ...opts.map(o => React.createElement("option", { key: o.v, value: o.v, disabled: o.disabled }, o.l))
      ),
      React.createElement("span", { style: { position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", fontSize: 9, color: C.muted } }, "▾"),
    ),
  );
}

function toggle(p: P, label: string) {
  const checked = Boolean(p.value);
  return React.createElement("div", { style: rowStyle },
    React.createElement("span", { style: labelStyle }, label),
    React.createElement("button", {
      type: "button",
      onClick: () => p.onChange(!checked),
      disabled: p.readOnly,
      style: {
        width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
        background: checked ? C.active : C.inactive,
        position: "relative", transition: "background 0.2s",
      },
    },
      React.createElement("span", {
        style: {
          position: "absolute", top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: 8,
          background: checked ? C.activeText : C.inactiveText,
          transition: "left 0.2s",
        },
      }),
    ),
  );
}

function numberInput(p: P, label: string, placeholder: string) {
  const cur = p.value != null ? String(p.value) : "";
  return React.createElement("div", { style: rowStyle },
    React.createElement("span", { style: labelStyle }, label),
    React.createElement("input", {
      type: "number",
      value: cur,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        p.onChange(val === "" ? undefined : Number(val));
      },
      disabled: p.readOnly,
      placeholder,
      style: {
        ...selectStyle,
        padding: "0 6px",
        appearance: "auto" as CSSProperties["appearance"],
        WebkitAppearance: "auto" as CSSProperties["appearance"],
      },
    }),
  );
}

/** Key/value editor supporting up to 10 entries */
function keyValueEditor(p: P) {
  const entries = (p.value as Record<string, string>) ?? {};
  const pairs = Object.entries(entries);
  const canAdd = pairs.length < 10;

  const update = (newEntries: Record<string, string>) => p.onChange(newEntries);

  const addEntry = () => {
    if (!canAdd) return;
    const newKey = `key_${pairs.length + 1}`;
    update({ ...entries, [newKey]: "" });
  };

  const removeEntry = (key: string) => {
    const next = { ...entries };
    delete next[key];
    update(next);
  };

  const updateKey = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(entries)) {
      next[k === oldKey ? newKey : k] = v;
    }
    update(next);
  };

  const updateValue = (key: string, newValue: string) => {
    update({ ...entries, [key]: newValue });
  };

  const inputStyle: CSSProperties = {
    height: 26, border: `1px solid ${C.border}`, borderRadius: 0, fontSize: 11,
    color: C.text, background: "#FFF", outline: "none", padding: "0 6px", flex: 1,
  };

  return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
    React.createElement("div", { style: { ...rowStyle, justifyContent: "space-between" } },
      React.createElement("span", { style: { fontSize: 11, color: C.muted } }, "Event Properties"),
      React.createElement("span", { style: { fontSize: 10, color: C.muted } }, `${pairs.length}/10`),
    ),
    ...pairs.map(([key, value]) =>
      React.createElement("div", { key, style: { display: "flex", gap: 4, alignItems: "center" } },
        React.createElement("input", {
          type: "text",
          value: key,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => updateKey(key, e.target.value.slice(0, 40)),
          placeholder: "key",
          maxLength: 40,
          disabled: p.readOnly,
          style: inputStyle,
        }),
        React.createElement("input", {
          type: "text",
          value: value,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => updateValue(key, e.target.value.slice(0, 200)),
          placeholder: "value",
          maxLength: 200,
          disabled: p.readOnly,
          style: inputStyle,
        }),
        !p.readOnly && React.createElement("button", {
          type: "button",
          onClick: () => removeEntry(key),
          style: { width: 20, height: 20, border: "none", background: "none", cursor: "pointer", fontSize: 12, color: C.muted },
        }, "✕"),
      ),
    ),
    canAdd && !p.readOnly && React.createElement("button", {
      type: "button",
      onClick: addEntry,
      style: {
        height: 26, border: `1px dashed ${C.border}`, background: C.bg,
        cursor: "pointer", fontSize: 11, color: C.muted,
      },
    }, "+ Add property"),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRACKING FIELDS
// ═══════════════════════════════════════════════════════════════════════════════

const coreEventOptions = EVENT_VOCABULARY.map((name) => ({ l: name, v: name }));

/**
 * React component that renders the event-name dropdown with both the
 * locked core vocabulary and admin-managed custom events. Subscribes to
 * the custom-events store so the list refreshes when events are added.
 */
function EventNameSelect(p: P) {
  const [customNames, setCustomNames] = React.useState<readonly string[]>(
    () => getCustomEventNames(),
  );

  React.useEffect(() => {
    return subscribeCustomEvents(() => {
      setCustomNames(getCustomEventNames());
    });
  }, []);

  const options = [
    { l: "— Select event —", v: "" },
    ...coreEventOptions,
    ...(customNames.length > 0
      ? [
          { l: "── Custom events ──", v: "__divider__", disabled: true },
          ...customNames.map((name) => ({ l: name, v: name })),
        ]
      : []),
  ];

  return sel(p, "Event", options);
}

const visibilityOptions = [
  { l: "— Not set —", v: "" },
  { l: "10%", v: "10" },
  { l: "20%", v: "20" },
  { l: "30%", v: "30" },
  { l: "40%", v: "40" },
  { l: "50%", v: "50" },
  { l: "60%", v: "60" },
  { l: "70%", v: "70" },
  { l: "80%", v: "80" },
  { l: "90%", v: "90" },
  { l: "100%", v: "100" },
];

export const trackingFields = {
  _tracking: {
    type: "object" as const,
    label: "Tracking",
    objectFields: {
      _trackAsEvent: {
        type: "custom" as const,
        label: "Track as Event",
        render: (p: P) => toggle(p, "Track"),
      },
      _eventName: {
        type: "custom" as const,
        label: "Event Name",
        render: (p: P) => React.createElement(EventNameSelect, p),
      },
      _eventProperties: {
        type: "custom" as const,
        label: "Event Properties",
        render: (p: P) => keyValueEditor(p),
      },
      _conversionValue: {
        type: "custom" as const,
        label: "Conversion Value (AED)",
        render: (p: P) => numberInput(p, "Value", "e.g. 1500"),
      },
      _visibilityThreshold: {
        type: "custom" as const,
        label: "Visibility Threshold",
        render: (p: P) => sel(p, "Visible", visibilityOptions),
      },
      _replayUnmask: {
        type: "custom" as const,
        label: "Unmask in Replay",
        render: (p: P) => toggle(p, "Unmask"),
      },
    },
  },
};

export const trackingDefaults = {
  _tracking: {
    _trackAsEvent: false,
    _eventName: "",
    _eventProperties: {},
    _conversionValue: undefined,
    _visibilityThreshold: "",
    _replayUnmask: false,
  },
};
