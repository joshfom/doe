// @vitest-environment jsdom
/**
 * InlineEditorInner — configuration sheet open / edit / close / validation.
 *
 * Spec: live-page-editor — task 8.3 (example tests, NOT property tests)
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
 *
 * Task 8.1 wires the live-editor selection path through the shared
 * `InlineEditorInner`: a controlled external `selection` prop (driven in the
 * live shell by the Navigation_Neutralizer) flows into the SelectionOverlay
 * indicator and the ConfigurationSheet open/close/re-target coupling. These
 * example tests exercise that wiring along the live-editor path by driving the
 * same external `selection` prop directly:
 *
 *   - Req 7.1: selecting a block opens the ConfigurationSheet (synchronously on
 *     selection — well within the 200ms budget).
 *   - Req 7.2: a visible SelectionOverlay indicator shows on the selected block.
 *   - Req 7.3: the ConfigurationSheet presents the block's editable properties
 *     via the Puck `ConfigurationPanel`.
 *   - Req 7.4: editing a property commits to the selected block's data (the
 *     inner observes the committed data and flips to an unsaved-changes state).
 *   - Req 7.5: a validation failure rejects the value, retains the prior data,
 *     and flags the offending field.
 *   - Req 7.7: closing the sheet retains the current selection + indicator (it
 *     does NOT clear `selectedId`), so the block stays selected and re-openable.
 *
 * The heavy `<Puck>` store and the admin `ConfigurationPanel` are stubbed (per
 * the `InlineEditorClient.test.tsx` mocking pattern); framer-motion is stubbed
 * so the sheet mounts/unmounts deterministically. This asserts the shell-level
 * selection→sheet contract, not Puck/field internals (covered elsewhere).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  within,
} from "@testing-library/react";
import React from "react";

// --- Mocks -----------------------------------------------------------------

// Controllable headless-Puck store. `appState` is replaced (new object) on each
// committed edit so the inner's data-mirror effect observes the change; a stable
// `dispatch` spy lets us assert the `setUi` itemSelector re-target.
const store = vi.hoisted(() => ({
  current: {
    appState: { data: undefined as unknown },
    dispatch: vi.fn(),
  },
}));

vi.mock("@/lib/page-builder/use-puck-store", () => ({
  usePuckStore: <T,>(selector: (s: typeof store.current) => T): T =>
    selector(store.current),
}));

// Bridge: the stubbed ConfigurationPanel reports a *committed* (valid) edit back
// to the harness, which updates the page data the same way a real Puck dispatch
// would. Invalid edits never call this — they are rejected at the field layer.
const bridge = vi.hoisted(() => ({ commit: (_text: string): void => {} }));

// Stub the admin ConfigurationPanel with a realistic single field that validates
// its input: a valid value commits (Req 7.4), an empty value is rejected and the
// field is flagged without committing (Req 7.5).
vi.mock(
  "@/lib/page-builder/builder-shell/configuration-panel/ConfigurationPanel",
  () => ({
    ConfigurationPanel: () => {
      const [val, setVal] = React.useState("Welcome");
      const [error, setError] = React.useState<string | null>(null);
      return (
        <div data-testid="cp-stub">
          <label htmlFor="cp-field-text">Heading text</label>
          <input
            id="cp-field-text"
            data-testid="cp-field-text"
            value={val}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? "cp-field-error" : undefined}
            onChange={(e) => {
              const next = e.target.value;
              setVal(next);
              if (next.trim().length === 0) {
                // Validation failure → reject value, do NOT commit, flag field.
                setError("Heading text is required");
                return;
              }
              setError(null);
              bridge.commit(next);
            }}
          />
          {error ? (
            <span role="alert" id="cp-field-error" data-testid="cp-field-error">
              {error}
            </span>
          ) : null}
        </div>
      );
    },
  }),
);

// Stub framer-motion so the portal sheet mounts/unmounts synchronously (no exit
// animation to await) while preserving refs, roles, aria, data-* and handlers.
vi.mock("framer-motion", async () => {
  const ReactMod = await import("react");
  const R = (ReactMod as unknown as { default?: typeof React }).default ?? ReactMod;
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
      return R.createElement(tag, { ...clean, ref }, props.children as React.ReactNode);
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

import { InlineEditorInner } from "./InlineEditorInner";
import type { InlineSelection } from "./useInlineSelection";

// --- Fixtures / harness ----------------------------------------------------

interface Block {
  type: string;
  props: { id: string; text?: string };
}
interface PageData {
  content: Block[];
  root: { props: Record<string, unknown> };
}

const INITIAL_DATA: PageData = {
  content: [
    { type: "Heading", props: { id: "block-1", text: "Welcome" } },
    { type: "Text", props: { id: "block-2", text: "Body" } },
  ],
  root: { props: {} },
};

interface SelState {
  id: string | null;
  el: HTMLElement | null;
}

/**
 * Drives the controlled external `selection` prop along the live-editor path,
 * keeps the mocked Puck store's `appState.data` in sync with the harness' page
 * data, and wires the panel-commit bridge to a real data update.
 */
