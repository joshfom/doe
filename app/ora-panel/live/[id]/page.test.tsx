import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Example/edge tests for the Live Page Editor route gating ORDER.
 * Spec: live-page-editor — task 2.2.
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
 *
 * The route `app/ora-panel/live/[id]/page.tsx` is an async server component
 * implementing a load-bearing ordered control flow:
 *
 *   validate id format → requirePagesEdit gate → fetchPageById → render shell
 *
 * In this (modified) Next.js, `notFound()` and `redirect()` from
 * `next/navigation` THROW to terminate rendering of the segment
 * (`notFound()` throws `NEXT_HTTP_ERROR_FALLBACK;404`; `redirect()` throws
 * `NEXT_REDIRECT`) — see node_modules/next/dist/docs. The mocks below make
 * them throw sentinel errors so we can assert both that they were invoked AND
 * that control stops (the route function rejects, so no element is returned
 * and downstream steps never run).
 *
 * "Page_Renderer / LiveEditorShell is NOT invoked" is asserted on the gated
 * paths by (a) the route rejecting / returning the Forbidden surface and
 * (b) `fetchPageById` never being called (no data is ever loaded, so nothing
 * is rendered). A server component returns an element tree without invoking
 * its children, so we verify the happy path by inspecting the returned
 * element's `type` (the LiveEditorShell stub) and `props`.
 */

// ── Sentinel errors thrown by the navigation control-flow primitives ─────────

class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_HTTP_ERROR_FALLBACK;404");
    this.name = "NotFoundSignal";
  }
}

class RedirectSignal extends Error {
  to: string;
  constructor(to: string) {
    super("NEXT_REDIRECT");
    this.name = "RedirectSignal";
    this.to = to;
  }
}

// ── Mock modules (hoisted before the route import) ───────────────────────────

const notFoundMock = vi.fn((): never => {
  throw new NotFoundSignal();
});
const redirectMock = vi.fn((to: string): never => {
  throw new RedirectSignal(to);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (to: string) => redirectMock(to),
}));

vi.mock("@/lib/cms/live-editor/page-id", () => ({
  isValidPageId: vi.fn(),
}));

vi.mock("@/lib/cms/inline-editor/server-gate", () => ({
  requirePagesEdit: vi.fn(),
}));

vi.mock("@/lib/cms/utils/fetch-page", () => ({
  fetchPageById: vi.fn(),
}));

