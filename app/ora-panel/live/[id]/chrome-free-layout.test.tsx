// @vitest-environment jsdom

/**
 * Example tests for the chrome-free, full-bleed live-editor layout.
 *
 * Spec: live-page-editor — task 3.3
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
 *
 * The chrome-free guarantee is split across two files (the design notes a
 * nested segment layout cannot strip a parent layout in Next.js):
 *
 *   - `app/ora-panel/layout.tsx` — the parent layout recognises
 *     `/ora-panel/live/` paths as chromeless (task 3.1) and renders `children`
 *     inside `QueryClientProvider` with NO sidebar/`aside`, NO `nav`, and NO
 *     `ml-16` main padding — a full-viewport container.
 *   - `app/ora-panel/live/[id]/layout.tsx` — the segment layout (task 3.2)
 *     provides the full-bleed `data-live-editor-root` container occupying 100%
 *     width and a `relative` positioning context for overlays.
 *
 * These tests assert the *structure* both layouts produce:
 *   - no site header / nav / footer, no builder palette/config sidebars (3.2–3.4)
 *   - the live wrapper is full-bleed / 100% width with no chrome padding (3.1)
 *   - Editor_UI (`data-inline-editor-ui`) overlays coexist with page content
 *     without removing it from the tree, and the full-bleed content wrapper
 *     keeps its width classes regardless of overlays (3.5, 3.6)
 *
 * The parent layout is a client component (`usePathname` + a session `fetch`),
 * so `next/navigation` and `fetch` are mocked exactly as the route shell would
 * see them on a live path. Mirrors the mocking conventions of the sibling
 * `page.test.tsx` (next/navigation) and the a11y test (jsdom + RTL structure).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── next/navigation: pin the active path to a live-editor route ───────────────
let currentPathname = "/ora-panel/live/11111111-1111-4111-8111-111111111111";
const routerReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

// next/image and next/link only render inside the *chrome* branch (the contrast
// test). Reduce them to host elements so jsdom renders them without the modified
// Next image/link runtime getting in the way of a structural assertion.
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { src, alt, ...rest } = props as any;
    return <img src={typeof src === "string" ? src : ""} alt={alt} {...rest} />;
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Imports must follow the mocks so the modules pick them up.
import OraPanelLayout from "@/app/ora-panel/layout";
import LiveEditorLayout from "./layout";

// ── Shared child fixture: page content beneath a floating Editor_UI overlay ───
function EditorChildren() {
  return (
    <>
      {/* Obscured page content — must stay rendered (Req 3.6). */}
      <div data-testid="page-content">live published page</div>
      {/* Floating Editor_UI overlay, out of flow so it reserves no layout
          space and never reduces the content width (Req 3.5). */}
      <div
        data-testid="editor-overlay"
        data-inline-editor-ui
        style={{ position: "fixed", bottom: 0, left: 0 }}
      >
        toolbar
      </div>
    </>
  );
}

