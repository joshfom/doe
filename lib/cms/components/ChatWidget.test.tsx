import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatWidget, formatMessageContent } from './ChatWidget';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFetchSuccess(responseData: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: responseData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function mockFetchError() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
}

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ChatWidget', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'sessionStorage', {
      value: sessionStorageMock,
      writable: true,
    });
    sessionStorageMock.clear();

    // Provide a default IntersectionObserver mock for jsdom
    if (!globalThis.IntersectionObserver) {
      globalThis.IntersectionObserver = class MockIntersectionObserver {
        callback: IntersectionObserverCallback;
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element) {
          // Simulate sentinel is visible by default (user is at bottom)
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          );
        }
        unobserve() {}
        disconnect() {}
        get root() { return null; }
        get rootMargin() { return ''; }
        get thresholds() { return []; }
        takeRecords() { return []; }
      } as unknown as typeof IntersectionObserver;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the floating toggle button', () => {
    render(<ChatWidget locale="en" />);
    const toggle = screen.getByTestId('chat-toggle');
    expect(toggle).toBeDefined();
  });

  it('opens chat panel on toggle click', async () => {
    render(<ChatWidget locale="en" />);

    // Panel should not be visible initially
    expect(screen.queryByTestId('chat-panel')).toBeNull();

    // Click toggle to open
    fireEvent.click(screen.getByTestId('chat-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });
  });

  it('closes chat panel on second toggle click', async () => {
    render(<ChatWidget locale="en" />);

    // Open
    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    // Close via the header close button (floating bubble is hidden while open)
    fireEvent.click(screen.getByLabelText('Close chat'));
    await waitFor(() => {
      expect(screen.queryByTestId('chat-panel')).toBeNull();
    });
  });

  it('displays welcome message when opened', async () => {
    render(<ChatWidget locale="en" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));

    await waitFor(() => {
      expect(screen.getByText(/I'm ORA AI/)).toBeDefined();
    });
  });

  it('displays Arabic welcome message for ar locale', async () => {
    render(<ChatWidget locale="ar" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));

    await waitFor(() => {
      expect(screen.getByText(/ORA AI/)).toBeDefined();
    });
  });

  it('sends a message and displays assistant response', async () => {
    const fetchSpy = mockFetchSuccess({
      message: 'Hello! How can I help you?',
      conversationId: 'conv-123',
      language: 'en',
      identityType: 'visitor',
    });

    render(<ChatWidget locale="en" />);

    // Open chat
    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    // Type and send a message
    const input = screen.getByPlaceholderText('Type your message…');
    fireEvent.change(input, { target: { value: 'Hi there' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    // User message should appear
    await waitFor(() => {
      expect(screen.getByText('Hi there')).toBeDefined();
    });

    // Wait for assistant response
    await waitFor(() => {
      expect(screen.getByText('Hello! How can I help you?')).toBeDefined();
    });

    // Verify fetch was called correctly
    expect(fetchSpy).toHaveBeenCalledWith('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hi there' }),
    });
  });

  it('sends message on Enter key press', async () => {
    mockFetchSuccess({
      message: 'Response',
      conversationId: 'conv-456',
      language: 'en',
      identityType: 'visitor',
    });

    render(<ChatWidget locale="en" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    const input = screen.getByPlaceholderText('Type your message…');
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Test message')).toBeDefined();
    });
  });

  it('shows typing indicator while waiting for response', async () => {
    // Use a delayed fetch to observe the typing indicator
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(
                  JSON.stringify({
                    data: {
                      message: 'Delayed response',
                      conversationId: 'conv-789',
                      language: 'en',
                      identityType: 'visitor',
                    },
                  }),
                  { status: 200, headers: { 'Content-Type': 'application/json' } }
                )
              ),
            100
          )
        )
    );

    render(<ChatWidget locale="en" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    const input = screen.getByPlaceholderText('Type your message…');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    // Typing indicator should appear
    await waitFor(() => {
      expect(screen.getByTestId('typing-indicator')).toBeDefined();
    });

    // After response, typing indicator should disappear
    await waitFor(() => {
      expect(screen.queryByTestId('typing-indicator')).toBeNull();
    });
  });

  it('persists conversationId in sessionStorage', async () => {
    mockFetchSuccess({
      message: 'Hello!',
      conversationId: 'conv-persist-123',
      language: 'en',
      identityType: 'visitor',
    });

    render(<ChatWidget locale="en" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    const input = screen.getByPlaceholderText('Type your message…');
    fireEvent.change(input, { target: { value: 'Test' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText('Hello!')).toBeDefined();
    });

    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'ora-ai-conversation-id',
      'conv-persist-123'
    );
  });

  it('restores conversationId from sessionStorage and includes it in requests', async () => {
    sessionStorageMock.setItem('ora-ai-conversation-id', 'existing-conv-id');

    const fetchSpy = mockFetchSuccess({
      message: 'Continued conversation',
      conversationId: 'existing-conv-id',
      language: 'en',
      identityType: 'visitor',
    });

    render(<ChatWidget locale="en" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    const input = screen.getByPlaceholderText('Type your message…');
    fireEvent.change(input, { target: { value: 'Continue' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText('Continued conversation')).toBeDefined();
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Continue', conversationId: 'existing-conv-id' }),
    });
  });

  it('applies dir="rtl" when locale is "ar"', async () => {
    render(<ChatWidget locale="ar" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));

    await waitFor(() => {
      const panel = screen.getByTestId('chat-panel');
      // The parent container should have dir="rtl"
      const container = panel.closest('[dir="rtl"]');
      expect(container).not.toBeNull();
    });
  });

  it('applies dir="ltr" when locale is "en"', async () => {
    render(<ChatWidget locale="en" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));

    await waitFor(() => {
      const panel = screen.getByTestId('chat-panel');
      const container = panel.closest('[dir="ltr"]');
      expect(container).not.toBeNull();
    });
  });

  it('handles fetch error gracefully', async () => {
    mockFetchError();

    render(<ChatWidget locale="en" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    const input = screen.getByPlaceholderText('Type your message…');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText(/connection error/i)).toBeDefined();
    });
  });

  it('does not send empty messages', async () => {
    const fetchSpy = mockFetchSuccess({
      message: 'Response',
      conversationId: 'conv-1',
      language: 'en',
      identityType: 'visitor',
    });

    render(<ChatWidget locale="en" />);

    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    // Try to send empty message
    fireEvent.click(screen.getByLabelText('Send message'));

    // fetch should not have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('minimize preserves conversation state — open, send message, minimize, reopen, verify messages still present', async () => {
    mockFetchSuccess({
      message: 'Hello! How can I help you?',
      conversationId: 'conv-minimize-test',
      language: 'en',
      identityType: 'visitor',
    });

    render(<ChatWidget locale="en" />);

    // Open chat
    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    // Send a message
    const input = screen.getByPlaceholderText('Type your message…');
    fireEvent.change(input, { target: { value: 'Test minimize' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    // Wait for user message and assistant response
    await waitFor(() => {
      expect(screen.getByText('Test minimize')).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByText('Hello! How can I help you?')).toBeDefined();
    });

    // Click the minimize button
    fireEvent.click(screen.getByTestId('minimize-button'));

    // Panel should be closed
    await waitFor(() => {
      expect(screen.queryByTestId('chat-panel')).toBeNull();
    });

    // Reopen by clicking the toggle button
    fireEvent.click(screen.getByTestId('chat-toggle'));

    // Panel should be visible again
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    // Verify the previously sent message and response are still visible
    expect(screen.getByText('Test minimize')).toBeDefined();
    expect(screen.getByText('Hello! How can I help you?')).toBeDefined();
  });

  it('on viewport ≤640px, panel renders full-screen and resize handles are not present', async () => {
    // Mock matchMedia to simulate mobile viewport (≤640px)
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 640px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<ChatWidget locale="en" />);
    fireEvent.click(screen.getByTestId('chat-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    // Verify resize handles are not present
    expect(screen.queryByTestId('resize-handle-top')).toBeNull();
    expect(screen.queryByTestId('resize-handle-side')).toBeNull();
    expect(screen.queryByTestId('resize-handle-corner')).toBeNull();

    // Verify minimize button is not present
    expect(screen.queryByTestId('minimize-button')).toBeNull();

    // Verify full-screen styles
    const panel = screen.getByTestId('chat-panel');
    expect(panel.style.width).toBe('100vw');
    expect(panel.style.height).toBe('100vh');
    expect(panel.style.position).toBe('fixed');
    expect(panel.style.top).toBe('0px');
    expect(panel.style.left).toBe('0px');

    // Restore
    window.matchMedia = originalMatchMedia;
  });

  it('scroll-to-bottom button appears when user scrolls up and disappears when clicked', async () => {
    // Track IntersectionObserver callbacks so we can simulate visibility changes
    // Use a ref object so TypeScript doesn't narrow the closure variable to `never`
    const observerRef: { callback: IntersectionObserverCallback | null; element: Element | null } = {
      callback: null,
      element: null,
    };

    const mockDisconnect = vi.fn();
    const mockObserve = vi.fn();

    // Override the global mock with one we can control
    globalThis.IntersectionObserver = class ControlledIntersectionObserver {
      constructor(cb: IntersectionObserverCallback) {
        observerRef.callback = cb;
      }
      observe(el: Element) {
        observerRef.element = el;
        mockObserve(el);
        // Initially the sentinel is visible (user is at bottom)
        observerRef.callback?.(
          [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        );
      }
      unobserve() {}
      disconnect() { mockDisconnect(); }
      get root() { return null; }
      get rootMargin() { return ''; }
      get thresholds() { return []; }
      takeRecords() { return []; }
    } as unknown as typeof IntersectionObserver;

    render(<ChatWidget locale="en" />);

    // Open chat
    fireEvent.click(screen.getByTestId('chat-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('chat-panel')).toBeDefined();
    });

    // Sentinel should be present
    const sentinel = screen.getByTestId('messages-sentinel');
    expect(sentinel).toBeDefined();

    // Initially at bottom — scroll-to-bottom button should NOT be visible
    expect(screen.queryByTestId('scroll-to-bottom-button')).toBeNull();

    // Simulate user scrolling up: sentinel becomes NOT visible
    observerRef.callback?.(
      [{ isIntersecting: false, target: observerRef.element! } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    // Scroll-to-bottom button should now appear
    await waitFor(() => {
      expect(screen.getByTestId('scroll-to-bottom-button')).toBeDefined();
    });

    // Verify the button has the correct aria-label
    expect(screen.getByTestId('scroll-to-bottom-button').getAttribute('aria-label')).toBe('Scroll to latest');

    // Mock scrollIntoView on the sentinel
    const scrollIntoViewMock = vi.fn();
    sentinel.scrollIntoView = scrollIntoViewMock;

    // Click the scroll-to-bottom button
    fireEvent.click(screen.getByTestId('scroll-to-bottom-button'));

    // scrollIntoView should have been called on the sentinel
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' });

    // Simulate the sentinel becoming visible again after scroll
    observerRef.callback?.(
      [{ isIntersecting: true, target: observerRef.element! } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );

    // Scroll-to-bottom button should disappear
    await waitFor(() => {
      expect(screen.queryByTestId('scroll-to-bottom-button')).toBeNull();
    });
  });
});

// ── formatMessageContent tests ───────────────────────────────────────────────

describe('formatMessageContent', () => {
  it('renders **bold** text as <strong> elements', () => {
    const { container } = render(<>{formatMessageContent('Hello **world**!')}</>);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe('world');
  });

  it('renders lines starting with "- " as an unordered list', () => {
    const { container } = render(<>{formatMessageContent('- Apple\n- Banana\n- Cherry')}</>);
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('Apple');
    expect(items[1].textContent).toBe('Banana');
    expect(items[2].textContent).toBe('Cherry');
  });

  it('renders lines starting with "* " as an unordered list', () => {
    const { container } = render(<>{formatMessageContent('* First\n* Second')}</>);
    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(2);
  });

  it('renders lines starting with "1. " as an ordered list', () => {
    const { container } = render(<>{formatMessageContent('1. Step one\n2. Step two\n3. Step three')}</>);
    const ol = container.querySelector('ol');
    expect(ol).not.toBeNull();
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('Step one');
    expect(items[1].textContent).toBe('Step two');
    expect(items[2].textContent).toBe('Step three');
  });

  it('renders double newlines as separate paragraph elements', () => {
    const { container } = render(<>{formatMessageContent('First paragraph\n\nSecond paragraph')}</>);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0].textContent).toBe('First paragraph');
    expect(paragraphs[1].textContent).toBe('Second paragraph');
  });

  it('renders single newlines as <br /> within a paragraph', () => {
    const { container } = render(<>{formatMessageContent('Line one\nLine two')}</>);
    const br = container.querySelector('br');
    expect(br).not.toBeNull();
  });

  it('handles mixed content: paragraphs with bold and lists', () => {
    const content = 'Here is a **bold** intro\n\n- Item one\n- Item **two**\n\nFinal paragraph';
    const { container } = render(<>{formatMessageContent(content)}</>);

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(2);

    const ul = container.querySelector('ul');
    expect(ul).not.toBeNull();

    const strongs = container.querySelectorAll('strong');
    expect(strongs.length).toBe(2);
  });

  it('renders plain text without markdown as a single paragraph', () => {
    const { container } = render(<>{formatMessageContent('Just plain text')}</>);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0].textContent).toBe('Just plain text');
  });
});
