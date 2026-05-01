'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, X, Minus, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { OraAiIcon } from './OraAiIcon';

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatWidgetProps {
  locale: 'en' | 'ar';
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// ── i18n strings ─────────────────────────────────────────────────────────────

const i18n = {
  en: {
    welcome: "Hi, I'm ORA AI — your virtual concierge. Ask me about communities, units, permits, or your account.",
    placeholder: 'Type your message…',
    title: 'ORA AI Assistant',
    close: 'Close chat',
    send: 'Send message',
    open: 'Open chat',
    minimize: 'Minimize chat',
    scrollToBottom: 'Scroll to latest',
    thinkingSteps: [
      'Understanding your question…',
      'Looking up the answer…',
      'Preparing your reply…',
    ],
  },
  ar: {
    welcome: 'أهلاً، أنا ORA AI — مساعدك الافتراضي. اسألني عن المجتمعات، الوحدات، التصاريح أو حسابك.',
    placeholder: 'اكتب رسالتك…',
    title: 'مساعد ORA الذكي',
    close: 'إغلاق المحادثة',
    send: 'إرسال الرسالة',
    open: 'فتح المحادثة',
    minimize: 'تصغير المحادثة',
    scrollToBottom: 'انتقل إلى الأحدث',
    thinkingSteps: [
      'جارٍ فهم سؤالك…',
      'جارٍ البحث عن الإجابة…',
      'جارٍ تجهيز ردّك…',
    ],
  },
} as const;

// ── Size constants ───────────────────────────────────────────────────────────

export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 400;
export const DEFAULT_WIDTH = 400;
export const DEFAULT_HEIGHT = 600;
export const MAX_VIEWPORT_RATIO = 0.9;
export const MOBILE_BREAKPOINT = 640;
export const STORAGE_KEY = 'ora-chat-widget-size';

// ── Size utility functions ───────────────────────────────────────────────────

export function clampSize(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number } {
  const maxW = Math.floor(viewportWidth * MAX_VIEWPORT_RATIO);
  const maxH = Math.floor(viewportHeight * MAX_VIEWPORT_RATIO);
  return {
    width: Math.max(MIN_WIDTH, Math.min(width, maxW)),
    height: Math.max(MIN_HEIGHT, Math.min(height, maxH)),
  };
}

export function persistSize(size: { width: number; height: number }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
  } catch { /* silently ignore */ }
}

export function loadPersistedSize(): { width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Resize delta computation (exported for property testing) ─────────────────

export type ResizeDirection = 'top' | 'side' | 'corner';

export function computeResizeDelta(
  direction: ResizeDirection,
  isRtl: boolean,
  deltaX: number,
  deltaY: number,
  startWidth: number,
  startHeight: number,
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number } {
  let newWidth = startWidth;
  let newHeight = startHeight;

  if (direction === 'top' || direction === 'corner') {
    // Dragging top edge up (negative deltaY) increases height
    newHeight = startHeight - deltaY;
  }

  if (direction === 'side' || direction === 'corner') {
    if (isRtl) {
      // RTL: handle is on right edge, dragging right (positive deltaX) increases width
      newWidth = startWidth + deltaX;
    } else {
      // LTR: handle is on left edge, dragging left (negative deltaX) increases width
      newWidth = startWidth - deltaX;
    }
  }

  return clampSize(newWidth, newHeight, viewportWidth, viewportHeight);
}

// ── Rich text formatter ──────────────────────────────────────────────────────

/**
 * Parses inline markdown markers (**bold**, [text](url)) and returns React nodes.
 * Single newlines within a paragraph become <br /> elements. Links are rendered
 * as <a> tags; relative URLs open in the same tab, absolute URLs in a new tab
 * with safe rel attributes.
 */
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Combined regex matches either **bold** or [text](url). The alternation is
  // ordered so the first matching group decides which branch to take.
  const tokenRegex = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      nodes.push(...splitNewlines(before, `${keyPrefix}-t${lastIndex}`));
    }

    if (match[1] !== undefined) {
      // **bold**
      nodes.push(
        React.createElement('strong', { key: `${keyPrefix}-b${match.index}` }, match[1])
      );
    } else if (match[2] !== undefined && match[3] !== undefined) {
      // [label](href)
      const href = match[3];
      const label = match[2];
      const isExternal = /^https?:\/\//i.test(href);
      nodes.push(
        React.createElement(
          'a',
          {
            key: `${keyPrefix}-a${match.index}`,
            href,
            className: 'text-ora-gold-dark underline underline-offset-2 hover:text-ora-charcoal',
            ...(isExternal
              ? { target: '_blank', rel: 'noopener noreferrer' }
              : {}),
          },
          label
        )
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(...splitNewlines(text.slice(lastIndex), `${keyPrefix}-t${lastIndex}`));
  }

  return nodes;
}

