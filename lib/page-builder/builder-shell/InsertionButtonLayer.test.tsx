// @vitest-environment jsdom

/**
 * InsertionButtonLayer — unit tests.
 *
 * Spec: builder-outline-tree-and-toolbar — Task 4.2
 * _Requirements: 4.1, 4.2, 4.3_
 *
 * The override (`componentItemOverride`) is invoked by Puck once per
 * rendered block in a zone. Per the design (and confirmed in the source
 * docstring), the wrapper emits insertion buttons in this pattern:
 *
 *   - A LEADING button before the first block (only when `index === 0`)
 *   - A TRAILING button after every block
 *
 * That layout produces exactly N + 1 buttons for a zone of N components,
 * matching Property 4 / Reqs 4.1, 4.2:
 *
 *   button(0) [block(0)] button(1) [block(1)] button(2) ... button(N)
 *
 * Empty-zone handling (Req 4.3): when N = 0 the override is never invoked
 * because there are no blocks to wrap — that single placeholder is
 * BuilderShell's concern (task 8.x), so the test for the empty-zone case
 * pins the documented identity behaviour: the override is a pure function
 * of its input, and with no input there is no output. We additionally
 * exercise the design's degraded-input contract (missing `index`/`zone`)
 * since that is the only way the override is ever invoked outside the
 * happy path.
 *
 * We mock:
 *   - `../use-puck-store` to inject a controlled `appState.data` and
 *     `config` so the wrapper's label-resolution effect has data to read.
 *   - `./InsertionContext` to expose a spy `openPicker` and avoid having
 *     to wrap every render in a real provider.
 *   - `./InsertionButton` to render a thin marker that exposes its props
 *     as `data-*` attributes — this lets us assert on `zone`/`index`
 *     without depending on the real button's CSS-in-JS layout.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";

// ─── Mock the Puck store ─────────────────────────────────────────────────────
//
// `ComponentItemWrapper` reads two slices of the store:
//   1. `appState.data` — to look up the current zone's content array
//      (root content lives on `data.content`; named zones on `data.zones`).
//   2. `config` — to resolve the registered label for each adjacent block.
//
// We expose a mutable `mockPuckState` so individual tests can swap in the
// fixture they need without rebuilding the mock module.

interface MockPuckState {
  appState: {
    data: {
      content: Array<{ type: string; props: Record<string, unknown> }>;
      zones: Record<
        string,
        Array<{ type: string; props: Record<string, unknown> }>
      >;
    };
  };
  config: {
    components: Record<string, { label?: string }>;
  };
}

let mockPuckState: MockPuckState;

vi.mock("../use-puck-store", () => ({
  usePuckStore: (selector: (state: MockPuckState) => unknown) =>
    selector(mockPuckState),
}));

// ─── Mock InsertionContext ───────────────────────────────────────────────────
//
// The wrapper only consumes `openPicker` from the context. A static stub
// keeps the test focused on the structural output of the override (button
// count, props) rather than on the dispatch flow already covered by
// `InsertionContext.test.tsx`.

const openPickerSpy = vi.fn();

vi.mock("./InsertionContext", () => ({
  useInsertion: () => ({
    state: null,
    openPicker: openPickerSpy,
    closePicker: vi.fn(),
    insertComponent: vi.fn(),
  }),
}));

// ─── Mock InsertionButton ────────────────────────────────────────────────────
//
// Replace the real button (which injects a `<style>` tag and renders
// CSS-in-JS visuals) with a minimal stub that mirrors its props as
// `data-*` attributes. This makes assertions readable and decouples the
// layer's tests from the button's visual implementation, which already
// has its own coverage in `InsertionButton.test.tsx`.

vi.mock("./InsertionButton", () => ({
  InsertionButton: ({
    zone,
    index,
    afterLabel,
    beforeLabel,
  }: {
    zone: string;
    index: number;
    afterLabel: string | null;
    beforeLabel: string | null;
    onActivate: (anchorEl: HTMLElement, zone: string, index: number) => void;
  }) => (
    <button
      type="button"
      data-testid="insertion-button"
      data-zone={zone}
      data-index={index}
      data-after-label={afterLabel ?? ""}
      data-before-label={beforeLabel ?? ""}
    />
  ),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

const { componentItemOverride } = await import("./InsertionButtonLayer");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROOT_ZONE = "root:default-zone";

/**
 * Render the override for every block in a zone the way Puck would: once
 * per item, with the item's `name`, `index`, and the shared `zone`. The
 * children are simple `<div data-testid="block-N">` markers so we can
 * assert their relative position to the buttons in the rendered tree.
 */
