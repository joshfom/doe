import localFont from "next/font/local";

/**
 * URW Geometric — ORA brand typeface.
 *
 * Loads all 10 weight variants locally via `next/font/local`, exposes a
 * `--font-urw-geometric` CSS variable, and uses `display: swap` so text
 * remains visible during font load (system-ui fallback first, then swap to
 * URW Geometric once available).
 *
 * See `.kiro/specs/branded-font-enforcement/design.md` §1 for the design
 * decisions behind this loader.
 */
export const urwGeometric = localFont({
  src: [
    { path: "./urw/URWGeometricThin.otf", weight: "100", style: "normal" },
    { path: "./urw/URWGeometricExtraLight.otf", weight: "200", style: "normal" },
    { path: "./urw/URWGeometricLight.otf", weight: "300", style: "normal" },
    { path: "./urw/URWGeometricRegular.otf", weight: "400", style: "normal" },
    { path: "./urw/URWGeometricMedium.otf", weight: "500", style: "normal" },
    { path: "./urw/URWGeometricSemiBold.otf", weight: "600", style: "normal" },
    { path: "./urw/URWGeometricBold.otf", weight: "700", style: "normal" },
    { path: "./urw/URWGeometricExtraBold.otf", weight: "800", style: "normal" },
    { path: "./urw/URWGeometricBlack.otf", weight: "900", style: "normal" },
    { path: "./urw/URWGeometricHeavy.otf", weight: "950", style: "normal" },
  ],
  variable: "--font-urw-geometric",
  display: "swap",
});
