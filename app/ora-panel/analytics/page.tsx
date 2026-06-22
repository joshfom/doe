'use client';

// ── AI Analytics — executive decision-support surface (C-level) ──────────────
//
// A text-first analytics partner for leadership: ask for comparisons, current
// figures, and trends; the agent narrates SQL-grounded numbers and frames
// options. It deliberately advises rather than decides — it leans toward a
// direction but always defers the call to the executive. Turns run through the
// existing admin agent (`POST /api/ai/admin/chat`), so figures come from the
// same audited, SQL-computed tools the reports use (never model-invented).
//
// On top of the chat it adds one capability: email the on-screen summary to the
// signed-in executive (`POST /api/ai/analytics/email-summary`). A voice button
// (staff mode) offers the same hands-free demo as the rest of the panel, behind
// a short prototype notice.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Sparkles,
  Mail,
  Loader2,
  ShieldAlert,
  BrainCircuit,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { resolvePromptSet } from '@/components/chat/prompt-sets';
import { VoiceCallButton } from '@/components/voice/VoiceCallButton';
import { ToolResultCards } from '@/app/ora-panel/_home/ToolCards';
import { PageHeaderSkeleton } from '@/components/ui/panel-skeletons';
import type { SessionData } from '@/lib/types/session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

const VOICE_ANALYTICS_NOTICE =
  'Quick heads-up — this voice analytics partner is an early prototype with a short training window, so it may have a few rough edges. ' +
  'It\u2019s a demo of brainstorming with data hands-free: ask me to compare, explain a number, or show a trend, and I\u2019ll talk you through the options. ' +
  'I\u2019ll lean toward what the data favours, but the call is always yours — and you can interrupt me anytime.';

/** C-level / executive gate — mirrors the analytics permission Marketing uses. */
function hasAnalyticsAccess(session: SessionData): boolean {
  const roles = session.roles ?? [];
  const permissions = session.permissions ?? [];
  return (
    roles.includes('super_admin') ||
    permissions.includes('*:*') ||
    permissions.includes('analytics:read') ||
    permissions.includes('analytics:*')
  );
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolResults?: Array<{ toolName: string; result: unknown }> | null;
}

interface AdminAgentResult {
  response: string;
  toolResults?: Array<{ toolName: string; result: unknown }>;
  sessionId?: string | null;
}

interface ToastState {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    "I\u2019m your analytics partner. Ask me to compare periods, explain a figure, or show a trend \u2014 I\u2019ll pull the numbers and lay out your options. I\u2019ll lean toward what the data favours, but I\u2019m here to help you decide faster, not to decide for you.",
};

// While a turn runs (a single request that returns only when the agent is done),
// cycle through phase messages so the wait reads as visible progress rather than
// a dead spinner. Advances on a timer and holds on the final line.
const PROGRESS_STEPS: readonly string[] = [
  'Working on it — this can take a few seconds…',
  'Checking your live CRM and pipeline data…',
  'Crunching the period comparisons…',
  'Compiling the results…',
  'Almost there — finishing up…',
];

