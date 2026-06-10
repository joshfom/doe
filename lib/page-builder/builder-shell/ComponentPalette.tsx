"use client";

/**
 * ComponentPalette — ORA-themed component palette (Slice 1 / task 5.1).
 *
 * Reads `categories` and `components` from the Puck config via `usePuck()`
 * and lists every registered block grouped by category with:
 *   - an ORA-themed lucide icon (from the shared `palette-meta` module)
 *   - the block's human label (from `components[name].label`, falling back
 *     to the component key)
 *   - a short description (from the shared `palette-meta` module, which is
 *     also consumed by the canvas component picker so the two surfaces stay
 *     in sync — see Req 5.1, 5.2 and design §5)
 *
 * Search is a case-insensitive substring match over label + description. When
 * search is active, categories with zero matches collapse away, so editors see
 * only what they can drop.
 *
 * Drag protocol: each item is wrapped in Puck's `Drawer.Item` so the Puck
 * engine receives the native drop event unchanged (Req 2.5).
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.1, 5.2_
 */

import React from "react";
import { Drawer } from "@puckeditor/core";
import { usePuckStore } from "../use-puck-store";
import {
  Search as SearchIcon,
  LayoutTemplate,
  Library,
} from "lucide-react";
import { ORA_THEME } from "./inspector/tokens";
import {
  PALETTE_META,
  FALLBACK_META,
  CATEGORY_ORDER,
  matchesQuery,
} from "./palette-meta";

// ─── Types mirroring Puck config shape (narrow subset we use) ────────────────

type PaletteCategory = {
  title?: string;
  components?: string[];
};

type PaletteComponent = {
  label?: string;
};

// ─── Component ───────────────────────────────────────────────────────────────

export interface ComponentPaletteProps {
  /** Opens the Template Library sheet. */
  onOpenTemplates?: () => void;
  /** Opens the Component Library sheet. */
  onOpenComponentLibrary?: () => void;
}

