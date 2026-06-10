import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { withBreakpointResolution } from "./with-breakpoint-resolution";
import { BreakpointProvider } from "./breakpoint-context";
import type { BreakpointValue } from "./breakpoints";

/**
 * Unit tests for withBreakpointResolution HOC.
 *
 * Validates: Requirements 1.1, 1.2
 *
 * Renders a Heading block with fontSize: { desktop: "32", tablet: "24" }
 * and asserts the resolved font-size CSS at each breakpoint.
 */

afterEach(() => {
  cleanup();
});

/**
 * A simple mock render function that simulates a Heading block.
 * It reads `fontSize` from props and applies it as inline style via
 * typographyPropsToCSS-like logic (normalizeLength appends "px").
 */
function HeadingRender(props: Record<string, unknown>): React.ReactElement {
  const fontSize = props.fontSize as string | undefined;
  const style: React.CSSProperties = {};
  if (fontSize && fontSize !== "auto") {
    style.fontSize = fontSize.endsWith("px") ? fontSize : `${fontSize}px`;
  }
  return <h2 data-testid="heading" style={style}>{props.text as string}</h2>;
}

describe("withBreakpointResolution", () => {
  const WrappedHeading = withBreakpointResolution(HeadingRender);

  it("resolves fontSize to desktop value (32px) at desktop breakpoint", () => {
    const props = {
      text: "Hello World",
      fontSize: { desktop: "32", tablet: "24" } as BreakpointValue<string>,
    };

    const { getByTestId } = render(
      <BreakpointProvider initial="desktop">
        <WrappedHeading {...props} />
      </BreakpointProvider>,
    );

    const heading = getByTestId("heading");
    expect(heading.style.fontSize).toBe("32px");
  });

  it("resolves fontSize to tablet value (24px) at tablet breakpoint", () => {
    const props = {
      text: "Hello World",
      fontSize: { desktop: "32", tablet: "24" } as BreakpointValue<string>,
    };

    const { getByTestId } = render(
      <BreakpointProvider initial="tablet">
        <WrappedHeading {...props} />
      </BreakpointProvider>,
    );

    const heading = getByTestId("heading");
    expect(heading.style.fontSize).toBe("24px");
  });
});
