// @vitest-environment jsdom
/**
 * Unit tests for the shared button anchor render helper (`renderButtonAnchor`)
 * and its `isExternalButtonUrl` companion.
 *
 * Scope: this file covers task 2.3 — the anchor *semantics* produced by
 * `renderButtonAnchor`: a semantic `<a>` with the correct `href`, the external
 * `rel="noopener noreferrer"` rule, the accessible name equalling the label,
 * the empty-url omission rule, the prefixed-prop round-trip, and icon
 * rendering/position. The field-group factory (`buttonFields`/`buttonFieldKey`/
 * `buttonFieldDefaults`) is covered in `button-fields.test.tsx`.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Shared helpers" → `blocks/button-fields.ts` (renderButtonAnchor)
 * Validates: Requirements 1.7, 1.8, 1.10, 5.5, 6.9, 7.7, 13.6
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import {
  renderButtonAnchor,
  isExternalButtonUrl,
  buttonFieldDefaults,
} from "./button-fields";

// A minimal, identifiable icon component matching the ICON_MAP value contract.
// It renders an empty <svg> (no text → contributes nothing to the accessible
// name) tagged with a test id and the size it was handed, so tests can assert
// presence, absence, and ordering relative to the label.
const TestIcon = ({ size }: { size?: number; color?: string; strokeWidth?: number }) =>
  React.createElement("svg", {
    "data-testid": "test-icon",
    "data-size": String(size ?? ""),
    "aria-hidden": "true",
  });

const ICON_MAP = { "test-icon": TestIcon };

/** Render a (non-null) anchor element and return Testing Library helpers. */
function renderAnchor(
  props: Record<string, unknown>,
  opts?: Parameters<typeof renderButtonAnchor>[1],
) {
  const el = renderButtonAnchor(props, opts);
  expect(el).not.toBeNull();
  return render(el as React.ReactElement);
}

describe("isExternalButtonUrl", () => {
  it("treats absolute http(s) URLs as external", () => {
    expect(isExternalButtonUrl("https://example.com")).toBe(true);
    expect(isExternalButtonUrl("http://example.com/path")).toBe(true);
  });

  it("is case-insensitive on the scheme", () => {
    expect(isExternalButtonUrl("HTTPS://EXAMPLE.COM")).toBe(true);
    expect(isExternalButtonUrl("HtTp://example.com")).toBe(true);
  });

  it("treats relative paths, anchors, mailto and tel as internal", () => {
    expect(isExternalButtonUrl("/about")).toBe(false);
    expect(isExternalButtonUrl("about")).toBe(false);
    expect(isExternalButtonUrl("#section")).toBe(false);
    expect(isExternalButtonUrl("mailto:hi@example.com")).toBe(false);
    expect(isExternalButtonUrl("tel:+15551234")).toBe(false);
  });
});

describe("renderButtonAnchor — anchor semantics (Req 1.8, 5.5, 6.9)", () => {
  it("renders a semantic <a> element carrying the resolved href", () => {
    const { getByRole } = renderAnchor({ text: "Go", url: "/pricing" });
    const link = getByRole("link") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/pricing");
  });

  it("uses the opts.url override in preference to the url prop", () => {
    const { getByRole } = renderAnchor(
      { text: "Go", url: "/from-prop" },
      { url: "/from-opts" },
    );
    expect((getByRole("link") as HTMLAnchorElement).getAttribute("href")).toBe(
      "/from-opts",
    );
  });

  it("trims surrounding whitespace from the href", () => {
    const { getByRole } = renderAnchor({ text: "Go", url: "  /trimmed  " });
    expect((getByRole("link") as HTMLAnchorElement).getAttribute("href")).toBe(
      "/trimmed",
    );
  });
});

