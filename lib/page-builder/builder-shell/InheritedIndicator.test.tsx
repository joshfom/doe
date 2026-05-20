import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { InheritedIndicator } from "./InheritedIndicator";

describe("InheritedIndicator", () => {
  it('renders "default" when source is "default"', () => {
    render(<InheritedIndicator source="default" />);
    const el = screen.getByTestId("ora-inherited-indicator");
    expect(el.textContent).toBe("default");
  });

  it('renders "from desktop" when source is "inherited" and inheritedFrom is "desktop"', () => {
    render(<InheritedIndicator source="inherited" inheritedFrom="desktop" />);
    const el = screen.getByTestId("ora-inherited-indicator");
    expect(el.textContent).toBe("from desktop");
  });

  it('renders "from tablet" when source is "inherited" and inheritedFrom is "tablet"', () => {
    render(<InheritedIndicator source="inherited" inheritedFrom="tablet" />);
    const el = screen.getByTestId("ora-inherited-indicator");
    expect(el.textContent).toBe("from tablet");
  });

  it("applies muted styling for subtlety", () => {
    render(<InheritedIndicator source="default" />);
    const el = screen.getByTestId("ora-inherited-indicator");
    expect(el.tagName.toLowerCase()).toBe("span");
    // Verify it's rendered as a small inline element
    expect(el.style.fontSize).toBe("10px");
  });
});
