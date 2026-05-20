"use client";

/**
 * ComponentLibrarySheet — browsable component library overlay.
 *
 * Spec: builder-template-component-library — task 5
 * Requirements: R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R3.8, R3.9, R3.10, R3.11, R5.4
 *
 * Design:
 *   - Uses `LibrarySheet` as the container (portal, focus trap, ESC close).
 *   - Reads components from `componentLibrary.list()`.
 *   - Toolbar: search input + category filter tabs ("All" | "Global" | "Content" | "My Components").
 *   - Renders cards in a responsive CSS Grid (auto-fill, minmax(280px, 1fr)).
 *   - Each card: thumbnail (16:9 aspect), name (truncated 60 chars), description (truncated 120 chars), category badge.
 *   - "Insert" button on each card.
 *   - Insert → regenerateIds() on component tree → dispatch Puck setData appending content + merging zones.
 *   - Close sheet after successful insertion.
 *   - Error message if insertion fails, preserves existing page content.
 *   - Empty state when no components match filter.
 *   - Search + category filter combine (both active simultaneously).
 */

import React, { useState, useCallback } from "react";
import { LibrarySheet } from "./LibrarySheet";
import { usePuckStore } from "../use-puck-store";
import { componentLibrary } from "../store";
import { regenerateIds } from "../templates/component-templates";
import { migratePageData } from "../migrate-data";
import type { LibraryComponent } from "../component-library/types";
import { ORA_THEME } from "./inspector/tokens";

export interface ComponentLibrarySheetProps {
  open: boolean;
  onClose: () => void;
}

type CategoryFilter = "all" | "global" | "content" | "my-components";

const CATEGORY_TABS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "global", label: "Global" },
  { id: "content", label: "Content" },
  { id: "my-components", label: "My Components" },
];

