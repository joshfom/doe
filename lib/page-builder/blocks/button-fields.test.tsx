// @vitest-environment jsdom
/**
 * Unit tests for the shared button field group (`buttonFields`) and its key
 * namespacing helpers.
 *
 * Scope: this file covers task 2.1 — the `buttonFields(prefix?)` field-group
 * factory, `buttonFieldKey`, and `buttonFieldDefaults`. The anchor render
 * helper (`renderButtonAnchor`) and its semantics are tested separately.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Shared helpers" → `blocks/button-fields.ts`
 * Validates: Requirements 1.7, 13.6
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import {
  buttonFields,
  buttonFieldDefaults,
  buttonFieldKey,
} from "./button-fields";

// The base field names a button group is expected to expose, mirroring the
// existing Button block's field set.
const EXPECTED_BASE_KEYS = [
  "text",
  "url",
  "_icon",
  "textColor",
  "textColorHover",
  "bgColor",
  "bgColorHover",
  "borderColor",
  "borderColorHover",
  "borderSize",
  "borderRadius",
  "btnPadding",
  "fullWidth",
  "alignment",
];

describe("buttonFieldKey", () => {
  it("returns the base name unchanged when no prefix is given", () => {
    expect(buttonFieldKey("text")).toBe("text");
    expect(buttonFieldKey("_icon")).toBe("_icon");
    expect(buttonFieldKey("btnPadding")).toBe("btnPadding");
  });

  it("camel-cases the base name behind a prefix", () => {
    expect(buttonFieldKey("text", "primary")).toBe("primaryText");
    expect(buttonFieldKey("url", "secondary")).toBe("secondaryUrl");
    expect(buttonFieldKey("btnPadding", "cta")).toBe("ctaBtnPadding");
  });

  it("preserves the leading underscore on private/structured keys", () => {
    expect(buttonFieldKey("_icon", "primary")).toBe("_primaryIcon");
  });

  it("produces unique keys per prefix so groups never collide", () => {
    const primary = EXPECTED_BASE_KEYS.map((k) => buttonFieldKey(k as never, "primary"));
    const secondary = EXPECTED_BASE_KEYS.map((k) => buttonFieldKey(k as never, "secondary"));
    const overlap = primary.filter((k) => secondary.includes(k));
    expect(overlap).toEqual([]);
  });
});

describe("buttonFields", () => {
  it("exposes the full Button-style field set when no prefix is given", () => {
    const fields = buttonFields();
    expect(Object.keys(fields).sort()).toEqual([...EXPECTED_BASE_KEYS].sort());
  });

  it("namespaces every field key when a prefix is given", () => {
    const fields = buttonFields("primary");
    const expected = EXPECTED_BASE_KEYS.map((k) => buttonFieldKey(k as never, "primary"));
    expect(Object.keys(fields).sort()).toEqual([...expected].sort());
  });

  it("keeps two prefixed groups fully disjoint", () => {
    const primary = buttonFields("primary");
    const secondary = buttonFields("secondary");
    const shared = Object.keys(primary).filter((k) => k in secondary);
    expect(shared).toEqual([]);
  });

  it("uses the expected Puck field types for each control", () => {
    const fields = buttonFields() as Record<string, { type: string; objectFields?: Record<string, unknown> }>;

    expect(fields.text.type).toBe("text");
    expect(fields.url.type).toBe("text");
    expect(fields._icon.type).toBe("object");
    expect(fields.fullWidth.type).toBe("radio");
    expect(fields.alignment.type).toBe("radio");

    // Color, border, and padding controls are all custom-rendered fields.
    for (const key of ["textColor", "bgColor", "borderColor", "borderSize", "borderRadius", "btnPadding"]) {
      expect(fields[key].type).toBe("custom");
    }
  });

  it("declares the icon object with name/position/size/gap sub-fields", () => {
    const fields = buttonFields() as Record<string, { objectFields?: Record<string, unknown> }>;
    const iconFields = fields._icon.objectFields ?? {};
    expect(Object.keys(iconFields).sort()).toEqual(["gap", "name", "position", "size"]);
  });

  it("marks the label text as content-editable, matching the Button block", () => {
    const fields = buttonFields() as Record<string, { contentEditable?: boolean }>;
    expect(fields.text.contentEditable).toBe(true);
  });

  it("produces field objects whose custom renderers return valid React", () => {
    const fields = buttonFields() as Record<string, {
      type: string;
      render?: (props: { field: unknown; name: string; id: string; value: unknown; onChange: () => void }) => React.ReactElement;
    }>;
    // Smoke-render one custom field to ensure the factory output is renderable.
    const colorField = fields.textColor;
    expect(colorField.type).toBe("custom");
    const element = colorField.render!({
      field: colorField,
      name: "textColor",
      id: "textColor",
      value: "#123456",
      onChange: () => {},
    });
    const { container } = render(element);
    const hexInput = container.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(hexInput).toBeTruthy();
    expect(hexInput!.value).toBe("#123456");
  });
});

describe("buttonFieldDefaults", () => {
  it("provides a default for every field buttonFields declares", () => {
    const fieldKeys = Object.keys(buttonFields()).sort();
    const defaultKeys = Object.keys(buttonFieldDefaults()).sort();
    expect(defaultKeys).toEqual(fieldKeys);
  });

  it("aligns default keys with prefixed field keys", () => {
    const fieldKeys = Object.keys(buttonFields("secondary")).sort();
    const defaultKeys = Object.keys(buttonFieldDefaults("secondary")).sort();
    expect(defaultKeys).toEqual(fieldKeys);
  });

  it("mirrors the Button block's shipped defaults", () => {
    const defaults = buttonFieldDefaults();
    expect(defaults.text).toBe("Click Me");
    expect(defaults.url).toBe("");
    expect(defaults.bgColor).toBe("#2C2C2C");
    expect(defaults.fullWidth).toBe("no");
    expect(defaults.alignment).toBe("left");
    expect(defaults.btnPadding).toEqual({ top: 12, right: 24, bottom: 12, left: 24 });
    expect(defaults._icon).toEqual({ name: "", position: "right", size: "16", gap: "8px" });
  });
});
