"use client";

/**
 * Ora Aura — agent audio visualizer.
 *
 * A self-contained, dependency-free canvas visualizer that renders a soft,
 * glassy gradient orb (the "Aura") which reacts to the agent's voice. It is
 * inspired by LiveKit's `AgentAudioVisualizerAura`, but re-skinned onto the Ora
 * brand palette (Ocean / Sun / Sand) and built directly on the Web Audio API so
 * it works with the project's raw `livekit-client` integration — no
 * `@livekit/components-react` dependency required.
 *
 * Two drive modes:
 *   1. Live audio  — pass an `audioTrack` (the agent's `MediaStreamTrack`). The
 *      orb's size, glow and shimmer follow the real output amplitude. Used by
 *      the public call widget where we have the LiveKit audio track.
 *   2. State only  — omit `audioTrack` and drive it with `state` / `speaking`.
 *      Used by the C-level Demo Console, which only receives a transcript event
 *      stream (no audio), so the orb pulses while the agent is "speaking".
 *
 * Accessibility: honours `prefers-reduced-motion` (falls back to a gentle,
 * non-oscillating glow) and exposes an `aria-label` describing the state.
 */

import React, { useEffect, useRef } from "react";

export type AuraState =
  | "disconnected"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking";

export type AuraSize = "sm" | "md" | "lg" | "xl";

export interface AuraVisualizerProps {
  /**
   * The agent's audio track. When provided, the orb reacts to real output
   * amplitude. When omitted, the orb animates from `state`/`speaking` alone.
   */
  audioTrack?: MediaStreamTrack | null;
  /** High-level agent state. Drives idle vs. active animation. */
  state?: AuraState;
  /** Convenience flag equivalent to `state === "speaking"`. */
  speaking?: boolean;
  /** Visual size. */
  size?: AuraSize;
  /**
   * Gradient stops (hex). Defaults to the Ora palette: a warm Sun lobe over a
   * cool Ocean lobe, echoing the brand's glass-sphere concept art.
   */
  palette?: { top: string; bottom: string; glow: string };
  className?: string;
  "aria-label"?: string;
}

const SIZE_PX: Record<AuraSize, number> = {
  sm: 72,
  md: 140,
  lg: 224,
  xl: 360,
};

/** Ora-brand default palette — Sun (#EA8B6E) over Ocean (#A4E0E6). */
const ORA_PALETTE = {
  top: "#F2A88E", // light Sun
  bottom: "#A4E0E6", // Ocean
  glow: "#EA8B6E", // Sun
};

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [255, 255, 255];
  return [
    parseInt(m[1]!, 16),
    parseInt(m[2]!, 16),
    parseInt(m[3]!, 16),
  ];
}

