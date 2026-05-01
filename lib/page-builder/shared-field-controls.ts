import React from "react";
import type { CSSProperties } from "react";

export interface FieldRenderProps {
  value: unknown;
  onChange: (value: string) => void;
  readOnly?: boolean;
  field?: unknown;
  name?: string;
  id?: string;
}

export interface SelectOption {
  label: string;
  value: string;
}

export const CONTROL_COLORS = {
  bg: "#FFFFFF",
  bgMuted: "#F9F7F5",
  border: "#E8E4DF",
  text: "#2C2C2C",
  muted: "#6B6B6B",
  active: "#1A73E8",
  activeBg: "#EEF4FF",
  inactiveBg: "#F5F3F0",
};

const inputStyle: CSSProperties = {
  minHeight: 36,
  border: `1px solid ${CONTROL_COLORS.border}`,
  padding: "0 10px",
  fontSize: 12,
  color: CONTROL_COLORS.text,
  background: CONTROL_COLORS.bg,
  boxSizing: "border-box",
};

export function renderFieldTitle(title: string, description?: string) {
  return React.createElement("div", {
    style: { display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 },
  },
    React.createElement("div", { style: { fontSize: 12, fontWeight: 600, color: CONTROL_COLORS.text } }, title),
    description
      ? React.createElement("div", { style: { fontSize: 11, color: CONTROL_COLORS.muted } }, description)
      : null,
  );
}

function CustomSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  const { value, onChange, options, placeholder } = props;
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  React.useEffect(() => {
    if (!open) return;

    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return React.createElement("div", { ref: rootRef, style: { position: "relative" } },
    React.createElement("button", {
      type: "button",
      onClick: () => setOpen((current) => !current),
      style: {
        width: "100%",
        minHeight: 36,
        border: `1px solid ${CONTROL_COLORS.border}`,
        background: CONTROL_COLORS.bg,
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 12,
        color: selected ? CONTROL_COLORS.text : CONTROL_COLORS.muted,
        cursor: "pointer",
      },
    },
      React.createElement("span", null, selected?.label ?? placeholder ?? "Select"),
      React.createElement("span", { style: { fontSize: 10, color: CONTROL_COLORS.muted } }, open ? "▴" : "▾"),
    ),
    open
      ? React.createElement("div", {
          style: {
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 20,
            border: `1px solid ${CONTROL_COLORS.border}`,
            background: CONTROL_COLORS.bg,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            maxHeight: 220,
            overflowY: "auto",
          },
        },
          ...options.map((option) => {
            const isActive = option.value === value;
            return React.createElement("button", {
              key: option.value,
              type: "button",
              onClick: () => {
                onChange(option.value);
                setOpen(false);
              },
              style: {
                width: "100%",
                border: "none",
                borderBottom: `1px solid ${CONTROL_COLORS.border}`,
                background: isActive ? CONTROL_COLORS.activeBg : CONTROL_COLORS.bg,
                color: isActive ? CONTROL_COLORS.active : CONTROL_COLORS.text,
                textAlign: "left",
                padding: "10px 12px",
                fontSize: 12,
                cursor: "pointer",
              },
            }, option.label);
          }),
        )
      : null,
  );
}

function toggleButtonStyle(isActive: boolean): CSSProperties {
  return {
    minHeight: 28,
    minWidth: 36,
    padding: "0 8px",
    border: `1px solid ${CONTROL_COLORS.border}`,
    fontSize: 12,
    fontWeight: isActive ? 600 : 400,
    cursor: "pointer",
    background: isActive ? "#2C2C2C" : CONTROL_COLORS.bg,
    color: isActive ? "#FFFFFF" : CONTROL_COLORS.muted,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -1,
    boxSizing: "border-box",
    lineHeight: 1,
  };
}

export function createCustomSelectField(
  title: string,
  options: SelectOption[],
  description?: string,
  placeholder?: string,
) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: FieldRenderProps) =>
      React.createElement("div", null,
        renderFieldTitle(title, description),
        React.createElement(CustomSelect, {
          value: (value as string) || "",
          onChange,
          options,
          placeholder,
        }),
      ),
  };
}

export function createToggleField(title: string, options: SelectOption[], description?: string) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: FieldRenderProps) => {
      const current = (value as string) || options[0]?.value || "";
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderFieldTitle(title, description),
        React.createElement("div", { style: { display: "flex", gap: 0, flexWrap: "wrap" } },
          ...options.map((option) =>
            React.createElement("button", {
              key: option.value,
              type: "button",
              onClick: () => onChange(option.value),
              style: toggleButtonStyle(current === option.value),
              title: option.label,
            }, option.label),
          ),
        ),
      );
    },
  };
}

