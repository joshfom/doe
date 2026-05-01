"use client";

/**
 * ComponentsDrawer — bottom-half of the LeftRail, lists all registered
 * components grouped by category. Each item is a Puck `Drawer.Item` so it
 * can be dragged onto the canvas.
 */

import React from "react";
import { Drawer, usePuck } from "@puckeditor/core";
import { ORA_THEME } from "./inspector/tokens";

type Category = {
  title: string;
  components: string[];
};

export function ComponentsDrawer() {
  const { config } = usePuck();
  const categories = (config.categories ?? {}) as Record<string, Category>;
  const allComponents = Object.keys(config.components ?? {});

  // Build category groups, with an Uncategorized bucket for any leftover.
  const grouped = React.useMemo(() => {
    const result: Array<[string, string[]]> = [];
    const used = new Set<string>();
    for (const [key, cat] of Object.entries(categories)) {
      const items = (cat.components ?? []).filter((c) => allComponents.includes(c));
      items.forEach((c) => used.add(c));
      if (items.length > 0) result.push([cat.title ?? key, items]);
    }
    const leftover = allComponents.filter((c) => !used.has(c));
    if (leftover.length > 0) result.push(["Other", leftover]);
    return result;
  }, [categories, allComponents]);

  return (
    <div
      style={{
        borderTop: `1px solid ${ORA_THEME.border}`,
        background: ORA_THEME.creamLight,
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
        }}
      >
        Components
      </div>
      <Drawer>
        {grouped.map(([title, items]) => (
          <div key={title} style={{ marginBottom: 8 }}>
            <div
              style={{
                padding: "4px 12px",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: ORA_THEME.muted,
              }}
            >
              {title}
            </div>
            {items.map((name) => (
              <Drawer.Item key={name} name={name}>
                {() => (
                  <div
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      color: ORA_THEME.charcoal,
                      background: ORA_THEME.white,
                      borderTop: `1px solid ${ORA_THEME.border}`,
                      cursor: "grab",
                    }}
                  >
                    {name}
                  </div>
                )}
              </Drawer.Item>
            ))}
          </div>
        ))}
      </Drawer>
    </div>
  );
}
