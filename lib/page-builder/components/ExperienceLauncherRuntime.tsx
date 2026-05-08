"use client";

/**
 * ExperienceLauncher runtime — renders a 3D-styled button that opens a
 * full-viewport dialog containing an <iframe>. Designed to embed external
 * interactive experiences (e.g. the Bayn 3D sales tool) without coupling the
 * parent page to the embedded app's lifecycle.
 *
 * Cross-origin constraints:
 *   - We cannot read the iframe's URL, DOM, or internal events.
 *   - We cannot inject UI into it.
 *   - We can only communicate if the embedded app voluntarily calls
 *     `window.parent.postMessage(...)`. A listener is wired up here so
 *     future coordination is a config change, not a rewrite.
 *
 * Lifecycle:
 *   - The iframe is only mounted while the dialog is open, so the GPU
 *     context and network resources are released on close.
 *   - ESC / backdrop click / explicit close button all dismiss the dialog.
 *   - Body scroll is locked while open.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, ArrowRight, Expand } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LauncherStyle = "3d-tilt" | "glass" | "flat";

export interface ExperienceLauncherProps {
  buttonLabel: string;
  subtitle?: string;
  posterImage?: string;
  iframeUrl: string;
  iframeTitle?: string;
  dialogWidthPct: number;
  dialogHeightPct: number;
  style: LauncherStyle;
  accentColor: string;
  textColor: string;
  cornerRadius: number;
  fullWidth?: boolean;
  alignment?: "left" | "center" | "right";
}

// Permissions the 3D engine is likely to need. Kept permissive on purpose —
// the iframe is same-suffix origin (ora-uae.com family) so the trust model
// is effectively first-party.
const IFRAME_ALLOW =
  "fullscreen; xr-spatial-tracking; accelerometer; gyroscope; autoplay; clipboard-write; picture-in-picture";

const IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock allow-presentation allow-downloads allow-top-navigation-by-user-activation";

// ─── Component ───────────────────────────────────────────────────────────────

export function ExperienceLauncherRuntime(props: ExperienceLauncherProps) {
  const {
    buttonLabel,
    subtitle,
    posterImage,
    iframeUrl,
    iframeTitle = "3D Experience",
    dialogWidthPct,
    dialogHeightPct,
    style,
    accentColor,
    textColor,
    cornerRadius,
    fullWidth,
    alignment = "left",
  } = props;

  const [open, setOpen] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Portal target — only available client-side, which in Next.js app router is
  // guaranteed inside this "use client" boundary.
  useEffect(() => setMounted(true), []);

  // Body scroll lock + ESC
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Return focus to the trigger button when the dialog closes, so keyboard
  // users don't get dumped at the top of the document.
  useEffect(() => {
    if (!open) buttonRef.current?.focus();
  }, [open]);

  // Listen for postMessage events from the iframe. No-ops unless the embedded
  // app opts in. Kept here so future integration is a pure addition.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MessageEvent) => {
      // Restrict to expected origins only. Be permissive about subdomain so
      // dev/staging hosts work without a code change.
      try {
        const origin = new URL(e.origin);
        if (!origin.hostname.endsWith("ora-uae.com")) return;
      } catch {
        return;
      }
      const data = e.data as { type?: string } | null | undefined;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      // Example hook: if bayn posts a "close" event, honour it.
      if (data.type === "bayn:close" || data.type === "experience:close") {
        setOpen(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [open]);

  const handleOpen = useCallback(() => {
    setIframeLoaded(false);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => setOpen(false), []);

  // ─── Button visual ─────────────────────────────────────────────────────────

  const alignStyle: React.CSSProperties = {
    display: "flex",
    justifyContent:
      alignment === "center" ? "center" : alignment === "right" ? "flex-end" : "flex-start",
    width: "100%",
  };

  const buttonInner = (
    <>
      {posterImage ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${posterImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: 0.55,
            transition: "opacity 0.4s ease, transform 0.6s ease",
          }}
          className="ora-exp-launcher__poster"
        />
      ) : null}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            style === "glass"
              ? `linear-gradient(135deg, rgba(0,0,0,0.35), rgba(0,0,0,0.1))`
              : `linear-gradient(135deg, ${accentColor}F5 0%, ${accentColor}CC 50%, ${accentColor}99 100%)`,
          mixBlendMode: posterImage ? "multiply" : "normal",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "18px 26px",
          color: textColor,
          textShadow: posterImage ? "0 1px 2px rgba(0,0,0,0.4)" : undefined,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
          {subtitle ? (
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                opacity: 0.85,
                fontWeight: 500,
              }}
            >
              {subtitle}
            </span>
          ) : null}
          <span
            style={{
              fontSize: 15,
              letterSpacing: "0.06em",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {buttonLabel}
          </span>
        </div>
        <span
          className="ora-exp-launcher__arrow"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.18)",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.35)",
            transition: "transform 0.3s ease, background 0.3s ease",
          }}
        >
          <ArrowRight size={16} strokeWidth={1.75} />
        </span>
      </div>
    </>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={alignStyle}>
      <style>{LAUNCHER_CSS}</style>
      <motion.button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`ora-exp-launcher ora-exp-launcher--${style}`}
        whileHover={style === "3d-tilt" ? { rotateX: -4, rotateY: 4, y: -3 } : { y: -2 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 280, damping: 20 }}
        style={{
          position: "relative",
          overflow: "hidden",
          border: "none",
          cursor: "pointer",
          background: "transparent",
          borderRadius: cornerRadius,
          minWidth: 220,
          width: fullWidth ? "100%" : undefined,
          transformStyle: "preserve-3d",
          perspective: 800,
        }}
      >
        {buttonInner}
      </motion.button>

      {mounted && typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <ExperienceLauncherDialog
                  iframeUrl={iframeUrl}
                  iframeTitle={iframeTitle}
                  widthPct={dialogWidthPct}
                  heightPct={dialogHeightPct}
                  onClose={handleClose}
                  onIframeLoad={() => setIframeLoaded(true)}
                  iframeLoaded={iframeLoaded}
                />
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
}

// ─── Dialog ──────────────────────────────────────────────────────────────────

interface DialogProps {
  iframeUrl: string;
  iframeTitle: string;
  widthPct: number;
  heightPct: number;
  onClose: () => void;
  onIframeLoad: () => void;
  iframeLoaded: boolean;
}

function ExperienceLauncherDialog({
  iframeUrl,
  iframeTitle,
  widthPct,
  heightPct,
  onClose,
  onIframeLoad,
  iframeLoaded,
}: DialogProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const handleFullscreen = useCallback(() => {
    const el = iframeRef.current;
    if (!el) return;
    const request =
      el.requestFullscreen ||
      (el as HTMLIFrameElement & { webkitRequestFullscreen?: () => Promise<void> })
        .webkitRequestFullscreen;
    try {
      request?.call(el);
    } catch {
      /* ignore — browsers without the API */
    }
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label={iframeTitle}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(26,26,26,0.78)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2vh 2vw",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 6 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: `${widthPct}vw`,
          height: `${heightPct}vh`,
          maxWidth: "100vw",
          maxHeight: "100dvh",
          background: "#0A0A0A",
          boxShadow: "0 32px 80px rgba(0,0,0,0.55)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Minimal top chrome: title + fullscreen + close */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            background: "rgba(255,255,255,0.04)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            color: "#FFF",
            fontFamily: "var(--font-poppins), sans-serif",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              opacity: 0.75,
              fontWeight: 500,
            }}
          >
            {iframeTitle}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={handleFullscreen}
              aria-label="Expand to fullscreen"
              style={chromeButtonStyle}
            >
              <Expand size={16} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close experience"
              autoFocus
              style={chromeButtonStyle}
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Iframe surface */}
        <div style={{ position: "relative", flex: 1, background: "#000" }}>
          {!iframeLoaded ? (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.55)",
                fontSize: 12,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                fontFamily: "var(--font-poppins), sans-serif",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                <div className="ora-exp-launcher__spinner" />
                <span>Loading experience…</span>
              </div>
            </div>
          ) : null}

          <iframe
            ref={iframeRef}
            src={iframeUrl}
            title={iframeTitle}
            onLoad={onIframeLoad}
            allow={IFRAME_ALLOW}
            allowFullScreen
            sandbox={IFRAME_SANDBOX}
            referrerPolicy="no-referrer-when-downgrade"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: "none",
              background: "#000",
            }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const chromeButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  border: "none",
  background: "transparent",
  color: "#FFF",
  cursor: "pointer",
  opacity: 0.75,
  transition: "opacity 0.2s, background 0.2s",
  borderRadius: 2,
};

