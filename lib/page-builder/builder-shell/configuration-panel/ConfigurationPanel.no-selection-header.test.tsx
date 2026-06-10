// @vitest-environment jsdom

/**
 * ConfigurationPanel — no-selection header behavior.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 9.4
 * Validates: Requirement 5.6
 *
 * When no block is selected:
 * 1. The header renders "Page" as the Block_Label.
 * 2. No AncestorBreadcrumb is rendered.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── usePuck mock ────────────────────────────────────────────────────────────

interface MockPuckState {
  selectedItem: null;
  config: { components: Record<string, unknown> };
  appState: { data: { content: unknown[]; zones?: Record<string, unknown[]> } };
  dispatch: ReturnType<typeof vi.fn>;
  getSelectorForId: ReturnType<typeof vi.fn>;
}

const mockPuckState: MockPuckState = {
  selectedItem: null,
  config: { components: {} },
  appState: { data: { content: [], zones: {} } },
  dispatch: vi.fn(),
  getSelectorForId: vi.fn(() => null),
};

vi.mock("@puckeditor/core", () => ({
  createUsePuck: () => () => mockPuckState,
}));

vi.mock("../../use-puck-store", () => ({
  usePuckStore: (selector: (state: MockPuckState) => unknown) =>
    selector(mockPuckState),
}));

const { ConfigurationPanel } = await import("./ConfigurationPanel");
const { BuilderShellProvider } = await import("../shell-context");
import type { BuilderShellContextValue } from "../shell-context";

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

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ConfigurationPanel header — no selection (Task 9.4, Req 5.6)", () => {
  beforeEach(() => {
    mockPuckState.selectedItem = null;
    mockPuckState.config = { components: {} };
    mockPuckState.appState = { data: { content: [], zones: {} } };
    mockPuckState.dispatch = vi.fn();
    mockPuckState.getSelectorForId = vi.fn(() => null);
  });

  it('renders "Page" as the Block_Label when no block is selected', () => {
    render(
      <BuilderShellProvider value={stubBuilderShellContext()}>
        <ConfigurationPanel />
      </BuilderShellProvider>,
    );

    const panel = screen.getByTestId("ora-configuration-panel");
    // The header should contain "Page"
    expect(panel.textContent).toContain("Page");
  });

  it("does not render an AncestorBreadcrumb when no block is selected", () => {
    render(
      <BuilderShellProvider value={stubBuilderShellContext()}>
        <ConfigurationPanel />
      </BuilderShellProvider>,
    );

    // AncestorBreadcrumb renders a <nav aria-label="Ancestor breadcrumb">
    const breadcrumbNav = screen.queryByRole("navigation", {
      name: /ancestor breadcrumb/i,
    });
    expect(breadcrumbNav).toBeNull();
  });
});