function Harness() {
  const [sel, setSel] = React.useState<SelState>({ id: null, el: null });
  const [data, setData] = React.useState<PageData>(INITIAL_DATA);

  const block1Ref = React.useRef<HTMLDivElement | null>(null);
  const block2Ref = React.useRef<HTMLDivElement | null>(null);

  // Mirror harness data into the mocked store (new appState object per render;
  // the inner keys dirtiness on `data` identity, not `appState` identity).
  store.current.appState = { data };

  // A committed (valid) edit updates the selected block's text → new data ref.
  bridge.commit = (text: string) => {
    setData((prev) => ({
      ...prev,
      content: prev.content.map((c) =>
        c.props.id === "block-1" ? { ...c, props: { ...c.props, text } } : c,
      ),
    }));
  };

  const selection: InlineSelection = {
    selectedId: sel.id,
    selectedEl: sel.el,
    setSelectedId: (id) => setSel((s) => ({ ...s, id })),
    setSelected: (id, el) => setSel({ id, el }),
  };

  return (
    <div>
      {/* Page content (data-puck-id blocks the overlay anchors onto). */}
      <div ref={block1Ref} data-puck-id="block-1" data-testid="dom-block-1">
        Block 1
      </div>
      <div ref={block2Ref} data-puck-id="block-2" data-testid="dom-block-2">
        Block 2
      </div>

      {/* Test controls that emulate the neutralizer pushing a resolved
          selection (block id + element) into the shared selection state. */}
      <button
        type="button"
        data-testid="ctrl-select-1"
        onClick={() => setSel({ id: "block-1", el: block1Ref.current })}
      >
        select block 1
      </button>
      <button
        type="button"
        data-testid="ctrl-select-2"
        onClick={() => setSel({ id: "block-2", el: block2Ref.current })}
      >
        select block 2
      </button>
      <button
        type="button"
        data-testid="ctrl-clear"
        onClick={() => setSel({ id: null, el: null })}
      >
        clear selection
      </button>

      <InlineEditorInner
        pageId="page-1"
        initialData={INITIAL_DATA as never}
        selection={selection}
        onPermissionRevoked={() => {}}
        onExit={() => {}}
      />
    </div>
  );
}

function selectBlock1() {
  act(() => {
    fireEvent.click(screen.getByTestId("ctrl-select-1"));
  });
}

const sheet = () => screen.queryByTestId("inline-config-sheet");
const overlay = () => screen.queryByTestId("inline-selection-outline");
const dirtyIndicator = () => screen.queryByLabelText("Unsaved changes");
const savedIndicator = () => screen.queryByLabelText("All changes saved");

