import { describe, it, expect } from "vitest";
import { RICHTEXT_FIELD_NAMES, isRichtextField } from "./richtext-fields";

describe("richtext-fields", () => {
  describe("RICHTEXT_FIELD_NAMES", () => {
    it('contains "content"', () => {
      expect(RICHTEXT_FIELD_NAMES.has("content")).toBe(true);
    });

    it('contains "body"', () => {
      expect(RICHTEXT_FIELD_NAMES.has("body")).toBe(true);
    });

    it('contains "html"', () => {
      expect(RICHTEXT_FIELD_NAMES.has("html")).toBe(true);
    });

    it('does NOT contain non-richtext field names', () => {
      expect(RICHTEXT_FIELD_NAMES.has("title")).toBe(false);
      expect(RICHTEXT_FIELD_NAMES.has("src")).toBe(false);
      expect(RICHTEXT_FIELD_NAMES.has("alt")).toBe(false);
      expect(RICHTEXT_FIELD_NAMES.has("className")).toBe(false);
    });
  });

  describe("isRichtextField", () => {
    it('returns true for "content"', () => {
      expect(isRichtextField("content")).toBe(true);
    });

    it('returns true for "body"', () => {
      expect(isRichtextField("body")).toBe(true);
    });

    it('returns true for "html"', () => {
      expect(isRichtextField("html")).toBe(true);
    });

    it('returns false for "title"', () => {
      expect(isRichtextField("title")).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isRichtextField("")).toBe(false);
    });
  });
});
