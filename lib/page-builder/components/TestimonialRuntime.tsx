"use client";

/**
 * Testimonial slider runtime — the `slider` layout of the Testimonial block.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Block 2 — Testimonial" → "slider → React.createElement(TestimonialRuntime,
 *   …) reusing the carousel runtime pattern".
 * Validates: Requirements 2.6 (swipeable carousel consistent with the existing
 *   ImageCarousel/Gallery runtime patterns), 2.12 (RTL), plus the cross-cutting
 *   a11y rules in Requirement 13.
 *
 * Why a runtime component:
 *   The `single` and `grid` Testimonial layouts are static markup rendered
 *   directly in `config.ts`. The `slider` layout needs client state (which slide
 *   is visible, swipe/keyboard interaction), so — exactly like
 *   `ImageCarouselRuntime` and `GalleryRuntime` — it lives in a dedicated
 *   `"use client"` component and the block's `render` in `config.ts` delegates to
 *   it via `React.createElement(TestimonialRuntime, …)` (wired in task 6.3).
 *
 * Reuse, not reinvention:
 *   - The per-item blockquote markup is owned by `renderTestimonialItem` in
 *     `config.ts` (the shared item renderer "consumed by every layout"). This
 *     runtime is intentionally a *pure carousel shell*: it receives the already
 *     rendered blockquote nodes as `slides` and only adds carousel chrome (track,
 *     arrows, dots, keyboard, swipe). That keeps the blockquote markup identical
 *     across the single/grid/slider layouts and keeps this file unit-testable in
 *     isolation. It mirrors how `TabGroupRuntime` receives resolved panel nodes.
 *   - The slide/track transform, arrow + dot controls, autoplay-with-pause, and
 *     `ChevronLeft/ChevronRight` icon usage follow `ImageCarouselRuntime` /
 *     `GalleryRuntime` so the slider behaves like the rest of the builder's
 *     carousels.
 *
 * Hydration safety (this layout is NOT excluded from the byte-stability
 * guarantee — only Countdown is):
 *   - The initial render is fully deterministic: `current` starts at `0`, `isRtl`
 *     and `reducedMotion` start at `false`, and the transform at `current === 0`
 *     is `translateX(0%)` regardless of direction. No `Date.now()`, no random,
 *     no `window`/`matchMedia` reads during render.
 *   - Direction (`dir="rtl"` inherited from the `ar` locale wrapper) and the
 *     user's reduced-motion preference are read in post-mount `useEffect`s, so
 *     the server markup and the first client paint are byte-identical and React
 *     hydrates without a mismatch. Live per-second / interaction updates only
 *     happen after mount, in response to the user.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface TestimonialRuntimeProps {
  /**
   * One pre-rendered `<blockquote>` node per testimonial item, produced by the
   * block's shared `renderTestimonialItem` helper in `config.ts`. The runtime
   * carousels these nodes without re-deriving their markup.
   */
  slides: React.ReactNode[];
  /** Show the previous/next arrow controls. Defaults to `true`. */
  showArrows?: boolean;
  /** Show the dot pagination control. Defaults to `true`. */
  showDots?: boolean;
  /**
   * Advance through slides automatically after mount. Defaults to `false` so the
   * default public render is static unless an author opts in. Autoplay never
   * affects the server markup (it is started in a post-mount effect).
   */
  autoplay?: boolean;
  /** Autoplay interval in milliseconds. Defaults to `6000`. */
  interval?: number;
  /** Accessible name for the carousel region. Defaults to `"Testimonials"`. */
  ariaLabel?: string;
}

/** Minimum horizontal pointer travel (px) that counts as a swipe. */
const SWIPE_THRESHOLD = 40;

