import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { DemoResetControl } from "./DemoResetControl";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFetchResponse(opts: { ok: boolean; status?: number; body?: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: vi.fn().mockResolvedValue(opts.body ?? {}),
  });
}

describe("DemoResetControl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 1. Renders the idle reset trigger.
  it("renders a Reset demo button in the idle state", () => {
    render(<DemoResetControl />);
    expect(screen.getByRole("button", { name: /reset demo/i })).toBeDefined();
  });

  // 2. Requires confirmation before calling the endpoint (destructive guard).
  it("does not call the endpoint until the action is confirmed", () => {
    const fetchMock = mockFetchResponse({ ok: true, body: {} });
    vi.stubGlobal("fetch", fetchMock);

    render(<DemoResetControl />);
    fireEvent.click(screen.getByRole("button", { name: /reset demo/i }));

    // Confirmation prompt shown, no network call yet.
    expect(screen.getByText(/reset all demo data\?/i)).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 3. Confirming POSTs to /api/demo/reset and shows success.
  it("POSTs to /api/demo/reset on confirm and renders the success state", async () => {
    const fetchMock = mockFetchResponse({
      ok: true,
      body: { message: "Demo reset complete." },
    });
    vi.stubGlobal("fetch", fetchMock);
    const onResetComplete = vi.fn();

    render(<DemoResetControl onResetComplete={onResetComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /reset demo/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/demo/reset");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");

    await waitFor(() => {
      expect(screen.getByText(/demo reset complete/i)).toBeDefined();
    });
    expect(onResetComplete).toHaveBeenCalledWith({ message: "Demo reset complete." });
  });

  // 4. Cancelling the confirmation returns to idle without calling fetch.
  it("cancels the confirmation without calling the endpoint", () => {
    const fetchMock = mockFetchResponse({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<DemoResetControl />);
    fireEvent.click(screen.getByRole("button", { name: /reset demo/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /reset demo/i })).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 5. Graceful handling when the endpoint does not exist yet (404 before task 18.2).
  it("shows a graceful error with retry when the endpoint is missing (404)", async () => {
    const fetchMock = mockFetchResponse({ ok: false, status: 404, body: {} });
    vi.stubGlobal("fetch", fetchMock);

    render(<DemoResetControl />);
    fireEvent.click(screen.getByRole("button", { name: /reset demo/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText(/not available yet/i)).toBeDefined();
    });
    // Retry control is available.
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  // 6. Retry re-invokes the endpoint and can recover to success.
  it("retries after an error and recovers to success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ message: "Boom" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ removed: 42 }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<DemoResetControl />);
    fireEvent.click(screen.getByRole("button", { name: /reset demo/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
    });

    await waitFor(() => expect(screen.getByText(/boom/i)).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/42 rows cleared/i)).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 7. Network rejection is surfaced as a graceful error (no unhandled throw).
  it("handles a network rejection gracefully", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network down"));
    vi.stubGlobal("fetch", fetchMock);

    render(<DemoResetControl />);
    fireEvent.click(screen.getByRole("button", { name: /reset demo/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText(/network down/i)).toBeDefined();
    });
  });
});
