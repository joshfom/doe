// @vitest-environment jsdom
/**
 * InlineEditorInner — shared inner editor body + permission-revocation lockout.
 *
 * Spec: live-page-editor — task 1.7
 * _Requirements: 3.4, 7.3_
 *
 * Task 1.6 made `InlineEditorInner` the single source of truth for the
 * selection→sheet wiring AND the permission-revocation lockout shared by both
 * the public client and the live editor shell. These tests pin the lockout
 * contract:
 *
 *   1. `RevokedOverlay` renders the non-dismissable lockout notice
 *      (`data-testid="inline-editor-revoked"`).
 *   2. When a save reports 403 — i.e. `InlineSaveBar` fires its
 *      `onPermissionRevoked` callback — the inner trips its lockout: it stops
 *      rendering editing affordances and shows `RevokedOverlay`, and it
 *      bubbles the signal to the host shell via the optional
 *      `onPermissionRevoked` prop.
 *
 * The Puck store and the selection/sheet/save-bar children are mocked so the
 * test exercises the lockout wiring in isolation. The module-scope config
 * augmentation deps are stubbed so importing the module stays light.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// --- Module-scope dependency stubs (keep the import light) -------------------
vi.mock("@/lib/page-builder/builder-shell/with-inline-richtext-menu", () => ({
  withInlineRichtextMenu: (config: unknown) => config,
}));
vi.mock("@/lib/page-builder/config", () => ({
  pageBuilderConfig: { components: {}, categories: {} },
}));

// --- Puck store: minimal stable app state + no-op dispatch -------------------
vi.mock("@/lib/page-builder/use-puck-store", () => ({
  usePuckStore: (selector: (s: unknown) => unknown) =>
    selector({
      appState: { data: { content: [], root: { props: {} } } },
      dispatch: () => {},
    }),
}));

// --- Selection: nothing selected (lockout path doesn't depend on selection) --
vi.mock("./useInlineSelection", () => ({
  useInlineSelection: () => ({
    selectedId: null,
    selectedEl: null,
    setSelectedId: () => {},
  }),
}));

// --- Floating UI children: observable stubs ----------------------------------
vi.mock("./SelectionOverlay", () => ({
  SelectionOverlay: () => <div data-testid="selection-overlay" />,
}));
vi.mock("./ConfigurationSheet", () => ({
  ConfigurationSheet: () => <div data-testid="config-sheet" />,
}));

// The save bar stub exposes a button that simulates the 403 → revoke path.
vi.mock("./InlineSaveBar", () => ({
  InlineSaveBar: ({
    onPermissionRevoked,
  }: {
    onPermissionRevoked: () => void;
  }) => (
    <div data-testid="save-bar">
      <button
        type="button"
        data-testid="simulate-403"
        onClick={onPermissionRevoked}
      >
        simulate 403
      </button>
    </div>
  ),
}));

import { InlineEditorInner, RevokedOverlay } from "./InlineEditorInner";

const initialData = { content: [], root: { props: {} } };

afterEach(() => cleanup());

describe("Feature: live-page-editor — RevokedOverlay (Req 7.3)", () => {
  it("renders the non-dismissable lockout notice", () => {
    render(<RevokedOverlay />);
    const overlay = screen.getByTestId("inline-editor-revoked");
    expect(overlay).toBeDefined();
    expect(overlay.getAttribute("role")).toBe("alertdialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
  });
});

describe("Feature: live-page-editor — InlineEditorInner lockout (Req 3.4, 7.3)", () => {
  it("renders editing affordances and no lockout overlay before a 403", () => {
    render(
      <InlineEditorInner
        pageId="page-1"
        initialData={initialData}
        onExit={() => {}}
      />,
    );

    expect(screen.getByTestId("save-bar")).toBeDefined();
    expect(screen.getByTestId("config-sheet")).toBeDefined();
    expect(screen.queryByTestId("inline-editor-revoked")).toBeNull();
  });

  it("locks out and renders RevokedOverlay when the save bar reports a 403", () => {
    render(
      <InlineEditorInner
        pageId="page-1"
        initialData={initialData}
        onExit={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("simulate-403"));

    // Lockout overlay is shown...
    expect(screen.getByTestId("inline-editor-revoked")).toBeDefined();
    // ...and the editing affordances are torn down.
    expect(screen.queryByTestId("save-bar")).toBeNull();
    expect(screen.queryByTestId("config-sheet")).toBeNull();
    expect(screen.queryByTestId("selection-overlay")).toBeNull();
  });

  it("bubbles the revocation to the host shell via onPermissionRevoked", () => {
    const onPermissionRevoked = vi.fn();
    render(
      <InlineEditorInner
        pageId="page-1"
        initialData={initialData}
        onExit={() => {}}
        onPermissionRevoked={onPermissionRevoked}
      />,
    );

    fireEvent.click(screen.getByTestId("simulate-403"));

    expect(onPermissionRevoked).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("inline-editor-revoked")).toBeDefined();
  });
});