beforeEach(() => {
  store.current.appState = { data: INITIAL_DATA };
  store.current.dispatch = vi.fn();
  bridge.commit = () => {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// --- Tests -----------------------------------------------------------------

describe("Feature: live-page-editor — config sheet open-on-select (Req 7.1, 7.2, 7.3)", () => {
  it("starts with no selection: sheet closed and no selection indicator", () => {
    render(<Harness />);
    expect(sheet()).toBeNull();
    expect(overlay()).toBeNull();
  });

  it("selecting a block opens the ConfigurationSheet synchronously and shows the indicator", () => {
    render(<Harness />);

    selectBlock1();

    // Req 7.1 — the sheet opens on selection (synchronous effect, << 200ms).
    const open = sheet();
    expect(open).not.toBeNull();
    expect(open!.getAttribute("role")).toBe("dialog");
    expect(open!.getAttribute("aria-modal")).toBe("true");

    // Req 7.2 — a visible selection indicator anchors on the selected block.
    expect(overlay()).not.toBeNull();

    // Re-target wiring: the inner points Puck's itemSelector at the block index.
    expect(store.current.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setUi",
        ui: { itemSelector: { index: 0 } },
      }),
    );
  });

  it("presents the block's editable properties via the ConfigurationPanel", () => {
    render(<Harness />);
    selectBlock1();

    // Req 7.3 — the panel (and its editable field) renders inside the sheet.
    const open = sheet()!;
    expect(within(open).getByTestId("cp-stub")).toBeTruthy();
    expect(within(open).getByTestId("cp-field-text")).toBeTruthy();
  });
});

describe("Feature: live-page-editor — config edit commit (Req 7.4)", () => {
  it("editing a property commits to the selected block's data (unsaved-changes shown)", () => {
    render(<Harness />);
    selectBlock1();

    // Clean to start.
    expect(savedIndicator()).not.toBeNull();
    expect(dirtyIndicator()).toBeNull();

    act(() => {
      fireEvent.change(screen.getByTestId("cp-field-text"), {
        target: { value: "Updated heading" },
      });
    });

    // Req 7.4 — the committed edit reaches the page data; the inner observes the
    // new data snapshot and surfaces the unsaved-changes indication.
    expect(dirtyIndicator()).not.toBeNull();
    expect(savedIndicator()).toBeNull();
  });
});

describe("Feature: live-page-editor — config validation failure (Req 7.5)", () => {
  it("rejects an invalid value, retains prior data, and flags the field", () => {
    render(<Harness />);
    selectBlock1();

    expect(savedIndicator()).not.toBeNull();

    act(() => {
      fireEvent.change(screen.getByTestId("cp-field-text"), {
        target: { value: "" },
      });
    });

    // Req 7.5 — the offending field is flagged with a validation message...
    const error = screen.getByTestId("cp-field-error");
    expect(error.textContent).toMatch(/required/i);
    expect(screen.getByTestId("cp-field-text").getAttribute("aria-invalid")).toBe(
      "true",
    );

    // ...and the prior data is retained (no commit → still not dirty).
    expect(savedIndicator()).not.toBeNull();
    expect(dirtyIndicator()).toBeNull();
  });
});

describe("Feature: live-page-editor — close retains selection (Req 7.7)", () => {
  it("closing the sheet keeps the block selected and its indicator visible", () => {
    render(<Harness />);
    selectBlock1();

    expect(sheet()).not.toBeNull();
    expect(overlay()).not.toBeNull();

    // Close via the sheet's close control.
    act(() => {
      fireEvent.click(screen.getByLabelText("Close configuration sheet"));
    });

    // Req 7.7 — sheet closed, but the selection + indicator are retained.
    expect(sheet()).toBeNull();
    expect(overlay()).not.toBeNull();

    // The retained selection is still actionable: the overlay's Edit affordance
    // re-opens the sheet for the same block without re-selecting.
    act(() => {
      fireEvent.click(screen.getByText("Edit"));
    });
    expect(sheet()).not.toBeNull();
  });

  it("closing via Escape also retains the selection and indicator", () => {
    render(<Harness />);
    selectBlock1();
    expect(sheet()).not.toBeNull();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(sheet()).toBeNull();
    expect(overlay()).not.toBeNull();
  });
});
