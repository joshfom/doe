"use client";

/**
 * ElementHeader — floating action bar for the currently selected block.
 *
 * Spec: custom-branded-page-builder
 * _Requirements: 4.1, 4.2, 4.6, 18.2_
 *
 * This component is purely presentational: it receives the selected block's
 * id, label, live DOM anchor element, positional capabilities, and action
 * callbacks, then renders a compact floating toolbar above the block. Puck
 * wiring (the `usePuck` dispatch calls for duplicate / delete / move) is the
 * responsibility of the caller (task 6.2) so this file can be composed
 * either inside the admin BuilderShell or inside the inline editor's
 * SelectionOverlay without carrying editor context along.
 *
 * Positioning semantics:
 *   - Rendered into `document.body` via `createPortal` so the bar escapes
 *     any overflow/transform ancestors on the canvas and always sits above
 *     the page composition.
 *   - Uses `position: fixed` with coordinates derived from
 *     `anchorEl.getBoundingClientRect()`. That gives the toolbar
 *     viewport-relative anchoring that matches the visible block regardless
 *     of scroll position.
 *   - Offset by ~32 px above the anchor's top edge, clamped to 60 px so the
 *     bar stays below the TopBar (56px height + 4px gap) when the block is
 *     flush with the top of the viewport.
 *   - Position tracking uses `useSyncExternalStore` with an rAF-throttled
 *     subscribe function bound to window `scroll` (capture), `resize`, and
 *     a `ResizeObserver` on the anchor when available. That way every
 *     position update flows through the external-store subscription path,
 *     not a setState-in-effect, which matches the project's React 19 lint
 *     profile.
 *
 * Accessibility (Req 4.2, 18.2):
 *   - The container is `role="toolbar"` with `aria-label={`${label} actions`}`.
 *   - Every icon-only button has `aria-label` and `title`.
 *   - At zone boundaries, the corresponding move button gets both the
 *     native `disabled` attribute and `aria-disabled="true"` so assistive
 *     tech announces the disabled state and `pointer-events` stay inert.
 */

import React from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, BookmarkPlus, Copy, Trash2 } from "lucide-react";
import { ORA_THEME } from "./inspector/tokens";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ElementHeaderProps {
  /** Puck item id for the selected block. Used only for `data-` diagnostics. */
  itemId: string;
  /** Human-readable block label shown on the left of the toolbar. */
  label: string;
  /** Live DOM node the selected block renders into. `null` ⇒ hidden. */
  anchorEl: HTMLElement | null;
  /** False when the selected block is the first in its zone. */
  canMoveUp: boolean;
  /** False when the selected block is the last in its zone. */
  canMoveDown: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** Save the selected component to the Component Library. */
  onSaveToLibrary?: () => void;
  /**
   * When set, shows a "Hidden on {Breakpoint}" badge next to the label
   * (Slice 3 / Req 13.4). Pass the human-readable breakpoint name only
   * when the block is hidden at the current active breakpoint.
   */
  hiddenAtBreakpoint?: string;
}

// ─── Positioning ─────────────────────────────────────────────────────────────

interface Position {
  top: number;
  left: number;
  width: number;
}

const HEADER_HEIGHT = 32;
const OFFSET_ABOVE_ANCHOR = 32;
const MIN_TOP = 60;

