"use client";

/**
 * BreakpointAwareFieldWrapper — wraps a field renderer so writes land in
 * only the active breakpoint slot of a {@link BreakpointValue}, and so
 * the displayed value resolves with desktop → tablet → mobile fall-through.
 *
 * Spec: custom-branded-page-builder — task 11.1, 11.2
 * Spec: default-responsive-component-defaults — task 6.2
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 6.1, 6.2, 6.4, 6.5, 6.6_
 *
 * Behaviour
 * ---------
 *  1. Reads the active breakpoint from {@link useBreakpoint}.
 *  2. Migrates legacy scalars on read via {@link migrateLegacyScalar}, so
 *     no SQL migration is required (Req 14.1, 14.3).
 *  3. Resolves the value to display via {@link resolveWithDefaults} when
 *     `responsiveDefaults` are available (from context), falling back to
 *     {@link resolveBreakpointValue} otherwise.
 *  4. Renders three small indicator dots — one per slot — filled when the
 *     slot holds an explicit value (Req 11.3).
 *  5. Shows an {@link InheritedIndicator} when the displayed value comes
 *     from `responsiveDefaults` or wider-tier inheritance (Req 6.2, 6.5).
 *  6. Provides a "Clear this breakpoint" affordance that calls
 *     {@link clearSlot} so the cleared slot is omitted entirely — no
 *     `null` or `undefined` sentinel (Req 11.4, 6.6).
 *  7. Writes only to the active slot on change (Req 11.2). Other slots
 *     are preserved verbatim.
 *
 * Integration
 * -----------
 * Used by {@link withBreakpointAwareness} below, which decorates a base
 * `FieldRenderer` so that fields whose `name` is in
 * {@link BREAKPOINT_AWARE_FIELDS} are auto-wrapped at the registry layer
 * without touching any individual block definition (Req 7.1).
 *
 * The component's `responsiveDefaults` are provided via
 * {@link ResponsiveDefaultsContext} — set by the ConfigurationPanel when
 * a block is selected.
 */

import React from "react";
import {
  useBreakpoint,
  type Breakpoint,
  type BreakpointValue,
  clearSlot,
  isBreakpointValue,
  migrateLegacyScalar,
  resolveBreakpointValue,
} from "../../breakpoint-context";
import { resolveWithDefaults } from "../../resolve-render-props";
import type { ResponsiveDefaults } from "../../responsive-defaults";
import { InheritedIndicator } from "../InheritedIndicator";
import { ORA_THEME } from "../inspector/tokens";
import type { FieldRenderer } from "./FieldControlRegistry";

// ─── Responsive Defaults Context ────────────────────────────────────────────

/**
 * Context providing the selected component's `responsiveDefaults` to
 * descendant field wrappers. When no component is selected or the component
 * has no `responsiveDefaults`, the context value is `undefined`.
 */
const ResponsiveDefaultsContext = React.createContext<
  ResponsiveDefaults | undefined
>(undefined);
ResponsiveDefaultsContext.displayName = "ResponsiveDefaultsContext";

export interface ResponsiveDefaultsProviderProps {
  responsiveDefaults: ResponsiveDefaults | undefined;
  children: React.ReactNode;
}

/**
 * Wraps a subtree to provide the current component's `responsiveDefaults`.
 * The ConfigurationPanel mounts this around its field list so that
 * `BreakpointAwareFieldWrapper` can resolve values through the full
 * Slot_Resolution_Order including responsive defaults.
 */
export function ResponsiveDefaultsProvider({
  responsiveDefaults,
  children,
}: ResponsiveDefaultsProviderProps) {
  return (
    <ResponsiveDefaultsContext.Provider value={responsiveDefaults}>
      {children}
    </ResponsiveDefaultsContext.Provider>
  );
}

/**
 * Hook — returns the `responsiveDefaults` for the currently-selected
 * component, or `undefined` if none are declared.
 */
export function useResponsiveDefaults(): ResponsiveDefaults | undefined {
  return React.useContext(ResponsiveDefaultsContext);
}

// ─── Field Wrapper ──────────────────────────────────────────────────────────

const BP_ORDER: ReadonlyArray<Breakpoint> = ["desktop", "tablet", "mobile"];

interface BreakpointAwareFieldWrapperProps {
  name: string;
  /** The raw stored value — may be a legacy scalar or a BreakpointValue. */
  rawValue: unknown;
  /** Persist a fresh raw value (always a BreakpointValue after a write). */
  onPersist: (next: unknown) => void;
  /** Renders the inner field control with the resolved scalar value. */
  renderInner: (resolved: unknown, onResolvedChange: (v: unknown) => void) =>
    React.ReactElement;
}

