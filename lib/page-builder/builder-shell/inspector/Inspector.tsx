"use client";

/**
 * Inspector — right rail of the BuilderShell.
 *
 * Reads `usePuck()` for the currently selected component, then renders its
 * Puck Field definitions through `InspectorFieldRenderer`, grouped into
 * Content / Style / Layout / Advanced sections. Section open/closed state
 * persists per session in `sessionStorage`.
 */

import React from "react";
import { usePuck } from "@puckeditor/core";
import type { Field } from "@puckeditor/core";
import { InspectorFieldRenderer } from "./InspectorFieldRenderer";
import { classifyField, INSPECTOR_SECTIONS, type InspectorSection } from "./sections";
import { ORA_THEME } from "./tokens";

const SECTION_STATE_KEY = "ora.inspector.sections";

function readSectionState(): Record<InspectorSection, boolean> {
  const defaults: Record<InspectorSection, boolean> = {
    Content: true,
    Style: true,
    Layout: true,
    Advanced: false,
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.sessionStorage.getItem(SECTION_STATE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<InspectorSection, boolean>>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function writeSectionState(state: Record<InspectorSection, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SECTION_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function Inspector() {
  const { selectedItem, config, dispatch, getSelectorForId } = usePuck();
  const [sectionOpen, setSectionOpen] = React.useState(readSectionState);

  const toggleSection = (section: InspectorSection) => {
    setSectionOpen((prev) => {
      const next = { ...prev, [section]: !prev[section] };
      writeSectionState(next);
      return next;
    });
  };

  if (!selectedItem) {
    return (
      <aside style={panelStyle} data-testid="ora-inspector">
        <Header label="Document" />
        <div style={{ padding: 12, fontSize: 12, color: ORA_THEME.muted }}>
          Select a component on the canvas to edit its properties.
        </div>
      </aside>
    );
  }

  const componentType = selectedItem.type;
  const componentConfig = config.components?.[componentType];
  const fields = componentConfig?.fields as
    | Record<string, Field>
    | undefined;
  const props = (selectedItem.props ?? {}) as Record<string, unknown>;

  const grouped: Record<InspectorSection, Array<[string, Field]>> = {
    Content: [],
    Style: [],
    Layout: [],
    Advanced: [],
  };

  if (fields) {
    for (const [name, field] of Object.entries(fields)) {
      if (name === "id") continue;
      if (!field) continue;
      if (field.visible === false) continue;
      grouped[classifyField(name)].push([name, field]);
    }
  }

  const updateProp = (propName: string, value: unknown) => {
    const selector = getSelectorForId(selectedItem.props.id as string);
    if (!selector) return;
    dispatch({
      type: "replace",
      destinationZone: selector.zone,
      destinationIndex: selector.index,
      data: {
        ...selectedItem,
        props: { ...selectedItem.props, [propName]: value },
      },
    });
  };

  return (
    <aside style={panelStyle} data-testid="ora-inspector">
      <Header
        label={componentType}
        sub={String(selectedItem.props.id ?? "")}
      />
      <div style={{ overflowY: "auto", flex: 1 }}>
        {INSPECTOR_SECTIONS.map((section) => {
          const items = grouped[section];
          if (items.length === 0) return null;
          const open = sectionOpen[section];
          return (
            <div key={section} style={{ borderBottom: `1px solid ${ORA_THEME.border}` }}>
              <button
                type="button"
                onClick={() => toggleSection(section)}
                aria-expanded={open}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: ORA_THEME.creamLight,
                  border: "none",
                  borderRadius: 0,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  color: ORA_THEME.charcoal,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                <span>{section}</span>
                <span aria-hidden style={{ color: ORA_THEME.muted }}>
                  {open ? "−" : "+"}
                </span>
              </button>
              {open ? (
                <div style={{ padding: 12 }}>
                  {items.map(([name, field]) => (
                    <InspectorFieldRenderer
                      key={name}
                      name={name}
                      field={field}
                      value={props[name]}
                      onChange={(v) => updateProp(name, v)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Header({ label, sub }: { label: string; sub?: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderBottom: `1px solid ${ORA_THEME.border}`,
        background: ORA_THEME.white,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: ORA_THEME.charcoal }}>
        {label}
      </div>
      {sub ? (
        <div style={{ fontSize: 11, color: ORA_THEME.muted, fontFamily: "monospace" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  height: "100%",
  background: ORA_THEME.white,
  borderLeft: `1px solid ${ORA_THEME.border}`,
  display: "flex",
  flexDirection: "column",
  fontFamily: "system-ui, sans-serif",
};
