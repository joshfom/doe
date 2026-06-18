/**
 * Breakpoint CSS-variable pipeline — the single source of truth that lets the
 * PUBLIC front-end render per-breakpoint values without JavaScript, matching the
 * builder's per-tier preview exactly.
 *
 * Background
 * ----------
 * Block renders are wrapped in `withBreakpointResolution`, which resolves every
 * breakpoint-aware field (`BREAKPOINT_AWARE_FIELDS`) to a single scalar for the
 * *active* tier. In the builder the active tier follows the DESKTOP/TABLET/MOBILE
 * switcher, so the canvas shows the right value. On the public site there is no
 * `BreakpointProvider`, so the active tier is always `"desktop"` — which is why a
 * mobile heading used to render at its desktop size.
 *
 * The fix: when a field genuinely varies across tiers, the style helpers emit the
 * resolved scalar wrapped in an **instance-scoped CSS custom property**:
 *
 *     font-size: var(--pb-<blockId>-fs, 84px);
 *
 * and `renderBreakpointCSS` emits matching `@media` rules that set that custom
 * property to the per-tier value:
 *
 *     @media (max-width: 640px) { .pb-block-<id> { --pb-<id>-fs: 40px; } }
 *
 * Because the custom property is **instance-scoped** (it carries the block id),
 * it never bleeds into nested blocks that use the same logical field — a Section's
 * `--pb-<sectionId>-pt` is distinct from a Heading's `--pb-<headingId>-fs`.
 *
 * Why "only when it varies"
 * -------------------------
 * If a field has the same value at every tier (the common case — and every value
 * in the existing test corpus), the helpers emit the plain scalar exactly as
 * before, and `renderBreakpointCSS` emits nothing for it. So static pages stay
 * byte-identical and the var() machinery only appears where an author actually set
 * a tablet/mobile override. This keeps the public render byte-stable
 * (server === client) and avoids churn for non-responsive content.
 *
 * This module is pure (no React, no DOM) so both the public renderer and unit
 * tests can use it.
 */

import {
  isBreakpointValue,
  resolveBreakpointValue,
  type Breakpoint,
} from "./breakpoints";
import {
  resolveAllRenderProps,
  resolveAllRenderPropsWithDefaults,
  COMPOUND_BREAKPOINT_FIELDS,
} from "./resolve-render-props";
import type { ResponsiveDefaults } from "./responsive-defaults";
import { normalizeLength } from "./shared-field-controls";

export const ALL_TIERS: ReadonlyArray<Breakpoint> = ["desktop", "tablet", "mobile"];

/** Tiers whose values are expressed via `@media` overrides (desktop is the inline fallback). */
export const OVERRIDE_TIERS: ReadonlyArray<Breakpoint> = ["tablet", "mobile"];

/**
 * Instance-scoped CSS custom property name for a block + slot suffix.
 * e.g. `pbVar("abc", "fs")` → `--pb-abc-fs`.
 */
export function pbVar(id: string, suffix: string): string {
  return `--pb-${id}-${suffix}`;
}

/** Wrap a resolved scalar in its instance-scoped custom property with a fallback. */
export function pbVarValue(id: string, suffix: string, fallback: string): string {
  return `var(${pbVar(id, suffix)}, ${fallback})`;
}

// ─── Field → CSS slot mapping ────────────────────────────────────────────────
// A "slot" is one CSS-custom-property worth of value derived from a (resolved,
// single-tier) field value. Scalar fields have one slot; compound objects
// (`_padding`, `_margin`, `_border`) expand to several. The `toCss` function
// mirrors EXACTLY what the corresponding style helper would emit for that value,
// so the `@media` override and the inline fallback always agree.

export interface FieldSlot {
  /** Short, stable var suffix (kept terse to keep emitted CSS compact). */
  suffix: string;
  /** Derive the CSS string for this slot from the field's resolved (single-tier) value. */
  toCss: (resolvedFieldValue: unknown) => string;
}

const isUnitless = (s: string) => /^-?\d+(\.\d+)?$/.test(s);

function numLen(v: unknown): string {
  const s = normalizeLength(v, "px");
  return s || "";
}

