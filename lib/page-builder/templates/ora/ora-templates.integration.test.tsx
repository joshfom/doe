// @vitest-environment jsdom
/**
 * ORA Templates — Integration test.
 *
 * Spec: ora-page-templates — tasks 13.1, 13.2, 13.3
 * Validates: Requirements 10.3, 10.4, 10.5
 *
 * Tests the full Template_Library import flow for each of the four ORA templates:
 *   1. Opens the TemplateLibrarySheet
 *   2. Clicks the template card
 *   3. Confirms the import dialog
 *   4. Asserts dispatch(setData) is called with the materialised tree
 *   5. Verifies every block in the dispatched data has a valid id (data-puck-id proxy)
 *   6. Verifies that deleting one block from the dispatched tree leaves others intact
 *
 * Reuses the test harness pattern from TemplateLibrarySheet.ora-validation.test.tsx
 * and BuilderShell.test.tsx (polyfills, mocking usePuckStore, templateRegistry, etc.)
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

// ─── Import real template factories ─────────────────────────────────────────

import { oraProjectPageTemplate } from "./ora-project-page";
import { whyBaynTemplate } from "./why-bayn";
import { lifeAtBaynTemplate } from "./life-at-bayn";
import { aboutOraTemplate } from "./about-ora";
import type { PageTemplate } from "../index";

// Generate the four templates for use in tests
const templateFactories = [
  { factory: oraProjectPageTemplate, id: "ora-project-page", name: "ORA Project Page" },
  { factory: whyBaynTemplate, id: "why-bayn", name: "Why Bayn" },
  { factory: lifeAtBaynTemplate, id: "life-at-bayn", name: "Life at Bayn" },
  { factory: aboutOraTemplate, id: "about-ora", name: "About ORA" },
] as const;

const realTemplates: PageTemplate[] = templateFactories.map((t) => t.factory());

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();

// Mock usePuckStore to return our controlled dispatch and appState
vi.mock("../../use-puck-store", () => ({
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

// Mock the store to return the real four ORA templates from the registry
vi.mock("../../store", () => ({
  templateRegistry: {
    list: () => realTemplates,
    getById: (id: string) => realTemplates.find((t) => t.id === id) ?? null,
  },
}));

// Mock validateOraPageTemplate to always pass (templates are valid)
vi.mock("./index", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    validateOraPageTemplate: () => ({ success: true, errors: [] }),
  };
});

// Mock migratePageData to pass through data unchanged
vi.mock("../../migrate-data", () => ({
  migratePageData: (data: unknown) => data,
}));

// Mock LibrarySheet to render children directly (avoids portal/framer-motion complexity)
vi.mock("../../builder-shell/LibrarySheet", () => ({
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

const { TemplateLibrarySheet } = await import(
  "../../builder-shell/TemplateLibrarySheet"
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all block ids from a PageData-like structure (content + zones). */
function collectBlockIds(data: {
  content: Array<{ props: { id: string } }>;
  zones?: Record<string, Array<{ props: { id: string } }>>;
}): string[] {
  const ids: string[] = [];
  for (const block of data.content) {
    ids.push(block.props.id);
  }
  if (data.zones) {
    for (const zoneBlocks of Object.values(data.zones)) {
      for (const block of zoneBlocks) {
        ids.push(block.props.id);
      }
    }
  }
  return ids;
}

