import { describe, it, expect } from "vitest";

// Polyfill ResizeObserver for jsdom — @puckeditor/core uses @dnd-kit/dom which requires it
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("page-builder module setup", () => {
  it("module directory structure exists", async () => {
    // Verify core module files can be imported
    await expect(import("./types")).resolves.toBeDefined();
    await expect(import("./schema")).resolves.toBeDefined();
    await expect(import("./config")).resolves.toBeDefined();
    await expect(import("./data-store")).resolves.toBeDefined();
    await expect(import("./page-manager")).resolves.toBeDefined();
    await expect(import("./ai-generator")).resolves.toBeDefined();
    await expect(import("./theme")).resolves.toBeDefined();
    await expect(import("./index")).resolves.toBeDefined();
  });
});
