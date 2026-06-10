// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

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

// ─── Mock state ──────────────────────────────────────────────────────────────

interface MockPuckState {
  selectedItem: unknown;
  appState: { data: { content: unknown[]; zones: Record<string, unknown[]> } };
  config: { components: Record<string, { label?: string }> };
  dispatch: ReturnType<typeof vi.fn>;
}

let mockPuckState: MockPuckState;

vi.mock("../use-puck-store", () => ({
  usePuckStore: (selector: (state: MockPuckState) => unknown) =>
    selector(mockPuckState),
}));

let mockShellState = {
  dirty: false,
  lastSavedAt: null as string | null,
  errorMessage: null as string | null,
  dismissError: vi.fn(),
};

vi.mock("./shell-context", () => ({
  useBuilderShell: () => mockShellState,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
const { StatusBar } = await import("./StatusBar");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("StatusBar — no selection", () => {
  beforeEach(() => {
    mockShellState = {
      dirty: false,
      lastSavedAt: null,
      errorMessage: null,
      dismissError: vi.fn(),
    };
    mockPuckState = {
      selectedItem: null,
      appState: { data: { content: [], zones: {} } },
      config: { components: {} },
      dispatch: vi.fn(),
    };
  });

  it('renders "No selection" when selectedItem is null', () => {
    render(<StatusBar />);
    expect(screen.getByText("No selection")).toBeTruthy();
  });

  it("does not render AncestorBreadcrumb when no selection", () => {
    render(<StatusBar />);
    expect(
      screen.queryByRole("navigation", { name: /ancestor breadcrumb/i }),
    ).toBeNull();
  });

  it("still renders the save status indicator when no selection", () => {
    render(<StatusBar />);
    expect(screen.getByText("Not saved yet")).toBeTruthy();
  });
});

describe("StatusBar — with selection", () => {
  beforeEach(() => {
    mockShellState = {
      dirty: false,
      lastSavedAt: null,
      errorMessage: null,
      dismissError: vi.fn(),
    };
    mockPuckState = {
      selectedItem: {
        type: "Section",
        props: { id: "abc12345-1234-1234-1234-123456789abc", title: "Hello" },
      },
      appState: {
        data: {
          content: [
            {
              type: "Section",
              props: { id: "abc12345-1234-1234-1234-123456789abc", title: "Hello" },
            },
          ],
          zones: {},
        },
      },
      config: { components: { Section: { label: "Section" } } },
      dispatch: vi.fn(),
    };
  });

  it("does not render any UUID substring in the statusbar", () => {
    render(<StatusBar />);
    const statusbar = screen.getByTestId("ora-statusbar");
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(uuidRegex.test(statusbar.textContent ?? "")).toBe(false);
  });

  it('does not render "No selection" when a block is selected', () => {
    render(<StatusBar />);
    expect(screen.queryByText("No selection")).toBeNull();
  });

  it('renders "Unsaved changes" dirty indicator when dirty is true and a block is selected', () => {
    mockShellState.dirty = true;
    render(<StatusBar />);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("renders last-saved timestamp when lastSavedAt is set and a block is selected", () => {
    mockShellState.lastSavedAt = "2024-06-15T10:30:00Z";
    render(<StatusBar />);
    // The StatusBar renders "Saved <time>" — look for the "Saved" prefix
    const statusbar = screen.getByTestId("ora-statusbar");
    expect(statusbar.textContent).toMatch(/Saved/);
  });

  it('renders "Not saved yet" when not dirty and no lastSavedAt, even with a block selected', () => {
    render(<StatusBar />);
    expect(screen.getByText("Not saved yet")).toBeTruthy();
  });
});
