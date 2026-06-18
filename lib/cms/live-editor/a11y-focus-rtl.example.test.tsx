// @vitest-environment jsdom
/**
 * Editor_UI accessibility (focus / escape / names) + RTL — example tests.
 *
 * Spec: live-page-editor — task 13.3 (example tests, NOT property tests)
 * _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7_
 *
 * Task 13.1 applied the cross-cutting a11y + RTL pass across the three floating
 * Editor_UI surfaces — Responsive_Toolbar, Component_Sheet, Configuration_Sheet.
 * These example/edge tests exercise that behaviour by example (the focus-trap
 * *cycling* property — Tab wrap-around — is covered separately by task 13.2's
 * property test and is deliberately NOT duplicated here):
 *
 *   - Req 10.1 — every interactive control in each surface is keyboard
 *     reachable (focusable) and keyboard activatable.
 *   - Req 10.2 — every control exposes a non-empty accessible name.
 *   - Req 10.3 — opening the Configuration_Sheet moves focus to its first
 *     focusable control; closing returns focus to the control that opened it.
 *   - Req 10.4 — if the opener is no longer focusable on close, focus moves to
 *     the first focusable control in the Responsive_Toolbar.
 *   - Req 10.6 — Escape closes the Configuration_Sheet and the Component_Sheet.
 *   - Req 10.7 — in an RTL locale the Editor_UI mirrors: `dir` propagates to the
 *     surfaces and their inner chrome uses logical layout (the toolbar keeps a
 *     logical DOM/tab order, the component sheet aligns text to the logical
 *     start and spans full width, and the configuration sheet mirrors to the
 *     inline-start edge).
 *
 * Mocking strategy (mirrors `InlineEditorInner.config-sheet.example.test.tsx`,
 * `ResponsiveToolbar.test.tsx`, and `ComponentSheet.insertion-failure.test.tsx`):
 *   - `usePuckStore` is stubbed to feed Component_Sheet a minimal palette config
 *     (and to sidestep the transitive `@dnd-kit` module-scope access in jsdom).
 *   - the admin `ConfigurationPanel` is stubbed with a couple of focusable
 *     fields so the sheet has real tab stops.
 *   - `framer-motion` is stubbed so the portaled sheet mounts/unmounts
 *     synchronously while preserving refs / roles / aria / data-* / handlers.
 *   - `requestAnimationFrame` is run synchronously so the sheet's
 *     focus-first-control step (scheduled via rAF) completes within `act`.
 */

import {
  describe,
  it,
  expect,
  afterEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  within,
} from "@testing-library/react";
import React from "react";

// ── jsdom polyfills (Puck / @dnd-kit touch these at module scope) ──────────
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

// ── Mock the headless-Puck store: Component_Sheet reads only `config` ──────
const puckMock = vi.hoisted(() => ({
  config: {
    categories: {
      blocks: { title: "Blocks", components: ["Heading", "Text"] },
    },
    components: {
      Heading: { label: "Heading" },
      Text: { label: "Text" },
    },
  },
}));

vi.mock("@/lib/page-builder/use-puck-store", () => ({
  usePuckStore: (selector: (s: { config: unknown }) => unknown) =>
    selector({ config: puckMock.config }),
}));

// ── Stub the admin ConfigurationPanel with real, focusable tab stops ───────
vi.mock(
  "@/lib/page-builder/builder-shell/configuration-panel/ConfigurationPanel",
  () => ({
    ConfigurationPanel: () => (
      <div data-testid="cp-stub">
        <label htmlFor="cp-field-a">Field A</label>
        <input id="cp-field-a" data-testid="cp-field-a" />
        <button type="button" data-testid="cp-field-b">
          Field B
        </button>
      </div>
    ),
  }),
);

// ── Stub framer-motion: synchronous mount/unmount, props preserved ─────────
vi.mock("framer-motion", async () => {
  const ReactMod = await import("react");
  const R =
    (ReactMod as unknown as { default?: typeof React }).default ?? ReactMod;
  const FRAMER_ONLY = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "whileHover",
    "whileTap",
    "whileFocus",
    "layout",
    "layoutId",
  ]);
  const make = (tag: string) =>
    R.forwardRef(function MotionMock(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      const clean: Record<string, unknown> = {};
      for (const key of Object.keys(props)) {
        if (key === "children" || FRAMER_ONLY.has(key)) continue;
        clean[key] = props[key];
      }
      return R.createElement(
        tag,
        { ...clean, ref },
        props.children as React.ReactNode,
      );
    });
  const motion = new Proxy(
    {},
    { get: (_t, tag: string) => make(typeof tag === "string" ? tag : "div") },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      R.createElement(R.Fragment, null, children),
  };
});

