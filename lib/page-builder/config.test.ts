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
const Text = pageBuilderConfig.components.Text;
const Video = pageBuilderConfig.components.Video;
const Button = pageBuilderConfig.components.Button;
const AccordionGroup = pageBuilderConfig.components.AccordionGroup;
const StatsGrid = pageBuilderConfig.components.StatsGrid;
const Heading = pageBuilderConfig.components.Heading;
const InlineLink = pageBuilderConfig.components.InlineLink;
const Quote = pageBuilderConfig.components.Quote;
const FilterTabs = pageBuilderConfig.components.FilterTabs;

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

  it("Section exposes maxHeight and gradient controls", () => {
    const fieldKeys = Object.keys(Section.fields ?? {});
    expect(fieldKeys).toContain("maxHeight");
    expect(fieldKeys).toContain("bgMode");
    expect(fieldKeys).toContain("bgMediaType");
    expect(fieldKeys).toContain("bgVideoUrl");
    expect(fieldKeys).toContain("gradientFrom");
    expect(fieldKeys).toContain("gradientTo");
    expect(fieldKeys).toContain("gradientDirection");
  });

  it("Section applies 100vh min/max height for hero use cases", () => {
    const props = {
      ...(Section.defaultProps as Record<string, unknown>),
      id: "hero-section",
      minHeight: "100vh",
      maxHeight: "100vh",
    };

    const element = (Section.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);
    const sectionEl = container.querySelector("section") as HTMLElement | null;

    expect(sectionEl).toBeTruthy();
    expect(sectionEl!.style.width).toBe("100%");
    expect(sectionEl!.style.minHeight).toBe("100vh");
    expect(sectionEl!.style.maxHeight).toBe("100vh");
  });

  it("Section renders gradient background when bgMode is gradient", () => {
    const props = {
      ...(Section.defaultProps as Record<string, unknown>),
      id: "gradient-section",
      bgMode: "gradient",
      gradientFrom: "#1A1A1A",
      gradientTo: "#2C2C2C",
      gradientDirection: "to right",
      bgImage: "",
    };

    const element = (Section.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);
    const sectionEl = container.querySelector("section") as HTMLElement | null;

    expect(sectionEl).toBeTruthy();
    expect(sectionEl!.style.backgroundImage).toContain("linear-gradient");
  });

  it("Section renders video background when media type is video", () => {
    const props = {
      ...(Section.defaultProps as Record<string, unknown>),
      id: "video-bg-section",
      bgMediaType: "video",
      bgVideoUrl: "https://cdn.example.com/video.mp4",
      bgImage: "https://placehold.co/1200x600",
    };

    const element = (Section.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    expect(container.querySelector("video")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeFalsy();
  });

  it("Section shows gradient controls only in gradient mode", () => {
    const fields = (Section.fields as Record<string, unknown>) ?? {};
    const resolved = (Section.resolveFields as (data: unknown, params: {
      changed: Record<string, boolean>;
      fields: Record<string, Record<string, unknown>>;
      lastFields: Record<string, Record<string, unknown>>;
      lastData: unknown;
      metadata: unknown;
      appState: unknown;
      parent: unknown;
    }) => Record<string, Record<string, unknown>>)(
      { ...(Section.defaultProps as Record<string, unknown>), bgMode: "gradient" },
      {
        changed: {},
        fields: fields as Record<string, Record<string, unknown>>,
        lastFields: fields as Record<string, Record<string, unknown>>,
        lastData: null,
        metadata: {},
        appState: {},
        parent: null,
      },
    );

    expect(resolved.gradientFrom.visible).toBe(true);
    expect(resolved.gradientTo.visible).toBe(true);
    expect(resolved.gradientDirection.visible).toBe(true);
    expect(resolved.bgColor.visible).toBe(false);
  });

  it("Section shows only image controls in image media mode", () => {
    const fields = (Section.fields as Record<string, unknown>) ?? {};
    const resolved = (Section.resolveFields as (data: unknown, params: {
      changed: Record<string, boolean>;
      fields: Record<string, Record<string, unknown>>;
      lastFields: Record<string, Record<string, unknown>>;
      lastData: unknown;
      metadata: unknown;
      appState: unknown;
      parent: unknown;
    }) => Record<string, Record<string, unknown>>)(
      { ...(Section.defaultProps as Record<string, unknown>), bgMediaType: "image" },
      {
        changed: {},
        fields: fields as Record<string, Record<string, unknown>>,
        lastFields: fields as Record<string, Record<string, unknown>>,
        lastData: null,
        metadata: {},
        appState: {},
        parent: null,
      },
    );

    expect(resolved.bgImage.visible).toBe(true);
    expect(resolved.bgPosition.visible).toBe(true);
    expect(resolved.bgVideoUrl.visible).toBe(false);
    expect(resolved.bgVideoPosition.visible).toBe(false);
    expect(resolved.bgOpacity.visible).toBe(true);
  });

  it("Section shows only video controls in video media mode", () => {
    const fields = (Section.fields as Record<string, unknown>) ?? {};
    const resolved = (Section.resolveFields as (data: unknown, params: {
      changed: Record<string, boolean>;
      fields: Record<string, Record<string, unknown>>;
      lastFields: Record<string, Record<string, unknown>>;
      lastData: unknown;
      metadata: unknown;
      appState: unknown;
      parent: unknown;
    }) => Record<string, Record<string, unknown>>)(
      { ...(Section.defaultProps as Record<string, unknown>), bgMediaType: "video" },
      {
        changed: {},
        fields: fields as Record<string, Record<string, unknown>>,
        lastFields: fields as Record<string, Record<string, unknown>>,
        lastData: null,
        metadata: {},
        appState: {},
        parent: null,
      },
    );

    expect(resolved.bgImage.visible).toBe(false);
    expect(resolved.bgVideoUrl.visible).toBe(true);
    expect(resolved.bgVideoPosition.visible).toBe(true);
    expect(resolved.bgVideoControls.visible).toBe(true);
    expect(resolved.bgOpacity.visible).toBe(true);
  });

  it("Section hides media-specific controls when media mode is none", () => {
    const fields = (Section.fields as Record<string, unknown>) ?? {};
    const resolved = (Section.resolveFields as (data: unknown, params: {
      changed: Record<string, boolean>;
      fields: Record<string, Record<string, unknown>>;
      lastFields: Record<string, Record<string, unknown>>;
      lastData: unknown;
      metadata: unknown;
      appState: unknown;
      parent: unknown;
    }) => Record<string, Record<string, unknown>>)(
      { ...(Section.defaultProps as Record<string, unknown>), bgMediaType: "none" },
      {
        changed: {},
        fields: fields as Record<string, Record<string, unknown>>,
        lastFields: fields as Record<string, Record<string, unknown>>,
        lastData: null,
        metadata: {},
        appState: {},
        parent: null,
      },
    );

    expect(resolved.bgImage.visible).toBe(false);
    expect(resolved.bgVideoUrl.visible).toBe(false);
    expect(resolved.bgOpacity.visible).toBe(false);
  });

  it("Section resolveFields reads mode values from runtime props shape", () => {
    const fields = (Section.fields as Record<string, unknown>) ?? {};
    const resolved = (Section.resolveFields as (data: unknown, params: {
      changed: Record<string, boolean>;
      fields: Record<string, Record<string, unknown>>;
      lastFields: Record<string, Record<string, unknown>>;
      lastData: unknown;
      metadata: unknown;
      appState: unknown;
      parent: unknown;
    }) => Record<string, Record<string, unknown>>)(
      {
        props: {
          ...(Section.defaultProps as Record<string, unknown>),
          bgMode: "gradient",
          bgMediaType: "video",
        },
      },
      {
        changed: {},
        fields: fields as Record<string, Record<string, unknown>>,
        lastFields: fields as Record<string, Record<string, unknown>>,
        lastData: null,
        metadata: {},
        appState: {},
        parent: null,
      },
    );

    expect(resolved.gradientFrom.visible).toBe(true);
    expect(resolved.bgColor.visible).toBe(false);
    expect(resolved.bgImage.visible).toBe(false);
    expect(resolved.bgVideoUrl.visible).toBe(true);
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

  it("Basic category contains Heading, Text, Button, InlineLink, Image, Video, Quote, Icon", () => {
    expect(categories.basic.components).toEqual([
      "Heading",
      "Text",
      "Button",
      "InlineLink",
      "Image",
      "Video",
      "Quote",
      "Icon",
    ]);
  });

  it("ORA category and Templates category have been removed", () => {
    expect((categories as Record<string, unknown>).ora).toBeUndefined();
    expect((categories as Record<string, unknown>).templates).toBeUndefined();
  });

  it("Interactive category contains FilterTabs, ScrollIndicator, IconFeatureList, AccordionGroup, StatsGrid, LocationMap", () => {
    expect(categories.interactive.components).toEqual([
      "FilterTabs",
      "ScrollIndicator",
      "IconFeatureList",
      "AccordionGroup",
      "StatsGrid",
      "LocationMap",
    ]);
  });

  it("Layout category has defaultExpanded: true", () => {
    expect(categories.layout.defaultExpanded).toBe(true);
  });
});

describe("Text rich content rendering", () => {
  it("renders bullet lists as ul/li elements", () => {
    const props = {
      ...(Text.defaultProps as Record<string, unknown>),
      id: "text-list-test",
      content: "<p>Intro</p><ul><li>Item one</li><li>Item two</li></ul>",
    };

    const element = (Text.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    const list = container.querySelector("ul");
    const items = container.querySelectorAll("li");

    expect(list).toBeTruthy();
    expect(items).toHaveLength(2);
    expect(container.textContent).toContain("Item one");
    expect(container.textContent).toContain("Item two");
  });
});

describe("Video component rendering", () => {
  it("renders Vimeo URL as iframe embed", () => {
    const props = {
      ...(Video.defaultProps as Record<string, unknown>),
      id: "video-embed-test",
      src: "https://player.vimeo.com/video/1101785637?muted=1&autoplay=1&controls=0&loop=1",
    };

    const element = (Video.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    expect(container.querySelector("iframe")).toBeTruthy();
  });
});

describe("Button hover rendering", () => {
  it("exposes hover-related fields", () => {
    const fieldKeys = Object.keys(Button.fields ?? {});
    expect(fieldKeys).toContain("bgColorHover");
    expect(fieldKeys).toContain("textColorHover");
    expect(fieldKeys).toContain("borderColorHover");
  });

  it("emits hover CSS variables and hover class", () => {
    const props = {
      ...(Button.defaultProps as Record<string, unknown>),
      text: "Hover me",
      bgColor: "#111111",
      bgColorHover: "#222222",
      textColor: "#eeeeee",
      textColorHover: "#ffcc00",
      borderSize: "1",
      borderColor: "#333333",
      borderColorHover: "#00aacc",
      _icon: { name: "star", position: "left", size: "16", gap: "8px" },
    };

    const element = (Button.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    const anchor = container.querySelector("a") as HTMLAnchorElement | null;
    expect(anchor).toBeTruthy();
    expect(anchor!.className).toContain("ora-builder-button");

    expect(anchor!.style.getPropertyValue("--btn-bg")).toBe("#111111");
    expect(anchor!.style.getPropertyValue("--btn-bg-hover")).toBe("#222222");
    expect(anchor!.style.getPropertyValue("--btn-text")).toBe("#eeeeee");
    expect(anchor!.style.getPropertyValue("--btn-text-hover")).toBe("#ffcc00");
    expect(anchor!.style.getPropertyValue("--btn-border")).toBe("#333333");
    expect(anchor!.style.getPropertyValue("--btn-border-hover")).toBe("#00aacc");

    const styleTag = container.querySelector("style");
    expect(styleTag?.textContent).toContain(".ora-builder-button:hover");
  });
});

describe("StatsGrid rendering", () => {
  it("renders stat values and labels from items array", () => {
    const props = {
      ...(StatsGrid.defaultProps as Record<string, unknown>),
      columns: "4",
      gap: "0px",
      items: [
        { value: "4.8M²", label: "Total Land Area", valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
        { value: "55%",   label: "Open Spaces",     valueColor: "#FFFFFF", valueFontSize: "52px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "rgba(255,255,255,0.75)", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "1", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
      ],
    };

    const element = (StatsGrid.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    expect(container.textContent).toContain("4.8M²");
    expect(container.textContent).toContain("Total Land Area");
    expect(container.textContent).toContain("55%");
    expect(container.textContent).toContain("Open Spaces");
  });

  it("applies per-item border-left when borderLeft is yes", () => {
    const props = {
      ...(StatsGrid.defaultProps as Record<string, unknown>),
      columns: "2",
      items: [
        { value: "100", label: "Units", valueColor: "#fff", valueFontSize: "48px", valueFontWeight: "300", valueLetterSpacing: "normal", labelColor: "#fff", labelFontSize: "14px", labelFontWeight: "300", labelLetterSpacing: "normal", borderLeft: "yes", borderRight: "no", borderTop: "no", borderBottom: "no", borderColor: "#FFFFFF", borderWidth: "2", borderRadius: "0", paddingX: "24px", paddingY: "16px", innerGap: "8px" },
      ],
    };

    const element = (StatsGrid.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    // styledRender wraps in a div (container → styledRender-wrapper → grid → stat-item)
    // container is itself a div, so we need 4 levels deep to reach the stat item
    const statItem = container.querySelector("div > div > div > div") as HTMLElement | null;
    expect(statItem).toBeTruthy();
    const styleAttr = statItem!.getAttribute("style") ?? "";
    expect(styleAttr).toContain("2px");
    expect(styleAttr).not.toContain("border-right");
  });
});

describe("AccordionGroup content rendering", () => {
  it("renders rich content body with list formatting", () => {
    const props = {
      ...(AccordionGroup.defaultProps as Record<string, unknown>),
      heading: "FAQs",
      items: [
        {
          title: "What is included?",
          body: "<p>Includes:</p><ul><li>Airport transfer</li><li>Daily breakfast</li></ul>",
        },
      ],
    };

    const element = (AccordionGroup.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    expect(container.querySelector("li")).toBeTruthy();
    expect(container.textContent).toContain("Airport transfer");
    expect(container.textContent).toContain("Daily breakfast");
  });

  it("does not render [object Object] for structured title/body values", () => {
    const props = {
      ...(AccordionGroup.defaultProps as Record<string, unknown>),
      heading: "FAQs",
      items: [
        {
          title: { text: "Accordion Title" },
          body: { children: [{ text: "Accordion Body" }] },
        },
      ],
    };

    const element = (AccordionGroup.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    expect(container.textContent).toContain("Accordion Title");
    expect(container.textContent).toContain("Accordion Body");
    expect(container.textContent).not.toContain("[object Object]");
  });
});

describe("LocationMap registration", () => {
  it("LocationMap is registered with default props and renders a title", () => {
    const LocationMap = pageBuilderConfig.components.LocationMap;
    expect(LocationMap).toBeDefined();
    expect(LocationMap.defaultProps).toBeDefined();

    const props = {
      ...(LocationMap.defaultProps as Record<string, unknown>),
      id: "loc-map-test",
      puck: { renderDropZone: () => null, isEditing: false },
    };
    const element = (LocationMap.render as (p: Record<string, unknown>) => React.ReactElement)(props);
    const { container } = render(element);

    // Title from defaultProps is "Location"
    expect(container.textContent).toContain("Location");
    // Cards from defaultProps include these names
    expect(container.textContent).toContain("Downtown Dubai");
    expect(container.textContent).toContain("35 Minutes");
    // Falls back to "Missing API key" notice when no key is configured at test time
    // (only when env var isn't set — guard so it doesn't fail in environments that have one)
    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
      expect(container.textContent?.toLowerCase()).toContain("api key");
    }
  });
});


/**
 * Feature: branded-font-enforcement — No fontFamily field in block configs
 *
 * Validates: Requirements 2.5
 */

describe("Configuration panel exposes no fontFamily field", () => {
  /**
   * Recursively collects all field keys and labels from a fields object,
   * including nested objectFields and arrayFields.
   */
  function collectFieldKeysAndLabels(
    fields: Record<string, unknown>,
    result: { keys: string[]; labels: string[] } = { keys: [], labels: [] },
  ): { keys: string[]; labels: string[] } {
    for (const [key, value] of Object.entries(fields)) {
      result.keys.push(key);
      if (value && typeof value === "object") {
        const field = value as Record<string, unknown>;
        if (typeof field.label === "string") {
          result.labels.push(field.label);
        }
        // Recurse into objectFields (e.g. _typography objectFields)
        if (field.objectFields && typeof field.objectFields === "object") {
          collectFieldKeysAndLabels(field.objectFields as Record<string, unknown>, result);
        }
        // Recurse into arrayFields (e.g. items arrayFields)
        if (field.arrayFields && typeof field.arrayFields === "object") {
          collectFieldKeysAndLabels(field.arrayFields as Record<string, unknown>, result);
        }
      }
    }
    return result;
  }

  const blocksToCheck = [
    { name: "Button", component: Button },
    { name: "StatsGrid", component: StatsGrid },
    { name: "Heading", component: Heading },
    { name: "Text", component: Text },
    { name: "InlineLink", component: InlineLink },
    { name: "Quote", component: Quote },
    { name: "AccordionGroup", component: AccordionGroup },
    { name: "FilterTabs", component: FilterTabs },
  ];

  it.each(blocksToCheck)(
    "$name fields do not contain a fontFamily key",
    ({ component }) => {
      const fields = (component.fields ?? {}) as Record<string, unknown>;
      const { keys } = collectFieldKeysAndLabels(fields);
      expect(keys).not.toContain("fontFamily");
    },
  );

  it.each(blocksToCheck)(
    '$name fields do not contain a "Font Family" label',
    ({ component }) => {
      const fields = (component.fields ?? {}) as Record<string, unknown>;
      const { labels } = collectFieldKeysAndLabels(fields);
      expect(labels).not.toContain("Font Family");
    },
  );
});
