import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { HomeChat } from './HomeChat';
import { HomeRealtimeProvider } from './HomeRealtime';

// Focused test for Home_Chat retain-input-on-failure (Req 1.7) and the success
// path (Req 1.3/7.7). HomeChat must be rendered inside HomeRealtimeProvider
// because it subscribes to the shared stream. EventSource is stubbed so no real
// connection is opened.

class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  close() {
    this.readyState = 2;
  }
}

function renderChat() {
  return render(
    <HomeRealtimeProvider>
      <HomeChat />
    </HomeRealtimeProvider>
  );
}

describe('HomeChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('appends the assistant reply on a successful turn and clears the input', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi
        .fn()
        .mockResolvedValue({ data: { ok: true, response: 'Here is your stack.', modelTier: 'fast' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderChat();
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'show my stack' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await waitFor(() => expect(screen.getByText(/here is your stack/i)).toBeDefined());
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
  });

  it('retains the input and shows a non-blocking error on a retain-input failure (Req 1.7)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        data: {
          ok: false,
          retainInput: true,
          reason: 'agent_unreachable',
          message: 'The home assistant could not be reached. Your message was kept.',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderChat();
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'delegate a task' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    // Input retained so the user can retry without retyping.
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('delegate a task');
  });

  it('retains the input when the request throws (agent unreachable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    renderChat();
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'trigger report' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('trigger report');
  });
});
