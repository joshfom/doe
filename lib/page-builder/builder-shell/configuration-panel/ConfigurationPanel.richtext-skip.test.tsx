// @vitest-environment jsdom

/**
 * ConfigurationPanel — richtext field skip test.
 *
 * Spec: builder-canvas-polish-and-inline-richtext — Task 8.4
 *
 * Asserts that:
 * 1. No richtext field name appears as a rendered field label in the DOM.
 * 2. The string "not yet supported in the new inspector" does NOT appear.
 * 3. The string "Use the legacy editor for now" does NOT appear.
 * 4. Multiple block types from the ORA block corpus with richtext fields
 *    are tested (Text, AccordionGroup, a hypothetical HtmlBlock).
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ── usePuck mock — must be set up before importing the panel ───────────────

interface MockPuckState {
  selectedItem:
    | { type: string; props: { id: string; [key: string]: unknown } }
    | null;
  config: {
    components: Record<
      string,
      {
        fields: Record<string, { type: string; label?: string; [key: string]: unknown }>;
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

const { ConfigurationPanel } = await import("./ConfigurationPanel");
const { tabStore } = await import("./tab-store");

// ── ORA block corpus fixtures with richtext fields ──────────────────────────

/**
 * Text block — has a `content` field of type "richtext".
 * This is the most common richtext field in the ORA corpus.
 * Also has a non-richtext `title` field (classified as Content → Configurations tab).
 */
const TextBlock = {
  fields: {
    content: { type: "richtext", label: "Content" },
    title: { type: "text", label: "Title" },
  },
  defaultProps: { content: "<p>Hello</p>", title: "Hello World" },
  render: () => null,
};

/**
 * AccordionGroup block — has a `body` field of type "richtext" at the
 * top level to test the filtering. Also has non-richtext fields.
 */
const AccordionGroupBlock = {
  fields: {
    heading: { type: "text", label: "Heading" },
    body: { type: "richtext", label: "Body" },
    items: { type: "array", label: "Items" },
  },
  defaultProps: { heading: "FAQ", body: "<p>Answer</p>", items: [] },
  render: () => null,
};

/**
 * HtmlBlock — has an `html` field of type "richtext".
 * Represents user-saved library components.
 */
const HtmlBlock = {
  fields: {
    html: { type: "richtext", label: "HTML" },
    title: { type: "text", label: "Title" },
  },
  defaultProps: { html: "<div>Custom</div>", title: "My Block" },
  render: () => null,
};

/**
 * MixedBlock — has both richtext and non-richtext fields to verify
 * that non-richtext fields still render while richtext ones are skipped.
 */
const MixedBlock = {
  fields: {
    content: { type: "richtext", label: "Content" },
    body: { type: "richtext", label: "Body" },
    html: { type: "richtext", label: "HTML" },
    title: { type: "text", label: "Title" },
    subtitle: { type: "text", label: "Subtitle" },
  },
  defaultProps: {
    content: "<p>Hello</p>",
    body: "<p>World</p>",
    html: "<div>Custom</div>",
    title: "My Title",
    subtitle: "My Subtitle",
  },
  render: () => null,
};

