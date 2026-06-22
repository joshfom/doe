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
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  BrainCircuit,
  Shield,
  MessageSquare,
  Plus,
  Trash2,
} from 'lucide-react';
import { SidebarTooltip } from '@/components/ui/sidebar-tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { ToolResultCards } from '@/app/ora-panel/_home/ToolCards';

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
  /** Structured tool results when the turn was served by the Mastra twin. */
  toolResults?: Array<{ toolName: string; result: unknown }>;
  /** When persistence is on, the server tells us which session this turn was recorded under. */
  sessionId?: string | null;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pendingAction?: PendingActionPayload | null;
  executed?: AdminAgentResult['executed'] | null;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pendingAction?: PendingActionPayload | null;
  /** When the user has confirmed/cancelled this pending action. */
  pendingResolved?: 'confirmed' | 'cancelled';
  /** Structured tool results rendered as typed cards (twin-served turns). */
  toolResults?: Array<{ toolName: string; result: unknown }> | null;
}

interface ToastState {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

// ── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string; say: string }> = [
  { label: 'Overview', prompt: 'Give me an overview', say: 'Try: "Give me an overview of today"' },
  { label: 'My tickets today', prompt: 'How many tickets do I have today?', say: 'Try: "How many tickets do I have today?"' },
  { label: 'My top priority', prompt: "What's my most important ticket?", say: 'Try: "What\'s my most important ticket?"' },
  { label: 'My appointments', prompt: 'Do I have appointments today?', say: 'Try: "Do I have appointments today?"' },
  { label: 'AI did today', prompt: 'What did the AI do today?', say: 'Try: "What did the AI do today?"' },
  { label: 'Help', prompt: 'help', say: 'Try: "help" to see everything I can do' },
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

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    "Hi \u2014 I'm your ORA AI Companion. Ask me for reports, look up records, or have me update bookings and tickets in bulk. Type \"help\" to see what I can do.",
};

