// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// Polyfill ResizeObserver for jsdom — must be set before importing config
// which transitively loads @dnd-kit/dom that accesses ResizeObserver at module scope
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Polyfill window.matchMedia for jsdom — Puck uses it internally for viewport detection
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
import { render } from "@testing-library/react";

// Dynamic imports after polyfill is in place
const { PageEditor } = await import("./components/PageEditor");
const { PageRenderer } = await import("./components/PageRenderer");
const { InMemoryDataStore } = await import("./data-store");
const { InMemoryPageMetaStore, createPageManager } = await import("./page-manager");

import type { PageData } from "./types";

// ─── Shared test data ────────────────────────────────────────────────────────

const validPageData: PageData = {
  root: { props: { title: "Integration Test Page" } },
  content: [
    {
      type: "Heading",
      props: {
        id: "heading-int-1",
        text: "Integration Heading",
        level: "h1",
        alignment: "center",
        color: "inherit",
      },
    },
    {
      type: "Text",
      props: {
        id: "text-int-1",
        content: "Integration text content here",
        alignment: "left",
        fontSize: "base",
        color: "inherit",
      },
    },
  ],
};

const updatedPageData: PageData = {
  root: { props: { title: "Updated Integration Page" } },
  content: [
    {
      type: "Heading",
      props: {
        id: "heading-int-2",
        text: "Updated Heading",
        level: "h2",
        alignment: "left",
        color: "#1A1A1A",
      },
    },
    {
      type: "Button",
      props: {
        id: "btn-int-1",
        text: "Take Action Now",
        link: "#go",
        variant: "default",
        size: "md",
        fullWidth: "no",
        alignment: "center",
      },
    },
  ],
};

// ─── Test: PageEditor mounts without errors ──────────────────────────────────

describe("PageEditor integration", () => {
  it("mounts without errors with valid config and data", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    // PageEditor wraps Puck which has complex internal requirements.
    // We verify it renders without throwing a fatal error.
    const { container, unmount } = render(
      React.createElement(PageEditor, {
        initialData: validPageData,
        onSave,
      })
    );

    // The editor should produce some DOM output
    expect(container.innerHTML.length).toBeGreaterThan(0);

    unmount();
  });
});

// ─── Test: PageRenderer produces HTML ────────────────────────────────────────

describe("PageRenderer integration", () => {
  it("produces meaningful HTML with valid page data", () => {
    const { container, unmount } = render(
      React.createElement(PageRenderer, { data: validPageData })
    );

    const html = container.innerHTML;

    // Should not be empty
    expect(html.length).toBeGreaterThan(0);

    // Should contain text from the Heading component
    expect(container.textContent).toContain("Integration Heading");

    // Should contain text from the Text component
    expect(container.textContent).toContain("Integration text content here");

    unmount();
  });
});

// ─── Test: Full page lifecycle ───────────────────────────────────────────────

describe("Full page lifecycle", () => {
  it("create → list → update → publish → render → unpublish → delete", async () => {
    const dataStore = new InMemoryDataStore();
    const metaStore = new InMemoryPageMetaStore();
    const pm = createPageManager({ dataStore, metaStore });

    // 1. Create a page
    const createResult = await pm.createPage(
      "My Integration Page",
      "integration-test",
      validPageData
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error("Create failed");
    const pageId = createResult.value.id;
    expect(createResult.value.title).toBe("My Integration Page");
    expect(createResult.value.slug).toBe("integration-test");
    expect(createResult.value.status).toBe("draft");

    // 2. Verify it appears in listPages
    let pages = await pm.listPages();
    expect(pages.some((p) => p.id === pageId)).toBe(true);

    // 3. Update the page with new data
    const updateResult = await pm.updatePage(pageId, {
      title: "Updated Integration Page",
      data: updatedPageData,
    });
    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) throw new Error("Update failed");
    expect(updateResult.value.title).toBe("Updated Integration Page");

    // 4. Verify the update is reflected in the data store
    const loadedData = await dataStore.load(pageId);
    expect(loadedData).not.toBeNull();
    expect(loadedData!.root.props.title).toBe("Updated Integration Page");
    expect(loadedData!.content[0].type).toBe("Heading");
    expect(loadedData!.content[0].props.text).toBe("Updated Heading");

    // 5. Publish the page
    const publishResult = await pm.publishPage(pageId);
    expect(publishResult.ok).toBe(true);
    if (!publishResult.ok) throw new Error("Publish failed");
    expect(publishResult.value.status).toBe("published");
    expect(publishResult.value.publishedAt).not.toBeNull();

    // 6. Render the page data with PageRenderer (verify no errors)
    const { container, unmount } = render(
      React.createElement(PageRenderer, { data: updatedPageData })
    );
    expect(container.textContent).toContain("Updated Heading");
    expect(container.textContent).toContain("Take Action Now");
    unmount();

    // 7. Unpublish the page
    const unpublishResult = await pm.unpublishPage(pageId);
    expect(unpublishResult.ok).toBe(true);
    if (!unpublishResult.ok) throw new Error("Unpublish failed");
    expect(unpublishResult.value.status).toBe("draft");

    // 8. Delete the page
    const deleteResult = await pm.deletePage(pageId);
    expect(deleteResult.ok).toBe(true);

    // 9. Verify it's gone from listPages
    pages = await pm.listPages();
    expect(pages.some((p) => p.id === pageId)).toBe(false);

    // Also verify data is gone
    const deletedData = await dataStore.load(pageId);
    expect(deletedData).toBeNull();
  });
});
