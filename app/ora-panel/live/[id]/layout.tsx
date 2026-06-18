/**
 * Live Page Editor segment layout — `/ora-panel/live/[id]` (server component).
 *
 * Task 3.2 / Requirements 3.1, 3.5, 3.6, 10.7.
 *
 * Responsibility (deliberately narrow):
 *   - Provide the full-bleed `data-live-editor-root` container that occupies
 *     100% of the viewport width with no margin/padding reserved for chrome
 *     (Req 3.1). Floating Editor_UI is positioned `fixed`/`absolute` by the
 *     shell so it occupies no layout space inside this container (Req 3.5, 3.6).
 *   - Establish a `dir` wrapper for RTL support (Req 10.7).
 *
 * Why `dir` lives on a wrapper `<div>` and not on `<html>`:
 *   In this Next.js version a nested segment layout CANNOT render its own
 *   `<html>`/`<body>` tags — only the root layout (`app/layout.tsx`) may do so
 *   (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md
 *   "Root Layout"). Parent layouts always wrap their children via `children`;
 *   a nested layout cannot remove or replace an ancestor `<html>`. So, exactly
 *   like the locale layouts in this repo (`app/ar/layout.tsx` sets `dir="rtl"`
 *   on a wrapping `<div>`), this layout applies `dir` to the full-bleed wrapper.
 *
 * Locale derivation is intentionally NOT done here. Layouts in this version are
 * cached and do not re-render on navigation, and this layout deliberately does
 * not fetch page data. A sensible default (`dir="ltr"`) is applied here, and the
 * authoritative direction is set by `LiveEditorShell` from its `locale` prop
 * (it already renders `dir={locale === "ar" ? "rtl" : "ltr"}`), which is the
 * value resolved from the page data in the route's server component.
 *
 * This layout does NOT attempt to strip parent chrome — that is handled by
 * task 3.1 in `app/ora-panel/layout.tsx`, which recognizes `/ora-panel/live/`
 * paths as chromeless (no sidebar, no nav, no `ml-16` main padding).
 */
export default function LiveEditorSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-live-editor-root
      dir="ltr"
      style={{
        width: "100vw",
        minHeight: "100vh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}
