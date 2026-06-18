// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ─── Polyfills ───────────────────────────────────────────────────────────────
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

// ─── Mocks ───────────────────────────────────────────────────────────────────

// TopBar's "Edit Live" control reads the app router (next/navigation).
// Hoist the push spy so individual tests can assert on it.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// TopBar reads the undo/redo history off the Puck store.
interface MockPuckState {
  history: {
    back: ReturnType<typeof vi.fn>;
    forward: ReturnType<typeof vi.fn>;
    hasPast: boolean;
    hasFuture: boolean;
  };
}

let mockPuckState: MockPuckState;

vi.mock("../use-puck-store", () => ({
  usePuckStore: (selector: (state: MockPuckState) => unknown) =>
    selector(mockPuckState),
}));

// The BreakpointSwitcher pulls in the breakpoint context; render nothing so the
// test stays focused on the TopBar's Edit Live behaviour.
vi.mock("./BreakpointSwitcher", () => ({
  BreakpointSwitcher: () => null,
}));

// Stub the shell context so we control documentId + dirty.
import type { BuilderShellContextValue } from "./shell-context";

let mockShellState: BuilderShellContextValue;

vi.mock("./shell-context", () => ({
  useBuilderShell: () => mockShellState,
}));

// ─── Import after mocks ──────────────────────────────────────────────────────
const { TopBar } = await import("./TopBar");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stubShell(
  overrides: Partial<BuilderShellContextValue> = {},
): BuilderShellContextValue {
  return {
    documentId: "doc-123",
    documentTitle: "Untitled",
    setDocumentTitle: vi.fn(),
    dirty: false,
    lastSavedAt: null,
    saving: false,
    publishing: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    onPublish: vi.fn().mockResolvedValue(undefined),
    onPreview: vi.fn(),
    errorMessage: null,
    dismissError: vi.fn(),
    ...overrides,
  };
}

const CONFIRM_DIALOG = /confirm leaving for live editor/i;

beforeEach(() => {
  pushMock.mockClear();
  mockPuckState = {
    history: {
      back: vi.fn(),
      forward: vi.fn(),
      hasPast: false,
      hasFuture: false,
    },
  };
  mockShellState = stubShell();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("TopBar — Edit Live entry point", () => {
  // Req 9.1 — single always-visible action with an identifying accessible name.
  it("always renders the Edit Live control with its accessible name", () => {
    render(<TopBar />);
    expect(
      screen.getByRole("button", { name: /edit live page/i }),
    ).toBeTruthy();
  });

  it("still renders the Edit Live control when the page has unsaved changes", () => {
    mockShellState = stubShell({ dirty: true });
    render(<TopBar />);
    expect(
      screen.getByRole("button", { name: /edit live page/i }),
    ).toBeTruthy();
  });

  // Req 9.2 — no unsaved changes navigates same-tab to the live route, no prompt.
  it("navigates to the live route in the same tab when there are no unsaved changes", () => {
    mockShellState = stubShell({ dirty: false, documentId: "doc-123" });
    render(<TopBar />);

    fireEvent.click(screen.getByRole("button", { name: /edit live page/i }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/ora-panel/live/doc-123");
    // No confirmation prompt is shown when there is nothing to lose.
    expect(
      screen.queryByRole("dialog", { name: CONFIRM_DIALOG }),
    ).toBeNull();
  });

  // Req 9.3 — unsaved changes shows a confirm prompt and does NOT navigate yet.
  it("shows a confirmation prompt and does not navigate when there are unsaved changes", () => {
    mockShellState = stubShell({ dirty: true });
    render(<TopBar />);

    fireEvent.click(screen.getByRole("button", { name: /edit live page/i }));

    expect(
      screen.getByRole("dialog", { name: CONFIRM_DIALOG }),
    ).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // Req 9.4 — confirming the prompt navigates to the live route in the same tab.
  it("navigates to the live route when the unsaved-changes prompt is confirmed", () => {
    mockShellState = stubShell({ dirty: true, documentId: "doc-123" });
    render(<TopBar />);

    fireEvent.click(screen.getByRole("button", { name: /edit live page/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /open live editor/i }),
    );

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/ora-panel/live/doc-123");
  });

  // Req 9.5 — cancelling keeps the builder view and retains changes (no nav).
  it("stays on the builder view and does not navigate when the prompt is cancelled", () => {
    mockShellState = stubShell({ dirty: true });
    render(<TopBar />);

    fireEvent.click(screen.getByRole("button", { name: /edit live page/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    // Prompt is dismissed, no navigation occurred — changes are retained.
    expect(
      screen.queryByRole("dialog", { name: CONFIRM_DIALOG }),
    ).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
    // The builder TopBar is still mounted.
    expect(screen.getByTestId("ora-topbar")).toBeTruthy();
    // The unsaved-changes indicator remains.
    expect(screen.getByLabelText(/unsaved changes/i)).toBeTruthy();
  });
});
