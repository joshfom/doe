"use client";

/**
 * InlineEditorBootstrap — tiny client boundary that lazy-loads the
 * inline editor chunk.
 *
 * Spec: custom-branded-page-builder — task 14.2
 * _Requirements: 9.3, 19.2_
 *
 * The actual editor implementation (`InlineEditorClient`) is loaded with
 * `next/dynamic({ ssr: false })` so it's never parsed during SSR and
 * never sent to anonymous browsers. The bundler emits this as a
 * separate chunk (`inline-editor.chunk.js`) — verify with
 * `bunx next build && grep inline-editor .next/static`.
 *
 * This component itself is intentionally trivial. Its only job is to
 * separate the **server gate** (`InlineEditorProvider`) from the
 * **client editor**, so that the dynamic import boundary can exist on
 * the client side without dragging the editor into the public chunk.
 */

import dynamic from "next/dynamic";

const InlineEditorClient = dynamic(
  () =>
    import(
      /* webpackChunkName: "inline-editor.chunk" */ "./InlineEditorClient"
    ).then((m) => m.InlineEditorClient),
  { ssr: false },
);

interface InlineEditorBootstrapProps {
  pageId: string;
}

export function InlineEditorBootstrap({ pageId }: InlineEditorBootstrapProps) {
  return <InlineEditorClient pageId={pageId} />;
}
