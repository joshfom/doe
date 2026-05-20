// @vitest-environment jsdom

/**
 * ConfigurationPanel — tab preservation across block selection changes.
 *
 * Spec: custom-branded-page-builder — Requirement 3.3, Property 11
 *
 * Property 11 (Tab preservation):
 *   When the active ConfigurationPanel tab is any of { Configurations, Style,
 *   Theme }, changing the selected block (including to null) MUST NOT reset
 *   the active tab.
 *
 * We mock `usePuck()` directly because we only need the panel's reaction to
 * selection/config changes — a full Puck harness (DndKit, ResizeObserver,
 * DropZone, etc.) would be pure overhead for a tab-state unit test. The
 * mocked store is driven via a mutable `mockPuckState` object; the
 * `rerender` call in each test is what models "Puck state changed" — React
 * re-reads `usePuck()` and the panel observes the new selected item.
 *
 * The secondary test covers deselection, where the panel falls back to
 * `PageSettingsFields` (Requirement 3.5). That component calls
 * `useBuilderShell()` so we wrap it in a stub `BuilderShellProvider` with
 * no-op handlers — this is the same pattern used by the wider shell tests
 * to isolate subtrees.
 *
 * `tabStore.reset()` in `beforeEach` keeps the module-scoped store
 * isolated between tests; see `tab-store.ts`.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── usePuck mock — must be set up before importing the panel ───────────────

interface MockPuckState {
  selectedItem:
    | { type: string; props: { id: string; [key: string]: unknown } }
    | null;
  config: {
    components: Record<
      string,
      {
        fields: Record<string, { type: string; label?: string }>;
        defaultProps: Record<string, unknown>;
        render: () => React.ReactNode;
      }
    >;
  };
  appState: { data: { content: Array<{ type: string; props: Record<string, unknown> }>; zones?: Record<string, unknown[]> } };
  dispatch: ReturnType<typeof vi.fn>;
  getSelectorForId: ReturnType<typeof vi.fn>;
}

const mockPuckState: MockPuckState = {
  selectedItem: null,
  config: { components: {} },
  appState: { data: { content: [], zones: {} } },
  dispatch: vi.fn(),
  getSelectorForId: vi.fn(() => ({ zone: "default-zone", index: 0 })),
};

vi.mock("@puckeditor/core", () => ({
  createUsePuck: () => () => mockPuckState,
}));

vi.mock("../../use-puck-store", () => ({
  usePuckStore: (selector: (state: MockPuckState) => unknown) => selector(mockPuckState),
}));

// These imports must come AFTER the vi.mock call above so the panel picks
// up the mocked module when it resolves `@puckeditor/core`.
const { ConfigurationPanel } = await import("./ConfigurationPanel");
const { tabStore } = await import("./tab-store");
const { BuilderShellProvider } = await import("../shell-context");
import type { BuilderShellContextValue } from "../shell-context";

// ── Test fixtures ───────────────────────────────────────────────────────────

const minimalConfig: MockPuckState["config"] = {
  components: {
    BlockA: {
      // Mix of style + content fields so all three tabs have something to
      // render. The classifier (`../inspector/sections.ts`) routes
      // `backgroundColor` → Style, `padding` → Theme, `title` → Configurations.
      fields: {
        title: { type: "text", label: "Title" },
        backgroundColor: { type: "text", label: "Background" },
        padding: { type: "number", label: "Padding" },
      },
      defaultProps: {},
      render: () => null,
    },
    BlockB: {
      // Different field names so we can see that the block genuinely changed
      // without the tab resetting.
      fields: {
        content: { type: "textarea", label: "Content" },
        fontSize: { type: "number", label: "Font Size" },
        width: { type: "number", label: "Width" },
      },
      defaultProps: {},
      render: () => null,
    },
  },
};

function stubBuilderShellContext(): BuilderShellContextValue {
  return {
    documentTitle: "Untitled",
    setDocumentTitle: vi.fn(),
    dirty: false,
    lastSavedAt: null,
    saving: false,
    publishing: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    onPublish: vi.fn().mockResolvedValue(undefined),
    onPreview: vi.fn(),
    errorMessage: null,
    dismissError: vi.fn(),
  };
}

function withShellProvider(node: React.ReactNode) {
  return (
    <BuilderShellProvider value={stubBuilderShellContext()}>
      {node}
    </BuilderShellProvider>
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ConfigurationPanel — tab preservation (Property 11, Req 3.3)", () => {
  beforeEach(() => {
    // Reset the module-scoped tab store so each test starts from the default
    // `Configurations` tab. See `tab-store.ts` for the reset contract.
    tabStore.reset();
    mockPuckState.selectedItem = null;
    mockPuckState.config = minimalConfig;
    mockPuckState.appState = { data: { content: [], zones: {} } };
    mockPuckState.dispatch = vi.fn();
    mockPuckState.getSelectorForId = vi.fn(() => ({
      zone: "default-zone",
      index: 0,
    }));
  });

  it("keeps the Style tab active when the selected block changes from A to B", () => {
    mockPuckState.selectedItem = {
      type: "BlockA",
      props: { id: "BlockA-1" },
    };

    const { rerender } = render(<ConfigurationPanel />);

    // Default starting state is the Configurations tab.
    expect(
      screen
        .getByRole("tab", { name: "Configurations" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Style" }).getAttribute("aria-selected"),
    ).toBe("false");

    // User switches to the Style tab.
    fireEvent.click(screen.getByRole("tab", { name: "Style" }));

    expect(
      screen.getByRole("tab", { name: "Style" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("tab", { name: "Configurations" })
        .getAttribute("aria-selected"),
    ).toBe("false");

    // Puck reports a new selected block (simulating the user clicking a
    // different element on the canvas). The panel re-renders — the tab
    // must not reset.
    mockPuckState.selectedItem = {
      type: "BlockB",
      props: { id: "BlockB-1" },
    };
    rerender(<ConfigurationPanel />);

    // Sanity: the header reflects the new block so we know the re-render
    // observed the state change.
    const panel = screen.getByTestId("ora-configuration-panel");
    expect(panel.textContent).toContain("BlockB");

    // The actual property — active tab is preserved across the selection change.
    expect(
      screen.getByRole("tab", { name: "Style" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("tab", { name: "Configurations" })
        .getAttribute("aria-selected"),
    ).toBe("false");
    expect(
      screen.getByRole("tab", { name: "Theme" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("keeps the Theme tab active when the selection is cleared (deselection)", () => {
    mockPuckState.selectedItem = {
      type: "BlockA",
      props: { id: "BlockA-1" },
    };

    const { rerender } = render(withShellProvider(<ConfigurationPanel />));

    // Switch to the Theme tab on Block A.
    fireEvent.click(screen.getByRole("tab", { name: "Theme" }));
    expect(
      screen.getByRole("tab", { name: "Theme" }).getAttribute("aria-selected"),
    ).toBe("true");

    // Deselect — Puck reports no selected item (e.g. the user clicked an
    // empty part of the canvas). The panel now renders page-level settings
    // on the Configurations tab, but the active tab itself must not change.
    mockPuckState.selectedItem = null;
    rerender(withShellProvider(<ConfigurationPanel />));

    expect(
      screen.getByRole("tab", { name: "Theme" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("tab", { name: "Configurations" })
        .getAttribute("aria-selected"),
    ).toBe("false");
  });
});
