// @vitest-environment jsdom
/**
 * TemplateLibrarySheet — ORA validation defense-in-depth test.
 *
 * Spec: ora-page-templates — task 10.4
 * Validates: Requirements 7.7, 8.7, 9.4
 *
 * Asserts that when an ORA template fails validation at import time,
 * the error is rendered AND dispatch is NOT called with setData.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ─── Polyfills for jsdom ────────────────────────────────────────────────────

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

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();

// Mock usePuckStore to return our controlled dispatch and appState
vi.mock("../use-puck-store", () => ({
  usePuckStore: (selector: (s: unknown) => unknown) => {
    const state = {
      dispatch: mockDispatch,
      appState: {
        data: {
          root: { props: { title: "Existing Page" } },
          content: [],
          zones: {},
        },
      },
    };
    return selector(state);
  },
}));

// Build a deliberately invalid ORA template: Section with bgMode: "video"
const invalidOraTemplate = {
  id: "ora-project-page",
  name: "ORA Project Page",
  description: "A project marketing page with invalid bgMode",
  thumbnailId: "thumb-ora-project",
  data: {
    root: { props: { title: "Project Page" } },
    content: [
      {
        type: "Section",
        props: {
          id: "section-1",
          bgMode: "video", // deliberately invalid for ORA templates
          bgMediaType: "none",
          bgImage: "",
          _archetype: "hero",
          _padding: {
            desktop: { paddingTop: "96", paddingBottom: "96", paddingLeft: "64", paddingRight: "64" },
            mobile: { paddingTop: "64", paddingBottom: "64", paddingLeft: "16", paddingRight: "16" },
          },
        },
      },
    ],
    zones: {},
  },
};

// Mock the store to return our invalid template from the registry
vi.mock("../store", () => ({
  templateRegistry: {
    list: () => [invalidOraTemplate],
    getById: (id: string) => (id === invalidOraTemplate.id ? invalidOraTemplate : null),
  },
}));

// Mock validateOraPageTemplate to return a failure for the invalid template
vi.mock("../templates/ora", () => ({
  validateOraPageTemplate: (template: { id: string; data: { content: Array<{ props: { bgMode?: string } }> } }) => {
    const section = template.data.content[0];
    if (section?.props?.bgMode === "video") {
      return {
        success: false,
        errors: [
          {
            templateId: template.id,
            blockId: "section-1",
            fieldPath: "content[0].props.bgMode",
            rule: "bgMode.allowed",
            message:
              'Section bgMode must be "gradient" or "solid" with bgMediaType "image"; got "video"',
          },
        ],
      };
    }
    return { success: true, errors: [] };
  },
}));

// Mock migratePageData to pass through data unchanged
vi.mock("../migrate-data", () => ({
  migratePageData: (data: unknown) => data,
}));

// Mock LibrarySheet to render children directly (avoids portal/framer-motion complexity)
vi.mock("./LibrarySheet", () => ({
  LibrarySheet: ({
    open,
    children,
  }: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
  }) => (open ? <div data-testid="library-sheet">{children}</div> : null),
}));

// ─── Import component under test (after mocks) ─────────────────────────────

const { TemplateLibrarySheet } = await import("./TemplateLibrarySheet");

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("TemplateLibrarySheet — ORA validation at import time", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
  });

  it("renders a validation error and does NOT dispatch setData when an invalid ORA template is imported", () => {
    const onClose = vi.fn();
    render(<TemplateLibrarySheet open={true} onClose={onClose} />);

    // The template card should be visible
    const card = screen.getByRole("button", {
      name: /Template: ORA Project Page/i,
    });
    expect(card).toBeTruthy();

    // Click the card to select it (shows confirmation prompt)
    fireEvent.click(card);

    // The confirmation prompt should appear with an "Import" button
    const importBtn = screen.getByRole("button", { name: /^Import$/i });
    expect(importBtn).toBeTruthy();

    // Click Import to trigger the validation flow
    fireEvent.click(importBtn);

    // The error should be rendered in an alert role
    const errorAlert = screen.getByRole("alert");
    expect(errorAlert).toBeTruthy();
    expect(errorAlert.textContent).toContain("Template validation failed");
    expect(errorAlert.textContent).toContain('bgMode must be "gradient" or "solid"');

    // dispatch should NOT have been called with setData
    expect(mockDispatch).not.toHaveBeenCalled();

    // The sheet should remain open (onClose not called)
    expect(onClose).not.toHaveBeenCalled();
  });
});