describe("renderButtonAnchor — external rel (Req 7.7)", () => {
  it("adds rel=noopener noreferrer for absolute http(s) URLs", () => {
    const { getByRole } = renderAnchor({ text: "Out", url: "https://example.com" });
    expect(getByRole("link").getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("omits rel for internal/relative URLs", () => {
    const { getByRole } = renderAnchor({ text: "In", url: "/internal" });
    expect(getByRole("link").getAttribute("rel")).toBeNull();
  });

  it("omits rel for in-page anchors, mailto, and tel links", () => {
    for (const url of ["#section", "mailto:hi@example.com", "tel:+15551234"]) {
      const { getByRole, unmount } = renderAnchor({ text: "Link", url });
      expect(getByRole("link").getAttribute("rel")).toBeNull();
      unmount();
    }
  });
});

describe("renderButtonAnchor — accessible name (Req 1.10, 13.6)", () => {
  it("gives the anchor an accessible name equal to its label", () => {
    const { getByRole } = renderAnchor({ text: "Get Started", url: "/start" });
    // Found only if the computed accessible name matches the visible label.
    const link = getByRole("link", { name: "Get Started" });
    expect(link).toBeTruthy();
  });

  it("derives the accessible name from the visible label text, not an aria-label", () => {
    const { getByRole } = renderAnchor({ text: "Contact Us", url: "/contact" });
    const link = getByRole("link", { name: "Contact Us" });
    expect(link.getAttribute("aria-label")).toBeNull();
    expect(link.textContent).toBe("Contact Us");
  });

  it("honours an opts.label override for the accessible name", () => {
    const { getByRole } = renderAnchor(
      { text: "ignored", url: "/x" },
      { label: "Override Name" },
    );
    expect(getByRole("link", { name: "Override Name" })).toBeTruthy();
  });
});

describe("renderButtonAnchor — empty-url omission (Req 1.7)", () => {
  it("returns null when the url is empty", () => {
    expect(renderButtonAnchor({ text: "Nope", url: "" })).toBeNull();
  });

  it("returns null when the url is missing entirely", () => {
    expect(renderButtonAnchor({ text: "Nope" })).toBeNull();
  });

  it("returns null when the url is only whitespace", () => {
    expect(renderButtonAnchor({ text: "Nope", url: "   " })).toBeNull();
  });

  it('returns null when the url is just "#"', () => {
    expect(renderButtonAnchor({ text: "Nope", url: "#" })).toBeNull();
    expect(renderButtonAnchor({ text: "Nope", url: "  #  " })).toBeNull();
  });

  it("returns null when an empty opts.url override wins over a real prop", () => {
    expect(renderButtonAnchor({ text: "Nope", url: "/real" }, { url: "" })).toBeNull();
  });
});

describe("renderButtonAnchor — prefixed-prop round-trip", () => {
  it("reads back the correct namespaced props for primary and secondary groups", () => {
    const props = {
      ...buttonFieldDefaults("primary"),
      ...buttonFieldDefaults("secondary"),
      primaryText: "Primary CTA",
      primaryUrl: "/primary",
      secondaryText: "Secondary CTA",
      secondaryUrl: "https://external.example.com",
    };

    const primary = renderAnchor(props, { prefix: "primary" });
    const primaryLink = primary.getByRole("link", { name: "Primary CTA" });
    expect(primaryLink.getAttribute("href")).toBe("/primary");
    expect(primaryLink.getAttribute("rel")).toBeNull(); // internal
    primary.unmount();

    const secondary = renderAnchor(props, { prefix: "secondary" });
    const secondaryLink = secondary.getByRole("link", { name: "Secondary CTA" });
    expect(secondaryLink.getAttribute("href")).toBe("https://external.example.com");
    expect(secondaryLink.getAttribute("rel")).toBe("noopener noreferrer"); // external
  });

  it("omits a prefixed button whose namespaced url is empty (default)", () => {
    // buttonFieldDefaults leaves url empty, so an untouched group renders nothing.
    const props = buttonFieldDefaults("secondary");
    expect(renderButtonAnchor(props, { prefix: "secondary" })).toBeNull();
  });
});

describe("renderButtonAnchor — icon rendering", () => {
  it("renders no icon when no iconMap is supplied", () => {
    const { getByRole, queryByTestId } = renderAnchor({
      text: "No Icon",
      url: "/x",
      _icon: { name: "test-icon", position: "right", size: "16" },
    });
    expect(queryByTestId("test-icon")).toBeNull();
    // The anchor's only child element is the label span.
    const link = getByRole("link");
    expect(link.querySelectorAll("svg").length).toBe(0);
  });

  it("renders no icon when the icon name is empty even with an iconMap", () => {
    const { queryByTestId } = renderAnchor(
      { text: "No Icon", url: "/x", _icon: { name: "", position: "right", size: "16" } },
      { iconMap: ICON_MAP },
    );
    expect(queryByTestId("test-icon")).toBeNull();
  });

  it("renders the mapped icon at the configured size when name + iconMap are present", () => {
    const { getByTestId } = renderAnchor(
      { text: "With Icon", url: "/x", _icon: { name: "test-icon", position: "right", size: "20" } },
      { iconMap: ICON_MAP },
    );
    const icon = getByTestId("test-icon");
    expect(icon).toBeTruthy();
    expect(icon.getAttribute("data-size")).toBe("20");
  });

  it("places the icon AFTER the label when position is right", () => {
    const { getByRole, getByTestId } = renderAnchor(
      { text: "Next", url: "/x", _icon: { name: "test-icon", position: "right", size: "16" } },
      { iconMap: ICON_MAP },
    );
    const link = getByRole("link");
    const icon = getByTestId("test-icon");
    const labelSpan = link.querySelector("span")!;
    // documentPosition FOLLOWING (4) means icon comes after the label span.
    expect(labelSpan.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("places the icon BEFORE the label when position is left", () => {
    const { getByRole, getByTestId } = renderAnchor(
      { text: "Back", url: "/x", _icon: { name: "test-icon", position: "left", size: "16" } },
      { iconMap: ICON_MAP },
    );
    const link = getByRole("link");
    const icon = getByTestId("test-icon");
    const labelSpan = link.querySelector("span")!;
    // documentPosition PRECEDING (2) means icon comes before the label span.
    expect(labelSpan.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("keeps the label as the accessible name even when an icon is present", () => {
    const { getByRole } = renderAnchor(
      { text: "Download", url: "/x", _icon: { name: "test-icon", position: "left", size: "16" } },
      { iconMap: ICON_MAP },
    );
    expect(getByRole("link", { name: "Download" })).toBeTruthy();
  });
});