const LAUNCHER_CSS = `
.ora-exp-launcher {
  box-shadow: 0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08);
  transition: box-shadow 0.3s ease;
}
.ora-exp-launcher--3d-tilt {
  box-shadow:
    0 14px 28px rgba(0,0,0,0.22),
    0 8px 14px rgba(0,0,0,0.14),
    inset 0 1px 0 rgba(255,255,255,0.18);
}
.ora-exp-launcher--glass {
  backdrop-filter: blur(10px);
}
.ora-exp-launcher:hover {
  box-shadow:
    0 22px 44px rgba(0,0,0,0.28),
    0 12px 20px rgba(0,0,0,0.16),
    inset 0 1px 0 rgba(255,255,255,0.22);
}
.ora-exp-launcher:hover .ora-exp-launcher__arrow {
  transform: translateX(3px);
  background: rgba(255,255,255,0.28);
}
.ora-exp-launcher:hover .ora-exp-launcher__poster {
  transform: scale(1.04);
  opacity: 0.65;
}
.ora-exp-launcher:focus-visible {
  outline: 2px solid #B8956B;
  outline-offset: 3px;
}
.ora-exp-launcher__spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(255,255,255,0.2);
  border-top-color: rgba(255,255,255,0.85);
  border-radius: 50%;
  animation: ora-exp-spin 0.9s linear infinite;
}
@keyframes ora-exp-spin {
  to { transform: rotate(360deg); }
}
`;
