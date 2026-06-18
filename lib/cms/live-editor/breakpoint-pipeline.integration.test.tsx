// @vitest-environment jsdom

/**
 * Breakpoint pipeline — integration test for the Live_Editor shell.
 *
 * Spec: live-page-editor — Task 4.3.
 * _Requirements: 5.4_
 *
 * This is an INTEGRATION test (not property-based). It mounts the real
 * breakpoint pipeline as composed under `LiveEditorShell`:
 *
 *   <BreakpointProvider initial="desktop">
 *     <ResponsiveToolbar />                    ← real setActiveBreakpoint driver
 *     <PreviewStage>                            ← virtual width + data-breakpoint
 *       <PageRenderer editMode breakpointCss /> ← responsive render output
 *     <WrappedProbe />                          ← withBreakpointResolution HOC
 *   </BreakpointProvider>
 *
 * Driving a breakpoint change through the toolbar (the same
 * `setActiveBreakpoint` call `LiveEditorShell` wires it to) must, in lock-step,
 * drive ALL THREE arms of the pipeline (Req 5.4):
 *
 *   1. `PreviewStage` resizes its inner stage to the breakpoint's virtual width
 *      (desktop:1440 / tablet:834 / mobile:390 from PREVIEW_VIRTUAL_WIDTHS) and
 *      reflects the active tier on `data-breakpoint`.
 *   2. `withBreakpointResolution` resolves a breakpoint-aware field to the
 *      per-tier scalar for the selected tier.
 *   3. `PageRenderer` (whose registered blocks are wrapped with
 *      `withBreakpointResolution`) emits responsive output for the selected
 *      breakpoint — here, a Heading whose breakpoint-aware `fontSize` resolves
 *      to a different value per tier.
 *
 * Polyfills (ResizeObserver, matchMedia) must be installed before any import
 * that transitively loads the page-builder config (which pulls in
 * @dnd-kit/dom at module scope under jsdom). `vi.hoisted` guarantees this.
 */

import { vi } from "vitest";
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

import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  BreakpointProvider,
  type BreakpointValue,
} from "@/lib/page-builder/breakpoint-context";
import { withBreakpointResolution } from "@/lib/page-builder/with-breakpoint-resolution";
import { PageRenderer } from "@/lib/page-builder/components/PageRenderer";
import type { PageData } from "@/lib/page-builder/types";
import { PreviewStage, PREVIEW_VIRTUAL_WIDTHS } from "./PreviewStage";
import { ResponsiveToolbar } from "./ResponsiveToolbar";

afterEach(() => {
  cleanup();
});

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * A breakpoint-aware font size with a distinct, valid (8..200px) value per
 * tier so the resolved scalar is unambiguous at every breakpoint. Used both
 * by the `withBreakpointResolution` probe and the real Heading block rendered
 * through `PageRenderer`.
 */
const FONT_SIZE: BreakpointValue<string> = {
  desktop: "48",
  tablet: "32",
  mobile: "18",
};

/** Expected resolved scalar (probe) per active breakpoint. */
const EXPECTED_SCALAR: Record<"desktop" | "tablet" | "mobile", string> = {
  desktop: "48",
  tablet: "32",
  mobile: "18",
};

/** Expected rendered inline `font-size` (Heading) per active breakpoint. */
const EXPECTED_FONT_SIZE: Record<"desktop" | "tablet" | "mobile", string> = {
  desktop: "48px",
  tablet: "32px",
  mobile: "18px",
};

const HEADING_TEXT = "Pipeline Heading";

/**
 * Page data with a single Heading block carrying the breakpoint-aware
 * `fontSize`. The Heading's registered render is wrapped with
 * `withBreakpointResolution` inside the page-builder config, so its emitted
 * inline `font-size` is the responsive output for the active breakpoint.
 */
const PAGE_DATA: PageData = {
  root: { props: {} },
  content: [
    {
      type: "Heading",
      props: {
        id: "heading-pipeline",
        text: HEADING_TEXT,
        level: "h2",
        fontSize: FONT_SIZE,
      },
    },
  ],
};

// ── Probe: exercises withBreakpointResolution directly ────────────────────────

/**
 * Renders the resolved `fontSize` scalar so the test can assert the exact
 * per-tier value `withBreakpointResolution` produces for the active breakpoint.
 */
function ProbeRender(props: Record<string, unknown>): React.ReactElement {
  return (
    <span data-testid="resolution-probe">{String(props.fontSize ?? "")}</span>
  );
}
const WrappedProbe = withBreakpointResolution(ProbeRender);

// ── Harness: the real shell composition (BreakpointProvider + pipeline) ───────

function Harness(): React.ReactElement {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <BreakpointProvider initial="desktop">
        {/* Real breakpoint driver — the same setActiveBreakpoint LiveEditorShell wires. */}
        <ResponsiveToolbar />
        {/* Arm 1 + Arm 3: PreviewStage virtual width + PageRenderer responsive output. */}
        <PreviewStage>
          <PageRenderer data={PAGE_DATA} editMode breakpointCss />
        </PreviewStage>
        {/* Arm 2: withBreakpointResolution per-tier resolution. */}
        <WrappedProbe fontSize={FONT_SIZE} />
      </BreakpointProvider>
    </QueryClientProvider>
  );
}

// ── Assertions helper ─────────────────────────────────────────────────────────

function expectPipelineAt(bp: "desktop" | "tablet" | "mobile"): void {
  // Arm 1 — PreviewStage virtual width + active-tier attribute.
  const stage = screen.getByTestId("live-preview-stage");
  expect(stage.getAttribute("data-breakpoint")).toBe(bp);

  const inner = screen.getByTestId("live-preview-stage-inner") as HTMLElement;
  expect(inner.style.width).toBe(`${PREVIEW_VIRTUAL_WIDTHS[bp]}px`);

  // Arm 2 — withBreakpointResolution resolves the per-tier scalar.
  const probe = screen.getByTestId("resolution-probe");
  expect(probe.textContent).toBe(EXPECTED_SCALAR[bp]);

  // Arm 3 — PageRenderer emits responsive output for the selected breakpoint:
  // the Heading's inline font-size resolves to the active tier's value.
  const heading = screen.getByText(HEADING_TEXT) as HTMLElement;
  expect(heading.style.fontSize).toBe(EXPECTED_FONT_SIZE[bp]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Live editor breakpoint pipeline (integration, Req 5.4)", () => {
  it("defaults to desktop across PreviewStage, withBreakpointResolution, and PageRenderer", () => {
    render(<Harness />);
    expectPipelineAt("desktop");

    // PageRenderer opted into the breakpoint CSS pipeline emits a responsive
    // <style> tag because the Heading carries breakpoint-aware fields.
    expect(
      document.querySelector("style[data-pb-breakpoint-css]"),
    ).not.toBeNull();
  });

  it("setActiveBreakpoint(tablet) drives all three pipeline arms in lock-step", () => {
    render(<Harness />);
    expectPipelineAt("desktop");

    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));

    expectPipelineAt("tablet");
  });

  it("setActiveBreakpoint(mobile) drives all three pipeline arms in lock-step", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));

    expectPipelineAt("mobile");
  });

  it("returning to desktop restores the desktop virtual width and per-tier values", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expectPipelineAt("mobile");

    fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
    expectPipelineAt("desktop");
  });
});
