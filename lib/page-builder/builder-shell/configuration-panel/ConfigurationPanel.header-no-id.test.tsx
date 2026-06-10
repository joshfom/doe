// @vitest-environment jsdom

/**
 * ConfigurationPanel — header does not leak UUIDs; breadcrumb renders expected segments.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 9.5
 * Validates: Requirements 5.1, 5.3, 5.5
 *
 * Asserts that:
 * 1. The UUID (or any substring of it) does NOT appear in the rendered
 *    textContent of the panel header when a block is selected.
 * 2. The breadcrumb renders expected ancestor segments (e.g., "Page" for a
 *    root-level block).
 * 3. A nested block's breadcrumb shows the correct ancestor chain.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── UUID regex pattern ──────────────────────────────────────────────────────

const UUID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ── usePuck mock — must be set up before importing the panel ───────────────

interface MockPuckState {
  selectedItem:
    | { type: string; props: { id: string; [key: string]: unknown } }
    | null;
  config: {
    components: Record<
      string,
      {
        fields?: Record<string, { type: string; label?: string; [key: string]: unknown }>;
        defaultProps?: Record<string, unknown>;
        render?: () => React.ReactNode;
        label?: string;
      }
    >;
  };
  appState: {
    data: {
      content: Array<{ type: string; props: Record<string, unknown> }>;
      zones?: Record<string, Array<{ type: string; props: Record<string, unknown> }>>;
    };
  };
  dispatch: ReturnType<typeof vi.fn>;
  getSelectorForId: ReturnType<typeof vi.fn>;
}

const mockPuckState: MockPuckState = {
  selectedItem: null,
  config: { components: {} },
  appState: { data: { content: [], zones: {} } },
  dispatch: vi.fn(),
  getSelectorForId: vi.fn(() => ({ zone: "root:default-zone", index: 0 })),
};

vi.mock("@puckeditor/core", () => ({
  createUsePuck: () => () => mockPuckState,
}));

vi.mock("../../use-puck-store", () => ({
  usePuckStore: (selector: (state: MockPuckState) => unknown) =>
    selector(mockPuckState),
}));

const { ConfigurationPanel } = await import("./ConfigurationPanel");
const { tabStore } = await import("./tab-store");

// ── Test fixtures ───────────────────────────────────────────────────────────

const ROOT_BLOCK_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SECTION_UUID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const NESTED_BLOCK_UUID = "c3d4e5f6-a7b8-9012-cdef-123456789012";

const configWithBlocks: MockPuckState["config"] = {
  components: {
    Section: {
      label: "Section",
      fields: {
        padding: { type: "text", label: "Padding" },
      },
      defaultProps: { padding: "16px" },
      render: () => null,
    },
    Text: {
      label: "Text",
      fields: {
        title: { type: "text", label: "Title" },
      },
      defaultProps: { title: "Hello" },
      render: () => null,
    },
    Button: {
      label: "Button",
      fields: {
        label: { type: "text", label: "Label" },
      },
      defaultProps: { label: "Click me" },
      render: () => null,
    },
  },
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ConfigurationPanel header — no UUID leak (Task 9.5)", () => {
  beforeEach(() => {
    tabStore.reset();
    mockPuckState.selectedItem = null;
    mockPuckState.config = configWithBlocks;
    mockPuckState.appState = { data: { content: [], zones: {} } };
    mockPuckState.dispatch = vi.fn();
    mockPuckState.getSelectorForId = vi.fn(() => ({
      zone: "root:default-zone",
      index: 0,
    }));
  });

  it("does NOT render the UUID or any substring of it in the panel header for a selected root-level block", () => {
    // Set up a root-level Text block with a UUID id
    mockPuckState.selectedItem = {
      type: "Text",
      props: { id: ROOT_BLOCK_UUID, title: "Hello World" },
    };
    mockPuckState.appState = {
      data: {
        content: [
          { type: "Text", props: { id: ROOT_BLOCK_UUID, title: "Hello World" } },
        ],
        zones: {},
      },
    };

    const { container } = render(<ConfigurationPanel />);
    const panel = screen.getByTestId("ora-configuration-panel");
    const textContent = panel.textContent ?? "";

    // The full UUID must not appear
    expect(textContent).not.toMatch(UUID_REGEX);

    // No substring of the UUID (8+ hex chars with dashes) should appear
    // Check specific substrings of the UUID
    expect(textContent).not.toContain(ROOT_BLOCK_UUID);
    expect(textContent).not.toContain(ROOT_BLOCK_UUID.slice(0, 8));
    expect(textContent).not.toContain(ROOT_BLOCK_UUID.slice(0, 16));
  });

  it("renders 'Page' as the breadcrumb segment for a root-level block", () => {
    mockPuckState.selectedItem = {
      type: "Text",
      props: { id: ROOT_BLOCK_UUID, title: "Hello World" },
    };
    mockPuckState.appState = {
      data: {
        content: [
          { type: "Text", props: { id: ROOT_BLOCK_UUID, title: "Hello World" } },
        ],
        zones: {},
      },
    };

    render(<ConfigurationPanel />);

    // The breadcrumb should render a nav with "Ancestor breadcrumb" label
    const breadcrumbNav = screen.getByRole("navigation", {
      name: /ancestor breadcrumb/i,
    });
    expect(breadcrumbNav).toBeTruthy();

    // For a root-level block, the only ancestor segment should be "Page"
    const buttons = breadcrumbNav.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe("Page");
  });

  it("renders the correct ancestor chain for a nested block (Page › Section)", () => {
    // Set up a nested structure: Section contains a Text block in a zone
    mockPuckState.selectedItem = {
      type: "Text",
      props: { id: NESTED_BLOCK_UUID, title: "Nested text" },
    };
    mockPuckState.appState = {
      data: {
        content: [
          { type: "Section", props: { id: SECTION_UUID, padding: "16px" } },
        ],
        zones: {
          [`${SECTION_UUID}:default-zone`]: [
            { type: "Text", props: { id: NESTED_BLOCK_UUID, title: "Nested text" } },
          ],
        },
      },
    };

    render(<ConfigurationPanel />);

    const breadcrumbNav = screen.getByRole("navigation", {
      name: /ancestor breadcrumb/i,
    });
    expect(breadcrumbNav).toBeTruthy();

    // For a nested block inside a Section, the breadcrumb should show:
    // "Page" › "Section"
    const buttons = breadcrumbNav.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe("Page");
    expect(buttons[1].textContent).toBe("Section");

    // Verify no UUID leaks in the breadcrumb
    const breadcrumbText = breadcrumbNav.textContent ?? "";
    expect(breadcrumbText).not.toMatch(UUID_REGEX);
    expect(breadcrumbText).not.toContain(SECTION_UUID);
    expect(breadcrumbText).not.toContain(NESTED_BLOCK_UUID);
  });

  it("does NOT render any UUID in the full panel textContent for a nested block", () => {
    mockPuckState.selectedItem = {
      type: "Button",
      props: { id: NESTED_BLOCK_UUID, label: "Click me" },
    };
    mockPuckState.appState = {
      data: {
        content: [
          { type: "Section", props: { id: SECTION_UUID, padding: "16px" } },
        ],
        zones: {
          [`${SECTION_UUID}:default-zone`]: [
            { type: "Button", props: { id: NESTED_BLOCK_UUID, label: "Click me" } },
          ],
        },
      },
    };

    const { container } = render(<ConfigurationPanel />);
    const panel = screen.getByTestId("ora-configuration-panel");
    const textContent = panel.textContent ?? "";

    // No UUID pattern should appear anywhere in the panel
    expect(textContent).not.toMatch(UUID_REGEX);
    expect(textContent).not.toContain(SECTION_UUID);
    expect(textContent).not.toContain(NESTED_BLOCK_UUID);
    expect(textContent).not.toContain(ROOT_BLOCK_UUID);
  });
});