// ── Session fetch mock helpers ────────────────────────────────────────────────
function mockSessionFetch(session: {
  userId: string;
  permissions: string[];
}) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: session }),
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  routerReplace.mockClear();
  currentPathname = "/ora-panel/live/11111111-1111-4111-8111-111111111111";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ora-panel layout — chromeless branch on /ora-panel/live/ (Req 3.2–3.4)", () => {
  it("renders no site header, nav, footer, or builder sidebars and no ml-16 padding", async () => {
    mockSessionFetch({ userId: "u-1", permissions: ["pages:edit"] });

    const { container } = render(
      <OraPanelLayout>
        <EditorChildren />
      </OraPanelLayout>
    );

    // Wait out the session-loading state until the children mount.
    await screen.findByTestId("page-content");

    // No site header / nav / footer (Req 3.2, 3.3).
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();

    // No builder/admin palette or configuration sidebars (Req 3.4).
    expect(container.querySelector("aside")).toBeNull();

    // No reserved `ml-16` main padding for the (absent) sidebar (Req 3.1/3.4).
    expect(container.querySelector('[class*="ml-16"]')).toBeNull();
    // The chrome `<main>` shell is not rendered on the live path.
    expect(container.querySelector("main")).toBeNull();
  });

  it("wraps children in a full-viewport (w-full) container (Req 3.1)", async () => {
    mockSessionFetch({ userId: "u-1", permissions: ["pages:edit"] });

    const { container } = render(
      <OraPanelLayout>
        <EditorChildren />
      </OraPanelLayout>
    );

    const content = await screen.findByTestId("page-content");

    // The chromeless wrapper occupies the full viewport width/height.
    const wrapper = content.parentElement as HTMLElement;
    expect(wrapper.className).toContain("w-full");
    expect(wrapper.className).toContain("min-h-screen");
  });

  it("keeps obscured page content rendered alongside the Editor_UI overlay (Req 3.5, 3.6)", async () => {
    mockSessionFetch({ userId: "u-1", permissions: ["pages:edit"] });

    render(
      <OraPanelLayout>
        <EditorChildren />
      </OraPanelLayout>
    );

    // Obscured content is still in the tree (not removed by the overlay).
    const content = await screen.findByTestId("page-content");
    expect(content).toBeDefined();

    // The overlay is marked as Editor_UI and is positioned out of flow, so it
    // reserves no layout space and cannot reduce the content width.
    const overlay = screen.getByTestId("editor-overlay");
    expect(overlay.getAttribute("data-inline-editor-ui")).not.toBeNull();
    expect(["fixed", "absolute"]).toContain(overlay.style.position);
  });
});

describe("ora-panel layout — chrome IS present on non-live paths (contrast)", () => {
  it("renders the sidebar, nav, and ml-16 main shell off the live route", async () => {
    currentPathname = "/ora-panel/pages";
    mockSessionFetch({ userId: "u-1", permissions: ["*:*"] });

    const { container } = render(
      <OraPanelLayout>
        <div data-testid="admin-content">admin</div>
      </OraPanelLayout>
    );

    await screen.findByTestId("admin-content");

    // The full admin shell is present here — proving the chromeless assertions
    // above are meaningful and not vacuously true.
    expect(container.querySelector("aside")).not.toBeNull();
    expect(container.querySelector("nav")).not.toBeNull();
    expect(container.querySelector('[class*="ml-16"]')).not.toBeNull();
  });
});

describe("live segment layout — full-bleed data-live-editor-root (Req 3.1, 3.5, 3.6)", () => {
  it("renders a 100%-width, full-bleed root with a relative positioning context", () => {
    const { container } = render(
      <LiveEditorLayout>
        <EditorChildren />
      </LiveEditorLayout>
    );

    const root = container.querySelector(
      "[data-live-editor-root]"
    ) as HTMLElement;
    expect(root).not.toBeNull();

    // 100% viewport width with no chrome margin/padding (Req 3.1).
    expect(root.className).toContain("w-full");
    expect(root.className).toContain("min-h-screen");
    // `relative` anchors any absolutely-positioned overlay (Req 3.5/3.6).
    expect(root.className).toContain("relative");

    // No chrome padding/margin is reintroduced by the wrapper.
    expect(root.className).not.toContain("ml-16");
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
    expect(container.querySelector("aside")).toBeNull();
  });

  it("keeps obscured content rendered beneath the floating overlay (Req 3.6)", () => {
    render(
      <LiveEditorLayout>
        <EditorChildren />
      </LiveEditorLayout>
    );

    // Both the obscured page content and the overlay coexist in the tree.
    expect(screen.getByTestId("page-content")).toBeDefined();
    const overlay = screen.getByTestId("editor-overlay");
    expect(overlay.getAttribute("data-inline-editor-ui")).not.toBeNull();
    // Out-of-flow overlay reserves no layout space (Req 3.5).
    expect(["fixed", "absolute"]).toContain(overlay.style.position);
  });
});