// Stub the shell + access-denied surface so we can identify them by reference
// without pulling in their (client) implementation trees.
vi.mock("@/lib/cms/live-editor/LiveEditorShell", () => ({
  default: vi.fn(() => null),
}));
vi.mock("@/app/ora-panel/forbidden", () => ({
  default: vi.fn(() => null),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import LiveEditorPage from "./page";
import { isValidPageId } from "@/lib/cms/live-editor/page-id";
import { requirePagesEdit } from "@/lib/cms/inline-editor/server-gate";
import { fetchPageById } from "@/lib/cms/utils/fetch-page";
import LiveEditorShell from "@/lib/cms/live-editor/LiveEditorShell";
import Forbidden from "@/app/ora-panel/forbidden";

// ── Helpers ──────────────────────────────────────────────────────────────────

// A well-formed canonical UUID (the accepted page-id format).
const VALID_ID = "11111111-1111-1111-1111-111111111111";

function invoke(id: string): Promise<ReactElement> {
  return LiveEditorPage({ params: Promise.resolve({ id }) });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("LiveEditorPage route gating order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. invalid id → notFound(); gate/fetch never run and shell not rendered", async () => {
    vi.mocked(isValidPageId).mockReturnValue(false);

    await expect(invoke("not-a-uuid")).rejects.toBeInstanceOf(NotFoundSignal);

    // id was validated, and the failure short-circuited BEFORE the gate/fetch.
    expect(isValidPageId).toHaveBeenCalledWith("not-a-uuid");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(requirePagesEdit).not.toHaveBeenCalled();
    expect(fetchPageById).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    // No page data fetched ⇒ Page_Renderer / shell is never rendered.
    expect(LiveEditorShell).not.toHaveBeenCalled();
  });

  it("2. forbidden (authenticated, no pages:edit) → access-denied returned; fetch never runs and shell not rendered", async () => {
    vi.mocked(isValidPageId).mockReturnValue(true);
    vi.mocked(requirePagesEdit).mockResolvedValue({
      ok: false,
      reason: "forbidden",
    });

    const result = await invoke(VALID_ID);

    // Returns the access-denied surface, not the shell.
    expect(result.type).toBe(Forbidden);
    expect(result.type).not.toBe(LiveEditorShell);

    // Gate ran AFTER id validation; fetch/redirect never ran (ordering).
    expect(isValidPageId).toHaveBeenCalledWith(VALID_ID);
    expect(requirePagesEdit).toHaveBeenCalledTimes(1);
    expect(fetchPageById).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(LiveEditorShell).not.toHaveBeenCalled();
  });

  it("3. unauthenticated → redirect() to login; fetch never runs and shell not rendered", async () => {
    vi.mocked(isValidPageId).mockReturnValue(true);
    vi.mocked(requirePagesEdit).mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
    });

    await expect(invoke(VALID_ID)).rejects.toBeInstanceOf(RedirectSignal);

    // Redirected to the ora-panel auth flow, preserving the return target.
    expect(redirectMock).toHaveBeenCalledTimes(1);
    const target = redirectMock.mock.calls[0][0];
    expect(target).toContain("/ora-panel/login");
    expect(target).toContain(encodeURIComponent(`/ora-panel/live/${VALID_ID}`));

    // Gate ran after validation; fetch/notFound never ran.
    expect(requirePagesEdit).toHaveBeenCalledTimes(1);
    expect(fetchPageById).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(LiveEditorShell).not.toHaveBeenCalled();
  });

  it("4. not-found (valid id, authorized, page missing) → notFound(); shell not rendered", async () => {
    vi.mocked(isValidPageId).mockReturnValue(true);
    vi.mocked(requirePagesEdit).mockResolvedValue({
      ok: true,
      userId: "user-1",
    });
    vi.mocked(fetchPageById).mockResolvedValue(null);

    await expect(invoke(VALID_ID)).rejects.toBeInstanceOf(NotFoundSignal);

    // Full ordered flow ran up to the fetch, which returned null.
    expect(isValidPageId).toHaveBeenCalledWith(VALID_ID);
    expect(requirePagesEdit).toHaveBeenCalledTimes(1);
    expect(fetchPageById).toHaveBeenCalledWith(VALID_ID);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(LiveEditorShell).not.toHaveBeenCalled();
  });

  it("5. happy path (valid id, authorized, page exists) → LiveEditorShell rendered with page data", async () => {
    vi.mocked(isValidPageId).mockReturnValue(true);
    vi.mocked(requirePagesEdit).mockResolvedValue({
      ok: true,
      userId: "user-1",
    });
    const page = {
      data: { content: [{ type: "Hero" }], root: {} },
      updatedAt: "2024-05-01T00:00:00.000Z",
      locale: "en",
    };
    vi.mocked(fetchPageById).mockResolvedValue(page);

    const result = await invoke(VALID_ID);

    // The shell is the rendered output, carrying the loaded page data.
    expect(result.type).toBe(LiveEditorShell);
    expect(result.props).toMatchObject({
      pageId: VALID_ID,
      initialData: page.data,
      version: page.updatedAt,
      locale: "en",
    });

    // Ordered flow ran end-to-end exactly once; no error path triggered.
    expect(fetchPageById).toHaveBeenCalledWith(VALID_ID);
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(Forbidden).not.toHaveBeenCalled();
  });
});
