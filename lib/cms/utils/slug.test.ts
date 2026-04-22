import { describe, it, expect } from "vitest";
import { generateSlug, ensureUniqueSlug } from "./slug";

describe("generateSlug", () => {
  it("converts a simple title to lowercase slug", () => {
    expect(generateSlug("Hello World")).toBe("hello-world");
  });

  it("strips special characters in strict mode", () => {
    expect(generateSlug("Hello! @World #2024")).toBe("hello-world-2024");
  });

  it("handles already-lowercase input", () => {
    expect(generateSlug("about us")).toBe("about-us");
  });

  it("returns empty string for empty input", () => {
    expect(generateSlug("")).toBe("");
  });

  it("handles unicode/accented characters", () => {
    const slug = generateSlug("Café Résumé");
    expect(slug).toBe("cafe-resume");
  });

  it("is deterministic — same input produces same output", () => {
    const title = "My Page Title";
    expect(generateSlug(title)).toBe(generateSlug(title));
  });
});

describe("ensureUniqueSlug", () => {
  it("returns baseSlug when no collision", () => {
    expect(ensureUniqueSlug("about", ["home", "contact"])).toBe("about");
  });

  it("appends -1 on first collision", () => {
    expect(ensureUniqueSlug("about", ["about"])).toBe("about-1");
  });

  it("appends -2 when -1 is also taken", () => {
    expect(ensureUniqueSlug("about", ["about", "about-1"])).toBe("about-2");
  });

  it("finds the next available suffix", () => {
    expect(
      ensureUniqueSlug("page", ["page", "page-1", "page-2", "page-3"])
    ).toBe("page-4");
  });

  it("returns baseSlug when existingSlugs is empty", () => {
    expect(ensureUniqueSlug("home", [])).toBe("home");
  });
});