/**
 * Render-prop wrapper. The caller controls how the inner field renders;
 * this component only owns the breakpoint-aware read/write semantics and
 * the small UI affordances (indicator dots, inherited indicator, + clear action).
 */
export function BreakpointAwareFieldWrapper({
  name,
  rawValue,
  onPersist,
  renderInner,
}: BreakpointAwareFieldWrapperProps) {
  const { activeBreakpoint } = useBreakpoint();
  const responsiveDefaults = useResponsiveDefaults();

  // Always operate on a normalized BreakpointValue. Legacy scalars are
  // migrated in-memory; storage is mutated only on write.
  const bv = React.useMemo<BreakpointValue<unknown>>(
    () => migrateLegacyScalar<unknown>(rawValue),
    [rawValue],
  );

  // Resolve the displayed value using the full Slot_Resolution_Order when
  // responsiveDefaults are available; otherwise fall back to the simpler
  // resolveBreakpointValue (which only does wider-tier inheritance).
  const resolution = React.useMemo(() => {
    if (responsiveDefaults) {
      return resolveWithDefaults(
        bv,
        activeBreakpoint,
        name,
        responsiveDefaults,
      );
    }
    // Fallback: no responsive defaults — use legacy resolution
    return {
      value: resolveBreakpointValue(bv, activeBreakpoint),
      source: Object.prototype.hasOwnProperty.call(bv, activeBreakpoint)
        ? ("explicit" as const)
        : ("inherited" as const),
      inheritedFrom: undefined as Breakpoint | undefined,
    };
  }, [bv, activeBreakpoint, name, responsiveDefaults]);

  const resolved = resolution.value;

  const writeActiveSlot = React.useCallback(
    (next: unknown) => {
      // Writing `undefined` is treated as "leave the slot untouched";
      // explicit clearing happens via the Clear button → clearSlot path.
      const nextBv: BreakpointValue<unknown> = { ...bv, [activeBreakpoint]: next };
      onPersist(nextBv);
    },
    [activeBreakpoint, bv, onPersist],
  );

  const clearActive = React.useCallback(() => {
    onPersist(clearSlot(bv, activeBreakpoint));
  }, [activeBreakpoint, bv, onPersist]);

  const slotIsExplicit = (bp: Breakpoint) =>
    Object.prototype.hasOwnProperty.call(bv, bp);

  // Show the InheritedIndicator when the value comes from responsiveDefaults
  // or wider-tier inheritance (Req 6.2, 6.5). Hide when explicit.
  const showInheritedIndicator =
    resolution.source === "default" || resolution.source === "inherited";

  return (
    <div data-breakpoint-aware={name} style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
          fontSize: 10,
          color: ORA_THEME.muted,
        }}
      >
        <span style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {activeBreakpoint}
        </span>
        <span style={{ display: "inline-flex", gap: 4 }} aria-hidden="true">
          {BP_ORDER.map((bp) => (
            <span
              key={bp}
              data-slot={bp}
              data-explicit={slotIsExplicit(bp) ? "true" : "false"}
              title={`${bp}${slotIsExplicit(bp) ? " (set)" : ""}`}
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: slotIsExplicit(bp)
                  ? ORA_THEME.gold
                  : "transparent",
                border: `1px solid ${ORA_THEME.border}`,
              }}
            />
          ))}
        </span>
        {showInheritedIndicator && (
          <InheritedIndicator
            source={resolution.source as "default" | "inherited"}
            inheritedFrom={resolution.inheritedFrom}
          />
        )}
        {slotIsExplicit(activeBreakpoint) ? (
          <button
            type="button"
            onClick={clearActive}
            aria-label={`Clear ${activeBreakpoint} value for ${name}`}
            style={{
              marginLeft: "auto",
              padding: "2px 6px",
              fontSize: 10,
              background: "transparent",
              border: `1px solid ${ORA_THEME.border}`,
              color: ORA_THEME.muted,
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
      {renderInner(resolved, writeActiveSlot)}
    </div>
  );
}

/**
 * Decorate a base FieldRenderer so it transparently reads/writes through a
 * {@link BreakpointAwareFieldWrapper}. Returns a renderer that the
 * registry can drop in for any breakpoint-aware field.
 */
export function withBreakpointAwareness(
  base: FieldRenderer<unknown>,
): FieldRenderer<unknown> {
  return function BreakpointAwareRenderer({ name, value, field, onChange }) {
    return (
      <BreakpointAwareFieldWrapper
        name={name}
        rawValue={value}
        onPersist={onChange}
        renderInner={(resolved, onResolvedChange) =>
          base({ name, value: resolved, field, onChange: onResolvedChange })
        }
      />
    );
  };
}

// Re-export the type guard so callers using just this module get full type
// coverage without a second import.
export { isBreakpointValue };