function sub(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

const FONT_SIZE_SLOT: FieldSlot = {
  suffix: "fs",
  toCss: (v) => {
    const s = String(v ?? "");
    if (!s || s === "auto") return "";
    const n = Number(s);
    return !Number.isNaN(n) && n >= 8 && n <= 200 ? normalizeLength(s, "px") : "";
  },
};

const LINE_HEIGHT_SLOT: FieldSlot = {
  suffix: "lh",
  toCss: (v) => {
    const s = String(v ?? "");
    if (!s || s === "auto") return "";
    return isUnitless(s) ? s : normalizeLength(s, "px");
  },
};

const LETTER_SPACING_SLOT: FieldSlot = {
  suffix: "ls",
  toCss: (v) => {
    const s = String(v ?? "");
    if (!s || s === "normal") return "";
    return normalizeLength(s, "px") || "";
  },
};

/** Single-value sizing fields share this factory. */
function lengthSlot(suffix: string): FieldSlot {
  return {
    suffix,
    toCss: (v) => {
      const s = String(v ?? "");
      if (!s || s === "auto") return "";
      return normalizeLength(s, "px") || s;
    },
  };
}

export const FIELD_SLOTS: Record<string, FieldSlot[]> = {
  // Typography metrics
  fontSize: [FONT_SIZE_SLOT],
  lineHeight: [LINE_HEIGHT_SLOT],
  letterSpacing: [LETTER_SPACING_SLOT],

  // Spacing — one slot per physical side (matches `stylePropsToCSS` longhand).
  _padding: [
    { suffix: "pt", toCss: (v) => numLen(sub(v, "paddingTop")) },
    { suffix: "pr", toCss: (v) => numLen(sub(v, "paddingRight")) },
    { suffix: "pb", toCss: (v) => numLen(sub(v, "paddingBottom")) },
    { suffix: "pl", toCss: (v) => numLen(sub(v, "paddingLeft")) },
  ],
  _margin: [
    { suffix: "mt", toCss: (v) => numLen(sub(v, "marginTop")) },
    { suffix: "mr", toCss: (v) => numLen(sub(v, "marginRight")) },
    { suffix: "mb", toCss: (v) => numLen(sub(v, "marginBottom")) },
    { suffix: "ml", toCss: (v) => numLen(sub(v, "marginLeft")) },
  ],
  _border: [
    { suffix: "bw", toCss: (v) => { const n = Number(sub(v, "borderWidth")) || 0; return n > 0 ? `${n}px` : "0px"; } },
    { suffix: "brad", toCss: (v) => numLen(sub(v, "borderRadius")) || "0px" },
  ],

  // Sizing
  minHeight: [lengthSlot("minh")],
  maxHeight: [lengthSlot("maxh")],
  height: [lengthSlot("h")],
  width: [lengthSlot("w")],
  imgHeight: [lengthSlot("imgh")],
  imgWidth: [lengthSlot("imgw")],

  // Grid gaps
  columnGap: [lengthSlot("cgap")],
  rowGap: [lengthSlot("rgap")],

  // Grid columns — full `repeat(n, 1fr)` track string.
  columns: [
    {
      suffix: "cols",
      toCss: (v) => {
        const n = Math.max(1, Math.floor(Number(v) || 0));
        return n > 0 ? `repeat(${n}, 1fr)` : "";
      },
    },
  ],

  // Columns/feature-list layout direction → grid track. When a tier is
  // "column" (stacked) the grid collapses to a single `1fr` track; "row" leaves
  // the inline desktop track (multi-column) in place via the var fallback, so
  // it emits no override (empty string = "use the fallback").
  layoutDirection: [
    {
      suffix: "coltpl",
      toCss: (v) => (String(v ?? "") === "column" ? "1fr" : ""),
    },
  ],
};

// ─── Variance detection ──────────────────────────────────────────────────────

/** Resolve a single field to its scalar (or deep object) value at a tier. */
function resolveFieldAtTier(
  rawProps: Record<string, unknown>,
  field: string,
  tier: Breakpoint,
  responsiveDefaults?: ResponsiveDefaults,
): unknown {
  const single = responsiveDefaults
    ? resolveAllRenderPropsWithDefaults(rawProps, tier, new Set([field]), responsiveDefaults)
    : resolveAllRenderProps(rawProps, tier, new Set([field]));
  return single[field];
}

/**
 * The set of breakpoint-aware fields on a block whose resolved value is NOT the
 * same across all three tiers — i.e. the fields that need responsive CSS.
 *
 * Uses the exact same resolution path the renderer uses (including
 * `responsiveDefaults` fall-through), then compares the per-tier slot CSS. A
 * field "varies" when any of its slots differs between desktop and tablet/mobile.
 */
export function computeVaryingFields(
  rawProps: Record<string, unknown>,
  breakpointAwareFields: ReadonlySet<string>,
  responsiveDefaults?: ResponsiveDefaults,
): Set<string> {
  const varying = new Set<string>();

  for (const field of breakpointAwareFields) {
    const slots = FIELD_SLOTS[field];
    if (!slots) continue;
    const present = field in rawProps;
    const hasRd = Boolean(responsiveDefaults && field in responsiveDefaults);
    if (!present && !hasRd) continue;

    const raw = rawProps[field];
    // A field can only vary if it (or one of its sub-keys, for compounds) is a
    // BreakpointValue OR a responsiveDefault applies to it.
    const compound = COMPOUND_BREAKPOINT_FIELDS.has(field);
    const hasBpShape =
      isBreakpointValue(raw) ||
      (compound &&
        raw != null &&
        typeof raw === "object" &&
        Object.values(raw as Record<string, unknown>).some((sv) => isBreakpointValue(sv))) ||
      hasRd;
    if (!hasBpShape) continue;

    const desktop = resolveFieldAtTier(rawProps, field, "desktop", responsiveDefaults);
    let differs = false;
    for (const tier of OVERRIDE_TIERS) {
      const tierVal = resolveFieldAtTier(rawProps, field, tier, responsiveDefaults);
      for (const slot of slots) {
        if (slot.toCss(tierVal) !== slot.toCss(desktop)) {
          differs = true;
          break;
        }
      }
      if (differs) break;
    }
    if (differs) varying.add(field);
  }

  return varying;
}

// ─── Render-time context injected into resolved props ─────────────────────────

/** Prop key under which the breakpoint context rides along to the style helpers. */
export const BP_CONTEXT_KEY = "__bpResponsive";

export interface BpResponsiveContext {
  /** The block instance id (used to scope the custom-property names). */
  id: string;
  /** Breakpoint-aware fields that vary across tiers and should emit var(). */
  varying: ReadonlySet<string>;
}

/** Read the breakpoint context the resolver injected, if any. */
export function getBpContext(props: Record<string, unknown>): BpResponsiveContext | null {
  const ctx = props[BP_CONTEXT_KEY] as BpResponsiveContext | undefined;
  if (!ctx || typeof ctx.id !== "string" || !ctx.varying) return null;
  return ctx;
}

/**
 * For a scalar style value, return either the plain value (when the field does
 * not vary) or `var(--pb-<id>-<suffix>, value)` (when it does), so the inline
 * style picks up the per-tier `@media` override on the public site.
 */
export function responsiveCss(
  ctx: BpResponsiveContext | null,
  field: string,
  suffix: string,
  value: string,
): string {
  if (!ctx || !ctx.varying.has(field)) return value;
  return pbVarValue(ctx.id, suffix, value);
}

// ─── CSS emission (public renderer) ──────────────────────────────────────────

/**
 * Emit the per-tier `@media` custom-property declarations for one block's
 * varying breakpoint-aware fields. Desktop is the inline fallback, so only the
 * tablet/mobile overrides are emitted, and only when their resolved slot value
 * differs from desktop.
 *
 * Returns `[]` when the block has no varying fields.
 */
export function emitBlockResponsiveVarDecls(
  rawProps: Record<string, unknown>,
  breakpointAwareFields: ReadonlySet<string>,
  responsiveDefaults: ResponsiveDefaults | undefined,
  id: string,
): Record<Breakpoint, string[]> {
  const byTier: Record<Breakpoint, string[]> = { desktop: [], tablet: [], mobile: [] };
  const varying = computeVaryingFields(rawProps, breakpointAwareFields, responsiveDefaults);
  if (varying.size === 0) return byTier;

  for (const field of varying) {
    const slots = FIELD_SLOTS[field];
    if (!slots) continue;
    const desktop = resolveFieldAtTier(rawProps, field, "desktop", responsiveDefaults);
    for (const tier of OVERRIDE_TIERS) {
      const tierVal = resolveFieldAtTier(rawProps, field, tier, responsiveDefaults);
      for (const slot of slots) {
        const tierCss = slot.toCss(tierVal);
        if (tierCss === "" || tierCss === slot.toCss(desktop)) continue;
        byTier[tier].push(`${pbVar(id, slot.suffix)}: ${tierCss};`);
      }
    }
  }

  return byTier;
}

// ─── Automatic responsive typography ─────────────────────────────────────────
// Authors usually set a single (desktop) font size and expect it to "just look
// right" on phones — the native-app/PWA expectation. A 64–96px hero headline
// that is perfect on desktop overflows a 390px phone. Rather than force authors
// to hand-set a mobile size on every text block, we DERIVE sensible tablet/
// mobile sizes from a large desktop size and feed them through the exact same
// per-breakpoint var pipeline (so the builder preview and the published page
// stay in lock-step, and an explicit author override always wins).

/** Desktop sizes at or below this (px) are left untouched (body copy, captions). */
const FLUID_DESKTOP_THRESHOLD = 40;
const FLUID_TABLET_RATIO = 0.72;
const FLUID_MOBILE_RATIO = 0.52;
const FLUID_TABLET_FLOOR = 30;
const FLUID_MOBILE_FLOOR = 28;

/**
 * Derive tablet/mobile font sizes (px numbers) from a desktop size. Returns an
 * empty object when the desktop size is small enough that scaling is
 * unnecessary, so small text never changes.
 */
export function deriveResponsiveFontSize(desktop: number): { tablet?: number; mobile?: number } {
  if (!Number.isFinite(desktop) || desktop <= FLUID_DESKTOP_THRESHOLD) return {};
  const mobile = Math.min(desktop, Math.max(FLUID_MOBILE_FLOOR, Math.round(desktop * FLUID_MOBILE_RATIO)));
  const tablet = Math.min(desktop, Math.max(FLUID_TABLET_FLOOR, Math.round(desktop * FLUID_TABLET_RATIO)));
  return { tablet, mobile: Math.min(mobile, tablet) };
}

/**
 * Return a shallow-cloned props object whose `fontSize` has auto-derived
 * tablet/mobile slots filled in when the author set only a (large) desktop
 * size. Author-set tablet/mobile slots are preserved untouched. When no scaling
 * applies, the original props object is returned unchanged (referential
 * equality), so non-typographic / small-text blocks pay no cost and stay
 * byte-identical.
 *
 * Used by BOTH the render-time resolver and `renderBreakpointCSS`, so the inline
 * `var(...)` fallback, the builder's active-tier preview, and the published
 * `@media` override all agree.
 */
export function augmentResponsiveTypography(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const fs = props.fontSize;
  if (fs == null) return props;

  let bv: Record<string, unknown>;
  if (isBreakpointValue(fs)) {
    bv = { ...(fs as Record<string, unknown>) };
  } else if (typeof fs === "string" || typeof fs === "number") {
    bv = { desktop: String(fs) };
  } else {
    return props;
  }

  const desktopRaw = bv.desktop;
  if (desktopRaw == null || desktopRaw === "" || desktopRaw === "auto") return props;
  const desktopNum = Number(desktopRaw);
  if (!Number.isFinite(desktopNum)) return props;

  const derived = deriveResponsiveFontSize(desktopNum);
  if (derived.tablet == null && derived.mobile == null) return props;

  let changed = false;
  if (bv.tablet == null && derived.tablet != null) {
    bv.tablet = String(derived.tablet);
    changed = true;
  }
  if (bv.mobile == null && derived.mobile != null) {
    bv.mobile = String(derived.mobile);
    changed = true;
  }
  if (!changed) return props;

  return { ...props, fontSize: bv };
}