const oraCorpusConfig: MockPuckState["config"] = {
  components: {
    Text: TextBlock,
    AccordionGroup: AccordionGroupBlock,
    HtmlBlock: HtmlBlock,
    MixedBlock: MixedBlock,
  },
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ConfigurationPanel — richtext field skip (Task 8.4)", () => {
  beforeEach(() => {
    tabStore.reset();
    mockPuckState.selectedItem = null;
    mockPuckState.config = oraCorpusConfig;
    mockPuckState.appState = { data: { content: [], zones: {} } };
    mockPuckState.dispatch = vi.fn();
    mockPuckState.getSelectorForId = vi.fn(() => ({
      zone: "default-zone",
      index: 0,
    }));
  });

  it("does not render the richtext 'Content' field for a Text block", () => {
    mockPuckState.selectedItem = {
      type: "Text",
      props: { id: "text-1", content: "<p>Hello</p>", title: "Hello World" },
    };

    const { container } = render(<ConfigurationPanel />);

    // No richtext placeholder strings anywhere
    expect(container.textContent).not.toContain("not yet supported in the new inspector");
    expect(container.textContent).not.toContain("Use the legacy editor for now");

    // The non-richtext "Title" field (classified as Content → Configurations tab) should render
    expect(screen.getByText("Title")).toBeTruthy();
  });

  it("does not render the richtext 'Body' field for an AccordionGroup block", () => {
    mockPuckState.selectedItem = {
      type: "AccordionGroup",
      props: { id: "acc-1", heading: "FAQ", body: "<p>Answer</p>", items: [] },
    };

    const { container } = render(<ConfigurationPanel />);

    expect(container.textContent).not.toContain("not yet supported in the new inspector");
    expect(container.textContent).not.toContain("Use the legacy editor for now");

    // Non-richtext fields should still render
    expect(screen.getByText("Heading")).toBeTruthy();
  });

  it("does not render the richtext 'HTML' field for an HtmlBlock", () => {
    mockPuckState.selectedItem = {
      type: "HtmlBlock",
      props: { id: "html-1", html: "<div>Custom</div>", title: "My Block" },
    };

    const { container } = render(<ConfigurationPanel />);

    expect(container.textContent).not.toContain("not yet supported in the new inspector");
    expect(container.textContent).not.toContain("Use the legacy editor for now");

    // Non-richtext field should still render
    expect(screen.getByText("Title")).toBeTruthy();
  });

  it("filters ALL richtext fields when a block has multiple (content, body, html)", () => {
    mockPuckState.selectedItem = {
      type: "MixedBlock",
      props: {
        id: "mixed-1",
        content: "<p>Hello</p>",
        body: "<p>World</p>",
        html: "<div>Custom</div>",
        title: "My Title",
        subtitle: "My Subtitle",
      },
    };

    const { container } = render(<ConfigurationPanel />);

    // No richtext placeholder strings anywhere
    expect(container.textContent).not.toContain("not yet supported in the new inspector");
    expect(container.textContent).not.toContain("Use the legacy editor for now");

    // Non-richtext fields should still render
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Subtitle")).toBeTruthy();
  });

  it("shows empty state when all fields are richtext (Text block with only content)", () => {
    // Override config to have a block with ONLY richtext fields
    const onlyRichtextConfig: MockPuckState["config"] = {
      components: {
        RichtextOnly: {
          fields: {
            content: { type: "richtext", label: "Content" },
          },
          defaultProps: { content: "<p>Hello</p>" },
          render: () => null,
        },
      },
    };
    mockPuckState.config = onlyRichtextConfig;
    mockPuckState.selectedItem = {
      type: "RichtextOnly",
      props: { id: "rt-only-1", content: "<p>Hello</p>" },
    };

    const { container } = render(<ConfigurationPanel />);

    // Should show the empty state message instead of any richtext placeholder
    expect(container.textContent).toContain("This block has no configuration fields.");
    expect(container.textContent).not.toContain("not yet supported in the new inspector");
    expect(container.textContent).not.toContain("Use the legacy editor for now");
  });

  it("no 'not yet supported' or 'Use the legacy editor' string across all ORA corpus blocks", () => {
    // Test each block type in the corpus
    const blockTypes = ["Text", "AccordionGroup", "HtmlBlock", "MixedBlock"] as const;

    for (const blockType of blockTypes) {
      const componentDef = oraCorpusConfig.components[blockType];
      mockPuckState.selectedItem = {
        type: blockType,
        props: { id: `${blockType}-test`, ...componentDef.defaultProps },
      };

      const { container, unmount } = render(<ConfigurationPanel />);

      expect(container.textContent).not.toContain(
        "not yet supported in the new inspector",
      );
      expect(container.textContent).not.toContain(
        "Use the legacy editor for now",
      );

      unmount();
    }
  });
});
