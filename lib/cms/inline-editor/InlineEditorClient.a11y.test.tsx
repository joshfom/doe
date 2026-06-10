// @vitest-environment jsdom

// Polyfills required by Puck under jsdom — must run before importing
// PageRenderer (which transitively loads @dnd-kit/dom). `vi.hoisted`
// guarantees this runs before any `import` is evaluated.
import { vi } from "vitest";
vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (typeof window !== "undefined") {
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
  }
});

/**
 * InlineEditorClient — accessibility landmark preservation.
 *
 * Spec: custom-branded-page-builder — task 18.1
 * _Requirements: 18.5_
 *
 * The inline editor wraps every block in a `data-puck-id` `<div>` so
 * the `useInlineSelection` hook can map clicks back to component ids
 * (task 15.5). That wrapper MUST NOT:
 *   - introduce its own landmark role (would create a phantom region
 *     in the screen-reader tree),
 *   - swallow the surrounding `<main>` / `<header>` / `<footer>` /
 *     `<nav>` landmarks the route provides, or
 *   - re-order or duplicate child landmark elements.
 *
 * The wrapper uses `display: contents` to stay invisible in layout;
 * this test asserts it's also invisible to assistive technology.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PageRenderer } from "@/lib/page-builder/components/PageRenderer";
import type { PageData } from "@/lib/page-builder/types";

const fixture: PageData = {
  content: [
    {
      type: "Section",
      props: {
        id: "section-hero",
        backgroundColor: "#ffffff",
        paddingTop: "lg",
        paddingBottom: "lg",
      },
    },
    {
      type: "Heading",
      props: {
        id: "heading-1",
        text: "Welcome",
        level: "h1",
      },
    },
    {
      type: "Text",
      props: {
        id: "text-1",
        text: "Body copy",
      },
    },
  ],
  root: { props: {} },
};

function renderWithMain(editMode: boolean) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <header data-testid="route-header">site header</header>
      <nav data-testid="route-nav">site nav</nav>
      <main data-testid="route-main">
        <PageRenderer data={fixture} editMode={editMode} />
      </main>
      <footer data-testid="route-footer">site footer</footer>
    </QueryClientProvider>,
  );
}

describe("InlineEditorClient — landmark preservation (Req 18.5)", () => {
  it("editMode=true keeps the route's <main>, <header>, <nav>, <footer> exactly once", () => {
    const { container } = renderWithMain(true);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelectorAll("header")).toHaveLength(1);
    expect(container.querySelectorAll("nav")).toHaveLength(1);
    expect(container.querySelectorAll("footer")).toHaveLength(1);
  });

  it("editMode wrappers carry data-puck-id but no landmark role", () => {
    const { container } = renderWithMain(true);
    const wrappers = Array.from(container.querySelectorAll("[data-puck-id]"));
    expect(wrappers.length).toBeGreaterThan(0);
    for (const el of wrappers) {
      // No phantom landmark role smuggled onto the annotation div.
      expect(el.getAttribute("role")).toBeNull();
      // Layout-neutral wrapper.
      expect((el as HTMLElement).style.display).toBe("contents");
    }
  });

  it("editMode=false produces zero data-puck-id annotations (Req 16.1)", () => {
    const { container } = renderWithMain(false);
    expect(container.querySelectorAll("[data-puck-id]")).toHaveLength(0);
  });

  it("annotation ids match the block ids in the data", () => {
    const { container } = renderWithMain(true);
    const ids = Array.from(container.querySelectorAll("[data-puck-id]"))
      .map((el) => el.getAttribute("data-puck-id"))
      .filter((v): v is string => typeof v === "string");
    expect(ids).toEqual(
      expect.arrayContaining(["section-hero", "heading-1", "text-1"]),
    );
  });
});