/** Splits text on single newlines, inserting <br /> elements between segments. */
function splitNewlines(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split('\n');
  const nodes: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      nodes.push(React.createElement('br', { key: `${keyPrefix}-br${i}` }));
    }
    if (part) {
      nodes.push(part);
    }
  });
  return nodes;
}

/**
 * Converts plain text with basic markdown into React elements.
 *
 * Supported syntax:
 * - `**text**` → <strong>text</strong>
 * - `\n\n` → paragraph breaks (<p> elements)
 * - `\n` → <br /> within a paragraph
 * - Lines starting with `- ` or `* ` → <ul> with <li> items
 * - Lines starting with `1. `, `2. `, etc. → <ol> with <li> items
 */
export function formatMessageContent(content: string): React.ReactNode {
  // Split on double newlines to get paragraph blocks
  const blocks = content.split(/\n\n+/);

  const elements: React.ReactNode[] = blocks.map((block, blockIdx) => {
    const lines = block.split('\n');

    // Check if all non-empty lines form an unordered list
    const nonEmptyLines = lines.filter((l) => l.trim() !== '');
    const isUnorderedList =
      nonEmptyLines.length > 0 &&
      nonEmptyLines.every((l) => /^[\-\*]\s/.test(l.trim()));

    if (isUnorderedList) {
      return React.createElement(
        'ul',
        { key: `block-${blockIdx}` },
        nonEmptyLines.map((line, li) =>
          React.createElement(
            'li',
            { key: `li-${blockIdx}-${li}` },
            ...parseInline(line.trim().replace(/^[\-\*]\s/, ''), `li-${blockIdx}-${li}`)
          )
        )
      );
    }

    // Check if all non-empty lines form an ordered list
    const isOrderedList =
      nonEmptyLines.length > 0 &&
      nonEmptyLines.every((l) => /^\d+\.\s/.test(l.trim()));

    if (isOrderedList) {
      return React.createElement(
        'ol',
        { key: `block-${blockIdx}` },
        nonEmptyLines.map((line, li) =>
          React.createElement(
            'li',
            { key: `li-${blockIdx}-${li}` },
            ...parseInline(line.trim().replace(/^\d+\.\s/, ''), `li-${blockIdx}-${li}`)
          )
        )
      );
    }

    // Regular paragraph
    return React.createElement(
      'p',
      { key: `block-${blockIdx}` },
      ...parseInline(block, `p-${blockIdx}`)
    );
  });

  return React.createElement(React.Fragment, null, ...elements);
}

// ── ResizeHandle sub-component ───────────────────────────────────────────────

interface ResizeHandleProps {
  direction: ResizeDirection;
  isRtl: boolean;
  onPointerDown: (e: React.PointerEvent, direction: ResizeDirection) => void;
}

function ResizeHandle({ direction, isRtl, onPointerDown }: ResizeHandleProps) {
  const getCursor = (): string => {
    if (direction === 'top') return 'ns-resize';
    if (direction === 'side') return 'ew-resize';
    // corner
    return isRtl ? 'nesw-resize' : 'nwse-resize';
  };

  const getStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'absolute',
      zIndex: 10,
      cursor: getCursor(),
      background: 'transparent',
      touchAction: 'none',
    };

    if (direction === 'top') {
      return {
        ...base,
        top: 0,
        left: 0,
        right: 0,
        height: '4px',
      };
    }

    if (direction === 'side') {
      return {
        ...base,
        top: 0,
        bottom: 0,
        width: '4px',
        ...(isRtl ? { right: 0 } : { left: 0 }),
      };
    }

    // corner: top-leading corner
    return {
      ...base,
      top: 0,
      width: '12px',
      height: '12px',
      ...(isRtl ? { right: 0 } : { left: 0 }),
    };
  };

  return (
    <div
      data-testid={`resize-handle-${direction}`}
      style={getStyle()}
      onPointerDown={(e) => onPointerDown(e, direction)}
    />
  );
}

