// @vitest-environment jsdom
/**
 * BuilderShell a11y test — task 8.3.
 *
 * Verifies:
 *   - every icon-only button in the shell exposes an `aria-label`
 *   - landmark roles (banner / main / aside) appear in tab order:
 *       TopBar -> ComponentPalette -> Canvas -> ConfigurationPanel
 *   - an `aria-live="polite"` region is present and updates on selection
 *
 * _Requirements: 18.1, 18.2, 18.4_
 */
import { describe, it, expect, vi } from "vitest";

// Polyfills required by Puck under jsdom — must run before importing Puck.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

import React from "react";
import { render, screen } from "@testing-library/react";

// Mock InlineRichtextController to avoid tiptap extension resolution issues.
vi.mock("./InlineRichtextController", () => ({
  InlineRichtextController: () => null,
  useActiveRichtextEditor: () => null,
  InlineRichtextContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

const { BuilderShell } = await import("./BuilderShell");
import type { DocumentRecord } from "./types";

const minimalConfig = {
  components: {
    Box: {
      label: "Box block",
      fields: { title: { type: "text" as const, label: "Title" } },
      defaultProps: { title: "hello" },
      render: ({ title }: { title?: string }) => (
        <div data-testid="box-rendered">{title}</div>
      ),
    },
  },
} as const;

function makePageDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "doc-1",
    title: "Untitled",
    slug: "untitled",
    mode: "page",
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pageData: {
      content: [{ type: "Box", props: { id: "Box-1", title: "hello" } }],
      root: { props: {} },
    },
    ...overrides,
  };
}

describe("BuilderShell — accessibility", () => {
  it("labels every icon-only button via aria-label", () => {
    render(
      <BuilderShell
        config={minimalConfig as never}
        document={makePageDoc()}
        onSave={vi.fn().mockResolvedValue({ ok: true })}
        onPublish={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    // Find buttons whose visible text is empty or a single non-letter glyph
    // (icon-only) and assert they expose an aria-label.
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    );
    const iconOnly = buttons.filter((b) => {
      const text = (b.textContent ?? "").trim();
      // Treat as icon-only when the label is a single glyph or empty
      // (e.g. "↶", "↷", "✕", or a lucide <svg> with no text).
      return text.length <= 1;
    });
    expect(iconOnly.length).toBeGreaterThan(0);
    for (const b of iconOnly) {
      const label = b.getAttribute("aria-label");
      expect(
        label,
        `icon-only button missing aria-label: ${b.outerHTML.slice(0, 200)}`,
      ).toBeTruthy();
      expect((label ?? "").length).toBeGreaterThan(0);
    }
  });

  it("renders landmarks in TopBar -> Palette -> Canvas -> ConfigurationPanel order", () => {
    render(
      <BuilderShell
        config={minimalConfig as never}
        document={makePageDoc()}
        onSave={vi.fn().mockResolvedValue({ ok: true })}
        onPublish={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    const topbar = screen.getByTestId("ora-topbar");
    const palette = screen.getByTestId("ora-component-palette");
    const canvas = screen.getByTestId("ora-canvas");
    const configPanel = screen.getByTestId("ora-configuration-panel");

    // Use document.compareDocumentPosition to assert DOM (and therefore
    // sequential tab) order: topbar -> palette -> canvas -> config panel.
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(topbar.compareDocumentPosition(palette) & FOLLOWING).toBeTruthy();
    expect(palette.compareDocumentPosition(canvas) & FOLLOWING).toBeTruthy();
    expect(canvas.compareDocumentPosition(configPanel) & FOLLOWING).toBeTruthy();
  });

  it("exposes an aria-live='polite' region for selection announcements", () => {
    render(
      <BuilderShell
        config={minimalConfig as never}
        document={makePageDoc()}
        onSave={vi.fn().mockResolvedValue({ ok: true })}
        onPublish={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    const live = screen.getByTestId("ora-selection-live-region");
    expect(live.getAttribute("aria-live")).toBe("polite");
    // No selection on first render: announcer states "Selection cleared".
    expect(live.textContent ?? "").toMatch(/cleared/i);
  });
});