export function createFreeInputField(
  title: string,
  suffix: string,
  presets: string[] = [],
  description?: string,
  placeholder?: string,
) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: FieldRenderProps) => {
      const current = (value as string) || "";
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderFieldTitle(title, description),
        React.createElement("div", { style: { display: "flex", gap: 0, width: "100%" } },
          React.createElement("input", {
            type: "text",
            value: current,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
            placeholder: placeholder ?? (suffix ? `e.g. 16${suffix}` : undefined),
            style: {
              ...inputStyle,
              flex: 1,
            },
          }),
          suffix
            ? React.createElement("span", {
                style: {
                  minWidth: 38,
                  minHeight: 36,
                  borderTop: `1px solid ${CONTROL_COLORS.border}`,
                  borderRight: `1px solid ${CONTROL_COLORS.border}`,
                  borderBottom: `1px solid ${CONTROL_COLORS.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  color: CONTROL_COLORS.muted,
                  background: CONTROL_COLORS.bgMuted,
                },
              }, suffix)
            : null,
        ),
        presets.length > 0
          ? React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
              ...presets.map((preset) =>
                React.createElement("button", {
                  key: preset,
                  type: "button",
                  onClick: () => onChange(preset),
                  style: {
                    border: `1px solid ${current === preset ? CONTROL_COLORS.active : CONTROL_COLORS.border}`,
                    background: current === preset ? CONTROL_COLORS.activeBg : CONTROL_COLORS.bg,
                    color: current === preset ? CONTROL_COLORS.active : CONTROL_COLORS.text,
                    padding: "4px 8px",
                    fontSize: 11,
                    cursor: "pointer",
                  },
                }, preset),
              ),
            )
          : null,
      );
    },
  };
}

export function createColorField(title: string, placeholder = "#000000", description?: string, presets?: string[]) {
  const presetValues = presets ?? [
    "#1A1A1A",
    "#2C2C2C",
    "#4A4A4A",
    "#6B6B6B",
    "#9A9A9A",
    "#FFFFFF",
    "#B8956B",
  ];
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: FieldRenderProps) => {
      const current = (value as string) || "";
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderFieldTitle(title, description),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
          React.createElement("input", {
            type: "color",
            value: current || "#000000",
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
            style: { width: 32, height: 32, border: `1px solid ${CONTROL_COLORS.border}`, padding: 0, cursor: "pointer", background: "none" },
          }),
          React.createElement("input", {
            type: "text",
            value: current,
            placeholder,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
            style: { ...inputStyle, flex: 1, minHeight: 36 },
          }),
        ),
        React.createElement("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" } },
          ...presetValues.map((hex) =>
            React.createElement("button", {
              key: hex,
              type: "button",
              onClick: () => onChange(hex),
              style: {
                width: 20,
                height: 20,
                background: hex,
                border: current === hex ? `2px solid #2C2C2C` : `1px solid ${CONTROL_COLORS.border}`,
                cursor: "pointer",
                padding: 0,
                boxSizing: "border-box",
              },
              title: hex,
            }),
          ),
        ),
      );
    },
  };
}

export function createSliderField(title: string, min: number, max: number, unit = "px", description?: string) {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: FieldRenderProps) => {
      const num = Number(value) || 0;
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderFieldTitle(title, description),
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: CONTROL_COLORS.muted } },
          React.createElement("span", null, `${min}${unit}`),
          React.createElement("span", null, `${max}${unit}`),
        ),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          React.createElement("input", {
            type: "range",
            min,
            max,
            value: num,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
            style: { flex: 1 },
          }),
          React.createElement("span", { style: { fontSize: 12, minWidth: 44, textAlign: "right" } }, `${num}${unit}`),
        ),
      );
    },
  };
}

export function createStepperField(title: string, step = 4, min = 0, description?: string, unit = "px") {
  return {
    type: "custom" as const,
    label: title,
    render: ({ value, onChange }: FieldRenderProps) => {
      const numeric = Number(value) || 0;
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        renderFieldTitle(title, description),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
          React.createElement("button", {
            type: "button",
            onClick: () => onChange(String(Math.max(min, numeric - step))),
            style: { width: 26, height: 26, border: `1px solid ${CONTROL_COLORS.border}`, background: CONTROL_COLORS.bgMuted, cursor: "pointer" },
          }, "−"),
          React.createElement("span", { style: { minWidth: 42, textAlign: "center", fontSize: 12 } }, `${numeric}${unit}`),
          React.createElement("button", {
            type: "button",
            onClick: () => onChange(String(numeric + step)),
            style: { width: 26, height: 26, border: `1px solid ${CONTROL_COLORS.border}`, background: CONTROL_COLORS.bgMuted, cursor: "pointer" },
          }, "+"),
        ),
      );
    },
  };
}

export function normalizeLength(value: unknown, defaultUnit = "px") {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (raw === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(raw)) return `${raw}${defaultUnit}`;
  return raw;
}
