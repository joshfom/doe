// @vitest-environment jsdom
/**
 * LiveEditorShell — leave guard + permission-revocation lock (example tests).
 *
 * Spec: live-page-editor — task 10.4
 * _Requirements: 8.4, 8.5, 8.6_
 *
 * Complements `InlineSaveBar.save-response.test.tsx` (which covers the one-shot
 * save responses 8.1/8.2/8.5/8.7/8.8 at the bar level). This file covers the
 * shell-owned behaviours:
 *
 *   • Req 8.4      — the leave guard: while unsaved changes exist a
 *                    `beforeunload` prompt is armed for full-page unloads, and
 *                    an in-app exit consults `window.confirm` — confirming
 *                    navigates, cancelling retains the unsaved changes (no
 *                    navigation). A clean editor arms neither guard.
 *   • Req 8.5/8.6  — a permission-revoked save (`403` → `onPermissionRevoked`)
 *                    locks the editor: the non-dismissable revoked overlay
 *                    replaces the whole editor surface so no further edit/save
 *                    UI is reachable.
 *
 * The dirty signal and the save responses originate in the shared
 * `InlineEditorInner`; here it is replaced with a double that exposes its props
 * (`onDirtyChange`, `onExit`, `onPermissionRevoked`) so the test can drive the
 * shell's guard/lock logic directly. The heavy Puck/renderer dependencies are
 * stubbed — this asserts the shell's wiring, not Puck internals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import React from "react";

// --- Router mock: observe same-tab navigations the exit guard performs. -----
const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

// --- Headless Puck context double: render children straight through. --------
vi.mock("@puckeditor/core", () => ({
  Puck: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="puck-context">{children}</div>
  ),
}));

// --- Puck store double: stable empty page content. --------------------------
const puckMock = vi.hoisted(() => ({
  appState: { data: { content: [], root: { props: {} } } },
  dispatch: vi.fn(),
}));
vi.mock("@/lib/page-builder/use-puck-store", () => ({
  usePuckStore: (selector: (s: { appState: unknown; dispatch: unknown }) => unknown) =>
    selector({ appState: puckMock.appState, dispatch: puckMock.dispatch }),
}));

// --- Cheap, side-effect-free config/transform stubs. ------------------------
vi.mock("@/lib/page-builder/config", () => ({ pageBuilderConfig: {} }));
vi.mock("@/lib/page-builder/builder-shell/headless-overrides", () => ({
  headlessOverrides: {},
}));
vi.mock("@/lib/page-builder/builder-shell/with-inline-richtext-menu", () => ({
  withInlineRichtextMenu: (config: unknown) => config,
}));
vi.mock("@/lib/page-builder/migrate-data", () => ({
  migratePageData: (data: unknown) => data,
}));

// --- Preview/renderer/sheet/neutralizer: keep the test light + isolated. ----
vi.mock("@/lib/page-builder/components/PageRenderer", () => ({
  PageRenderer: () => <div data-testid="page-renderer" />,
}));
vi.mock("./PreviewStage", () => ({
  PreviewStage: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="preview-stage">{children}</div>
  ),
}));
vi.mock("./useNavigationNeutralizer", () => ({
  useNavigationNeutralizer: () => {},
}));
vi.mock("./ComponentSheet", () => ({
  ComponentSheet: () => <div data-testid="component-sheet" />,
  insertionIndex: (selectedIndex: number | null, length: number) =>
    selectedIndex == null ? length : selectedIndex + 1,
}));

// --- Shared inner double: expose props so the test drives the shell wiring. -
const innerProps = vi.hoisted(() => ({
  current: null as null | {
    onDirtyChange?: (dirty: boolean) => void;
    onExit: () => void;
    onPermissionRevoked: () => void;
  },
}));
vi.mock("@/lib/cms/inline-editor/InlineEditorInner", () => ({
  InlineEditorInner: (props: {
    onDirtyChange?: (dirty: boolean) => void;
    onExit: () => void;
    onPermissionRevoked: () => void;
  }) => {
    innerProps.current = props;
    return <div data-testid="inline-editor-inner" />;
  },
}));

import { LiveEditorShell } from "./LiveEditorShell";

const INITIAL_DATA = { content: [], root: { props: {} } } as never;

function renderShell() {
  return render(
    <LiveEditorShell
      pageId="page-1"
      initialData={INITIAL_DATA}
      version="v-1"
      locale="en"
    />,
  );
}

/** Dispatch a cancelable beforeunload event; return whether it was blocked. */
function dispatchBeforeUnload(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function setDirty(dirty: boolean) {
  act(() => {
    innerProps.current!.onDirtyChange?.(dirty);
  });
}

beforeEach(() => {
  innerProps.current = null;
  routerMock.push.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Feature: live-page-editor — LiveEditorShell beforeunload guard (Req 8.4)", () => {
  it("arms the beforeunload prompt only while unsaved changes exist", () => {
    renderShell();
    expect(innerProps.current).not.toBeNull();

    // Clean editor: a full-page unload is NOT blocked.
    expect(dispatchBeforeUnload()).toBe(false);

    // Dirty editor: the unload is blocked (browser shows the leave prompt).
    setDirty(true);
    expect(dispatchBeforeUnload()).toBe(true);

    // Reverting to a clean state disarms the guard again.
    setDirty(false);
    expect(dispatchBeforeUnload()).toBe(false);
  });
});

describe("Feature: live-page-editor — LiveEditorShell in-app exit guard (Req 8.4)", () => {
  it("navigates immediately when there are no unsaved changes", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderShell();

    act(() => {
      innerProps.current!.onExit();
    });

    // No unsaved changes → no confirmation needed, navigation proceeds.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith("/ora-panel/pages/page-1/edit");
  });

  it("retains unsaved changes when the user cancels the exit confirmation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderShell();
    setDirty(true);

    act(() => {
      innerProps.current!.onExit();
    });

    // Confirm was consulted, the user cancelled → no navigation, edits retained.
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("navigates when the user confirms leaving with unsaved changes", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderShell();
    setDirty(true);

    act(() => {
      innerProps.current!.onExit();
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(routerMock.push).toHaveBeenCalledWith("/ora-panel/pages/page-1/edit");
  });
});

describe("Feature: live-page-editor — LiveEditorShell revocation lock (Req 8.5, 8.6)", () => {
  it("locks the editor behind the non-dismissable revoked overlay on a 403", () => {
    renderShell();

    // Editing UI is present before revocation.
    expect(screen.getByTestId("inline-editor-inner")).toBeTruthy();
    expect(screen.getByTestId("component-sheet")).toBeTruthy();

    // A permission-revoked save trips the lock (Req 8.5).
    act(() => {
      innerProps.current!.onPermissionRevoked();
    });

    // The non-dismissable overlay replaces the whole editor surface, so no
    // further edits or saves are reachable until refresh (Req 8.6).
    const overlay = screen.getByTestId("live-editor-revoked");
    expect(overlay.getAttribute("role")).toBe("alertdialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");

    expect(screen.queryByTestId("inline-editor-inner")).toBeNull();
    expect(screen.queryByTestId("component-sheet")).toBeNull();
    expect(screen.queryByTestId("puck-context")).toBeNull();
  });
});
