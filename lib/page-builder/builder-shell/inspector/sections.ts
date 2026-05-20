"use client";

/**
 * Static field-name → group map. Field names not in any list fall through to
 * `Advanced`. Conventions match the existing config in `lib/page-builder/config.ts`.
 */

const STYLE_PATTERNS = [
  /color/i,
  /background/i,
  /border/i,
  /shadow/i,
  /opacity/i,
  /font/i,
  /typography/i,
  /align/i,
  /weight/i,
  /size/i,
  /tracking/i,
  /leading/i,
];

const LAYOUT_PATTERNS = [
  /padding/i,
  /margin/i,
  /spacing/i,
  /gap/i,
  /width/i,
  /height/i,
  /maxwidth/i,
  /minheight/i,
  /columns/i,
  /rows/i,
  /grid/i,
  /layout/i,
  /position/i,
  /sticky/i,
];

const CONTENT_PATTERNS = [
  /^title$/i,
  /^subtitle$/i,
  /^heading$/i,
  /^text$/i,
  /^content$/i,
  /^body$/i,
  /^label$/i,
  /^image$/i,
  /^src$/i,
  /^alt$/i,
  /^href$/i,
  /^link$/i,
  /^url$/i,
  /^cta/i,
  /^icon/i,
  /^items$/i,
  /^pins$/i,
  /^cards$/i,
];

export type InspectorSection = "Content" | "Style" | "Layout" | "Advanced";

/**
 * Field names that always belong to the "Configurations" tab regardless of
 * pattern matches. Use a leading underscore to denote internal/system fields.
 *
 * `_tracking` would otherwise match the `/tracking/i` style pattern (intended
 * for CSS letter-tracking), but it carries analytics tracking config and
 * belongs in Configurations alongside `_animation` and `_visibility`.
 */
const CONFIGURATION_FIELDS = new Set<string>([
  "_animation",
  "_tracking",
  "_analytics",
  "_visibility",
  "_replayUnmask",
]);

export function classifyField(name: string): InspectorSection {
  if (CONFIGURATION_FIELDS.has(name)) return "Advanced";
  if (STYLE_PATTERNS.some((re) => re.test(name))) return "Style";
  if (LAYOUT_PATTERNS.some((re) => re.test(name))) return "Layout";
  if (CONTENT_PATTERNS.some((re) => re.test(name))) return "Content";
  return "Advanced";
}

export const INSPECTOR_SECTIONS: InspectorSection[] = [
  "Content",
  "Style",
  "Layout",
  "Advanced",
];
