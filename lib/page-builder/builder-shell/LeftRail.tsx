"use client";

/**
 * LeftRail — Page Mode outline (Phase 6). Slide Mode navigator lands in Phase 7.
 */

import React from "react";
import { usePuck } from "@puckeditor/core";
import { ORA_THEME } from "./inspector/tokens";

export function LeftRail() {
  const { appState, dispatch, getItemById } = usePuck();
  const content = appState.data.content ?? [];

  const handleSelect = (index: number) => {
    dispatch({
      type: "setUi",
      ui: {
        itemSelector: { index, zone: "default-zone" },
      },
    });
  };

  const selectedId =
    appState.ui.itemSelector?.zone === "default-zone"
      ? content[appState.ui.itemSelector.index]?.props.id
      : undefined;

  return (
    <aside
      data-testid="ora-left-rail"
      style={{
        gridColumn: "1",
        gridRow: "2",
        background: ORA_THEME.white,
        borderRight: `1px solid ${ORA_THEME.border}`,
        overflowY: "auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: ORA_THEME.muted,
          borderBottom: `1px solid ${ORA_THEME.border}`,
        }}
      >
        Outline
      </div>
      {content.length === 0 ? (
        <div style={{ padding: 12, fontSize: 12, color: ORA_THEME.muted }}>
          Drag a component onto the canvas to begin.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {content.map((item, index) => {
            const isActive = item.props.id === selectedId;
            const data = getItemById(item.props.id as string);
            const label = (data?.props as { _label?: string })?._label ?? item.type;
            return (
              <li key={String(item.props.id ?? index)}>
                <button
                  type="button"
                  onClick={() => handleSelect(index)}
                  aria-current={isActive ? "true" : undefined}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    border: "none",
                    background: isActive ? ORA_THEME.cream : "transparent",
                    color: ORA_THEME.charcoal,
                    cursor: "pointer",
                    fontSize: 13,
                    borderLeft: isActive
                      ? `2px solid ${ORA_THEME.gold}`
                      : "2px solid transparent",
                  }}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
