// @vitest-environment jsdom
/**
 * Interaction test for the TabGroup runtime (task 7.4).
 *
 * Scope (per the implementation plan, task 7.4 and design Property 7):
 *   - Initial render honours `defaultIndex`: that tab is selected, its panel is
 *     visible and every other panel is `hidden` (Req 3.3).
 *   - Pointer activation: clicking a tab switches the selected tab and the
 *     visible panel (Req 3.4).
 *   - Keyboard navigation (automatic-activation model): ArrowRight / ArrowLeft
 *     move selection by one and wrap; Home jumps to the first tab and End to the
 *     last; focus follows selection (Req 3.6, 13.2).
 *   - Roving tabindex: exactly one tab carries `tabindex="0"` and every other
 *     tab carries `tabindex="-1"` at all times (Req 3.7).
 *   - Property 7 (the Tabs invariant): exactly one tab has
 *     `aria-selected="true"`; the single visible (non-`hidden`) panel's
 *     `aria-labelledby` equals the selected tab's `id`, and the selected tab's
 *     `aria-controls` equals that visible panel's `id` (Req 3.3-3.7, 13.3).
 *   - RTL: under `dir="rtl"` the Arrow keys map to the visual reading direction,
 *     so ArrowRight moves to the *previous* tab and ArrowLeft to the *next*
 *     (Req 3.9, 14.2). The runtime reads the computed direction post-mount.
 *
 * Conventions mirror `testimonial.test.tsx` / `BuilderShell.test.tsx`: jsdom
 * environment, Testing Library `render` + `fireEvent`, queries scoped to the
 * returned `container`, and `cleanup()` between cases so keyboard focus state
 * (`document.activeElement`) never bleeds across tests. The runtime is a
 * self-contained `"use client"` component with no Next.js dependency, so it is
 * imported and exercised directly (no config/registry round-trip needed).
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 3 — TabGroup" and §"Property 7: Tabs invariant".
 * Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 13.2, 13.3 and Property 7.
 */

import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { TabGroupRuntime, type TabGroupTab } from "./TabGroupRuntime";

afterEach(() => cleanup());

/** Build `n` tabs with deterministic labels + identifiable panel content. */
function makeTabs(n: number): TabGroupTab[] {
  return Array.from({ length: n }, (_, i) => ({
    label: `Tab ${i + 1}`,
    panel: <p>Panel {i + 1} content</p>,
  }));
}

/** All `role="tab"` buttons in document order. */
function getTabs(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
}

/** All `role="tabpanel"` elements in document order. */
function getPanels(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="tabpanel"]'),
  );
}

/**
 * Assert Property 7 (the Tabs invariant) over the current DOM and return the
 * index of the selected tab. Checks, in one place:
 *   - exactly one tab is `aria-selected="true"`;
 *   - exactly one tab is in the tab order (`tabindex="0"`), and it is that same
 *     selected tab; every other tab is `tabindex="-1"` (roving tabindex);
 *   - exactly one panel is visible (no `hidden` attribute);
 *   - the visible panel's `aria-labelledby` === the selected tab's `id`;
 *   - the selected tab's `aria-controls` === the visible panel's `id`.
 */
function assertTabsInvariant(container: HTMLElement): number {
  const tabs = getTabs(container);
  const panels = getPanels(container);

  // Exactly one selected tab.
  const selectedTabs = tabs.filter(
    (t) => t.getAttribute("aria-selected") === "true",
  );
  expect(selectedTabs).toHaveLength(1);
  const selectedTab = selectedTabs[0];

  // Roving tabindex: exactly one tab in the page tab order, and it is the
  // selected one; all others are removed from the tab order.
  const rovingTabs = tabs.filter((t) => t.getAttribute("tabindex") === "0");
  expect(rovingTabs).toHaveLength(1);
  expect(rovingTabs[0]).toBe(selectedTab);
  tabs
    .filter((t) => t !== selectedTab)
    .forEach((t) => expect(t.getAttribute("tabindex")).toBe("-1"));

  // Exactly one visible panel.
  const visiblePanels = panels.filter((p) => !p.hasAttribute("hidden"));
  expect(visiblePanels).toHaveLength(1);
  const visiblePanel = visiblePanels[0];

  // The visible panel is wired to the selected tab, both directions.
  expect(visiblePanel.getAttribute("aria-labelledby")).toBe(selectedTab.id);
  expect(selectedTab.getAttribute("aria-controls")).toBe(visiblePanel.id);

  return tabs.indexOf(selectedTab);
}