// ── ScrollToBottomButton sub-component ───────────────────────────────────────

interface ScrollToBottomButtonProps {
  label: string;
  onClick: () => void;
}
function ScrollToBottomButton({ label, onClick }: ScrollToBottomButtonProps) {
  return (
    <button
      data-testid="scroll-to-bottom-button"
      aria-label={label}
      onClick={onClick}
      className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-ora-gold text-ora-white shadow-ora-lg hover:bg-ora-gold-dark transition-colors"
    >
      <ChevronDown className="h-4 w-4" />
    </button>
  );
}

// ── ThinkingSteps sub-component ──────────────────────────────────────────────
// Cycles through "Understanding…" → "Looking up…" → "Preparing…" while the
// assistant is generating a reply. Each step crossfades with framer-motion to
// give a sense of real progress instead of an opaque "Typing…" indicator.

interface ThinkingStepsProps {
  steps: readonly string[];
}

function ThinkingSteps({ steps }: ThinkingStepsProps) {
  const [stepIndex, setStepIndex] = React.useState(0);

  React.useEffect(() => {
    if (steps.length <= 1) return;
    // Advance steps but stop at the last one — the request usually completes
    // within ~3s, so progressing then "holding" feels natural.
    const id = window.setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, steps.length - 1));
    }, 1100);
    return () => window.clearInterval(id);
  }, [steps.length]);

  return (
    <div className="relative h-5 flex-1 overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.span
          key={stepIndex}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="absolute inset-0 flex items-center"
        >
          {steps[stepIndex]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

// ── Session storage helpers ──────────────────────────────────────────────────

const CONVERSATION_ID_KEY = 'ora-ai-conversation-id';

function getStoredConversationId(): string | null {
  try {
    return sessionStorage.getItem(CONVERSATION_ID_KEY);
  } catch {
    return null;
  }
}

function setStoredConversationId(id: string): void {
  try {
    sessionStorage.setItem(CONVERSATION_ID_KEY, id);
  } catch {
    // sessionStorage unavailable — silently ignore
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function ChatWidget({ locale }: ChatWidgetProps) {
  const strings = i18n[locale];
  const isRtl = locale === 'ar';

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);

  // New state for resize infrastructure
  const [panelSize, setPanelSize] = useState<{ width: number; height: number }>({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<'top' | 'left' | 'right' | 'corner' | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Refs for resize tracking
  const resizeStartRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    direction: ResizeDirection;
    pointerId: number;
    target: Element | null;
  } | null>(null);

  // Restore conversationId from sessionStorage on mount
  useEffect(() => {
    const stored = getStoredConversationId();
    if (stored) {
      setConversationId(stored);
    }
    setHasInitialized(true);
  }, []);

  // Initialize panelSize from persisted storage or defaults, clamped to viewport
  useEffect(() => {
    const persisted = loadPersistedSize();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (persisted) {
      setPanelSize(clampSize(persisted.width, persisted.height, vw, vh));
    } else {
      setPanelSize(clampSize(DEFAULT_WIDTH, DEFAULT_HEIGHT, vw, vh));
    }
  }, []);

  // Track mobile state via matchMedia
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };
    // Set initial value
    handleChange(mql);
    mql.addEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
    return () => {
      mql.removeEventListener('change', handleChange as (e: MediaQueryListEvent) => void);
    };
  }, []);

  // IntersectionObserver on sentinel to track isAtBottom
  useEffect(() => {
    if (!isOpen) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsAtBottom(entry.isIntersecting);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [isOpen]);

  // Add welcome message when first opened
  useEffect(() => {
    if (isOpen && messages.length === 0 && hasInitialized) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: strings.welcome,
          timestamp: new Date(),
        },
      ]);
    }
  }, [isOpen, messages.length, hasInitialized, strings.welcome]);

  // Scroll to bottom when messages change (only if user is at bottom)
  useEffect(() => {
    if (isAtBottom && sentinelRef.current && typeof sentinelRef.current.scrollIntoView === 'function') {
      sentinelRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isAtBottom]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Clear unread count when chat opens
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
    }
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // Reset textarea height back to single line after sending
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      const body: Record<string, string> = { message: text };
      if (conversationId) {
        body.conversationId = conversationId;
      }

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (res.ok && json.data) {
        const { message: responseText, conversationId: newConvId } = json.data;

        // Persist conversationId
        if (newConvId && newConvId !== conversationId) {
          setConversationId(newConvId);
          setStoredConversationId(newConvId);
        }

        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: responseText,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Increment unread if chat is minimized
        if (!isOpen) {
          setUnreadCount((prev) => prev + 1);
        }
      } else {
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content:
            locale === 'ar'
              ? 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.'
              : 'Sorry, something went wrong. Please try again.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch {
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content:
          locale === 'ar'
            ? 'عذراً، حدث خطأ في الاتصال. يرجى المحاولة مرة أخرى.'
            : 'Sorry, a connection error occurred. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      // Re-focus input so the user can keep typing without clicking back
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [inputValue, isLoading, conversationId, isOpen, locale]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      const textarea = e.target;
      // Reset height to auto to allow shrinking when text is deleted
      textarea.style.height = 'auto';
      // Set height to scrollHeight, capped at 96px (6rem / ~4 lines)
      textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
    },
    []
  );

  const handleScrollToBottom = useCallback(() => {
    if (sentinelRef.current) {
      sentinelRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  // ── Resize handlers ──────────────────────────────────────────────────────

  const getCursorForDirection = useCallback((direction: ResizeDirection): string => {
    if (direction === 'top') return 'ns-resize';
    if (direction === 'side') return 'ew-resize';
    return isRtl ? 'nesw-resize' : 'nwse-resize';
  }, [isRtl]);

  const handleResizePointerDown = useCallback((e: React.PointerEvent, direction: ResizeDirection) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    resizeStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: panelSize.width,
      startHeight: panelSize.height,
      direction,
      pointerId: e.pointerId,
      target,
    };

    setIsResizing(true);
    setResizeDirection(direction === 'side' ? (isRtl ? 'right' : 'left') : direction === 'top' ? 'top' : 'corner');

    // Apply cursor to body during resize
    document.body.style.cursor = getCursorForDirection(direction);
  }, [panelSize, isRtl, getCursorForDirection]);

  const handleResizePointerMove = useCallback((e: PointerEvent) => {
    const start = resizeStartRef.current;
    if (!start) return;

    const deltaX = e.clientX - start.startX;
    const deltaY = e.clientY - start.startY;

    const newSize = computeResizeDelta(
      start.direction,
      isRtl,
      deltaX,
      deltaY,
      start.startWidth,
      start.startHeight,
      window.innerWidth,
      window.innerHeight
    );

    setPanelSize(newSize);
  }, [isRtl]);

  const handleResizePointerUp = useCallback((e: PointerEvent) => {
    const start = resizeStartRef.current;
    if (!start) return;

    // Release pointer capture
    if (start.target) {
      try {
        (start.target as Element).releasePointerCapture(start.pointerId);
      } catch {
        // Pointer capture may already be released
      }
    }

    resizeStartRef.current = null;
    setIsResizing(false);
    setResizeDirection(null);

    // Clear cursor from body
    document.body.style.cursor = '';

    // Persist final size
    persistSize(panelSize);
  }, [panelSize]);

  // Attach document-level pointermove/pointerup during resize
  useEffect(() => {
    if (!isResizing) return;

    document.addEventListener('pointermove', handleResizePointerMove);
    document.addEventListener('pointerup', handleResizePointerUp);

    return () => {
      document.removeEventListener('pointermove', handleResizePointerMove);
      document.removeEventListener('pointerup', handleResizePointerUp);
      document.body.style.cursor = '';
    };
  }, [isResizing, handleResizePointerMove, handleResizePointerUp]);

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className={isMobile && isOpen ? 'fixed inset-0 z-50' : 'fixed bottom-6 z-50'}
      style={isMobile && isOpen ? undefined : (isRtl ? { left: '1.5rem' } : { right: '1.5rem' })}
    >
      {/* ── Chat Panel ── */}
      {isOpen && (
        <div
          data-testid="chat-panel"
          className={`flex flex-col bg-ora-white shadow-ora-lg border border-ora-sand${isMobile ? '' : ' mb-3'}`}
          style={isMobile ? {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)',
          } : {
            position: 'relative',
            width: `${panelSize.width}px`,
            height: `${panelSize.height}px`,
            maxWidth: 'calc(100vw - 2rem)',
            maxHeight: 'calc(100vh - 6rem)',
          }}
        >
          {/* Resize Handles (hidden on mobile) */}
          {!isMobile && (
            <>
              <ResizeHandle direction="top" isRtl={isRtl} onPointerDown={handleResizePointerDown} />
              <ResizeHandle direction="side" isRtl={isRtl} onPointerDown={handleResizePointerDown} />
              <ResizeHandle direction="corner" isRtl={isRtl} onPointerDown={handleResizePointerDown} />
            </>
          )}
          {/* Header */}
          <div className="flex items-center justify-between bg-ora-charcoal px-4 py-3">
            <h2 className="flex items-center gap-3 text-sm font-semibold text-ora-white">
              {/* ORA AI avatar — peeks slightly above the header bar */}
              <span
                aria-hidden
                className="relative -mt-3 -mb-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ora-charcoal-dark ring-2 ring-ora-gold shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
              >
                <svg
                  viewBox="0 0 196 72"
                  width={22}
                  height={9}
                  fill="currentColor"
                  className="text-ora-gold"
                  aria-hidden
                >
                  <path d="M157.107 1.55636L118.209 69.2891H196L157.107 1.55636ZM157.107 30.3405L171.682 55.7177H142.539L157.107 30.3405ZM129.175 16.1352H98.3209V69.2891H82.8629V2.56941H129.175V16.1352ZM35.8078 0C16.0659 0 0 16.1465 0 36C0 55.8535 16.0603 72 35.8078 72C55.5553 72 71.6156 55.8535 71.6156 36C71.6156 16.1465 55.5553 0 35.8078 0ZM35.8078 57.6589C24.1721 57.6589 14.7037 47.9415 14.7037 36C14.7037 24.0585 24.1721 14.3411 35.8078 14.3411C47.4435 14.3411 56.9119 24.0585 56.9119 36C56.9119 47.9415 47.4491 57.6589 35.8078 57.6589Z" />
                </svg>
              </span>
              {strings.title}
            </h2>
            <div className="flex items-center gap-1">
              {!isMobile && (
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label={strings.minimize}
                  data-testid="minimize-button"
                  className="text-ora-white/70 hover:text-ora-white transition-colors"
                >
                  <Minus className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={handleToggle}
                aria-label={strings.close}
                className="text-ora-white/70 hover:text-ora-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="relative flex-1 overflow-y-auto">
            <div className="px-4 py-3 space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded px-3 py-2 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-ora-gold text-ora-white'
                      : 'bg-ora-cream text-ora-charcoal ora-richtext'
                  }`}
                >
                  {msg.role === 'assistant' ? formatMessageContent(msg.content) : msg.content}
                </div>
              </div>
            ))}

            {/* Thinking indicator with cycling steps */}
            {isLoading && (
              <div className="flex justify-start" data-testid="typing-indicator">
                <div className="flex items-center gap-3 bg-ora-cream rounded px-3 py-2 text-sm text-ora-charcoal-light w-full max-w-[80%] sm:min-w-[18rem]">
                  <span className="text-ora-gold shrink-0"><OraAiIcon size={20} /></span>
                  <ThinkingSteps steps={strings.thinkingSteps} />
                </div>
              </div>
            )}

            <div ref={sentinelRef} data-testid="messages-sentinel" />
            </div>

            {/* Scroll to bottom button */}
            {!isAtBottom && (
              <ScrollToBottomButton
                label={strings.scrollToBottom}
                onClick={handleScrollToBottom}
              />
            )}
          </div>

          {/* Input */}
          <div className="border-t border-ora-sand px-3 py-2">
            <div className="flex items-center gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={strings.placeholder}
                disabled={isLoading}
                className="flex-1 bg-transparent px-2 py-1.5 text-sm text-ora-charcoal placeholder:text-ora-muted outline-none resize-none"
                style={{ maxHeight: '6rem', overflowY: 'auto' }}
                aria-label={strings.placeholder}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !inputValue.trim()}
                aria-label={strings.send}
                className="flex h-8 w-8 items-center justify-center rounded bg-ora-gold text-ora-white hover:bg-ora-gold-dark transition-colors disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating Button (hidden when panel is open) ── */}
      {!isOpen && (
      <button
        onClick={handleToggle}
        aria-label={strings.open}
        data-testid="chat-toggle"
        className="group relative flex flex-col items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ora-white rounded-full"
      >
        {/* Outer pulse ring — draws attention regardless of page bg */}
        <motion.span
          aria-hidden
          className="absolute rounded-full bg-ora-gold/40"
          style={{ width: 72, height: 72, top: 0, left: '50%', marginLeft: -36 }}
          initial={{ scale: 0.9, opacity: 0.55 }}
          animate={{ scale: [0.9, 1.45, 0.9], opacity: [0.55, 0, 0.55] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
        />

        {/* Branded bubble: dark fill + gold ring + soft shadow */}
        <motion.span
          aria-hidden
          className="relative flex h-18 w-18 items-center justify-center rounded-full bg-ora-charcoal-dark ring-2 ring-ora-gold shadow-[0_8px_24px_rgba(0,0,0,0.28),0_2px_6px_rgba(0,0,0,0.18)] group-hover:ring-ora-gold-light transition-colors"
          initial={{ scale: 0.97 }}
          animate={{ scale: [0.97, 1.02, 0.97] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          {/* ORA wordmark (extracted from public/logo.svg) */}
          <svg
            viewBox="0 0 196 72"
            width={42}
            height={16}
            fill="currentColor"
            className="text-ora-gold"
            aria-hidden
          >
            <path d="M157.107 1.55636L118.209 69.2891H196L157.107 1.55636ZM157.107 30.3405L171.682 55.7177H142.539L157.107 30.3405ZM129.175 16.1352H98.3209V69.2891H82.8629V2.56941H129.175V16.1352ZM35.8078 0C16.0659 0 0 16.1465 0 36C0 55.8535 16.0603 72 35.8078 72C55.5553 72 71.6156 55.8535 71.6156 36C71.6156 16.1465 55.5553 0 35.8078 0ZM35.8078 57.6589C24.1721 57.6589 14.7037 47.9415 14.7037 36C14.7037 24.0585 24.1721 14.3411 35.8078 14.3411C47.4435 14.3411 56.9119 24.0585 56.9119 36C56.9119 47.9415 47.4491 57.6589 35.8078 57.6589Z" />
          </svg>
          {/* "AI" caption inside the bubble, beneath the wordmark */}
          <span className="absolute bottom-2.5 text-[9px] font-bold tracking-[0.22em] text-ora-gold-light">
            AI
          </span>
        </motion.span>

        {/* External label — high contrast pill so it reads on any page bg */}
        <span className="mt-1.5 rounded-full bg-ora-charcoal-dark/90 px-2 py-0.5 text-[10px] font-semibold tracking-[0.2em] uppercase text-ora-white shadow-sm">
          ORA AI
        </span>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ora-error px-1 text-[10px] font-bold text-ora-white shadow-md"
            style={isRtl ? { left: '-0.5rem' } : { right: '-0.5rem' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      )}
    </div>
  );
}

export default ChatWidget;
