// @vitest-environment jsdom
/**
 * InlineSaveBar — save response handling (example tests).
 *
 * Spec: live-page-editor — task 10.4
 * _Requirements: 8.1, 8.2, 8.5, 8.7, 8.8_
 *
 * These are example (not property) tests. They exercise the one-shot save
 * response handling of `InlineSaveBar` against a mocked `fetch`:
 *
 *   • Req 8.1  — a save PUTs `{ data, version }` to `/api/pages/:id` with
 *                `credentials:"include"`; the submitted body echoes the loaded
 *                `version` identifier.
 *   • Req 8.2  — a `{ pendingDraft: true }` response surfaces the
 *                "saved to pending draft — live unchanged" banner and reports
 *                the save up via `onSaved` (which clears the dirty indication
 *                in the host).
 *   • Req 8.5  — a `403` invokes `onPermissionRevoked` and does NOT report a
 *                successful save.
 *   • Req 8.7  — a `409` (stale version) invokes `onStaleConflict`, shows the
 *                "page changed since you opened it" notice, and does NOT call
 *                `onSaved` (local data/dirty state is retained — not
 *                overwritten).
 *   • Req 8.8  — a timeout (the 30s `AbortController` firing) and any other
 *                failure show an error and retain the unsaved changes
 *                (`onSaved` is never called).
 *
 * The bar owns no Puck context, so it is rendered directly with controlled
 * props and a mocked `fetch` (same fetch-mocking style as
 * `InlineEditorClient.test.tsx`).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

import { InlineSaveBar } from "./InlineSaveBar";

const PAGE_ID = "page-1";
const VERSION = "2024-01-01T00:00:00.000Z";
const DATA = { content: [{ type: "Heading", props: { id: "h1" } }], root: { props: {} } };

/** Build a Response-like object for the fetch mock. */
function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function renderBar(overrides: Partial<React.ComponentProps<typeof InlineSaveBar>> = {}) {
  const props = {
    pageId: PAGE_ID,
    dirty: true,
    data: DATA,
    version: VERSION,
    onSaved: vi.fn(),
    onExit: vi.fn(),
    onPermissionRevoked: vi.fn(),
    onStaleConflict: vi.fn(),
    ...overrides,
  };
  const view = render(<InlineSaveBar {...props} />);
  return { props, view };
}

function clickSave() {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Feature: live-page-editor — InlineSaveBar save submission (Req 8.1)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { data: DATA })),
    );
  });

  it("PUTs { data, version } to /api/pages/:id with credentials included", async () => {
    const { props } = renderBar();

    clickSave();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/pages/${PAGE_ID}`);
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("include");

    // The submitted body carries both the edited data AND the loaded version
    // identifier so the endpoint can detect stale writes (Req 8.1).
    const body = JSON.parse(init.body as string);
    expect(body.version).toBe(VERSION);
    expect(body.data).toEqual(DATA);

    await waitFor(() =>
      expect(props.onSaved).toHaveBeenCalledWith({ pendingDraft: false }),
    );
  });
});

describe("Feature: live-page-editor — InlineSaveBar pending-draft handling (Req 8.2)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { pendingDraft: true })),
    );
  });

  it("shows the pending-draft banner and reports the save (clears dirty upstream)", async () => {
    const { props } = renderBar();

    clickSave();

    // The "live page unchanged" banner appears for a pending-draft result.
    expect(
      await screen.findByText(/saved to pending draft/i),
    ).toBeTruthy();

    // onSaved fires with the pendingDraft flag so the host clears its dirty
    // indication (Req 8.2).
    await waitFor(() =>
      expect(props.onSaved).toHaveBeenCalledWith({ pendingDraft: true }),
    );
    expect(props.onPermissionRevoked).not.toHaveBeenCalled();
    expect(props.onStaleConflict).not.toHaveBeenCalled();
  });
});

describe("Feature: live-page-editor — InlineSaveBar permission revocation (Req 8.5)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(403, { error: "forbidden" })),
    );
  });

  it("invokes onPermissionRevoked on a 403 and does not report a save", async () => {
    const { props } = renderBar();

    clickSave();

    await waitFor(() => expect(props.onPermissionRevoked).toHaveBeenCalledTimes(1));
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onStaleConflict).not.toHaveBeenCalled();
  });
});

describe("Feature: live-page-editor — InlineSaveBar stale conflict (Req 8.7)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(409, { error: "stale" })),
    );
  });

  it("invokes onStaleConflict, shows the stale notice, and does NOT clear/overwrite", async () => {
    const { props } = renderBar();

    clickSave();

    await waitFor(() => expect(props.onStaleConflict).toHaveBeenCalledTimes(1));

    // The user is told the page changed since it was loaded (Req 8.7).
    expect(
      await screen.findByText(/this page changed since you opened it/i),
    ).toBeTruthy();

    // Local data is NOT overwritten: a successful save is never reported, so the
    // host retains its current (dirty) data.
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onPermissionRevoked).not.toHaveBeenCalled();
  });
});

describe("Feature: live-page-editor — InlineSaveBar failure handling (Req 8.8)", () => {
  it("times out via the 30s AbortController, shows an error, and retains changes", async () => {
    vi.useFakeTimers();

    // A fetch that never resolves on its own — it only rejects when the
    // AbortController signal fires, faithfully exercising the 30s timeout path.
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { props } = renderBar();

    clickSave();

    // Advance past the 30s timeout so the AbortController aborts the request.
    // `advanceTimersByTimeAsync` flushes the microtask chain (abort → reject →
    // catch → setState) and the surrounding `act` flushes the React update, so
    // the error is on screen synchronously afterwards — no `findByText` polling
    // (which deadlocks under fake timers) is needed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText(/save timed out/i)).toBeTruthy();
    // Unsaved changes are retained — no successful save is reported (Req 8.8).
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onPermissionRevoked).not.toHaveBeenCalled();
    expect(props.onStaleConflict).not.toHaveBeenCalled();
  });

  it("shows an error and retains changes on a non-permission server failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(500, { error: "Internal error" })),
    );

    const { props } = renderBar();

    clickSave();

    expect(await screen.findByText(/internal error/i)).toBeTruthy();
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onPermissionRevoked).not.toHaveBeenCalled();
    expect(props.onStaleConflict).not.toHaveBeenCalled();
  });
});