describe("TabGroupRuntime — initial render (Req 3.3)", () => {
  it("selects the defaultIndex tab and shows only its panel", () => {
    const { container } = render(
      <TabGroupRuntime tabs={makeTabs(3)} defaultIndex={1} />,
    );

    const tabs = getTabs(container);
    const panels = getPanels(container);

    expect(tabs).toHaveLength(3);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    expect(tabs[2].getAttribute("aria-selected")).toBe("false");

    // Only the default tab's panel is visible.
    expect(panels[1].hasAttribute("hidden")).toBe(false);
    expect(panels[0].hasAttribute("hidden")).toBe(true);
    expect(panels[2].hasAttribute("hidden")).toBe(true);

    expect(assertTabsInvariant(container)).toBe(1);
  });

  it("defaults to the first tab when defaultIndex is omitted", () => {
    const { container } = render(<TabGroupRuntime tabs={makeTabs(3)} />);
    expect(assertTabsInvariant(container)).toBe(0);
  });

  it("clamps an out-of-range defaultIndex into the valid range", () => {
    const { container } = render(
      <TabGroupRuntime tabs={makeTabs(3)} defaultIndex={99} />,
    );
    // Clamped to the last tab.
    expect(assertTabsInvariant(container)).toBe(2);
  });

  it("applies the provided accessible name to the tablist", () => {
    const { container } = render(
      <TabGroupRuntime tabs={makeTabs(2)} ariaLabel="Pricing options" />,
    );
    const tablist = container.querySelector('[role="tablist"]')!;
    expect(tablist.getAttribute("aria-label")).toBe("Pricing options");
  });
});

describe("TabGroupRuntime — pointer activation (Req 3.4)", () => {
  it("switches the selected tab and visible panel on click", () => {
    const { container } = render(
      <TabGroupRuntime tabs={makeTabs(3)} defaultIndex={0} />,
    );
    expect(assertTabsInvariant(container)).toBe(0);

    fireEvent.click(getTabs(container)[2]);

    // Selection + visible panel both moved to the clicked tab.
    expect(assertTabsInvariant(container)).toBe(2);
    expect(getPanels(container)[2].hasAttribute("hidden")).toBe(false);
    expect(getPanels(container)[0].hasAttribute("hidden")).toBe(true);
  });

  it("keeps the invariant when clicking back and forth", () => {
    const { container } = render(<TabGroupRuntime tabs={makeTabs(4)} />);

    fireEvent.click(getTabs(container)[3]);
    expect(assertTabsInvariant(container)).toBe(3);

    fireEvent.click(getTabs(container)[1]);
    expect(assertTabsInvariant(container)).toBe(1);
  });
});

describe("TabGroupRuntime — keyboard navigation (Req 3.6, 13.2)", () => {
  it("ArrowRight moves selection to the next tab and moves focus with it", () => {
    const { container } = render(<TabGroupRuntime tabs={makeTabs(3)} />);

    fireEvent.keyDown(getTabs(container)[0], { key: "ArrowRight" });

    expect(assertTabsInvariant(container)).toBe(1);
    // Automatic activation: focus follows selection.
    expect(document.activeElement).toBe(getTabs(container)[1]);
  });

  it("ArrowLeft moves selection to the previous tab", () => {
    const { container } = render(
      <TabGroupRuntime tabs={makeTabs(3)} defaultIndex={2} />,
    );

    fireEvent.keyDown(getTabs(container)[2], { key: "ArrowLeft" });

    expect(assertTabsInvariant(container)).toBe(1);
    expect(document.activeElement).toBe(getTabs(container)[1]);
  });

  it("ArrowRight wraps from the last tab to the first", () => {
    const { container } = render(
      <TabGroupRuntime tabs={makeTabs(3)} defaultIndex={2} />,
    );

    fireEvent.keyDown(getTabs(container)[2], { key: "ArrowRight" });

    expect(assertTabsInvariant(container)).toBe(0);
    expect(document.activeElement).toBe(getTabs(container)[0]);
  });

  it("ArrowLeft wraps from the first tab to the last", () => {
    const { container } = render(
      <TabGroupRuntime tabs={makeTabs(3)} defaultIndex={0} />,
    );

    fireEvent.keyDown(getTabs(container)[0], { key: "ArrowLeft" });

    expect(assertTabsInvariant(container)).toBe(2);
    expect(document.activeElement).toBe(getTabs(container)[2]);
  });

  it("Home selects the first tab and End selects the last tab", () => {
    const { container } = render(
      <TabGroupRuntime tabs={makeTabs(4)} defaultIndex={1} />,
    );

    fireEvent.keyDown(getTabs(container)[1], { key: "End" });
    expect(assertTabsInvariant(container)).toBe(3);
    expect(document.activeElement).toBe(getTabs(container)[3]);

    fireEvent.keyDown(getTabs(container)[3], { key: "Home" });
    expect(assertTabsInvariant(container)).toBe(0);
    expect(document.activeElement).toBe(getTabs(container)[0]);
  });
});

