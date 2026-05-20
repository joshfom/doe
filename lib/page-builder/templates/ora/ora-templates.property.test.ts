/**
 * Property-based tests for ORA page templates.
 *
 * Uses fast-check to verify universal properties hold across all four
 * template factories over ≥ 100 iterations each.
 *
 * Validates: Requirements 1.11, 2.3, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { oraProjectPageTemplate } from "./ora-project-page";
import { whyBaynTemplate } from "./why-bayn";
import { lifeAtBaynTemplate } from "./life-at-bayn";
import { aboutOraTemplate } from "./about-ora";
import { validatePageData } from "../../schema";
import { ORA_PAGE_TEMPLATE_PALETTE } from "./archetype-defaults";
import { BREAKPOINT_AWARE_FIELDS } from "../../breakpoint-fields";
import type { PageTemplate } from "../index";
import type { ComponentInstance } from "../../types";

// ─── Generator (Task 11.2) ──────────────────────────────────────────────────

const templateFactories = [
  oraProjectPageTemplate,
  whyBaynTemplate,
  lifeAtBaynTemplate,
  aboutOraTemplate,
] as const;

const factoryArb = fc.constantFrom(...templateFactories);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all blocks from a template's content and zones. */
function collectAllBlocks(template: PageTemplate): ComponentInstance[] {
  const blocks: ComponentInstance[] = [...template.data.content];
  if (template.data.zones) {
    for (const children of Object.values(template.data.zones)) {
      blocks.push(...children);
    }
  }
  return blocks;
}

/** Collect all props.id values from the template tree. */
function collectAllIds(template: PageTemplate): string[] {
  return collectAllBlocks(template).map((b) => b.props.id);
}

/** Get all Section blocks from a template (top-level content). */
function getSections(template: PageTemplate): ComponentInstance[] {
  return template.data.content.filter((b) => b.type === "Section");
}

/** Valid archetype tags. */
const VALID_ARCHETYPES = new Set([
  "hero",
  "image+text",
  "text+image",
  "heading+full-width-image",
  "heading+accordions",
  "split-content",
  "cta",
  "quote-feature",
]);

/** Check if a value is a breakpoint object (has desktop and mobile keys). */
function isBreakpointObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    "desktop" in (value as Record<string, unknown>) &&
    "mobile" in (value as Record<string, unknown>)
  );
}

// ─── Properties ─────────────────────────────────────────────────────────────

const NUM_RUNS = 100;

