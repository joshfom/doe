import { describe, it, expect } from "vitest";
import { validatePageData } from "./schema";

describe("validatePageData", () => {
  const validPageData = {
    root: { props: {} },
    content: [
      { type: "Hero", props: { id: "hero-1", heading: "Hello" } },
    ],
  };

  it("accepts valid PageData", () => {
    const result = validatePageData(validPageData);
    expect(result.success).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("accepts valid PageData with zones", () => {
    const result = validatePageData({
      ...validPageData,
      zones: {
        "col-1": [{ type: "TextBlock", props: { id: "tb-1" } }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid PageData with empty content", () => {
    const result = validatePageData({ root: { props: {} }, content: [] });
    expect(result.success).toBe(true);
  });

  it("rejects missing root", () => {
    const result = validatePageData({ content: [] });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("rejects missing content", () => {
    const result = validatePageData({ root: { props: {} } });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("rejects component instance missing type", () => {
    const result = validatePageData({
      root: { props: {} },
      content: [{ props: { id: "x" } }],
    });
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path.includes("type"))).toBe(true);
  });

  it("rejects component instance with empty type", () => {
    const result = validatePageData({
      root: { props: {} },
      content: [{ type: "", props: { id: "x" } }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects component instance missing props.id", () => {
    const result = validatePageData({
      root: { props: {} },
      content: [{ type: "Hero", props: {} }],
    });
    expect(result.success).toBe(false);
    expect(result.errors!.some((e) => e.path.includes("id"))).toBe(true);
  });

  it("rejects component instance with empty props.id", () => {
    const result = validatePageData({
      root: { props: {} },
      content: [{ type: "Hero", props: { id: "" } }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validatePageData(null).success).toBe(false);
    expect(validatePageData(undefined).success).toBe(false);
    expect(validatePageData("string").success).toBe(false);
    expect(validatePageData(42).success).toBe(false);
  });

  it("returns error paths for nested validation failures", () => {
    const result = validatePageData({
      root: { props: {} },
      content: [{ type: "Hero", props: { id: "" } }],
    });
    expect(result.success).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
    // Path should reference the nested location
    expect(result.errors![0].path).toBeTruthy();
    expect(result.errors![0].message).toBeTruthy();
  });
});
