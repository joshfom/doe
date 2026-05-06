'use client';

/**
 * Full-width admin AI chat for ORA panel staff. Talks to /api/ai/admin/chat.
 *
 * UX:
 *  • Composer at the bottom, message stream above.
 *  • Suggested prompts above the composer for first-time users.
 *  • When the agent returns a `pendingAction`, render an inline confirmation
 *    card with Confirm / Cancel buttons. Confirm posts the token back; the
 *    response is appended as the next assistant message and a toast appears.
 *  • Lightweight in-page toast (no new dependency) for success / error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Send,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  BrainCircuit,
} from 'lucide-react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// ── Types mirror lib/cms/ai/admin-agent.ts ───────────────────────────────────

type PendingActionKind =
  | 'bulk_complete_bookings'
  | 'bulk_cancel_bookings'
  | 'bulk_close_tickets'
  | 'cancel_appointment'
  | 'reschedule_appointment'
  | 'change_ticket_status';

interface PendingActionPayload {
  token: string;
  summary: string;
  affectedCount: number;
  kind: PendingActionKind;
  preview?: string[];
}

interface AdminAgentResult {
  response: string;
  pendingAction?: PendingActionPayload;
  executed?: {
    kind: PendingActionKind;
    affected: number;
    detail?: Record<string, unknown>;
  };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pendingAction?: PendingActionPayload | null;
  /** When the user has confirmed/cancelled this pending action. */
  pendingResolved?: 'confirmed' | 'cancelled';
}

interface ToastState {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

// ── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'Overview', prompt: 'Give me an overview' },
  { label: 'Open tickets', prompt: 'List open tickets' },
  { label: 'Leads this week', prompt: 'How many leads this week?' },
  { label: 'Appointments today', prompt: 'Show appointments today' },
  { label: 'Help', prompt: 'help' },
];

// ── Utils ────────────────────────────────────────────────────────────────────