export default function AdminChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [quickActionsOpen, setQuickActionsOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Pull the user's saved chat sessions for the sidebar.
  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/admin/sessions`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { data: ChatSession[] };
      setSessions(json.data ?? []);
    } catch {
      // sidebar is best-effort; chat still works without it.
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/ai/admin/sessions`, {
          credentials: 'include',
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { data: ChatSession[] };
        if (!cancelled) setSessions(json.data ?? []);
      } catch {
        // sidebar is best-effort
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (!confirmationToken) setQuickActionsOpen(false);

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
            sessionId: sessionId ?? undefined,
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
        if (data.sessionId && data.sessionId !== sessionId) {
          setSessionId(data.sessionId);
        }
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: data.response,
            pendingAction: data.pendingAction ?? null,
            toolResults: data.toolResults ?? null,
          },
        ]);

        if (data.executed) {
          pushToast(
            'success',
            `${data.executed.kind.replace(/_/g, ' ')} \u2014 ${data.executed.affected} affected`,
          );
        }
        // Refresh the sidebar so the title / ordering reflects this turn.
        void refreshSessions();
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
    [busy, pushToast, refreshSessions, sessionId],
  );

  // ── Session lifecycle helpers ─────────────────────────────────────────
  const startNewChat = useCallback(() => {
    if (busy) return;
    setSessionId(null);
    setMessages([WELCOME_MESSAGE]);
    setQuickActionsOpen(true);
    setInput('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [busy]);

  const loadSession = useCallback(
    async (id: string) => {
      if (busy || id === sessionId) return;
      setBusy(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/ai/admin/sessions/${id}/messages`,
          { credentials: 'include' },
        );
        if (!res.ok) {
          pushToast('error', 'Could not load that conversation.');
          return;
        }
        const json = (await res.json()) as { data: PersistedMessage[] };
        const loaded: ChatMessage[] = (json.data ?? []).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          // Don't re-render an unresolved confirmation card from a past
          // session — those tokens have long since expired.
          pendingAction: null,
          pendingResolved: m.pendingAction ? 'cancelled' : undefined,
        }));
        setSessionId(id);
        setMessages(loaded.length > 0 ? loaded : [WELCOME_MESSAGE]);
        setQuickActionsOpen(loaded.length === 0);
      } catch {
        pushToast('error', 'Network error loading conversation.');
      } finally {
        setBusy(false);
      }
    },
    [busy, sessionId, pushToast],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this conversation? This cannot be undone.')) {
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/ai/admin/sessions/${id}`,
          { method: 'DELETE', credentials: 'include' },
        );
        if (!res.ok) {
          pushToast('error', 'Could not delete that conversation.');
          return;
        }
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (id === sessionId) {
          startNewChat();
        }
      } catch {
        pushToast('error', 'Network error deleting conversation.');
      }
    },
    [sessionId, pushToast, startNewChat],
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

  const showSuggestions = useMemo(
    () => messages.filter((m) => m.role === 'user').length === 0,
    [messages],
  );

  const sessionTurns = useMemo(
    () => Math.max(messages.length - 1, 0),
    [messages],
  );

  const pendingCount = useMemo(
    () =>
      messages.reduce(
        (count, message) =>
          count + (message.pendingAction && !message.pendingResolved ? 1 : 0),
        0,
      ),
    [messages],
  );

  return (
    <div className="flex min-h-[72vh] gap-3 lg:h-[calc(100vh-4rem)]">
      <ConversationSidebar
        sessions={sessions}
        loading={sessionsLoading}
        activeId={sessionId}
        onSelect={loadSession}
        onNew={startNewChat}
        onDelete={deleteSession}
        disabled={busy}
      />
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-ora-sand/50 bg-ora-white">
      <header className="border-b border-ora-sand/50 bg-ora-white px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-ora-charcoal">
              Platform Copilot
            </h1>
            <span className="hidden text-[10px] font-bold uppercase tracking-[0.18em] text-ora-gold-dark sm:inline">
              ORA AI control room
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <SidebarTooltip
              label={quickActionsOpen ? 'Hide quick actions' : 'Show quick actions'}
              show
              side="bottom"
            >
              <button
                type="button"
                onClick={() => setQuickActionsOpen((prev) => !prev)}
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2 ${
                  quickActionsOpen
                    ? 'border-ora-gold bg-ora-cream text-ora-gold-dark'
                    : 'border-ora-sand/60 bg-ora-white text-ora-charcoal-light hover:bg-ora-cream-light'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 stroke-1" />
              </button>
            </SidebarTooltip>

            <SidebarTooltip
              label={busy ? 'Working on a request' : 'Live operational context'}
              show
              side="bottom"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-ora-sand/60 bg-ora-white text-ora-charcoal-light">
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin stroke-1 text-ora-gold-dark" />
                ) : (
                  <BrainCircuit className="h-3.5 w-3.5 stroke-1 text-ora-gold-dark" />
                )}
              </div>
            </SidebarTooltip>

            <SidebarTooltip
              label={
                pendingCount > 0
                  ? `${pendingCount} action${pendingCount > 1 ? 's' : ''} awaiting confirmation`
                  : 'No pending confirmations'
              }
              show
              side="bottom"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-ora-sand/60 bg-ora-white text-ora-charcoal-light">
                <Shield className="h-3.5 w-3.5 stroke-1 text-ora-gold-dark" />
              </div>
            </SidebarTooltip>

            <SidebarTooltip
              label={
                sessionTurns === 0
                  ? 'New session'
                  : sessionTurns === 1
                    ? '1 turn in this session'
                    : `${sessionTurns} turns in this session`
              }
              show
              side="bottom"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-ora-sand/60 bg-ora-white text-ora-charcoal-light">
                <MessageSquare className="h-3.5 w-3.5 stroke-1 text-ora-gold-dark" />
              </div>
            </SidebarTooltip>
          </div>
        </div>
      </header>

      {quickActionsOpen && showSuggestions && (
        <div className="border-b border-ora-sand/60 bg-ora-cream-light/40 px-4 py-2 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ora-muted">
              Agent capabilities
            </span>
            {SUGGESTIONS.map((suggestion) => (
              <SuggestionButton
                key={suggestion.label}
                label={suggestion.label}
                prompt={suggestion.prompt}
                say={suggestion.say}
                onSelect={(prompt) => void send(prompt)}
                disabled={busy}
              />
            ))}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-ora-cream-light/35 px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onConfirm={() => void confirmPending(m)}
              onCancel={() => cancelPending(m)}
              disabled={busy}
            />
          ))}
          {busy && <ThinkingBubble />}
        </div>
      </div>

      <footer className="border-t border-ora-sand/50 bg-ora-white px-3 py-3 sm:px-4">
        <div className="mx-auto w-full max-w-5xl">
          <ChatComposer
            variant="panel"
            value={input}
            onChange={setInput}
            onSubmit={(text) => void send(text)}
            sending={busy}
            disabled={busy}
            inputRef={inputRef}
            voice
            voiceMode="staff"
            placeholder="Ask for a report, lookup, or bulk action…  (type / for commands)"
          />
        </div>
      </footer>

      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
              t.kind === 'success'
                ? 'border-ora-success/20 bg-[rgba(92,138,107,0.1)] text-ora-charcoal'
                : t.kind === 'error'
                  ? 'border-ora-error/20 bg-[rgba(184,92,92,0.1)] text-ora-charcoal'
                  : 'border-ora-sand/70 bg-ora-white text-ora-charcoal'
            }`}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 stroke-1 text-ora-success" />
            ) : t.kind === 'error' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 stroke-1 text-ora-error" />
            ) : (
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 stroke-1 text-ora-gold-dark" />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ConversationSidebar({
  sessions,
  loading,
  activeId,
  onSelect,
  onNew,
  onDelete,
  disabled,
}: {
  sessions: ChatSession[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <aside className="hidden w-80 shrink-0 flex-col rounded-xl border border-ora-sand/50 bg-ora-white md:flex">
      <div className="border-b border-ora-sand/60 px-3 py-3">
        <button
          type="button"
          onClick={onNew}
          disabled={disabled}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ora-charcoal text-xs font-medium uppercase tracking-[0.18em] text-ora-white transition hover:bg-[#1f1f1f] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2"
        >
          <Plus className="h-3.5 w-3.5 stroke-1" />
          New chat
        </button>
        <p className="mt-2 px-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-ora-muted">
          Recent conversations
        </p>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="space-y-1.5 px-2 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-4 text-xs text-ora-muted">
            No saved conversations yet — your next chat will appear here.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => {
              const active = s.id === activeId;
              return (
                <li key={s.id} className="px-2">
                  <div
                    className={`group flex items-center gap-1 rounded-xl border px-2.5 py-2 text-xs transition ${
                      active
                        ? 'border-ora-gold/40 bg-ora-cream text-ora-charcoal'
                        : 'border-transparent text-ora-charcoal-light hover:border-ora-sand/60 hover:bg-ora-cream-light'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      disabled={disabled}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-50"
                      title={s.title}
                    >
                      <MessageSquare className="h-3 w-3 shrink-0 stroke-1" />
                      <span className="truncate">{s.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(s.id);
                      }}
                      className="opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                      aria-label="Delete conversation"
                    >
                      <Trash2 className="h-3 w-3 stroke-1 text-ora-muted hover:text-ora-error" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function SuggestionButton({
  label,
  prompt,
  say,
  onSelect,
  disabled,
}: {
  label: string;
  prompt: string;
  say: string;
  onSelect: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <SidebarTooltip label={say} show side="top">
      <button
        type="button"
        onClick={() => onSelect(prompt)}
        disabled={disabled}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-ora-sand/70 bg-ora-white px-4 text-xs text-ora-charcoal transition hover:border-ora-gold/40 hover:bg-ora-cream-light disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2"
      >
        <Sparkles className="h-3.5 w-3.5 stroke-1 text-ora-gold-dark" />
        {label}
      </button>
    </SidebarTooltip>
  );
}

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

  const avatar = (
    <div
      className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${
        isUser
          ? 'border-ora-gold/30 bg-ora-gold text-ora-white'
          : 'border-ora-sand/70 bg-ora-cream text-ora-charcoal'
      }`}
    >
      {isUser ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
          You
        </span>
      ) : (
        <BrainCircuit className="h-4 w-4 stroke-1" />
      )}
    </div>
  );

  return (
    <div className={`flex w-full items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && avatar}
      <div
        className={`flex w-full max-w-3xl flex-col gap-2 ${
          isUser ? 'items-end' : 'items-start'
        }`}
      >
        <div
          className={`flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${
            isUser ? 'text-ora-muted' : 'text-ora-gold-dark'
          }`}
        >
          <span>{isUser ? 'Operator' : 'ORA Copilot'}</span>
          {!isUser && <span className="text-ora-muted">Staff thread</span>}
        </div>
        <div
          className={`max-w-full whitespace-pre-wrap rounded-2xl border px-5 py-4 text-sm leading-7 ${
            isUser
              ? 'ml-auto w-full max-w-2xl rounded-br-md border-ora-charcoal bg-ora-charcoal text-ora-white'
              : 'w-full rounded-tl-md border-ora-sand/60 bg-ora-white text-ora-charcoal'
          }`}
        >
          <div className="wrap-break-word">{message.content}</div>
          {!isUser && message.toolResults && message.toolResults.length > 0 && (
            <ToolResultCards toolResults={message.toolResults} />
          )}
          {message.pendingAction && !message.pendingResolved && (
            <PendingActionCard
              action={message.pendingAction}
              onConfirm={onConfirm}
              onCancel={onCancel}
              disabled={disabled}
            />
          )}
          {message.pendingResolved === 'confirmed' && (
            <div
              className={`mt-4 inline-flex items-center gap-2 border px-3 py-2 text-xs ${
                isUser
                  ? 'border-white/15 bg-white/10 text-white/80'
                  : 'border-ora-sand/60 bg-ora-cream-light text-ora-charcoal-light'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 stroke-1" />
              Confirmed — the request has been sent.
            </div>
          )}
          {message.pendingResolved === 'cancelled' && (
            <div
              className={`mt-4 inline-flex items-center gap-2 border px-3 py-2 text-xs ${
                isUser
                  ? 'border-white/15 bg-white/10 text-white/80'
                  : 'border-ora-sand/60 bg-ora-cream-light text-ora-charcoal-light'
              }`}
            >
              <XCircle className="h-3.5 w-3.5 stroke-1" />
              Cancelled — no changes were made.
            </div>
          )}
        </div>
      </div>
      {isUser && avatar}
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
    <div className="mt-4 rounded-2xl border border-ora-sand/60 bg-ora-cream-light p-4 text-ora-charcoal">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-ora-sand/60 bg-ora-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-ora-charcoal-light">
            <AlertTriangle
              className={`h-3.5 w-3.5 stroke-1 ${
                isDestructive ? 'text-ora-error' : 'text-ora-gold-dark'
              }`}
            />
            Confirm action
          </div>
          <div className="mt-3 text-sm font-medium leading-6">{action.summary}</div>
          <div className="mt-1 text-xs text-ora-muted">
            {action.affectedCount} record(s) will be affected.
          </div>
        </div>
        <div
          className={`flex min-w-12 items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold ${
            isDestructive
              ? 'border-ora-error/20 bg-ora-error/10 text-ora-error'
              : 'border-ora-gold/20 bg-ora-gold/10 text-ora-gold-dark'
          }`}
        >
          {action.affectedCount}
        </div>
      </div>

      {action.preview && action.preview.length > 0 && (
        <div className="mt-3 rounded-xl border border-ora-sand/60 bg-ora-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ora-muted">
            Preview
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-ora-charcoal-light">
            {action.preview.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className={`inline-flex h-10 items-center gap-2 rounded-full px-5 text-xs font-medium text-ora-white transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2 ${
            isDestructive
              ? 'bg-ora-error hover:bg-[#a74f4f]'
              : 'bg-ora-charcoal hover:bg-[#1f1f1f]'
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5 stroke-1" />
          Confirm
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-ora-sand/70 bg-ora-white px-5 text-xs text-ora-charcoal transition hover:bg-ora-cream-light disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2"
        >
          <XCircle className="h-3.5 w-3.5 stroke-1" />
          Cancel
        </button>
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ora-sand/70 bg-ora-cream text-ora-charcoal">
        <BrainCircuit className="h-4 w-4 stroke-1" />
      </div>
      <div className="w-full max-w-3xl">
        <div className="mb-2 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-ora-gold-dark">
          <span>ORA Copilot</span>
          <span className="text-ora-muted">Processing</span>
        </div>
        <div className="rounded-2xl rounded-tl-md border border-ora-sand/60 bg-ora-white px-5 py-4 text-sm text-ora-charcoal">
          <div className="flex items-center gap-3 text-sm text-ora-charcoal-light">
            <Loader2 className="h-4 w-4 animate-spin stroke-1 text-ora-gold-dark" />
            Working through that request…
          </div>
        </div>
      </div>
    </div>
  );
}
