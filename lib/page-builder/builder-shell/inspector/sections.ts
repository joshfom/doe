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

export function classifyField(name: string): InspectorSection {
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
