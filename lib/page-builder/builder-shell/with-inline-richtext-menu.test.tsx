// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { Config } from "@puckeditor/core";

// Polyfill ResizeObserver for jsdom — must be set before importing the module
// under test, which transitively loads @puckeditor/core → @dnd-kit/dom that
// accesses ResizeObserver at module scope.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Dynamic import so the polyfill is in place before module evaluation.
const { withInlineRichtextMenu } = await import("./with-inline-richtext-menu");

const baseConfig = {
  components: {
    Text: {
      fields: {
        content: { type: "richtext", label: "Content", options: { link: false } },
        size: { type: "text", label: "Size" },
      },
      defaultProps: { content: "<p>Hi</p>", size: "16" },
      render: () => null,
    },
    Accordion: {
      fields: {
        items: {
          type: "array",
          arrayFields: {
            title: { type: "text", label: "Title" },
            body: { type: "richtext", label: "Body" },
          },
        },
      },
      defaultProps: { items: [] },
      render: () => null,
    },
  },
} as unknown as Config;

describe("withInlineRichtextMenu", () => {
  it("attaches renderInlineMenu to top-level richtext fields", () => {
    const out = withInlineRichtextMenu(baseConfig);
    const field = out.components.Text.fields!.content as Record<string, unknown>;
    expect(typeof field.renderInlineMenu).toBe("function");
  });

  it("attaches renderInlineMenu to nested array richtext fields", () => {
    const out = withInlineRichtextMenu(baseConfig);
    const arrayField = out.components.Accordion.fields!.items as Record<string, unknown>;
    const body = (arrayField.arrayFields as Record<string, Record<string, unknown>>).body;
    expect(typeof body.renderInlineMenu).toBe("function");
  });

  it("leaves non-richtext fields untouched", () => {
    const out = withInlineRichtextMenu(baseConfig);
    const size = out.components.Text.fields!.size as Record<string, unknown>;
    expect(size.renderInlineMenu).toBeUndefined();
  });

  it("does not mutate the input config (public config stays menu-free)", () => {
    withInlineRichtextMenu(baseConfig);
    const original = baseConfig.components.Text.fields!.content as Record<string, unknown>;
    expect(original.renderInlineMenu).toBeUndefined();
  });
});