function computePosition(anchorEl: HTMLElement): Position {
  const rect = anchorEl.getBoundingClientRect();
  // When the anchor is inside an iframe, its bounding rect is relative
  // to the iframe's own viewport. Translate the rect into the parent
  // document's coordinate space by adding the iframe's bounding rect
  // origin. We detect "in iframe" by comparing ownerDocument with the
  // top-level document via a defaultView round trip.
  const ownerDoc = anchorEl.ownerDocument;
  const frameWin = ownerDoc?.defaultView;
  const isInIframe = !!frameWin && frameWin !== window && !!frameWin.frameElement;
  let offsetTop = 0;
  let offsetLeft = 0;
  if (isInIframe && frameWin?.frameElement) {
    const frameRect = (frameWin.frameElement as Element).getBoundingClientRect();
    offsetTop = frameRect.top;
    offsetLeft = frameRect.left;
  }
  const top = Math.max(MIN_TOP, rect.top + offsetTop - OFFSET_ABOVE_ANCHOR);
  return {
    top,
    left: rect.left + offsetLeft,
    width: rect.width,
  };
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Returns `true` once the component has hydrated on the client. Used to gate
 * the portal render so server output stays empty (the header is editor
 * chrome and must never appear in public HTML).
 */
function useIsClient(): boolean {
  return React.useSyncExternalStore(
    // No-op subscription — the snapshot never changes after the first
    // client render, so we never need to notify React.
    () => () => {},
    // Client snapshot: always true on the browser.
    () => true,
    // Server snapshot: always false during SSR.
    () => false,
  );
}

/**
 * Subscribe to the anchor's viewport geometry and return the current
 * position. Implemented via `useSyncExternalStore` so every update is
 * routed through the subscription path (no setState-in-effect).
 *
 * The snapshot is memoized by a string key so repeated reads that yield the
 * same numbers return a referentially stable object, satisfying the
 * external-store contract that snapshots are cached until notified.
 */
function useAnchoredPosition(anchorEl: HTMLElement | null): Position | null {
  const cachedKey = React.useRef<string>("");
  const cachedValue = React.useRef<Position | null>(null);

  const getSnapshot = React.useCallback((): Position | null => {
    if (!anchorEl) {
      if (cachedKey.current !== "__null__") {
        cachedKey.current = "__null__";
        cachedValue.current = null;
      }
      return cachedValue.current;
    }
    const pos = computePosition(anchorEl);
    const key = `${pos.top}:${pos.left}:${pos.width}`;
    if (key !== cachedKey.current) {
      cachedKey.current = key;
      cachedValue.current = pos;
    }
    return cachedValue.current;
  }, [anchorEl]);

  // During SSR there's no anchor and no viewport — always `null`.
  const getServerSnapshot = React.useCallback((): Position | null => null, []);

  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!anchorEl) return () => {};

      // rAF-throttle: coalesce bursts of scroll/resize events into one
      // layout read per frame. `pending` guards against enqueuing a second
      // rAF while one is already in flight.
      let rafId: number | null = null;
      let pending = false;
      const schedule = () => {
        if (pending) return;
        pending = true;
        rafId = requestAnimationFrame(() => {
          pending = false;
          rafId = null;
          notify();
        });
      };

      // Capture phase catches scroll events on any ancestor scroll
      // container, not just the window — the canvas is typically nested
      // inside a scrollable pane.
      window.addEventListener("scroll", schedule, true);
      window.addEventListener("resize", schedule);

      // When the anchor lives inside an iframe (Puck v0.21 default), also
      // listen for scroll/resize on the iframe's own window so the toolbar
      // tracks scrolling within the canvas viewport.
      const ownerDoc = anchorEl.ownerDocument;
      const frameWin = ownerDoc?.defaultView ?? null;
      const inIframe = !!frameWin && frameWin !== window;
      if (inIframe && frameWin) {
        frameWin.addEventListener("scroll", schedule, true);
        frameWin.addEventListener("resize", schedule);
      }

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(anchorEl);
      }

      return () => {
        window.removeEventListener("scroll", schedule, true);
        window.removeEventListener("resize", schedule);
        if (inIframe && frameWin) {
          frameWin.removeEventListener("scroll", schedule, true);
          frameWin.removeEventListener("resize", schedule);
        }
        if (resizeObserver) resizeObserver.disconnect();
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    },
    [anchorEl],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ElementHeader({
  itemId,
  label,
  anchorEl,
  canMoveUp,
  canMoveDown,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSaveToLibrary,
  hiddenAtBreakpoint,
}: ElementHeaderProps) {
  const isClient = useIsClient();
  const position = useAnchoredPosition(anchorEl);

  // Slice 3 (Req 13.4): when the block is hidden at the active
  // breakpoint, fade the anchor so the editor sees it as hidden without
  // actually removing it. We mutate `style.opacity` directly because Puck
  // owns the rendered element and we don't want to fork its render.
  React.useEffect(() => {
    if (!anchorEl) return;
    if (hiddenAtBreakpoint) {
      const prev = anchorEl.style.opacity;
      anchorEl.style.opacity = "0.5";
      return () => {
        anchorEl.style.opacity = prev;
      };
    }
    return undefined;
  }, [anchorEl, hiddenAtBreakpoint]);

  if (!isClient || typeof document === "undefined") return null;
  if (!anchorEl || !position) return null;

  const toolbar = (
    <div
      role="toolbar"
      aria-label={`${label} actions`}
      data-element-header
      data-item-id={itemId}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        height: HEADER_HEIGHT,
        display: "inline-flex",
        alignItems: "stretch",
        background: ORA_THEME.white,
        color: ORA_THEME.charcoal,
        border: `1px solid ${ORA_THEME.border}`,
        borderRadius: 6,
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        zIndex: 9999,
        overflow: "hidden",
        // The bar is chrome, never part of the block being edited.
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      <span style={labelStyle}>{label}</span>
      {hiddenAtBreakpoint ? (
        <span
          data-testid="ora-hidden-badge"
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "0 10px",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            background: ORA_THEME.gold,
            color: ORA_THEME.white,
          }}
        >
          Hidden on {hiddenAtBreakpoint}
        </span>
      ) : null}
      <span style={dividerStyle} aria-hidden="true" />
      {onSaveToLibrary && (
        <IconButton
          ariaLabel={`Save ${label} to library`}
          title="Save to Library"
          onClick={onSaveToLibrary}
          Icon={BookmarkPlus}
        />
      )}
      <IconButton
        ariaLabel={`Duplicate ${label}`}
        title="Duplicate"
        onClick={onDuplicate}
        Icon={Copy}
      />
      <IconButton
        ariaLabel={`Move ${label} up`}
        title="Move up"
        onClick={onMoveUp}
        Icon={ArrowUp}
        disabled={!canMoveUp}
      />
      <IconButton
        ariaLabel={`Move ${label} down`}
        title="Move down"
        onClick={onMoveDown}
        Icon={ArrowDown}
        disabled={!canMoveDown}
      />
      <IconButton
        ariaLabel={`Delete ${label}`}
        title="Delete"
        onClick={onDelete}
        Icon={Trash2}
        tone="danger"
      />
    </div>
  );

  return createPortal(toolbar, document.body);
}