function genId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function destructiveKind(kind: PendingActionKind): boolean {
  return (
    kind === 'bulk_cancel_bookings' ||
    kind === 'bulk_close_tickets' ||
    kind === 'cancel_appointment' ||
    kind === 'change_ticket_status' ||
    kind === 'bulk_complete_bookings' ||
    kind === 'reschedule_appointment'
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AdminChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hi — I'm your platform copilot. Ask me for reports, look up records, or have me update bookings and tickets in bulk. Type \"help\" to see what I can do.",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const pushToast = useCallback((kind: ToastState['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const send = useCallback(
    async (rawMessage: string, confirmationToken?: string) => {
      const message = rawMessage.trim();
      if (!message && !confirmationToken) return;
      if (busy) return;
      setBusy(true);

      // For a normal message, append a user bubble. For a confirmation we
      // already mutated the source bubble — don't push a duplicate.
      if (!confirmationToken) {
        setMessages((prev) => [
          ...prev,
          { id: genId(), role: 'user', content: message },
        ]);
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/ai/admin/chat`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: message || '(confirm)',
            confirmationToken,
          }),
        });
        const json = (await res.json()) as
          | { data: AdminAgentResult }
          | { error: string; details?: unknown };

        if (!res.ok || !('data' in json)) {
          const errText =
            'error' in json ? json.error : `HTTP ${res.status}`;
          setMessages((prev) => [
            ...prev,
            {
              id: genId(),
              role: 'assistant',
              content: `Sorry — request failed: ${errText}`,
            },
          ]);
          pushToast('error', errText);
          return;
        }

        const data = json.data;
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: data.response,
            pendingAction: data.pendingAction ?? null,
          },
        ]);

        if (data.executed) {
          pushToast(
            'success',
            `${data.executed.kind.replace(/_/g, ' ')} — ${data.executed.affected} affected`,
          );
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Network error';
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: `Sorry — ${text}.`,
          },
        ]);
        pushToast('error', text);
      } finally {
        setBusy(false);
        if (!confirmationToken) setInput('');
        // Refocus composer for fluent typing
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [busy, pushToast],
  );

  const confirmPending = useCallback(
    async (msg: ChatMessage) => {
      if (!msg.pendingAction) return;
      // Mark this card as resolved immediately so the buttons don't double-fire
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, pendingResolved: 'confirmed' } : m,
        ),
      );
      await send('', msg.pendingAction.token);
    },
    [send],
  );

  const cancelPending = useCallback((msg: ChatMessage) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msg.id ? { ...m, pendingResolved: 'cancelled' } : m,
      ),
    );
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (input.trim()) void send(input);
    },
    [input, send],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.trim()) void send(input);
      }
    },
    [input, send],
  );

  const showSuggestions = useMemo(
    () => messages.filter((m) => m.role === 'user').length === 0,
    [messages],
  );

  return (
    <div className="flex h-[calc(100vh-1rem)] flex-col bg-ora-cream-light">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-ora-sand bg-ora-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ora-charcoal text-ora-white">
            <BrainCircuit className="h-5 w-5 stroke-1" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-ora-charcoal">
              Platform Copilot
            </h1>
            <p className="text-xs text-ora-muted">
              Reports, lookups, and bulk operations — destructive actions ask to
              confirm.
            </p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onConfirm={() => void confirmPending(m)}
              onCancel={() => cancelPending(m)}
              disabled={busy}
            />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-ora-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <footer className="border-t border-ora-sand bg-ora-white px-6 py-4">
        <div className="mx-auto max-w-4xl">
          {showSuggestions && (
            <div className="mb-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => void send(s.prompt)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 border border-ora-sand bg-ora-cream-light px-3 py-1.5 text-xs text-ora-charcoal hover:bg-ora-sand disabled:opacity-50"
                >
                  <Sparkles className="h-3 w-3" />
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask for a report or an action…  e.g. 'mark all bookings from this week as completed'"
              rows={2}
              className="flex-1 resize-none border border-ora-sand bg-ora-white px-3 py-2 text-sm text-ora-charcoal focus:border-ora-charcoal focus:outline-none"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex h-10 items-center gap-1.5 bg-ora-charcoal px-4 text-sm font-medium text-ora-white disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          </form>
        </div>
      </footer>

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 border px-4 py-2.5 text-sm shadow-lg ${
              t.kind === 'success'
                ? 'border-green-700 bg-green-50 text-green-900'
                : t.kind === 'error'
                  ? 'border-red-700 bg-red-50 text-red-900'
                  : 'border-ora-sand bg-ora-white text-ora-charcoal'
            }`}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : t.kind === 'error' ? (
              <AlertTriangle className="h-4 w-4" />
            ) : null}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onConfirm,
  onCancel,
  disabled,
}: {
  message: ChatMessage;
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap border px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'border-ora-charcoal bg-ora-charcoal text-ora-white'
            : 'border-ora-sand bg-ora-white text-ora-charcoal'
        }`}
      >
        <div>{message.content}</div>
        {message.pendingAction && !message.pendingResolved && (
          <PendingActionCard
            action={message.pendingAction}
            onConfirm={onConfirm}
            onCancel={onCancel}
            disabled={disabled}
          />
        )}
        {message.pendingResolved === 'cancelled' && (
          <div className="mt-2 text-xs italic text-ora-muted">
            Cancelled — no changes were made.
          </div>
        )}
      </div>
    </div>
  );
}

function PendingActionCard({
  action,
  onConfirm,
  onCancel,
  disabled,
}: {
  action: PendingActionPayload;
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const isDestructive = destructiveKind(action.kind);
  return (
    <div className="mt-3 border border-ora-sand bg-ora-cream-light p-3 text-ora-charcoal">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        <AlertTriangle className="h-3.5 w-3.5" />
        Confirm action
      </div>
      <div className="mt-1.5 text-sm font-medium">{action.summary}</div>
      <div className="mt-1 text-xs text-ora-muted">
        {action.affectedCount} record(s) will be affected.
      </div>
      {action.preview && action.preview.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-ora-muted">
          {action.preview.map((p, i) => (
            <li key={i}>· {p}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ora-white disabled:opacity-50 ${
            isDestructive ? 'bg-red-700 hover:bg-red-800' : 'bg-ora-charcoal'
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Confirm
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 border border-ora-sand bg-ora-white px-3 py-1.5 text-xs text-ora-charcoal hover:bg-ora-cream-light disabled:opacity-50"
        >
          <XCircle className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}
