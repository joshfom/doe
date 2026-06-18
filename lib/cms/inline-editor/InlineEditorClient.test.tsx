// @vitest-environment jsdom

/**
 * InlineEditorClient — opt-in gate vs. always-on mounting + revocation lockout.
 *
 * Spec: live-page-editor — task 1.7
 * _Requirements: 3.4, 7.3_
 *
 * After extracting the shared selection→sheet body into `InlineEditorInner`
 * (task 1.6), the public `InlineEditorClient` must still:
 *   1. Gate behind the "Enter Edit Mode" opt-in trigger by default, mounting
 *      the shared inner only after the user opts in (Req 3.4).
 *   2. Mount the inner directly with no gate when `alwaysOn` is set — the
 *      surface the dedicated live editor uses (Req 3.4).
 *   3. Route the inner's `onPermissionRevoked` callback into the
 *      non-dismissable revocation lockout overlay (Req 7.3 / 9.5).
 *
 * The real `<Puck>` mount, the page-builder config, and the inner body are
 * stubbed: this test asserts the *gating + wiring* contract of the client
 * shell, not Puck internals (those are covered elsewhere).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";

// --- Mocks -----------------------------------------------------------------
// Capture the props the client hands to the shared inner so we can drive its
// `onPermissionRevoked` callback and assert direct (gate-less) mounting.
const innerProps = vi.hoisted(() => ({
  current: null as null | { onPermissionRevoked: () => void },
}));

vi.mock("./InlineEditorInner", () => ({
  InlineEditorInner: (props: { onPermissionRevoked: () => void }) => {
    innerProps.current = props;
    return (
      <div data-testid="inline-editor-inner">
        <button
          type="button"
          data-testid="trigger-revocation"
          onClick={() => props.onPermissionRevoked()}
        >
          revoke
        </button>
      </div>
    );
  },
}));

// Stub `<Puck>` so we don't need a real headless Puck context — it just
// renders its children (the inner) straight through.
vi.mock("@puckeditor/core", () => ({
  Puck: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="puck-context">{children}</div>
  ),
}));

// Keep module-scope config augmentation cheap and side-effect free.
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

import { InlineEditorClient } from "./InlineEditorClient";

const PAGE_FIXTURE = {
  id: "page-1",
  slug: "/home",
  data: { content: [], root: { props: {} } },
};

function mockFetchOk() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: PAGE_FIXTURE }),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  innerProps.current = null;
  mockFetchOk();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Feature: live-page-editor — InlineEditorClient gating (Req 3.4)", () => {
  it("default render shows the opt-in trigger and does not mount the inner", async () => {
    render(<InlineEditorClient pageId="page-1" />);

    // The public-page opt-in gate is present...
    expect(screen.getByTestId("inline-editor-trigger")).toBeTruthy();
    // ...and the shared inner is NOT mounted until the user opts in.
    expect(screen.queryByTestId("inline-editor-inner")).toBeNull();
    expect(innerProps.current).toBeNull();
  });

  it("alwaysOn mounts the shared inner directly without the opt-in gate", async () => {
    render(<InlineEditorClient pageId="page-1" alwaysOn />);

    // No opt-in gate is ever rendered in always-on mode.
    expect(screen.queryByTestId("inline-editor-trigger")).toBeNull();

    // The inner mounts directly once the page snapshot loads.
    await waitFor(() =>
      expect(screen.getByTestId("inline-editor-inner")).toBeTruthy(),
    );
    expect(screen.getByTestId("puck-context")).toBeTruthy();
    expect(innerProps.current).not.toBeNull();
  });
});

describe("Feature: live-page-editor — revocation lockout wiring (Req 7.3)", () => {
  it("renders the non-dismissable revocation overlay when the inner reports a revocation", async () => {
    render(<InlineEditorClient pageId="page-1" alwaysOn />);

    await waitFor(() =>
      expect(screen.getByTestId("inline-editor-inner")).toBeTruthy(),
    );

    // The shared inner trips the lockout via its onPermissionRevoked prop.
    act(() => {
      screen.getByTestId("trigger-revocation").click();
    });

    const overlay = await screen.findByTestId("inline-editor-revoked");
    expect(overlay).toBeTruthy();
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("role")).toBe("alertdialog");

    // Lockout replaces the editor entirely — the inner is gone.
    expect(screen.queryByTestId("inline-editor-inner")).toBeNull();
  });
});