import { BreakpointProvider } from "@/lib/page-builder/breakpoint-context";
import { ResponsiveToolbar } from "./ResponsiveToolbar";
import { ComponentSheet } from "./ComponentSheet";
import { ConfigurationSheet } from "@/lib/cms/inline-editor/ConfigurationSheet";

// Run rAF synchronously so the sheet's "focus first control" (scheduled via
// requestAnimationFrame) completes inside `act` without a real animation frame.
let rafSpy: ReturnType<typeof vi.spyOn> | undefined;
beforeAll(() => {
  rafSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
afterAll(() => {
  rafSpy?.mockRestore();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

// ───────────────────────────────────────────────────────────────────────────
// Req 10.1 / 10.2 — keyboard reachability + accessible names per surface
// ───────────────────────────────────────────────────────────────────────────

describe("Feature: live-page-editor — Responsive_Toolbar a11y (Req 10.1, 10.2)", () => {
  function renderToolbar() {
    return render(
      <BreakpointProvider initial="desktop">
        <ResponsiveToolbar />
      </BreakpointProvider>,
    );
  }

  it("exposes exactly three real <button> controls, each keyboard-focusable", () => {
    renderToolbar();
    const group = screen.getByRole("group", { name: "Preview size" });
    const buttons = within(group).getAllByRole("button") as HTMLButtonElement[];
    expect(buttons).toHaveLength(3);

    for (const btn of buttons) {
      // Real <button> elements are inherently keyboard operable; confirm each
      // can actually receive focus (Req 10.1).
      expect(btn.tagName).toBe("BUTTON");
      btn.focus();
      expect(document.activeElement).toBe(btn);
    }
  });

  it("each control has a non-empty accessible name (Req 10.2)", () => {
    renderToolbar();
    const group = screen.getByRole("group", { name: "Preview size" });
    const buttons = within(group).getAllByRole("button") as HTMLButtonElement[];
    for (const btn of buttons) {
      const name = btn.getAttribute("aria-label") ?? btn.textContent ?? "";
      expect(name.trim().length).toBeGreaterThan(0);
    }
    // The expected purposes are all present.
    expect(within(group).getByRole("button", { name: "Desktop" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Tablet" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Mobile" })).toBeTruthy();
  });

  it("activating a focused control changes the active preview size (Req 10.1)", () => {
    renderToolbar();
    const group = screen.getByRole("group", { name: "Preview size" });
    const tablet = within(group).getByRole("button", {
      name: "Tablet",
    }) as HTMLButtonElement;

    tablet.focus();
    fireEvent.click(tablet); // keyboard activation of a focused button === click
    expect(tablet.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Feature: live-page-editor — Component_Sheet a11y (Req 10.1, 10.2)", () => {
  it("the drag handle is a labelled button that toggles via the keyboard (Req 10.1, 10.2)", () => {
    render(<ComponentSheet selectedId={null} onInsert={() => true} />);

    const handle = screen.getByTestId(
      "live-component-sheet-handle",
    ) as HTMLButtonElement;
    expect(handle.tagName).toBe("BUTTON");

    // Non-empty accessible name (Req 10.2).
    expect((handle.getAttribute("aria-label") ?? "").trim().length).toBeGreaterThan(
      0,
    );
    expect(handle.getAttribute("aria-expanded")).toBe("false");

    // Keyboard focus + activation toggles the sheet open (Req 10.1).
    handle.focus();
    expect(document.activeElement).toBe(handle);
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("live-component-sheet").getAttribute("data-state")).toBe(
      "expanded",
    );
  });

  it("expanded controls (search + palette items) are reachable with non-empty names (Req 10.1, 10.2)", () => {
    render(<ComponentSheet selectedId={null} onInsert={() => true} />);
    const handle = screen.getByTestId("live-component-sheet-handle");
    fireEvent.keyDown(handle, { key: "Enter" });

    // Search field: focusable with an accessible name.
    const search = screen.getByTestId(
      "live-component-sheet-search",
    ) as HTMLInputElement;
    expect((search.getAttribute("aria-label") ?? "").trim().length).toBeGreaterThan(
      0,
    );
    search.focus();
    expect(document.activeElement).toBe(search);

    // Palette item buttons: focusable with a non-empty (text) accessible name.
    const item = screen.getByTestId(
      "live-component-sheet-item-Heading",
    ) as HTMLButtonElement;
    expect(item.tagName).toBe("BUTTON");
    expect((item.textContent ?? "").trim().length).toBeGreaterThan(0);
    item.focus();
    expect(document.activeElement).toBe(item);
  });
});

describe("Feature: live-page-editor — Configuration_Sheet a11y (Req 10.1, 10.2)", () => {
  it("the dialog and its close control expose non-empty accessible names (Req 10.2)", () => {
    render(<ConfigurationSheet open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect((dialog.getAttribute("aria-label") ?? "").trim().length).toBeGreaterThan(
      0,
    );
    const close = screen.getByLabelText("Close configuration sheet");
    expect(close).toBeTruthy();
  });

  it("every focusable control inside the open sheet can receive focus (Req 10.1)", () => {
    render(<ConfigurationSheet open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(0);
    for (const el of focusables) {
      el.focus();
      expect(document.activeElement).toBe(el);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Req 10.3 / 10.4 — focus move on open, focus return on close, toolbar fallback
// ───────────────────────────────────────────────────────────────────────────

describe("Feature: live-page-editor — Configuration_Sheet focus move / return (Req 10.3)", () => {
  function OpenCloseHarness() {
    const [open, setOpen] = React.useState(false);
    // Stable handler so the sheet's open/focus effect (keyed on [open, onClose])
    // doesn't re-run on unrelated re-renders.
    const close = React.useCallback(() => setOpen(false), []);
    return (
      <div>
        <button
          type="button"
          data-testid="opener"
          onClick={() => setOpen(true)}
        >
          Open config
        </button>
        <ConfigurationSheet open={open} onClose={close} />
      </div>
    );
  }

  it("moves focus to the first focusable control inside the sheet on open (Req 10.3)", () => {
    render(<OpenCloseHarness />);

    const opener = screen.getByTestId("opener") as HTMLButtonElement;
    opener.focus();
    act(() => {
      fireEvent.click(opener);
    });

    // The first focusable control in the sheet is its close button (header
    // precedes the panel body in DOM order).
    const close = screen.getByLabelText("Close configuration sheet");
    expect(document.activeElement).toBe(close);
  });

  it("returns focus to the opener when the sheet closes (Req 10.3)", () => {
    render(<OpenCloseHarness />);

    const opener = screen.getByTestId("opener") as HTMLButtonElement;
    opener.focus();
    act(() => {
      fireEvent.click(opener);
    });
    expect(screen.queryByRole("dialog")).not.toBeNull();

    // Close via the close control.
    act(() => {
      fireEvent.click(screen.getByLabelText("Close configuration sheet"));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    // Focus returns to the control that opened the sheet (Req 10.3).
    expect(document.activeElement).toBe(opener);
  });
});

describe("Feature: live-page-editor — focus-return toolbar fallback (Req 10.4)", () => {
  function FallbackHarness() {
    const [open, setOpen] = React.useState(false);
    const [openerPresent, setOpenerPresent] = React.useState(true);
    // Stable handler so removing the opener (a separate state change) does not
    // re-run the sheet's open/focus effect and re-capture the focus-return
    // target — the effect should keep the original opener as its target so the
    // fallback fires when that opener is gone on close.
    const close = React.useCallback(() => setOpen(false), []);
    return (
      <BreakpointProvider initial="desktop">
        <ResponsiveToolbar />
        {openerPresent ? (
          <button
            type="button"
            data-testid="opener"
            onClick={() => setOpen(true)}
          >
            Open config
          </button>
        ) : null}
        <button
          type="button"
          data-testid="remove-opener"
          onClick={() => setOpenerPresent(false)}
        >
          remove opener
        </button>
        <ConfigurationSheet open={open} onClose={close} />
      </BreakpointProvider>
    );
  }

  it("moves focus to the first Responsive_Toolbar control when the opener is gone on close (Req 10.4)", () => {
    render(<FallbackHarness />);

    // Open the sheet from the opener (captured as the focus-return target).
    const opener = screen.getByTestId("opener") as HTMLButtonElement;
    opener.focus();
    act(() => {
      fireEvent.click(opener);
    });
    expect(screen.queryByRole("dialog")).not.toBeNull();

    // The opener is removed from the DOM while the sheet is open, so it is no
    // longer focusable when the sheet closes.
    act(() => {
      fireEvent.click(screen.getByTestId("remove-opener"));
    });

    // Close via Escape.
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog")).toBeNull();

    // Fallback: focus lands on the first focusable control of the toolbar
    // (Desktop), located via the stable [data-live-editor-toolbar] hook.
    const toolbar = screen.getByTestId("live-responsive-toolbar");
    const firstControl = within(toolbar).getByRole("button", {
      name: "Desktop",
    });
    expect(document.activeElement).toBe(firstControl);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Req 10.6 — Escape closes the Configuration_Sheet and the Component_Sheet
// ───────────────────────────────────────────────────────────────────────────

describe("Feature: live-page-editor — Escape closes sheets (Req 10.6)", () => {
  it("Escape closes the Configuration_Sheet", () => {
    const onClose = vi.fn();
    render(<ConfigurationSheet open onClose={onClose} />);

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape collapses the expanded Component_Sheet and returns focus to its handle", () => {
    render(<ComponentSheet selectedId={null} onInsert={() => true} />);

    const handle = screen.getByTestId("live-component-sheet-handle");
    fireEvent.keyDown(handle, { key: "Enter" }); // expand
    expect(
      screen.getByTestId("live-component-sheet").getAttribute("data-state"),
    ).toBe("expanded");

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    // The sheet returns to its collapsed (handle-only) state (Req 10.6)...
    expect(
      screen.getByTestId("live-component-sheet").getAttribute("data-state"),
    ).toBe("collapsed");
    // ...and focus returns to the handle so keyboard users keep an anchor.
    expect(document.activeElement).toBe(handle);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Req 10.7 — RTL mirroring across the Editor_UI
// ───────────────────────────────────────────────────────────────────────────

describe("Feature: live-page-editor — RTL mirroring (Req 10.7)", () => {
  it("the Responsive_Toolbar keeps a logical DOM/tab order so it reads right-to-left under dir=rtl", () => {
    render(
      <div dir="rtl" data-live-editor-root="">
        <BreakpointProvider initial="desktop">
          <ResponsiveToolbar />
        </BreakpointProvider>
      </div>,
    );

    // The toolbar inherits direction from the [data-live-editor-root] wrapper.
    const root = document.querySelector("[data-live-editor-root]");
    expect(root?.getAttribute("dir")).toBe("rtl");

    // DOM/tab order stays logical (desktop → tablet → mobile); in an RTL
    // container the visual row reverses, so this logical order reads from the
    // right edge first — matching RTL reading order.
    const group = screen.getByRole("group", { name: "Preview size" });
    const labels = (
      within(group).getAllByRole("button") as HTMLButtonElement[]
    ).map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Desktop", "Tablet", "Mobile"]);
  });

  it("the Component_Sheet uses logical layout (full width + start-aligned text) for RTL mirroring", () => {
    render(
      <div dir="rtl" data-live-editor-root="">
        <ComponentSheet selectedId={null} onInsert={() => true} />
      </div>,
    );

    const sheet = screen.getByTestId("live-component-sheet");
    // Symmetric horizontal anchoring (left:0 + right:0) → spans full width and
    // mirrors without physical-offset overrides.
    expect(sheet.style.left).toBe("0px");
    expect(sheet.style.right).toBe("0px");

    // Expand to reach the search field, which uses logical alignment + padding.
    fireEvent.keyDown(screen.getByTestId("live-component-sheet-handle"), {
      key: "Enter",
    });
    const search = screen.getByTestId(
      "live-component-sheet-search",
    ) as HTMLInputElement;
    expect(search.style.textAlign).toBe("start");
    // Logical inline-start padding (the search-icon gutter) rather than a
    // physical left/right offset.
    expect(search.style.paddingInlineStart).not.toBe("");
  });

  it("the Configuration_Sheet receives dir=rtl and mirrors to the inline-start (left) edge", () => {
    render(<ConfigurationSheet open onClose={() => {}} dir="rtl" />);

    // The portaled sheet cannot inherit the editor's direction, so the host
    // threads `dir` explicitly; the dialog reflects it.
    const dialog = screen.getByRole("dialog") as HTMLElement;
    expect(dialog.getAttribute("dir")).toBe("rtl");

    // In RTL the sheet anchors to the left (inline-start) edge: left:0 and the
    // right anchor released to "auto".
    expect(dialog.style.left).toBe("0px");
    expect(dialog.style.right).toBe("auto");
    // Text aligns to the logical start so content mirrors with the direction.
    expect(dialog.style.textAlign).toBe("start");
  });

  it("the Configuration_Sheet defaults to LTR (right edge) when no dir is supplied (control)", () => {
    render(<ConfigurationSheet open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog") as HTMLElement;
    expect(dialog.getAttribute("dir")).toBe("ltr");
    expect(dialog.style.right).toBe("0px");
    expect(dialog.style.left).toBe("auto");
  });
});
