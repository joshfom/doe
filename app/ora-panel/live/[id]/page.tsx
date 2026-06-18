import { notFound, redirect } from "next/navigation";
import { isValidPageId } from "@/lib/cms/live-editor/page-id";
import { requirePagesEdit } from "@/lib/cms/inline-editor/server-gate";
import { fetchPageById } from "@/lib/cms/utils/fetch-page";
import Forbidden from "@/app/ora-panel/forbidden";
import LiveEditorShell from "@/lib/cms/live-editor/LiveEditorShell";

/**
 * Live Page Editor route — `/ora-panel/live/[id]` (server component).
 *
 * Implements the ordered control flow from design.md (LiveEditorRoute contract)
 * and Requirement 1. The order is load-bearing and MUST NOT be reordered:
 *
 *   1. Validate the `[id]` format BEFORE any fetch (Req 1.7).
 *   2. Authorize on the server BEFORE rendering any page content or editing
 *      affordance (Req 1.3, 1.5):
 *        - unauthenticated → redirect to the ora-panel auth flow (Req 1.4)
 *        - authenticated but lacking `pages:edit` → render the access-denied
 *          surface and RETURN before fetching/rendering (Req 1.3)
 *   3. Fetch the page; a missing page → not-found (Req 1.6).
 *   4. Render the editor shell with the same published payload public visitors
 *      receive — no draft content (Req 1.1, 1.2).
 *
 * `forbidden()` from `next/navigation` is intentionally NOT used here: it is an
 * experimental API that requires `experimental.authInterrupts` in
 * `next.config.ts`, which this project does not enable. Rendering the existing
 * `app/ora-panel/forbidden.tsx` surface and returning satisfies Req 1.3
 * (access-denied response, no Page_Renderer, no editing affordances) without a
 * global config change.
 */
export default async function LiveEditorPage({
  params,
}: {
  // `params` is a Promise in this Next.js version and must be awaited.
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  // 1. Validate id format before any fetch (Req 1.7).
  const { id } = await params;
  if (!isValidPageId(id)) {
    notFound();
  }

  // 2. Server-side authorization before any content/affordances (Req 1.3, 1.5).
  const gate = await requirePagesEdit();
  if (!gate.ok) {
    if (gate.reason === "unauthenticated") {
      // Redirect to the ora-panel auth flow, preserving the return target
      // (mirrors the client layout's `?next=` convention) (Req 1.4).
      const next = encodeURIComponent(`/ora-panel/live/${id}`);
      redirect(`/ora-panel/login?next=${next}`);
    }
    // Authenticated but lacking `pages:edit`: render access-denied and return
    // BEFORE fetching or rendering the page (Req 1.3).
    return <Forbidden />;
  }

  // 3. Fetch the page; missing → not-found (Req 1.6).
  const page = await fetchPageById(id);
  if (!page) {
    notFound();
  }

  // 4. Render the editor shell with the same published payload public visitors
  //    receive (Req 1.1, 1.2). `initialData` is the Puck document; `version` is
  //    echoed back on save (Req 8.1); `locale` drives RTL mirroring (Req 10.7).
  const locale = page.locale === "ar" ? "ar" : "en";

  return (
    <LiveEditorShell
      pageId={id}
      initialData={page.data ?? page}
      version={page.updatedAt ?? page.version ?? null}
      locale={locale}
    />
  );
}
