// @vitest-environment jsdom
/**
 * InlineEditorClient — opt-in gate vs. `alwaysOn` (shared-inner extraction).
 *
 * Spec: live-page-editor — task 1.7
 * _Requirements: 3.4, 7.3_
 *
 * Task 1.6 pulled the headless-Puck + selection + sheets wiring out of
 * `InlineEditorClient` into the shared `InlineEditorInner`, and turned the
 * public "Enter Edit Mode" opt-in into an `alwaysOn` prop. These tests pin
 * the gate contract on the public client:
 *
 *   1. With `alwaysOn` defaulting to `false`, the public client renders the
 *      opt-in trigger (`data-testid="inline-editor-trigger"`) and does NOT
 *      mount the shared inner until the user clicks it.
 *   2. With `alwaysOn` set, the shared inner mounts directly and no opt-in
 *      trigger is ever rendered.
 *
 * The heavy `<Puck>` context and the shared inner are mocked so these tests
 * focus on the gate wiring; `fetch` (the on-mount `GET /api/pages/:id`) is
 * stubbed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// Mock the heavy Puck context to a passthrough so we don't need a real
// editor engine — the gate just needs to know whether the inner mounted.
vi.mock("@puckeditor/core", () => ({
  Puck: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="puck-context">{children}</div>
  ),
}));

// Mock the shared inner so its mount is observable without dragging in the
// real selection/sheet/save-bar wiring. Re-export the named values
// `InlineEditorClient` imports from the same module.
vi.mock("./InlineEditorInner", () => ({
  InlineEditorInner: () => <div data-testid="inner-editor">inner</div>,
  editorConfig: {},
  INLINE_EDITOR_PERMISSIONS: { duplicate: false, delete: false },
}));

// `headlessOverrides` is just an overrides object; stub to avoid pulling in
// builder-shell internals.
vi.mock("@/lib/page-builder/builder-shell/headless-overrides", () => ({
  headlessOverrides: {},
}));

// `migratePageData` is identity for our purposes.
vi.mock("@/lib/page-builder/migrate-data", () => ({
  migratePageData: (data: unknown) => data,
}));

import { InlineEditorClient } from "./InlineEditorClient";

const PAGE_PAYLOAD = {
  data: { id: "page-1", slug: "home", data: { content: [], root: { props: {} } } },
};

function mockFetchOk() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => PAGE_PAYLOAD,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Feature: live-page-editor — InlineEditorClient gate (Req 3.4, 7.3)", () => {
  beforeEach(() => {
    mockFetchOk();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("defaults to the opt-in gate: renders the trigger and does NOT mount the inner", () => {
    render(<InlineEditorClient pageId="page-1" />);

    // The opt-in trigger is present...
    expect(screen.getByTestId("inline-editor-trigger")).toBeDefined();
    // ...and the shared inner editor is NOT mounted yet.
    expect(screen.queryByTestId("inner-editor")).toBeNull();
    expect(screen.queryByTestId("puck-context")).toBeNull();
  });

  it("mounts the shared inner only after the user opts in via the trigger", async () => {
    render(<InlineEditorClient pageId="page-1" />);

    fireEvent.click(screen.getByTestId("inline-editor-trigger"));

    // After opting in and the page snapshot loading, the inner mounts inside
    // the headless Puck context and the trigger is gone.
    await waitFor(() => {
      expect(screen.getByTestId("inner-editor")).toBeDefined();
    });
    expect(screen.getByTestId("puck-context")).toBeDefined();
    expect(screen.queryByTestId("inline-editor-trigger")).toBeNull();
  });

  it("with alwaysOn set, mounts the inner directly without showing the gate", async () => {
    render(<InlineEditorClient pageId="page-1" alwaysOn />);

    // The inner mounts once the snapshot loads — no opt-in step required.
    await waitFor(() => {
      expect(screen.getByTestId("inner-editor")).toBeDefined();
    });
    expect(screen.getByTestId("puck-context")).toBeDefined();
    // The opt-in trigger is never rendered in always-on mode.
    expect(screen.queryByTestId("inline-editor-trigger")).toBeNull();
  });
});