describe("ORA Templates — Property-based tests", () => {
  // Property 1: Schema validity (Task 11.3)
  it("Property 1 — every template passes page-data schema validation", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const template = factory();
        const result = validatePageData(template.data);
        expect(result.success).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property 2: Unique block ids (Task 11.4)
  it("Property 2 — all block ids within a template are unique", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const template = factory();
        const ids = collectAllIds(template);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property 3: Disjoint ids across imports (Task 11.5)
  it("Property 3 — two invocations of the same factory produce disjoint id sets", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const t1 = factory();
        const t2 = factory();
        const ids1 = new Set(collectAllIds(t1));
        const ids2 = new Set(collectAllIds(t2));
        const intersection = [...ids1].filter((id) => ids2.has(id));
        expect(intersection).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property 4: Brand background mode (Task 11.6)
  it("Property 4 — every Section uses gradient or solid+image bgMode", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const template = factory();
        const sections = getSections(template);
        const violations: string[] = [];
        for (const section of sections) {
          const bgMode = section.props.bgMode as string;
          if (bgMode === "gradient") continue;
          if (
            bgMode === "solid" &&
            section.props.bgMediaType === "image" &&
            typeof section.props.bgImage === "string" &&
            (section.props.bgImage as string).trim().length > 0
          ) {
            continue;
          }
          violations.push(
            `Section ${section.props.id}: bgMode="${bgMode}", bgMediaType="${section.props.bgMediaType}", bgImage="${section.props.bgImage}"`,
          );
        }
        expect(violations).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property 5: Gradient palette compliance (Task 11.7)
  it("Property 5 — every gradient from/to is in ORA_PAGE_TEMPLATE_PALETTE", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const template = factory();
        const sections = getSections(template);
        const palette = new Set<string>(ORA_PAGE_TEMPLATE_PALETTE as readonly string[]);
        const violations: string[] = [];
        for (const section of sections) {
          if (section.props.bgMode === "gradient") {
            const from = section.props.gradientFrom as string;
            const to = section.props.gradientTo as string;
            if (!palette.has(from)) {
              violations.push(`Section ${section.props.id}: gradientFrom="${from}" not in palette`);
            }
            if (!palette.has(to)) {
              violations.push(`Section ${section.props.id}: gradientTo="${to}" not in palette`);
            }
          }
        }
        expect(violations).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property 6: Image hero source non-empty (Task 11.8)
  it("Property 6 — image-hero Sections at position 0 have non-empty bgImage", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const template = factory();
        const sections = getSections(template);
        const violations: string[] = [];
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          // image-hero is encoded as bgMode=solid + bgMediaType=image
          if (
            section.props.bgMode === "solid" &&
            section.props.bgMediaType === "image"
          ) {
            if (i !== 0) {
              violations.push(`image-hero Section found at position ${i}, expected 0`);
            }
            const bgImage = section.props.bgImage as string;
            if (!bgImage || bgImage.trim().length === 0) {
              violations.push(`image-hero Section at position ${i} has empty bgImage`);
            }
          }
        }
        expect(violations).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property 7: Mobile breakpoint completeness (Task 11.9)
  it("Property 7 — breakpoint-aware fields have both desktop and mobile", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const template = factory();
        const allBlocks = collectAllBlocks(template);
        const violations: string[] = [];
        for (const block of allBlocks) {
          for (const propName of Object.keys(block.props)) {
            if (propName === "id") continue;
            if (!BREAKPOINT_AWARE_FIELDS.has(propName)) continue;
            const value = block.props[propName];
            // Skip fields stored as scalars (e.g., minHeight="auto")
            if (value === null || value === undefined || typeof value !== "object") continue;
            const obj = value as Record<string, unknown>;
            if (!("desktop" in obj)) {
              violations.push(`${block.type} (${block.props.id}): "${propName}" missing desktop key`);
            }
            if (!("mobile" in obj)) {
              violations.push(`${block.type} (${block.props.id}): "${propName}" missing mobile key`);
            }
          }
        }
        expect(violations).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property 8: Mobile heading size bound (Task 11.10)
  it("Property 8 — h1 mobile fontSize ∈ [28, 48], desktop ∈ [36, 84], desktop ≥ mobile", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const template = factory();
        const allBlocks = collectAllBlocks(template);
        const violations: string[] = [];
        for (const block of allBlocks) {
          if (block.type === "Heading" && block.props.level === "h1") {
            const fontSize = block.props.fontSize as { desktop: number; mobile: number } | undefined;
            if (!fontSize || !isBreakpointObject(fontSize)) {
              violations.push(`h1 Heading (${block.props.id}): fontSize is not a breakpoint object`);
              continue;
            }
            const mobile = fontSize.mobile as number;
            const desktop = fontSize.desktop as number;
            if (mobile < 28 || mobile > 48) {
              violations.push(`h1 (${block.props.id}): mobile fontSize ${mobile} not in [28, 48]`);
            }
            if (desktop < 36 || desktop > 84) {
              violations.push(`h1 (${block.props.id}): desktop fontSize ${desktop} not in [36, 84]`);
            }
            if (desktop < mobile) {
              violations.push(`h1 (${block.props.id}): desktop ${desktop} < mobile ${mobile}`);
            }
          }
        }
        expect(violations).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property 9: Mobile section padding bound (Task 11.11)
  it("Property 9 — Section mobile horizontal ∈ [12, 24], vertical ∈ [24, 96]", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const template = factory();
        const sections = getSections(template);
        const violations: string[] = [];
        for (const section of sections) {
          const padding = section.props._padding as {
            desktop: Record<string, string>;
            mobile: Record<string, string>;
          } | undefined;
          if (!padding || !isBreakpointObject(padding)) {
            violations.push(`Section (${section.props.id}): _padding is not a breakpoint object`);
            continue;
          }
          const mobile = padding.mobile as Record<string, string>;
          const hLeft = Number(mobile.paddingLeft);
          const hRight = Number(mobile.paddingRight);
          const vTop = Number(mobile.paddingTop);
          const vBottom = Number(mobile.paddingBottom);

          if (hLeft < 12 || hLeft > 24) {
            violations.push(`Section (${section.props.id}): mobile paddingLeft ${hLeft} not in [12, 24]`);
          }
          if (hRight < 12 || hRight > 24) {
            violations.push(`Section (${section.props.id}): mobile paddingRight ${hRight} not in [12, 24]`);
          }
          if (vTop < 24 || vTop > 96) {
            violations.push(`Section (${section.props.id}): mobile paddingTop ${vTop} not in [24, 96]`);
          }
          if (vBottom < 24 || vBottom > 96) {
            violations.push(`Section (${section.props.id}): mobile paddingBottom ${vBottom} not in [24, 96]`);
          }
        }
        expect(violations).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Property 10: Section archetype conformance (Task 11.12)
  it("Property 10 — every Section has a valid _archetype tag", () => {
    expect.assertions(NUM_RUNS);
    fc.assert(
      fc.property(factoryArb, (factory) => {
        const template = factory();
        const sections = getSections(template);
        const violations: string[] = [];
        for (const section of sections) {
          const archetype = section.props._archetype as string;
          if (!VALID_ARCHETYPES.has(archetype)) {
            violations.push(
              `Section (${section.props.id}): _archetype="${archetype}" not in catalog`,
            );
          }
        }
        expect(violations).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