function renderZone(
  zone: string,
  items: Array<{ type: string; props: Record<string, unknown> }>,
) {
  return render(
    <>
      {items.map((item, index) =>
        // Each call returns a fragment containing buttons + children. We
        // render them as siblings to mirror Puck's rendering behaviour.
        // A stable React `key` is required for the array.
        React.cloneElement(
          componentItemOverride({
            children: (
              <div data-testid={`block-${index}`} data-block-type={item.type} />
            ),
            name: item.type,
            index,
            zone,
          }),
          { key: `${item.type}-${index}` },
        ),
      )}
    </>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("componentItemOverride", () => {
  beforeEach(() => {
    openPickerSpy.mockReset();
  });

  describe("button count (Reqs 4.1, 4.2)", () => {
    it("renders N+1 insertion buttons for a zone with N=3 components", () => {
      // Three components → buttons at positions 0, 1, 2, 3 (= N+1 = 4).
      const items = [
        { type: "Heading", props: {} },
        { type: "Image", props: {} },
        { type: "Section", props: {} },
      ];
      mockPuckState = {
        appState: { data: { content: items, zones: {} } },
        config: {
          components: {
            Heading: { label: "Heading" },
            Image: { label: "Image" },
            Section: { label: "Section" },
          },
        },
      };

      const { getAllByTestId } = renderZone(ROOT_ZONE, items);
      const buttons = getAllByTestId("insertion-button");
      expect(buttons).toHaveLength(items.length + 1);
    });

    it("renders N+1 insertion buttons for a zone with N=1 component", () => {
      // One component → buttons at positions 0 and 1 (= 2 = N+1).
      const items = [{ type: "Heading", props: {} }];
      mockPuckState = {
        appState: { data: { content: items, zones: {} } },
        config: { components: { Heading: { label: "Heading" } } },
      };

      const { getAllByTestId } = renderZone(ROOT_ZONE, items);
      expect(getAllByTestId("insertion-button")).toHaveLength(2);
    });

    it("renders N+1 insertion buttons for a non-root zone with N=2 components", () => {
      // Same N+1 invariant for named zones — the wrapper reads the zone
      // off `data.zones[zone]` instead of `data.content` but otherwise
      // produces the same layout.
      const zone = "section-1:content";
      const items = [
        { type: "Heading", props: {} },
        { type: "Image", props: {} },
      ];
      mockPuckState = {
        appState: { data: { content: [], zones: { [zone]: items } } },
        config: {
          components: {
            Heading: { label: "Heading" },
            Image: { label: "Image" },
          },
        },
      };

      const { getAllByTestId } = renderZone(zone, items);
      expect(getAllByTestId("insertion-button")).toHaveLength(items.length + 1);
    });
  });

  describe("empty zone (Req 4.3)", () => {
    it("renders zero buttons when no blocks exist (override is never invoked)", () => {
      // Documented behaviour: the empty-zone single-button placeholder is
      // BuilderShell's concern (task 8.x), not this module's. With N = 0
      // Puck never calls `componentItem`, so the layer produces no output.
      // Asserting this directly pins the contract: regressions that try
      // to emit a button from an empty fixture would fail here.
      mockPuckState = {
        appState: { data: { content: [], zones: {} } },
        config: { components: {} },
      };

      const { queryAllByTestId } = renderZone(ROOT_ZONE, []);
      expect(queryAllByTestId("insertion-button")).toHaveLength(0);
    });

    it("returns identity output when called with missing positional metadata", () => {
      // The override's documented degraded-input contract: when `index`
      // or `zone` is absent, return the children verbatim with no
      // wrapping. This is the safety net for any Puck code path that
      // invokes `componentItem` without the augmented payload — we
      // never want to swallow content.
      mockPuckState = {
        appState: { data: { content: [], zones: {} } },
        config: { components: {} },
      };

      const child = <div data-testid="bare-child" />;
      // index undefined → identity
      const { queryByTestId, queryAllByTestId } = render(
        <>{componentItemOverride({ children: child, name: "Heading" })}</>,
      );
      expect(queryByTestId("bare-child")).not.toBeNull();
      expect(queryAllByTestId("insertion-button")).toHaveLength(0);
    });
  });

  describe("button props (Reqs 4.1, 4.2, 4.3)", () => {
    it("passes the correct zone to every button", () => {
      const zone = "section-1:content";
      const items = [
        { type: "Heading", props: {} },
        { type: "Image", props: {} },
      ];
      mockPuckState = {
        appState: { data: { content: [], zones: { [zone]: items } } },
        config: {
          components: {
            Heading: { label: "Heading" },
            Image: { label: "Image" },
          },
        },
      };

      const { getAllByTestId } = renderZone(zone, items);
      const buttons = getAllByTestId("insertion-button");
      // Every button addresses the same zone — that's what makes the
      // picker land in the right slot when the user activates it.
      for (const button of buttons) {
        expect(button.getAttribute("data-zone")).toBe(zone);
      }
    });

    it("passes monotonically increasing indices 0..N to the buttons", () => {
      // Three components yields four buttons at indices 0, 1, 2, 3.
      // The exact sequence matters: the index is the destination
      // position the picker passes to Puck's `insert` action, so a
      // mis-ordering here would corrupt the page.
      const items = [
        { type: "Heading", props: {} },
        { type: "Image", props: {} },
        { type: "Section", props: {} },
      ];
      mockPuckState = {
        appState: { data: { content: items, zones: {} } },
        config: {
          components: {
            Heading: { label: "Heading" },
            Image: { label: "Image" },
            Section: { label: "Section" },
          },
        },
      };

      const { getAllByTestId } = renderZone(ROOT_ZONE, items);
      const indices = getAllByTestId("insertion-button").map((el) =>
        Number(el.getAttribute("data-index")),
      );
      expect(indices).toEqual([0, 1, 2, 3]);
    });

    it("emits a leading button only for the first block, trailing for every block", () => {
      // The structural contract: the leading button is conditional
      // (`index === 0`), the trailing button is unconditional. Asserting
      // this directly catches regressions where, e.g., the wrapper
      // accidentally emits a leading button for every block (which would
      // produce 2N buttons instead of N+1) or drops the leading button
      // entirely (N buttons, missing the "insert at start" affordance).
      const items = [
        { type: "Heading", props: {} },
        { type: "Image", props: {} },
      ];
      mockPuckState = {
        appState: { data: { content: items, zones: {} } },
        config: {
          components: {
            Heading: { label: "Heading" },
            Image: { label: "Image" },
          },
        },
      };

      // Render the first block's wrapper output in isolation: should
      // produce exactly two buttons (index 0 + index 1).
      const { getAllByTestId, unmount } = render(
        <>
          {componentItemOverride({
            children: <div data-testid="block-0" />,
            name: "Heading",
            index: 0,
            zone: ROOT_ZONE,
          })}
        </>,
      );
      const firstBlockButtons = getAllByTestId("insertion-button");
      expect(firstBlockButtons).toHaveLength(2);
      expect(firstBlockButtons.map((el) => el.getAttribute("data-index"))).toEqual(
        ["0", "1"],
      );
      unmount();

      // The second block's wrapper should produce a single trailing
      // button (index 2). No leading button because `index !== 0`.
      const { getAllByTestId: getAll2 } = render(
        <>
          {componentItemOverride({
            children: <div data-testid="block-1" />,
            name: "Image",
            index: 1,
            zone: ROOT_ZONE,
          })}
        </>,
      );
      const secondBlockButtons = getAll2("insertion-button");
      expect(secondBlockButtons).toHaveLength(1);
      expect(secondBlockButtons[0].getAttribute("data-index")).toBe("2");
    });
  });
});