function rgba([r, g, b]: [number, number, number], a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function AuraVisualizer({
  audioTrack,
  state = "connecting",
  speaking,
  size = "lg",
  palette = ORA_PALETTE,
  className,
  "aria-label": ariaLabel,
}: AuraVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live values updated outside React state so the rAF loop never re-renders.
  const stateRef = useRef<AuraState>(state);
  const speakingRef = useRef<boolean>(Boolean(speaking));
  const levelRef = useRef(0); // smoothed amplitude 0..1
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  stateRef.current = state;
  speakingRef.current = speaking ?? state === "speaking";

  const top = hexToRgb(palette.top);
  const bottom = hexToRgb(palette.bottom);
  const glow = hexToRgb(palette.glow);

  // ── Web Audio: tap the live track for real amplitude ──────────────────────
  useEffect(() => {
    if (!audioTrack) {
      analyserRef.current = null;
      return;
    }
    if (typeof window === "undefined") return;
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtor) return;

    let cancelled = false;
    const audioCtx = new AudioCtor();
    ctxRef.current = audioCtx;
    const stream = new MediaStream([audioTrack]);
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    // Do NOT connect analyser to destination — the call widget already plays
    // the agent audio through its own <audio> element. This is analysis-only.
    if (!cancelled) analyserRef.current = analyser;

    return () => {
      cancelled = true;
      analyserRef.current = null;
      try {
        source.disconnect();
      } catch {
        /* no-op */
      }
      void audioCtx.close().catch(() => {});
      ctxRef.current = null;
    };
  }, [audioTrack]);

  // ── Render loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    const px = SIZE_PX[size];
    const dpr = Math.min(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      2
    );
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    ctx.scale(dpr, dpr);

    const freq =
      analyserRef.current && analyserRef.current.frequencyBinCount
        ? new Uint8Array(analyserRef.current.frequencyBinCount)
        : null;

    let raf = 0;
    let t = 0;

    const draw = () => {
      t += 1;
      const cx = px / 2;
      const cy = px / 2;

      // 1) Determine target amplitude (0..1).
      let target: number;
      const analyser = analyserRef.current;
      if (analyser) {
        const buf =
          freq && freq.length === analyser.frequencyBinCount
            ? freq
            : new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i]!;
        target = Math.min(1, sum / buf.length / 160);
      } else {
        // No live audio: synthesise from state.
        const st = stateRef.current;
        const isSpeaking = speakingRef.current || st === "speaking";
        if (reduced) {
          target = isSpeaking ? 0.55 : st === "thinking" ? 0.3 : 0.12;
        } else if (isSpeaking) {
          target = 0.45 + 0.35 * Math.abs(Math.sin(t * 0.12));
        } else if (st === "thinking") {
          target = 0.25 + 0.1 * Math.sin(t * 0.06);
        } else if (st === "connecting" || st === "disconnected") {
          target = 0.08 + 0.05 * Math.sin(t * 0.04);
        } else {
          // listening — gentle breathing
          target = 0.16 + 0.06 * Math.sin(t * 0.05);
        }
      }

      // Smooth toward target so the orb feels fluid, not jittery.
      levelRef.current += (target - levelRef.current) * 0.18;
      const level = levelRef.current;

      // 2) Geometry that breathes with the level.
      const baseR = px * 0.3;
      const radius = baseR * (1 + level * 0.16);
      const wob = reduced ? 0 : Math.sin(t * 0.03) * px * 0.004;

      ctx.clearRect(0, 0, px, px);

      // 3) Outer glow halo.
      const haloR = radius * (1.7 + level * 0.5);
      const halo = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, haloR);
      halo.addColorStop(0, rgba(glow, 0.32 + level * 0.4));
      halo.addColorStop(0.5, rgba(glow, 0.1 + level * 0.12));
      halo.addColorStop(1, rgba(glow, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // 4) Glass sphere body — base fill.
      const body = ctx.createRadialGradient(
        cx - radius * 0.3,
        cy - radius * 0.35,
        radius * 0.1,
        cx,
        cy,
        radius
      );
      body.addColorStop(0, "rgba(255,255,255,0.95)");
      body.addColorStop(0.45, rgba(top, 0.92));
      body.addColorStop(1, rgba(bottom, 0.96));
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy + wob, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = body;
      ctx.fill();

      // 5) Cool lower lobe (Ocean) layered for the two-tone glass look.
      const lobe = ctx.createRadialGradient(
        cx,
        cy + radius * 0.55,
        radius * 0.1,
        cx,
        cy + radius * 0.4,
        radius * 1.1
      );
      lobe.addColorStop(0, rgba(bottom, 0.55 + level * 0.2));
      lobe.addColorStop(1, rgba(bottom, 0));
      ctx.fillStyle = lobe;
      ctx.fill();

      // 6) Specular highlight (top-left), intensifies with level.
      const hi = ctx.createRadialGradient(
        cx - radius * 0.4,
        cy - radius * 0.45,
        0,
        cx - radius * 0.4,
        cy - radius * 0.45,
        radius * 0.7
      );
      hi.addColorStop(0, `rgba(255,255,255,${0.85})`);
      hi.addColorStop(0.4, `rgba(255,255,255,${0.18 + level * 0.15})`);
      hi.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hi;
      ctx.fill();
      ctx.restore();

      // 7) Rim light for the glass edge.
      ctx.beginPath();
      ctx.arc(cx, cy + wob, radius, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(glow, 0.25 + level * 0.3);
      ctx.lineWidth = Math.max(1, px * 0.006);
      ctx.stroke();

      raf = window.requestAnimationFrame(draw);
    };

    raf = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(raf);
    // Palette values are stable per render; size triggers a re-init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, palette.top, palette.bottom, palette.glow]);

  const px = SIZE_PX[size];
  const label =
    ariaLabel ??
    (speakingRef.current
      ? "Agent is speaking"
      : state === "thinking"
        ? "Agent is thinking"
        : state === "listening"
          ? "Listening"
          : "Voice visualizer");

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={className}
      style={{ width: px, height: px, display: "block" }}
    />
  );
}

export default AuraVisualizer;
