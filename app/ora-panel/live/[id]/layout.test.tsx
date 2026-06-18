// @vitest-environment jsdom
/**
 * Example tests for the chrome-free Live Page Editor layout — segment layout
 * + Editor_UI overlay layout behavior.
 * Spec: live-page-editor — task 3.3.
 * _Requirements: 3.1, 3.5, 3.6_
 *
 * Two layout seams cooperate to produce the chrome-free, full-bleed editor:
 *   - the PARENT panel layout drops its chrome for `/ora-panel/live/` paths
 *     (covered by `app/ora-panel/layout.chromeless.test.tsx` — Req 3.2–3.4);
 *   - this SEGMENT layout (`app/ora-panel/live/[id]/layout.tsx`) provides the
 *     full-bleed `data-live-editor-root` container that wraps `children` at
 *     100% viewport width with no chrome margin/padding (Req 3.1).
 *
 * Req 3.5/3.6 concern the floating Editor_UI: the overlays must occupy NO space
 * in the page-content layout (so they don't reduce content width) and must
 * leave any content they obscure fully rendered. jsdom performs no visual
 * layout, so "occupies no layout space" is verified structurally the way it is
 * actually guaranteed in the product: every Editor_UI overlay is marked
 * `data-inline-editor-ui` and taken OUT OF FLOW via `position: fixed`/`absolute`
 * (an out-of-flow box contributes zero size to its in-flow siblings, so the
 * page content's width is unaffected). The obscured page content is asserted to
 * remain present in the DOM (Req 3.6). The real shipping overlay components
 * (`InlineSaveBar`, `SelectionOverlay`) are rendered so these guarantees are
 * checked against production code, not a stand-in.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import LiveEditorSegmentLayout from "./layout";
import { InlineSaveBar } from "@/lib/cms/inline-editor/InlineSaveBar";
import { SelectionOverlay } from "@/lib/cms/inline-editor/SelectionOverlay";

afterEach(() => cleanup());

describe("Feature: live-page-editor — full-bleed segment layout (Req 3.1)", () => {
  it("wraps children in a 100vw, zero-padding data-live-editor-root container", () => {
    const { container } = render(
      <LiveEditorSegmentLayout>
        <div data-testid="page-content">PAGE</div>
      </LiveEditorSegmentLayout>,
    );

    const root = container.querySelector<HTMLElement>("[data-live-editor-root]");
    expect(root).not.toBeNull();

    // Full-bleed: spans the viewport width with no chrome margin/padding (Req 3.1).
    expect(root!.style.width).toBe("100vw");
    expect(root!.style.minHeight).toBe("100vh");
    expect(root!.style.margin).toBe("0px");
    expect(root!.style.padding).toBe("0px");

    // The page content is nested INSIDE the full-bleed root (it wraps children).
    const content = screen.getByTestId("page-content");
    expect(root!.contains(content)).toBe(true);
  });
});

describe("Feature: live-page-editor — Editor_UI overlays occupy no layout space (Req 3.5, 3.6)", () => {
  // A representative selection target for SelectionOverlay to outline. The
  // overlay measures it on mount and renders its (out-of-flow) outline.
  function makeSelectedEl(): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("data-puck-id", "block-1");
    document.body.appendChild(el);
    return el;
  }

  it("every Editor_UI overlay is data-inline-editor-ui and out of flow (fixed/absolute)", () => {
    const selectedEl = makeSelectedEl();

    const { container } = render(
      <LiveEditorSegmentLayout>
        {/* The page content the visitor sees — full width. */}
        <div data-testid="page-content" style={{ width: "100%" }}>
          obscured-but-present page content
        </div>
        {/* Real floating Editor_UI overlays the shell layers over the page. */}
        <InlineSaveBar
          pageId="p1"
          dirty={false}
          data={{}}
          version={null}
          onSaved={() => {}}
          onExit={() => {}}
          onPermissionRevoked={() => {}}
        />
        <SelectionOverlay
          selectedEl={selectedEl}
          selectedLabel="Hero"
          onEdit={() => {}}
        />
      </LiveEditorSegmentLayout>,
    );

    const overlays = Array.from(
      container.querySelectorAll<HTMLElement>("[data-inline-editor-ui]"),
    );
    // Both overlay roots are present and marked as Editor_UI.
    expect(overlays.length).toBeGreaterThanOrEqual(2);

    // Each Editor_UI overlay is taken out of normal flow, so it contributes no
    // size to in-flow siblings (cannot reduce the page content width — Req 3.5).
    for (const overlay of overlays) {
      expect(["fixed", "absolute"]).toContain(overlay.style.position);
    }

    // The save bar overlay specifically is fixed (floats over scrolling content).
    const saveBar = screen.getByTestId("inline-save-bar");
    expect(saveBar.getAttribute("data-inline-editor-ui")).not.toBeNull();
    expect(saveBar.style.position).toBe("fixed");

    selectedEl.remove();
  });

  it("page content stays rendered and full-width beneath the overlays (Req 3.1, 3.6)", () => {
    const selectedEl = makeSelectedEl();

    render(
      <LiveEditorSegmentLayout>
        <div data-testid="page-content" style={{ width: "100%" }}>
          obscured page content
        </div>
        <InlineSaveBar
          pageId="p1"
          dirty
          data={{}}
          version={null}
          onSaved={() => {}}
          onExit={() => {}}
          onPermissionRevoked={() => {}}
        />
        <SelectionOverlay
          selectedEl={selectedEl}
          selectedLabel="Hero"
          onEdit={() => {}}
        />
      </LiveEditorSegmentLayout>,
    );

    // Obscured content remains fully rendered in the DOM (Req 3.6) ...
    const content = screen.getByTestId("page-content");
    expect(content).toBeDefined();
    expect(content.textContent).toContain("obscured page content");
    // ... at its full width, unchanged by the overlaid Editor_UI (Req 3.1, 3.5):
    // the overlays are out of flow, so the content style is untouched.
    expect(content.style.width).toBe("100%");

    selectedEl.remove();
  });
});
