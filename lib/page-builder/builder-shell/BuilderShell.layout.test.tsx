// @vitest-environment jsdom
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

// Mock InlineRichtextController to avoid tiptap extension resolution issues.
vi.mock("./InlineRichtextController", () => ({
  InlineRichtextController: () => null,
  useActiveRichtextEditor: () => null,
  InlineRichtextContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

import React from "react";
import { render, screen, within } from "@testing-library/react";

const { BuilderShell } = await import("./BuilderShell");
import type { DocumentRecord } from "./types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const minimalConfig = {
  components: {
    Box: {
      fields: {
        title: { type: "text" as const, label: "Title" },
      },
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
      content: [
        {
          type: "Box",
          props: { id: "Box-1", title: "hello" },
        },
      ],
      root: { props: {} },
    },
    ...overrides,
  };
}

const defaultProps = {
  config: minimalConfig as never,
  document: makePageDoc(),
  onSave: vi.fn().mockResolvedValue({ ok: true }),
  onPublish: vi.fn().mockResolvedValue({ ok: true }),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("BuilderShell layout — left rail sections", () => {
  it('renders the left rail aside with aria-label "Component palette"', () => {
    render(<BuilderShell {...defaultProps} />);
    const leftRail = screen.getByRole("complementary", {
      name: "Component palette",
    });
    expect(leftRail).toBeTruthy();
  });

  it('renders a PaletteSection titled "Components"', () => {
    render(<BuilderShell {...defaultProps} />);
    const leftRail = screen.getByRole("complementary", {
      name: "Component palette",
    });
    // PaletteSection renders a button with the title text
    const componentsHeader = within(leftRail).getByRole("button", {
      name: /components/i,
    });
    expect(componentsHeader).toBeTruthy();
  });

  it('renders a PaletteSection titled "Outline"', () => {
    render(<BuilderShell {...defaultProps} />);
    const leftRail = screen.getByRole("complementary", {
      name: "Component palette",
    });
    const outlineHeader = within(leftRail).getByRole("button", {
      name: /outline/i,
    });
    expect(outlineHeader).toBeTruthy();
  });

  it("renders both PaletteSection headers inside the left rail", () => {
    render(<BuilderShell {...defaultProps} />);
    const leftRail = screen.getByRole("complementary", {
      name: "Component palette",
    });
    const sectionButtons = within(leftRail).getAllByRole("button", {
      name: /components|outline/i,
    });
    expect(sectionButtons).toHaveLength(2);
  });
});

describe("BuilderShell layout — CanvasFrame wraps viewport", () => {
  it("renders CanvasFrame around the canvas viewport", () => {
    const { container } = render(<BuilderShell {...defaultProps} />);
    // CanvasFrame renders a div with cream background wrapping an inner div
    // with a border and shadow. The viewport (data-testid="ora-canvas-viewport")
    // should be nested inside.
    const viewport = screen.getByTestId("ora-canvas-viewport");
    expect(viewport).toBeTruthy();

    // The viewport should be inside the main canvas area
    const canvasMain = screen.getByTestId("ora-canvas");
    expect(canvasMain.contains(viewport)).toBe(true);

    // CanvasFrame's outer div has the cream background and padding.
    // Walk up from viewport to find the CanvasFrame wrapper.
    const canvasFrameOuter = viewport.parentElement?.parentElement;
    expect(canvasFrameOuter).toBeTruthy();
    // The CanvasFrame outer div should have the cream background
    // jsdom may convert hex to rgb, so check for either format
    if (canvasFrameOuter) {
      const bg = canvasFrameOuter.style.background;
      const hasCreamBg =
        bg.includes("#F5F3F0") ||
        bg.includes("#f5f3f0") ||
        bg.includes("rgb(245, 243, 240)");
      expect(hasCreamBg).toBe(true);
    }
  });

  it("renders the CanvasFrame inner panel with border and shadow", () => {
    render(<BuilderShell {...defaultProps} />);
    const viewport = screen.getByTestId("ora-canvas-viewport");
    // The inner panel is the direct parent of the viewport
    const innerPanel = viewport.parentElement;
    expect(innerPanel).toBeTruthy();
    if (innerPanel) {
      expect(innerPanel.style.border).toContain("1px solid");
      expect(innerPanel.style.boxShadow).toBeTruthy();
    }
  });
});

describe("BuilderShell layout — no regression in existing structure", () => {
  it("renders TopBar", () => {
    render(<BuilderShell {...defaultProps} />);
    expect(screen.getByTestId("ora-topbar")).toBeTruthy();
  });

  it("renders the canvas main area", () => {
    render(<BuilderShell {...defaultProps} />);
    expect(screen.getByTestId("ora-canvas")).toBeTruthy();
  });

  it("renders the configuration panel", () => {
    render(<BuilderShell {...defaultProps} />);
    expect(screen.getByTestId("ora-configuration-panel")).toBeTruthy();
  });

  it("renders the status bar", () => {
    render(<BuilderShell {...defaultProps} />);
    expect(screen.getByTestId("ora-statusbar")).toBeTruthy();
  });

  it("renders the component palette", () => {
    render(<BuilderShell {...defaultProps} />);
    expect(screen.getByTestId("ora-component-palette")).toBeTruthy();
  });

  it("does not render Puck default chrome", () => {
    const { container } = render(<BuilderShell {...defaultProps} />);
    expect(
      container.querySelector("[class*='PuckLayout-header']"),
    ).toBeNull();
    expect(container.querySelector("[class*='PuckHeader']")).toBeNull();
  });
});