/** Visually-hidden style for the screen-reader status region. */
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function TestimonialRuntime({
  slides,
  showArrows = true,
  showDots = true,
  autoplay = false,
  interval = 6000,
  ariaLabel = "Testimonials",
}: TestimonialRuntimeProps) {
  const count = slides.length;

  const [current, setCurrent] = useState(0);
  // Deterministic SSR defaults; both are corrected in post-mount effects so the
  // server markup and first client paint match (see file header).
  const [isRtl, setIsRtl] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const regionRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pointerStartX = useRef<number | null>(null);

  // Stable ids for aria-controls / aria-labelledby wiring (deterministic across
  // server + client via React's useId, so markup stays byte-stable).
  const baseId = useId();
  const trackId = `${baseId}-track`;

  // Wrap-around navigation (matches ImageCarouselRuntime).
  const goTo = useCallback(
    (idx: number) => {
      if (count === 0) return;
      setCurrent(((idx % count) + count) % count);
    },
    [count],
  );
  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  // ── Read inherited text direction once, after mount (RTL — Req 2.12) ───────
  useEffect(() => {
    const el = regionRef.current;
    if (!el || typeof window === "undefined") return;
    setIsRtl(window.getComputedStyle(el).direction === "rtl");
  }, []);

  // ── Respect the user's reduced-motion preference (a11y) ────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // ── Autoplay with pause-on-hover/focus (mirrors ImageCarouselRuntime) ──────
  const startAutoplay = useCallback(() => {
    if (!autoplay || reducedMotion || count <= 1) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCurrent((c) => (c + 1) % count);
    }, interval);
  }, [autoplay, reducedMotion, count, interval]);

  const stopAutoplay = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    startAutoplay();
    return stopAutoplay;
  }, [startAutoplay, stopAutoplay]);

  // ── Keyboard navigation mapped to visual reading direction (Req 2.12, 13.2)
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (count <= 1) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          if (isRtl) prev();
          else next();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (isRtl) next();
          else prev();
          break;
        case "Home":
          e.preventDefault();
          goTo(0);
          break;
        case "End":
          e.preventDefault();
          goTo(count - 1);
          break;
        default:
          break;
      }
    },
    [count, isRtl, next, prev, goTo],
  );

  // ── Pointer/touch swipe (the "swipeable" part of Req 2.6) ──────────────────
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartX.current = e.clientX;
  }, []);

  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const startX = pointerStartX.current;
      pointerStartX.current = null;
      if (startX === null || count <= 1) return;
      const delta = e.clientX - startX;
      if (Math.abs(delta) < SWIPE_THRESHOLD) return;
      // A leftward drag advances in LTR and goes back in RTL.
      if (delta < 0) {
        if (isRtl) prev();
        else next();
      } else {
        if (isRtl) next();
        else prev();
      }
    },
    [count, isRtl, next, prev],
  );

  // ── Empty state: render a neutral hint rather than throwing (parity with
  //    ImageCarouselRuntime / GalleryRuntime). ────────────────────────────────
  if (count === 0) {
    return React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 120,
          background: "#F2EDE3",
          color: "#6B6B6B",
          fontSize: 14,
        },
      },
      "Add testimonials to the slider",
    );
  }

  // At current === 0 the offset is 0 in both directions, so the initial transform
  // string is identical server-side and client-side (hydration-safe).
  const sign = isRtl ? 1 : -1;
  const trackTransform = `translateX(${sign * current * 100}%)`;

  // Slides: each item fills the viewport (flex 0 0 100%); inactive slides are
  // hidden from assistive tech and described as "N of total".
  const slideEls = slides.map((node, i) =>
    React.createElement(
      "div",
      {
        key: i,
        id: `${baseId}-slide-${i}`,
        role: "group",
        "aria-roledescription": "slide",
        "aria-label": `${i + 1} of ${count}`,
        "aria-hidden": i !== current,
        style: {
          flex: "0 0 100%",
          minWidth: 0,
          boxSizing: "border-box" as const,
          paddingInline: 8,
        },
      },
      node,
    ),
  );

  const track = React.createElement(
    "div",
    {
      id: trackId,
      style: {
        display: "flex",
        transform: trackTransform,
        transition: reducedMotion ? "none" : "transform 0.4s ease",
        touchAction: "pan-y" as const,
      },
    },
    ...slideEls,
  );

  const viewport = React.createElement(
    "div",
    {
      style: { overflow: "hidden" },
      onPointerDown,
      onPointerUp: onPointerEnd,
      onPointerCancel: () => {
        pointerStartX.current = null;
      },
    },
    track,
  );

  const arrowBaseStyle: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 10,
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fff",
    border: "1px solid #E8E4DF",
    borderRadius: "50%",
    color: "#2C2C2C",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  };

  // Arrows use logical inset (start/end) so they flip under RTL automatically,
  // and the glyph is swapped so "previous" always points toward the start.
  const prevButton =
    showArrows && count > 1
      ? React.createElement(
          "button",
          {
            key: "prev",
            type: "button",
            onClick: prev,
            "aria-label": "Previous testimonial",
            "aria-controls": trackId,
            style: { ...arrowBaseStyle, insetInlineStart: 0 },
          },
          React.createElement(isRtl ? ChevronRight : ChevronLeft, {
            size: 20,
            strokeWidth: 1.5,
          }),
        )
      : null;

  const nextButton =
    showArrows && count > 1
      ? React.createElement(
          "button",
          {
            key: "next",
            type: "button",
            onClick: next,
            "aria-label": "Next testimonial",
            "aria-controls": trackId,
            style: { ...arrowBaseStyle, insetInlineEnd: 0 },
          },
          React.createElement(isRtl ? ChevronLeft : ChevronRight, {
            size: 20,
            strokeWidth: 1.5,
          }),
        )
      : null;

  const dots =
    showDots && count > 1
      ? React.createElement(
          "div",
          {
            key: "dots",
            role: "tablist",
            "aria-label": "Choose testimonial",
            style: {
              display: "flex",
              justifyContent: "center",
              gap: 8,
              marginTop: 16,
            },
          },
          ...slides.map((_, i) =>
            React.createElement("button", {
              key: i,
              type: "button",
              onClick: () => goTo(i),
              "aria-label": `Go to testimonial ${i + 1}`,
              "aria-current": i === current,
              "aria-controls": `${baseId}-slide-${i}`,
              style: {
                width: i === current ? 24 : 8,
                height: 8,
                borderRadius: 4,
                border: "none",
                padding: 0,
                background: i === current ? "#2C2C2C" : "#D8D2C8",
                cursor: "pointer",
                transition: reducedMotion ? "none" : "all 0.3s ease",
              },
            }),
          ),
        )
      : null;

  // Polite live region announces the active slide to assistive tech without
  // stealing focus. Its initial text ("1 of N") is deterministic.
  const liveStatus = React.createElement(
    "div",
    {
      key: "status",
      "aria-live": "polite",
      "aria-atomic": true,
      style: VISUALLY_HIDDEN,
    },
    `Testimonial ${current + 1} of ${count}`,
  );

  return React.createElement(
    "div",
    {
      ref: regionRef,
      role: "group",
      "aria-roledescription": "carousel",
      "aria-label": ariaLabel,
      tabIndex: 0,
      onKeyDown,
      onMouseEnter: stopAutoplay,
      onMouseLeave: startAutoplay,
      onFocus: stopAutoplay,
      onBlur: startAutoplay,
      style: { position: "relative", outline: "none" },
    },
    viewport,
    prevButton,
    nextButton,
    dots,
    liveStatus,
  );
}