function genId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function AnalyticsPage() {
  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionData | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [progressStep, setProgressStep] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const pushToast = useCallback((kind: ToastState['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Not authenticated');
        const json = await res.json();
        if (!json?.data?.userId) throw new Error('Not authenticated');
        return json.data as SessionData;
      })
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        if (!hasAnalyticsAccess(data)) setUnauthorized(true);
        setAuthLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setUnauthorized(true);
        setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // Drive the phased progress copy while a turn is in flight.
  useEffect(() => {
    if (!busy) {
      setProgressStep(0);
      return;
    }
    setProgressStep(0);
    const id = setInterval(() => {
      setProgressStep((i) => Math.min(i + 1, PROGRESS_STEPS.length - 1));
    }, 3500);
    return () => clearInterval(id);
  }, [busy]);

  // The latest assistant answer (skipping the static welcome) is what "Email me
  // this" sends; the most recent user question becomes the email heading.
  // The role-aware prompt set (general + executive for C-Level) sourced from
  // the single shared definition module. Drives the composer's fill-not-send
  // slash menu and Prompt_Helper; executive prompts never surface to a
  // non-C-Level session (resolved server-side authority still applies).
  const promptSet = useMemo(() => resolvePromptSet(session), [session]);

  const { lastSummary, lastQuestion } = useMemo(() => {
    let summary = '';
    let question = '';
    for (const m of messages) {
      if (m.role === 'assistant' && m.id !== 'welcome') summary = m.content;
      if (m.role === 'user') question = m.content;
    }
    return { lastSummary: summary, lastQuestion: question };
  }, [messages]);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busy) return;
      setBusy(true);
      setMessages((prev) => [...prev, { id: genId(), role: 'user', content: message }]);
      try {
        const res = await fetch(`${API_BASE_URL}/api/ai/admin/chat`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, sessionId: sessionId ?? undefined }),
        });
        const json = (await res.json()) as { data: AdminAgentResult } | { error: string };
        if (!res.ok || !('data' in json)) {
          const errText = 'error' in json ? json.error : `HTTP ${res.status}`;
          setMessages((prev) => [
            ...prev,
            { id: genId(), role: 'assistant', content: `Sorry — ${errText}` },
          ]);
          pushToast('error', errText);
          return;
        }
        const data = json.data;
        if (data.sessionId && data.sessionId !== sessionId) setSessionId(data.sessionId);
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: data.response,
            toolResults: data.toolResults ?? null,
          },
        ]);
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Network error';
        setMessages((prev) => [
          ...prev,
          { id: genId(), role: 'assistant', content: `Sorry — ${text}.` },
        ]);
        pushToast('error', text);
      } finally {
        setBusy(false);
        setInput('');
      }
    },
    [busy, sessionId, pushToast],
  );

  const emailSummary = useCallback(async () => {
    if (!lastSummary || emailing) return;
    setEmailing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/analytics/email-summary`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: lastSummary, title: lastQuestion || undefined }),
      });
      const json = (await res.json()) as
        | { data: { sent: boolean; to: string } }
        | { error: string };
      if (!res.ok || !('data' in json)) {
        pushToast('error', 'error' in json ? json.error : `HTTP ${res.status}`);
        return;
      }
      pushToast('success', `Summary emailed to ${json.data.to}`);
    } catch {
      pushToast('error', 'Could not send the summary email.');
    } finally {
      setEmailing(false);
    }
  }, [lastSummary, lastQuestion, emailing, pushToast]);

  if (authLoading) return <PageHeaderSkeleton />;

  if (unauthorized) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-ora-sand/60 bg-ora-white p-8 text-center">
        <ShieldAlert className="h-8 w-8 text-ora-error" />
        <p className="text-sm text-ora-charcoal">
          AI Analytics is available to leadership (C-level) accounts only.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-5xl flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ora-charcoal">
            <BarChart3 className="h-6 w-6 stroke-[1.5] text-ora-gold-dark" />
            AI Analytics
          </h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Brainstorm with your data — comparisons, current figures, and trends, framed as options.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void emailSummary()}
            disabled={!lastSummary || emailing}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-ora-sand/70 bg-ora-white px-4 text-sm font-medium text-ora-charcoal transition-colors hover:border-ora-gold hover:bg-ora-cream-light disabled:cursor-not-allowed disabled:opacity-50"
            title={lastSummary ? 'Email this summary to yourself' : 'Ask something first'}
          >
            {emailing ? (
              <Loader2 className="h-4 w-4 animate-spin stroke-[1.5]" />
            ) : (
              <Mail className="h-4 w-4 stroke-[1.5] text-ora-gold-dark" />
            )}
            Email me this
          </button>
          <VoiceCallButton
            mode="staff"
            page="ora-panel-analytics"
            label="Ask voice agent"
            title="Voice analytics"
            introNotice={VOICE_ANALYTICS_NOTICE}
          />
        </div>
      </div>

      {/* Advisory framing */}
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-ora-gold/30 bg-ora-cream-light/50 px-4 py-2.5 text-xs text-ora-charcoal-light">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 stroke-[1.5] text-ora-gold-dark" />
        <span>
          Figures are computed from your data (not invented). I&apos;ll lean toward what the numbers
          favour and flag what&apos;s worth a closer look — but the decision is always yours.
        </span>
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-ora-sand/50 bg-ora-cream-light/35 px-4 py-5 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 px-1 text-xs text-ora-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span aria-live="polite">{PROGRESS_STEPS[progressStep]}</span>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="pt-3">
        <ChatComposer
          variant="panel"
          value={input}
          onChange={setInput}
          onSubmit={(text) => void send(text)}
          sending={busy}
          disabled={busy}
          voice
          voiceMode="staff"
          promptHelper
          commands={promptSet.commands}
          sampleQuestions={promptSet.sampleQuestions}
          placeholder="Ask to compare, explain a figure, or show a trend…"
        />
      </div>

      {/* Toasts */}
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
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex w-full items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ora-sand/70 bg-ora-cream text-ora-charcoal">
          <BrainCircuit className="h-4 w-4 stroke-1" />
        </div>
      )}
      <div className={`flex w-full max-w-3xl flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${
            isUser ? 'text-ora-muted' : 'text-ora-gold-dark'
          }`}
        >
          <span>{isUser ? 'You' : 'Analytics partner'}</span>
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
        </div>
      </div>
    </div>
  );
}
