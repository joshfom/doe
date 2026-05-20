/**
 * InlineEditorProvider — server-side gate for the inline frontend editor.
 *
 * Spec: custom-branded-page-builder — task 14.1
 * _Requirements: 8.1, 9.1, 9.2, 9.3, 19.1_
 *
 * This is a Next.js 16 server component. It performs three independent
 * authorization checks before mounting any inline-editor code on the
 * client:
 *
 *   1. **Feature flag.** `inline_editor` must be enabled in the
 *      `site_settings` table. The flag is read with the pure
 *      `resolveFeatureFlag` helper so anonymous SSR never imports any
 *      client editor chunk.
 *   2. **Authentication.** A valid session cookie (DB-backed via
 *      `validateSession`) must be present. Anonymous visitors get back
 *      `null` — i.e. the public HTML stays byte-identical (Req 16.1).
 *   3. **RBAC.** The user's roles must include the `pages:edit`
 *      permission resolved against the live RBAC tables. The same
 *      check is repeated server-side on every save (Req 9.4) so the
 *      client cache cannot grant access on its own.
 *
 * Only when all three pass do we render the small `InlineEditorBootstrap`
 * client boundary, which dynamically imports the editor chunk
 * (`inline-editor.chunk.js`). This is the single chokepoint that keeps
 * the editor bundle out of every anonymous public page (Req 19.1, 19.4).
 */

import { canMountInlineEditor } from "@/lib/cms/inline-editor/server-gate";
import { InlineEditorBootstrap } from "@/lib/cms/inline-editor/InlineEditorBootstrap";

interface InlineEditorProviderProps {
  /** Page id used by the editor client to fetch its initial draft. */
  pageId: string;
}

export async function InlineEditorProvider({
  pageId,
}: InlineEditorProviderProps): Promise<React.ReactElement | null> {
  if (!(await canMountInlineEditor())) return null;
  return <InlineEditorBootstrap pageId={pageId} />;
}
