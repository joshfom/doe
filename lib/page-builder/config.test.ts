// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// Polyfill ResizeObserver for jsdom — must be set before importing config
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation
const { pageBuilderConfig } = await import("./config");

const Section = pageBuilderConfig.components.Section;

/**
 * Feature: atomic-component-architecture — Unit tests for Section refactor
 *
 * Validates: Requirements 3.3, 3.4
 */

describe("Section refactor", () => {
  it("Section fields do NOT include maxWidth", () => {
    const fieldKeys = Object.keys(Section.fields ?? {});
    expect(fieldKeys).not.toContain("maxWidth");
  });

  it("Section defaultProps do NOT include maxWidth", () => {
    const defaultKeys = Object.keys(
      (Section.defaultProps as Record<string, unknown>) ?? {},
    );
    expect(defaultKeys).not.toContain("maxWidth");
  });

  it("Section renders full-width with no content constraint", () => {
    // Render Section with default props + a stub DropZone zone
    const props = {
      ...(Section.defaultProps as Record<string, unknown>),
      id: "test-section",
    };

    // Section.render returns React elements; render them via @testing-library/react
    const element = (Section.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    // The Section renders a <section> with an inner <div> wrapping the DropZone
    const sectionEl = container.querySelector("section");
    expect(sectionEl).toBeTruthy();

    // The content wrapper div (last child of <section>, the one with zIndex: 2)
    const contentDiv = sectionEl!.querySelector(
      'div[style*="z-index"]',
    ) as HTMLElement | null;
    expect(contentDiv).toBeTruthy();

    const style = contentDiv!.style;

    // Should have position: relative and z-index: 2
    expect(style.position).toBe("relative");
    expect(style.zIndex).toBe("2");

    // Should NOT have maxWidth, padding, or auto margins
    expect(style.maxWidth).toBeFalsy();
    expect(style.paddingLeft).toBeFalsy();
    expect(style.paddingRight).toBeFalsy();
    expect(style.marginLeft).toBeFalsy();
    expect(style.marginRight).toBeFalsy();
  });
});

/**
 * Feature: atomic-component-architecture — Unit tests for sidebar categories
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */

describe("Sidebar categories", () => {
  const categories = pageBuilderConfig.categories as Record<
    string,
    { components: string[]; title: string; defaultExpanded?: boolean }
  >;

  it("Layout category contains Section, Container, Columns, Accordion, Spacer, Divider", () => {
    expect(categories.layout.components).toEqual([
      "Section",
      "Container",
      "Columns",
      "Accordion",
      "Spacer",
      "Divider",
    ]);
  });

  it("Basic category contains Heading, Text, Button, InlineLink, Image, Quote, Icon", () => {
    expect(categories.basic.components).toEqual([
      "Heading",
      "Text",
      "Button",
      "InlineLink",
      "Image",
      "Quote",
      "Icon",
    ]);
  });

  it("ORA category contains HeroBanner, PropertyCard, FeatureGrid, FilterTabs, StatRow, Footer, MegaFooter", () => {
    expect(categories.ora.components).toEqual([
      "HeroBanner",
      "PropertyCard",
      "FeatureGrid",
      "FilterTabs",
      "StatRow",
      "Footer",
      "MegaFooter",
    ]);
  });

  it("Templates category contains all 5 template components", () => {
    expect(categories.templates.components).toEqual([
      "TplContentBlock",
      "TplHeroSection",
      "TplFeatureSection",
      "TplCTASection",
      "TplTestimonialSection",
    ]);
  });

  it("Layout category has defaultExpanded: true", () => {
    expect(categories.layout.defaultExpanded).toBe(true);
  });
});