describe("TabGroupRuntime — roving tabindex (Req 3.7, Property 7)", () => {
  it("keeps exactly one tab in the tab order across every interaction", () => {
    const { container } = render(<TabGroupRuntime tabs={makeTabs(4)} />);

    const expectExactlyOneRoving = () => {
      const tabs = getTabs(container);
      expect(tabs.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
      expect(
        tabs.filter((t) => t.getAttribute("tabindex") === "-1"),
      ).toHaveLength(tabs.length - 1);
    };

    expectExactlyOneRoving();

    fireEvent.click(getTabs(container)[2]);
    expectExactlyOneRoving();

    fireEvent.keyDown(getTabs(container)[2], { key: "ArrowRight" });
    expectExactlyOneRoving();

    fireEvent.keyDown(getTabs(container)[3], { key: "End" });
    expectExactlyOneRoving();
  });
});

describe("TabGroupRuntime — Property 7 invariant holds across a session", () => {
  it("maintains the full tab/panel wiring through a mix of click + keyboard", () => {
    const { container } = render(
      <TabGroupRuntime tabs={makeTabs(5)} defaultIndex={2} ariaLabel="Docs" />,
    );

    // A scripted sequence of interactions; the invariant must hold after each.
    expect(assertTabsInvariant(container)).toBe(2);

    fireEvent.click(getTabs(container)[0]);
    expect(assertTabsInvariant(container)).toBe(0);

    fireEvent.keyDown(getTabs(container)[0], { key: "ArrowLeft" }); // wrap to last
    expect(assertTabsInvariant(container)).toBe(4);

    fireEvent.keyDown(getTabs(container)[4], { key: "Home" });
    expect(assertTabsInvariant(container)).toBe(0);

    fireEvent.keyDown(getTabs(container)[0], { key: "End" });
    expect(assertTabsInvariant(container)).toBe(4);

    fireEvent.click(getTabs(container)[3]);
    expect(assertTabsInvariant(container)).toBe(3);
  });
});

describe("TabGroupRuntime — RTL keyboard mapping (Req 3.9, 14.2)", () => {
  it("maps ArrowRight/ArrowLeft to the visual reading direction under dir=rtl", () => {
    // The runtime reads the inherited computed text direction after mount; jsdom
    // derives `direction: rtl` from the `dir` attribute, so the post-mount effect
    // flips the Arrow-key mapping. ArrowRight should now move toward the start
    // (previous tab) and ArrowLeft toward the end (next tab).
    const { container } = render(
      <div dir="rtl">
        <TabGroupRuntime tabs={makeTabs(3)} defaultIndex={1} />
      </div>,
    );

    // ArrowRight in RTL → previous tab: index 1 → index 0.
    fireEvent.keyDown(getTabs(container)[1], { key: "ArrowRight" });
    expect(assertTabsInvariant(container)).toBe(0);

    // ArrowRight again in RTL → previous: from the first tab it wraps to the
    // last (index 2). (In LTR this same key would instead advance to index 1.)
    fireEvent.keyDown(getTabs(container)[0], { key: "ArrowRight" });
    expect(assertTabsInvariant(container)).toBe(2);

    // ArrowLeft in RTL → next: from the last tab it wraps back to the first.
    fireEvent.keyDown(getTabs(container)[2], { key: "ArrowLeft" });
    expect(assertTabsInvariant(container)).toBe(0);
  });
});