// ─── Icon button ─────────────────────────────────────────────────────────────

interface IconButtonProps {
  ariaLabel: string;
  title: string;
  onClick: () => void;
  Icon: React.ComponentType<{ size?: number | string; "aria-hidden"?: boolean }>;
  disabled?: boolean;
  tone?: "default" | "danger";
}

function IconButton({
  ariaLabel,
  title,
  onClick,
  Icon,
  disabled = false,
  tone = "default",
}: IconButtonProps) {
  // `aria-disabled` is set alongside the native `disabled` attribute on
  // purpose (Req 4.6): native `disabled` blocks click dispatch and focus,
  // `aria-disabled` ensures screen readers announce the state clearly.
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title}
      onClick={(event) => {
        // Clicks on the header must not bubble to the canvas selection
        // handler and clear/retarget the selection.
        event.stopPropagation();
        if (disabled) return;
        onClick();
      }}
      onMouseDown={(event) => {
        // Same rationale for mousedown — Puck's click-to-select fires on
        // mousedown/pointerdown in some paths.
        event.stopPropagation();
      }}
      style={{
        ...iconButtonBaseStyle,
        color: disabled
          ? ORA_THEME.muted
          : tone === "danger"
            ? ORA_THEME.danger
            : ORA_THEME.charcoal,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0 12px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: ORA_THEME.charcoal,
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  background: ORA_THEME.creamLight,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  alignSelf: "stretch",
  background: ORA_THEME.border,
};

const iconButtonBaseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: "100%",
  padding: 0,
  background: "transparent",
  border: "none",
  borderLeft: `1px solid ${ORA_THEME.border}`,
  borderRadius: 0,
  fontFamily: "inherit",
  outlineOffset: -2,
};