export function ComponentPalette({
  onOpenTemplates,
  onOpenComponentLibrary,
}: ComponentPaletteProps = {}) {
  const config = usePuckStore((s) => s.config);
  const [query, setQuery] = React.useState("");

  const categories = React.useMemo(
    () => (config.categories ?? {}) as Record<string, PaletteCategory>,
    [config.categories],
  );
  const components = React.useMemo(
    () => (config.components ?? {}) as Record<string, PaletteComponent>,
    [config.components],
  );
  const allComponents = React.useMemo(() => Object.keys(components), [components]);

  // Build categorized groups with an "Other" bucket for any leftover
  // components not referenced by a category definition (Req 2.1 — every
  // registered block must appear).
  const groups = React.useMemo(() => {
    const result: Array<{ key: string; title: string; items: string[] }> = [];
    const used = new Set<string>();

    // 1. Render categories in the fixed order first.
    for (const key of CATEGORY_ORDER) {
      const cat = categories[key];
      if (!cat) continue;
      const items = (cat.components ?? []).filter((name) =>
        allComponents.includes(name),
      );
      items.forEach((name) => used.add(name));
      if (items.length > 0) {
        result.push({ key, title: cat.title ?? key, items });
      }
    }

    // 2. Render any additional categories not in the fixed order.
    for (const [key, cat] of Object.entries(categories)) {
      if ((CATEGORY_ORDER as readonly string[]).includes(key)) continue;
      const items = (cat.components ?? []).filter((name) =>
        allComponents.includes(name),
      );
      items.forEach((name) => used.add(name));
      if (items.length > 0) {
        result.push({ key, title: cat.title ?? key, items });
      }
    }

    // 3. "Other" fallback for unregistered components (Req 1.8).
    const leftover = allComponents.filter((name) => !used.has(name));
    if (leftover.length > 0) {
      result.push({ key: "other", title: "Other", items: leftover });
    }
    return result;
  }, [categories, allComponents]);

  // Filter groups by the current search query. A group is rendered only if at
  // least one of its items matches (Req 2.4).
  const filteredGroups = React.useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((name) => {
          const meta = PALETTE_META[name] ?? FALLBACK_META;
          const label = components[name]?.label ?? name;
          return matchesQuery(label, meta.description, query);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, components, query]);

  const trimmedQuery = query.trim();
  const hasResults = filteredGroups.length > 0;

  return (
    <div
      data-testid="ora-component-palette"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: ORA_THEME.creamLight,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Header + search */}
      <div
        style={{
          padding: "10px 12px 8px",
          borderBottom: `1px solid ${ORA_THEME.border}`,
          background: ORA_THEME.white,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: ORA_THEME.muted,
            marginBottom: 8,
          }}
        >
          Components
        </div>
        <label
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
          }}
        >
          <span
            // Visually hidden but readable by screen readers (Req 18.1, 18.2).
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          >
            Search components
          </span>
          <SearchIcon
            size={14}
            color={ORA_THEME.muted}
            style={{
              position: "absolute",
              left: 8,
              pointerEvents: "none",
            }}
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search components"
            aria-label="Search components"
            style={{
              width: "100%",
              minHeight: 30,
              padding: "4px 8px 4px 26px",
              border: `1px solid ${ORA_THEME.border}`,
              borderRadius: 4,
              background: ORA_THEME.white,
              color: ORA_THEME.charcoal,
              fontSize: 12,
              outline: "none",
            }}
          />
        </label>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "4px 0 12px",
        }}
      >
        {!hasResults ? (
          <div
            role="status"
            style={{
              padding: 12,
              fontSize: 12,
              color: ORA_THEME.muted,
            }}
          >
            {trimmedQuery
              ? `No components match "${trimmedQuery}".`
              : "No components registered."}
          </div>
        ) : (
          <Drawer>
            {filteredGroups.map((group) => (
              <section
                key={group.key}
                aria-label={group.title}
                style={{ marginBottom: 6 }}
              >
                <h3
                  style={{
                    margin: 0,
                    padding: "8px 12px 4px",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: ORA_THEME.muted,
                  }}
                >
                  {group.title}
                </h3>
                {group.items.map((name) => {
                  const meta = PALETTE_META[name] ?? FALLBACK_META;
                  const label = components[name]?.label ?? name;
                  const Icon = meta.Icon;
                  return (
                    <Drawer.Item key={name} name={name}>
                      {() => (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            padding: "8px 12px",
                            background: ORA_THEME.white,
                            borderTop: `1px solid ${ORA_THEME.border}`,
                            cursor: "grab",
                            color: ORA_THEME.charcoal,
                          }}
                        >
                          <span
                            style={{
                              flex: "0 0 auto",
                              width: 28,
                              height: 28,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: ORA_THEME.cream,
                              border: `1px solid ${ORA_THEME.border}`,
                              borderRadius: 4,
                              color: ORA_THEME.gold,
                            }}
                            aria-hidden="true"
                          >
                            <Icon size={16} strokeWidth={1.75} />
                          </span>
                          <span
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: ORA_THEME.charcoal,
                              }}
                            >
                              {label}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                lineHeight: 1.35,
                                color: ORA_THEME.muted,
                              }}
                            >
                              {meta.description}
                            </span>
                          </span>
                        </div>
                      )}
                    </Drawer.Item>
                  );
                })}
              </section>
            ))}
          </Drawer>
        )}
      </div>

      {/* Library trigger buttons */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: `1px solid ${ORA_THEME.border}`,
          background: ORA_THEME.white,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <button
          type="button"
          onClick={onOpenTemplates}
          data-testid="palette-open-templates"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "8px 10px",
            border: `1px solid ${ORA_THEME.border}`,
            borderRadius: 4,
            background: ORA_THEME.creamLight,
            color: ORA_THEME.charcoal,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <LayoutTemplate size={16} strokeWidth={1.75} aria-hidden="true" />
          Templates
        </button>
        <button
          type="button"
          onClick={onOpenComponentLibrary}
          data-testid="palette-open-component-library"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "8px 10px",
            border: `1px solid ${ORA_THEME.border}`,
            borderRadius: 4,
            background: ORA_THEME.creamLight,
            color: ORA_THEME.charcoal,
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <Library size={16} strokeWidth={1.75} aria-hidden="true" />
          Component Library
        </button>
      </div>
    </div>
  );
}
