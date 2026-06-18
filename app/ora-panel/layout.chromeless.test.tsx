// @vitest-environment jsdom
/**
 * Example tests for the chrome-free Live Page Editor layout path.
 * Spec: live-page-editor — task 3.3.
 * _Requirements: 3.2, 3.3, 3.4_
 *
 * `app/ora-panel/layout.tsx` is the authenticated panel shell. It renders its
 * full chrome (a `<aside>` sidebar containing the `<nav>` and a "Logout"
 * control, plus the padded `<main>`) for ordinary panel routes, but special-
 * cases a set of "chromeless" paths — the login/register routes and, added by
 * task 3.1, the live page editor `/ora-panel/live/[id]` — by rendering only
 * `children` inside the `QueryClientProvider` with NO sidebar, NO nav, NO
 * Logout, and NO main padding.
 *
 * The chromeless branch is driven entirely by `usePathname()`. These tests mock
 * `next/navigation` to return a `/ora-panel/live/<id>` path and assert that the
 * site/builder chrome is absent while `children` still render. A contrasting
 * non-chromeless render proves the very chrome the live path omits (`<aside>`,
 * `<nav>`, "Logout") is genuinely produced by the shell otherwise — so the
 * absence assertions are meaningful, not vacuous.
 *
 * Requirement mapping:
 *   - 3.2 — no site header / no site navigation in the live editor path.
 *   - 3.3 — no site footer in the live editor path.
 *   - 3.4 — no builder left palette / right configuration sidebars
 *           (the panel `<aside>` sidebar is the only chrome the parent layout
 *           contributes; the live path renders none of it).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

// ── usePathname drives the chromeless branch; useRouter must be a no-op. ──────
const pathnameMock = vi.fn<[], string>();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), prefetch: vi.fn() }),
}));

// Lightweight stand-ins for the Next primitives so we render plain DOM nodes.
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
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));

import OraPanelLayout from "./layout";

const LIVE_PATH = "/ora-panel/live/11111111-1111-1111-1111-111111111111";

function child() {
  return <div data-testid="editor-child">EDITOR CONTENT</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // A fresh fetch spy per test — the chromeless branch must never reach for it.
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Feature: live-page-editor — chrome-free layout (Req 3.2, 3.3, 3.4)", () => {
  it("live editor path renders children with NO sidebar, nav, footer, or Logout chrome", async () => {
    pathnameMock.mockReturnValue(LIVE_PATH);

    const { container } = render(<OraPanelLayout>{child()}</OraPanelLayout>);

    // children still render (the page is shown chrome-free, not blanked).
    expect(await screen.findByTestId("editor-child")).toBeDefined();

    // No site header / navigation (Req 3.2).
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("header")).toBeNull();
    // No builder/panel sidebars (Req 3.4) — the panel <aside> is absent.
    expect(container.querySelector("aside")).toBeNull();
    // No site footer (Req 3.3).
    expect(container.querySelector("footer")).toBeNull();
    // No padded panel <main> wrapper either (chrome-free, full-bleed).
    expect(container.querySelector("main")).toBeNull();

    // The Logout control lives only in the chromed sidebar.
    expect(
      screen.queryByRole("button", { name: /logout/i }),
    ).toBeNull();
    expect(container.querySelector(".lucide-log-out")).toBeNull();

    // The chromeless branch must not trigger the session fetch (Req 3.4 —
    // the live route enforces authorization server-side, not in this layout).
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("treats every /ora-panel/live/<id> path as chromeless", async () => {
    pathnameMock.mockReturnValue("/ora-panel/live/abc-some-other-id");

    const { container } = render(<OraPanelLayout>{child()}</OraPanelLayout>);

    expect(await screen.findByTestId("editor-child")).toBeDefined();
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
  });

  it("CONTRAST: an ordinary panel route DOES render the sidebar, nav, and Logout", async () => {
    // Prove the chrome the live path omits is really produced otherwise, so the
    // absence assertions above are meaningful rather than vacuously true.
    pathnameMock.mockReturnValue("/ora-panel/pages");
    vi.mocked(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      {
        ok: true,
        json: async () => ({
          data: { userId: "u-1", permissions: ["*:*"] },
        }),
      } as unknown as Response,
    );

    const { container } = render(<OraPanelLayout>{child()}</OraPanelLayout>);

    // Wait for the session to resolve and the chromed shell to render.
    await waitFor(() => {
      expect(container.querySelector("aside")).not.toBeNull();
    });
    expect(container.querySelector("nav")).not.toBeNull();
    expect(container.querySelector("main")).not.toBeNull();
    // The Logout control (icon-only while the sidebar is collapsed) lives in
    // the chromed sidebar; identify it by its icon to avoid name flakiness.
    expect(container.querySelector(".lucide-log-out")).not.toBeNull();
    // Children render here too — confirms the contrast is purely about chrome.
    expect(screen.getByTestId("editor-child")).toBeDefined();
  });
});
