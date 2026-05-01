import { describe, it, expect } from "vitest";
import { detectLanguage } from "./language";

describe("detectLanguage", () => {
  it("detects English text", () => {
    expect(detectLanguage("Hello, how can I help you today?")).toBe("en");
  });

  it("detects Arabic text", () => {
    expect(detectLanguage("مرحبا كيف يمكنني مساعدتك اليوم")).toBe("ar");
  });

  it("detects mixed text as Arabic when Arabic ratio exceeds 30%", () => {
    // Roughly 50% Arabic characters
    expect(detectLanguage("مرحبا hello مساعدتك")).toBe("ar");
  });

  it("detects mixed text as English when Arabic ratio is below 30%", () => {
    // Mostly English with a single Arabic word
    expect(detectLanguage("Hello world this is a test مرحبا")).toBe("en");
  });

  it("returns English for empty string", () => {
    expect(detectLanguage("")).toBe("en");
  });

  it("returns English for whitespace-only string", () => {
    expect(detectLanguage("   ")).toBe("en");
  });

  it("returns English for text with only numbers and punctuation", () => {
    expect(detectLanguage("12345!@#$%")).toBe("en");
  });

  it("detects fully Arabic text with diacritics", () => {
    expect(detectLanguage("بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ")).toBe("ar");
  });
});