/** Truncate text to maxLen characters with ellipsis. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

export function ComponentLibrarySheet({ open, onClose }: ComponentLibrarySheetProps) {
  const dispatch = usePuckStore((s) => s.dispatch);
  const appState = usePuckStore((s) => s.appState);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const allComponents = React.useMemo(() => componentLibrary.list(), []);

  // Filter components by category and search query (combined)
  const filteredComponents = React.useMemo(() => {
    let filtered = allComponents;

    // Apply category filter
    if (activeCategory === "global") {
      filtered = filtered.filter((c) => c.category === "global");
    } else if (activeCategory === "content") {
      filtered = filtered.filter((c) => c.category === "content");
    } else if (activeCategory === "my-components") {
      filtered = filtered.filter((c) => c.scope === "user");
    }

    // Apply search filter (case-insensitive substring match on name + description)
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.description.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [allComponents, activeCategory, searchQuery]);

  const handleInsert = useCallback(
    (component: LibraryComponent) => {
      try {
        setError(null);

        const { content: newContent, zones: newZones } = regenerateIds({
          content: component.content,
          zones: component.zones,
        });

        const currentData = appState.data;
        // Migrate the merged data from legacy DropZone format to slot format
        // before dispatching, so Puck's internal processing doesn't crash.
        const mergedData = {
          ...currentData,
          content: [...(currentData.content ?? []), ...newContent],
          zones: { ...(currentData.zones ?? {}), ...newZones },
        };
        const migratedData = migratePageData(mergedData);
        dispatch({
          type: "setData",
          data: migratedData,
        });

        onClose();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to insert component. Please try again."
        );
      }
    },
    [dispatch, appState, onClose]
  );

  // Reset state when sheet closes
  React.useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setActiveCategory("all");
      setError(null);
    }
  }, [open]);

  return (
    <LibrarySheet open={open} onClose={onClose} title="Component Library">
      <div style={{ padding: 24 }}>
        {/* Error message */}
        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              background: "#FDF2F2",
              border: `1px solid ${ORA_THEME.danger}`,
              borderRadius: 6,
              color: ORA_THEME.danger,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {/* Toolbar: search + category filter */}
        <div style={{ marginBottom: 20 }}>
          {/* Search input */}
          <input
            type="search"
            placeholder="Search components…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search components"
            style={{
              width: "100%",
              padding: "10px 14px",
              fontSize: 14,
              fontFamily: "system-ui, sans-serif",
              border: `1px solid ${ORA_THEME.border}`,
              borderRadius: 6,
              background: ORA_THEME.white,
              color: ORA_THEME.charcoal,
              outline: "none",
              boxSizing: "border-box",
              marginBottom: 12,
            }}
          />

          {/* Category filter tabs */}
          <div
            role="tablist"
            aria-label="Filter by category"
            style={{
              display: "flex",
              gap: 4,
              borderBottom: `1px solid ${ORA_THEME.border}`,
              paddingBottom: 0,
            }}
          >
            {CATEGORY_TABS.map((tab) => {
              const isActive = activeCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="component-library-panel"
                  onClick={() => setActiveCategory(tab.id)}
                  style={{
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    fontFamily: "system-ui, sans-serif",
                    border: "none",
                    borderBottom: isActive
                      ? `2px solid ${ORA_THEME.gold}`
                      : "2px solid transparent",
                    background: "transparent",
                    color: isActive ? ORA_THEME.charcoal : ORA_THEME.muted,
                    cursor: "pointer",
                    marginBottom: -1,
                    transition: "color 150ms ease, border-color 150ms ease",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Component grid */}
        <div id="component-library-panel" role="tabpanel">
          {filteredComponents.length === 0 ? (
            <div
              role="status"
              style={{
                textAlign: "center",
                padding: "48px 24px",
                color: ORA_THEME.muted,
                fontSize: 14,
                fontFamily: "system-ui, sans-serif",
              }}
            >
              No components match the current filter.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 20,
              }}
            >
              {filteredComponents.map((component) => (
                <ComponentCard
                  key={component.id}
                  component={component}
                  onInsert={handleInsert}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </LibrarySheet>
  );
}

// ─── ComponentCard ───────────────────────────────────────────────────────────

interface ComponentCardProps {
  component: LibraryComponent;
  onInsert: (component: LibraryComponent) => void;
}

function ComponentCard({ component, onInsert }: ComponentCardProps) {
  const badgeColor = component.category === "global" ? "#01A7C7" : ORA_THEME.gold;
  const badgeLabel = component.category === "global" ? "Global" : "Content";

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${ORA_THEME.border}`,
        background: ORA_THEME.white,
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Thumbnail (16:9 aspect ratio) */}
      <div
        style={{
          width: "100%",
          paddingTop: "56.25%",
          position: "relative",
          background: ORA_THEME.cream,
          borderBottom: `1px solid ${ORA_THEME.border}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: ORA_THEME.muted,
            fontSize: 12,
            fontFamily: "system-ui, sans-serif",
          }}
          aria-hidden="true"
        >
          {component.thumbnail ? (
            <img
              src={component.thumbnail}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="6"
                y="6"
                width="36"
                height="36"
                rx="4"
                stroke={ORA_THEME.muted}
                strokeWidth="1.5"
                fill="none"
              />
              <rect
                x="12"
                y="12"
                width="10"
                height="10"
                rx="2"
                fill={ORA_THEME.gold}
                opacity="0.5"
              />
              <rect
                x="26"
                y="12"
                width="10"
                height="10"
                rx="2"
                fill={ORA_THEME.gold}
                opacity="0.3"
              />
              <rect
                x="12"
                y="26"
                width="24"
                height="10"
                rx="2"
                fill={ORA_THEME.gold}
                opacity="0.4"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Card body */}
      <div style={{ padding: "12px 16px 16px", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Category badge */}
        <span
          style={{
            display: "inline-block",
            alignSelf: "flex-start",
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "system-ui, sans-serif",
            borderRadius: 4,
            background: `${badgeColor}15`,
            color: badgeColor,
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.02em",
          }}
        >
          {badgeLabel}
        </span>

        {/* Name */}
        <h3
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: ORA_THEME.charcoal,
            fontFamily: "system-ui, sans-serif",
            lineHeight: 1.3,
          }}
        >
          {truncate(component.name, 60)}
        </h3>

        {/* Description */}
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 12,
            lineHeight: 1.4,
            color: ORA_THEME.muted,
            fontFamily: "system-ui, sans-serif",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            flex: 1,
          }}
        >
          {truncate(component.description, 120)}
        </p>

        {/* Insert button */}
        <button
          type="button"
          onClick={() => onInsert(component)}
          aria-label={`Insert ${component.name}`}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "system-ui, sans-serif",
            border: `1px solid ${ORA_THEME.gold}`,
            borderRadius: 6,
            background: ORA_THEME.white,
            color: ORA_THEME.gold,
            cursor: "pointer",
            transition: "background 150ms ease, color 150ms ease",
          }}
        >
          Insert
        </button>
      </div>
    </div>
  );
}