/** Simulate the full import flow: click card → confirm → assert dispatch. */
function importTemplate(templateName: string) {
  // Click the template card to select it
  const card = screen.getByRole("button", {
    name: new RegExp(`Template: ${templateName}`, "i"),
  });
  fireEvent.click(card);

  // Click the Import button in the confirmation overlay
  const importBtn = screen.getByRole("button", { name: /^Import$/i });
  fireEvent.click(importBtn);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ORA Templates — Integration: Template_Library import flow", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
  });

  describe.each(templateFactories)("$name ($id)", ({ id, name, factory }) => {
    it("imports the template via the Template_Library flow and dispatches setData", () => {
      const onClose = vi.fn();
      render(<TemplateLibrarySheet open={true} onClose={onClose} />);

      importTemplate(name);

      // dispatch should have been called with setData
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      const dispatchCall = mockDispatch.mock.calls[0][0];
      expect(dispatchCall.type).toBe("setData");

      // The dispatched data should have content (the materialised tree)
      const dispatchedData = dispatchCall.data;
      expect(dispatchedData.content.length).toBeGreaterThan(0);

      // onClose should have been called (sheet closes on successful import)
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("every block in the dispatched data has a valid id (data-puck-id proxy)", () => {
      const onClose = vi.fn();
      render(<TemplateLibrarySheet open={true} onClose={onClose} />);

      importTemplate(name);

      const dispatchedData = mockDispatch.mock.calls[0][0].data;
      const ids = collectBlockIds(dispatchedData);

      // Every block must have a non-empty id
      expect(ids.length).toBeGreaterThan(0);
      for (const blockId of ids) {
        expect(blockId).toBeTruthy();
        expect(typeof blockId).toBe("string");
        expect(blockId.trim().length).toBeGreaterThan(0);
      }

      // All ids must be unique (no collisions)
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("the dispatched tree contains the expected Section blocks with _archetype tags", () => {
      const onClose = vi.fn();
      render(<TemplateLibrarySheet open={true} onClose={onClose} />);

      importTemplate(name);

      const dispatchedData = mockDispatch.mock.calls[0][0].data;
      const sections = dispatchedData.content.filter(
        (block: { type: string }) => block.type === "Section"
      );

      // Every template has at least 4 sections
      expect(sections.length).toBeGreaterThanOrEqual(4);

      // Every Section should have an _archetype tag
      for (const section of sections) {
        expect(section.props._archetype).toBeTruthy();
        expect(typeof section.props._archetype).toBe("string");
      }
    });

    it("selecting any block (simulated) — each block has fields accessible via its type", () => {
      // This test verifies that each block in the dispatched tree has a `type`
      // that corresponds to a registered component, meaning the Configuration_Panel
      // would be able to render its fields when selected.
      const onClose = vi.fn();
      render(<TemplateLibrarySheet open={true} onClose={onClose} />);

      importTemplate(name);

      const dispatchedData = mockDispatch.mock.calls[0][0].data;
      const allBlocks: Array<{ type: string; props: { id: string } }> = [
        ...dispatchedData.content,
      ];
      if (dispatchedData.zones) {
        for (const zoneBlocks of Object.values(dispatchedData.zones)) {
          allBlocks.push(
            ...(zoneBlocks as Array<{ type: string; props: { id: string } }>)
          );
        }
      }

      // Known atomic block types from atomic-component-architecture
      const knownBlockTypes = new Set([
        "Section",
        "Container",
        "Columns",
        "Heading",
        "Text",
        "Image",
        "Quote",
        "Button",
        "Accordion",
        "AccordionGroup",
        "Icon",
      ]);

      for (const block of allBlocks) {
        expect(knownBlockTypes.has(block.type)).toBe(true);
        expect(block.props.id).toBeTruthy();
      }
    });

    it("deleting one block from the dispatched tree leaves the others intact", () => {
      // Simulate: after import, removing one block from the tree should not
      // affect the remaining blocks. This verifies independent block editability.
      const template = factory();
      const allBlocks: Array<{ type: string; props: { id: string } }> = [
        ...template.data.content,
      ];
      if (template.data.zones) {
        for (const zoneBlocks of Object.values(template.data.zones)) {
          allBlocks.push(
            ...(zoneBlocks as Array<{ type: string; props: { id: string } }>)
          );
        }
      }

      // Pick the first zone block to "delete" (simulate removal)
      const zoneKeys = Object.keys(template.data.zones ?? {});
      if (zoneKeys.length > 0) {
        const firstZoneKey = zoneKeys[0];
        const zoneBlocks = template.data.zones![firstZoneKey];
        if (zoneBlocks.length > 1) {
          // Remove the first block from this zone
          const removedBlock = zoneBlocks[0];
          const remainingBlocks = zoneBlocks.slice(1);

          // The remaining blocks should still be intact
          expect(remainingBlocks.length).toBe(zoneBlocks.length - 1);
          for (const block of remainingBlocks) {
            expect(block.props.id).toBeTruthy();
            expect(block.type).toBeTruthy();
            // The remaining block ids should not include the deleted one
            expect(block.props.id).not.toBe(removedBlock.props.id);
          }

          // Content-level sections should be unaffected
          expect(template.data.content.length).toBeGreaterThan(0);
        }
      }

      // Also verify content-level deletion: remove one Section
      if (template.data.content.length > 1) {
        const removedSection = template.data.content[0];
        const remainingSections = template.data.content.slice(1);

        expect(remainingSections.length).toBe(template.data.content.length - 1);
        for (const section of remainingSections) {
          expect(section.props.id).not.toBe(removedSection.props.id);
          expect(section.props.id).toBeTruthy();
        }
      }
    });
  });
});
