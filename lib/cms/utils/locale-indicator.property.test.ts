import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { getLocaleCompletionStatus } from "./locale-indicator";
import type { PageNamespaceGroup } from "../types";
import type { PageStatus } from "../types";

/**
 * Feature: ora-cms-platform, Property 13: Locale completion indicator logic
 *
 * **Validates: Requirements 7.4**
 *
 * For any namespace group, the completion indicator SHALL be:
 * - green when all locale versions are published
 * - amber when exactly one locale version is published
 * - gray when no locale version is published
 */

const statusArb = fc.constantFrom<PageStatus>("draft", "published");

const localeEntryArb = (status: fc.Arbitrary<PageStatus>) =>
  fc.record({
    id: fc.uuid(),
    title: fc.string({ minLength: 1, maxLength: 50 }),
    status,
  });

const baseGroupArb = fc.record({
  namespace: fc.uuid(),
  slug: fc.string({ minLength: 1, maxLength: 30 }),
  isSystem: fc.boolean(),
});

describe("Feature: ora-cms-platform, Property 13: Locale completion indicator logic", () => {
  it("returns green when both EN and AR are published", () => {
    fc.assert(
      fc.property(
        baseGroupArb,
        localeEntryArb(fc.constant<PageStatus>("published")),
        localeEntryArb(fc.constant<PageStatus>("published")),
        (base, enEntry, arEntry) => {
          const group: PageNamespaceGroup = {
            ...base,
            locales: { en: enEntry, ar: arEntry },
          };
          expect(getLocaleCompletionStatus(group)).toBe("green");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("returns amber when only EN is published", () => {
    fc.assert(
      fc.property(
        baseGroupArb,
        localeEntryArb(fc.constant<PageStatus>("published")),
        localeEntryArb(fc.constant<PageStatus>("draft")),
        (base, enEntry, arEntry) => {
          const group: PageNamespaceGroup = {
            ...base,
            locales: { en: enEntry, ar: arEntry },
          };
          expect(getLocaleCompletionStatus(group)).toBe("amber");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("returns amber when only AR is published", () => {
    fc.assert(
      fc.property(
        baseGroupArb,
        localeEntryArb(fc.constant<PageStatus>("draft")),
        localeEntryArb(fc.constant<PageStatus>("published")),
        (base, enEntry, arEntry) => {
          const group: PageNamespaceGroup = {
            ...base,
            locales: { en: enEntry, ar: arEntry },
          };
          expect(getLocaleCompletionStatus(group)).toBe("amber");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("returns gray when neither EN nor AR is published", () => {
    fc.assert(
      fc.property(
        baseGroupArb,
        localeEntryArb(fc.constant<PageStatus>("draft")),
        localeEntryArb(fc.constant<PageStatus>("draft")),
        (base, enEntry, arEntry) => {
          const group: PageNamespaceGroup = {
            ...base,
            locales: { en: enEntry, ar: arEntry },
          };
          expect(getLocaleCompletionStatus(group)).toBe("gray");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("returns amber when only EN exists and is published (AR missing)", () => {
    fc.assert(
      fc.property(
        baseGroupArb,
        localeEntryArb(fc.constant<PageStatus>("published")),
        (base, enEntry) => {
          const group: PageNamespaceGroup = {
            ...base,
            locales: { en: enEntry },
          };
          expect(getLocaleCompletionStatus(group)).toBe("amber");
        }
      ),
      { numRuns: 20 }
    );
  });

  it("returns gray when only EN exists and is draft (AR missing)", () => {
    fc.assert(
      fc.property(
        baseGroupArb,
        localeEntryArb(fc.constant<PageStatus>("draft")),
        (base, enEntry) => {
          const group: PageNamespaceGroup = {
            ...base,
            locales: { en: enEntry },
          };
          expect(getLocaleCompletionStatus(group)).toBe("gray");
        }
      ),
      { numRuns: 20 }
    );
  });
});
