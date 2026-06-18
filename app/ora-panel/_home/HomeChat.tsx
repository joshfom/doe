'use client';

// ── Home_Chat region — chat-first digital-twin landing (S5, task 12; Part B) ─
//
// The conversational entry to platform management, redesigned as a polished
// AI-chat home. Each turn is POSTed to `POST /api/home/chat`, which runs it
// through the Home_Agent on the Mastra_Runtime (Req 1.3 — the surface routes
// every turn through the agent).
//
// Two presentations driven by one `started` flag:
//   • HERO (no active conversation yet): a centered two-line greeting
//     ("Hey {firstName} 👋" / "What can I help with?"), a twin subtitle, a row
//     of suggested prompt cards, and a prominent centered composer (ChatGPT
//     style). Clicking a prompt card sends that prompt to the chat.
//   • CONVERSATION (once the user sends a turn): messages stacked, composer
//     pinned at the bottom. `started` never flips back, so a failed turn keeps
//     us in conversation view with the error + retained input.
//
// Retain-input-on-failure (Req 1.7): the route answers an unprocessable turn
// with `{ ok:false, retainInput:true, reason, message }` (a budget stop or an
// unreachable agent). On such a response — or on a thrown/network error — the
// composer KEEPS the user's submitted text and shows a NON-BLOCKING error, so
// the user can retry without retyping. The conversation stays open.
//
// Live updates (Req 13.1): the chat subscribes to the shared Home_Surface
// stream and surfaces the agent's own trace activity (`agent.*` events) as a
// transient "working…" indicator, updating only this region.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Layers,
  GitBranch,
  FileText,
  UserPlus,
  BrainCircuit,
  type LucideIcon,
} from 'lucide-react';
import { useHomeEvents, type HomeEvent } from './HomeRealtime';
import { ToolResultCards, type ToolCardData } from './ToolCards';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { useDemoPersona } from '../_components/demo-persona';
import type { ReactNode } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// ── Tiny, safe markdown renderer (no deps, no dangerouslySetInnerHTML) ────────
// Handles the shapes the twin emits: paragraphs, ordered/unordered lists,
// **bold**, and `inline code`. Renders to React elements so nothing is injected
// as raw HTML.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{tok.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded bg-ora-sand/40 px-1 py-0.5 text-[0.85em]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = (k: string) => {
    if (para.length) {
      blocks.push(
        <p key={`p${k}`} className="mb-2 last:mb-0">
          {renderInline(para.join(' '), `p${k}`)}
        </p>,
      );
      para = [];
    }
  };
  const flushList = (k: string) => {
    if (list) {
      const { ordered, items } = list;
      const inner = items.map((it, i) => (
        <li key={i}>{renderInline(it, `l${k}-${i}`)}</li>
      ));
      blocks.push(
        ordered ? (
          <ol key={`l${k}`} className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
            {inner}
          </ol>
        ) : (
          <ul key={`l${k}`} className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
            {inner}
          </ul>
        ),
      );
      list = null;
    }
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (heading) {
      flushPara(`${idx}`);
      flushList(`${idx}`);
      blocks.push(
        <p
          key={`h${idx}`}
          className="mb-1 mt-2 font-semibold text-ora-charcoal first:mt-0"
        >
          {renderInline(heading[2], `h${idx}`)}
        </p>,
      );
    } else if (ol) {
      flushPara(`${idx}`);
      if (!list || !list.ordered) {
        flushList(`${idx}`);
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]);
    } else if (ul) {
      flushPara(`${idx}`);
      if (!list || list.ordered) {
        flushList(`${idx}`);
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
    } else if (line.trim() === '') {
      flushPara(`${idx}`);
      flushList(`${idx}`);
    } else {
      flushList(`${idx}`);
      para.push(line);
    }
  });
  flushPara('end');
  flushList('end');

  return <div className="text-sm leading-relaxed">{blocks}</div>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolResults?: ToolCardData[];
}

type ChatResponse =
  | { ok: true; response: string; modelTier: string; toolResults?: ToolCardData[] }
  | {
      ok: false;
      retainInput: true;
      reason: 'budget_exceeded' | 'agent_unreachable' | 'invalid_input';
      message: string;
    };

interface SuggestedPrompt {
  label: string;
  prompt: string;
  icon: LucideIcon;
}

// Prompts grounded in what the Home_Agent can actually do today.
const DEFAULT_PROMPTS: SuggestedPrompt[] = [
  { label: "What's on my stack today?", prompt: "What's on my stack today?", icon: Layers },
  { label: 'Summarize my pipeline', prompt: 'Summarize my pipeline', icon: GitBranch },
  { label: 'Draft my daily report', prompt: 'Draft my daily report', icon: FileText },
  { label: 'Check my latest leads', prompt: 'Check my latest leads', icon: UserPlus },
];

let messageSeq = 0;
function nextId(): string {
  messageSeq += 1;
  return `m${Date.now()}_${messageSeq}`;
}

export interface HomeChatProps {
  /** First name for the hero greeting; falls back to a generic greeting. */
  firstName?: string;
  /** Suggested prompt cards shown in the hero (defaults to the agent's skills). */
  prompts?: SuggestedPrompt[];
}

// ── Message bubble (mirrors the /ai control-room MessageBubble layout) ────────
// Avatar + role label + a rounded, bordered bubble, so the feed twin and the
// /ai Platform Copilot read as the same chat surface.

function FeedAvatar({ isUser }: { isUser: boolean }) {
  return (
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
}

function FeedBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const hasText = isUser || message.content.trim().length > 0;

  return (
    <div className={`flex w-full items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <FeedAvatar isUser={false} />}
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
          <span>{isUser ? 'You' : 'DOE Twin'}</span>
          {!isUser && <span className="text-ora-muted">Your twin</span>}
        </div>
        {hasText && (
          <div
            dir="auto"
            className={`max-w-full rounded-2xl border px-5 py-4 text-sm leading-7 ${
              isUser
                ? 'ml-auto w-full max-w-2xl whitespace-pre-wrap rounded-br-md border-ora-charcoal bg-ora-charcoal text-white'
                : 'w-full rounded-tl-md border-ora-sand/60 bg-ora-white text-ora-charcoal'
            }`}
          >
            {isUser ? (
              <div className="wrap-break-word">{message.content}</div>
            ) : (
              <Markdown text={message.content} />
            )}
          </div>
        )}
        {!isUser && message.toolResults && message.toolResults.length > 0 && (
          <div className="w-full">
            <ToolResultCards toolResults={message.toolResults} />
          </div>
        )}
      </div>
      {isUser && <FeedAvatar isUser />}
    </div>
  );
}

export function HomeChat({ firstName, prompts = DEFAULT_PROMPTS }: HomeChatProps) {
  const { persona } = useDemoPersona();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentActive, setAgentActive] = useState(false);
  // Once the user sends a turn we transition to the conversation view and never
  // return to the hero, even if that first turn fails (input is retained).
  const [started, setStarted] = useState(false);
  const mounted = useRef(true);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Auto-scroll the transcript as it grows.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  // Live updates: surface the agent's own activity without touching the
  // Briefing region (Req 13.1). `agent.run.finished` clears the indicator.
  const onEvent = useCallback((event: HomeEvent) => {
    if (event.type === 'agent.run.started' || event.type === 'agent.step') {
      setAgentActive(true);
    } else if (
      event.type === 'agent.run.finished' ||
      event.type === 'agent.budget.exceeded'
    ) {
      setAgentActive(false);
    }
  }, []);
  useHomeEvents(onEvent);

  const submitMessage = useCallback(
    async (rawText: string) => {
      const message = rawText.trim();
      if (!message || sending) return;

      // Transition to the conversation view on the first turn (Part B).
      setStarted(true);
      setSending(true);
      setError(null);
      // Optimistic: clear the composer immediately on send. On failure we
      // restore the text (retain-input, Req 1.7) so nothing is lost.
      setInput('');

      // Optimistically show the user's turn; build the history to send.
      const userMsg: ChatMessage = { id: nextId(), role: 'user', content: message };
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [...prev, userMsg]);

      const restoreInput = () => {
        // Retain the submitted input so the user can retry (Req 1.7).
        if (mounted.current) setInput(message);
      };

      try {
        const res = await fetch(`${API_BASE_URL}/api/home/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message, history, persona }),
        });

        if (!res.ok) {
          // Transport-level failure → treat as unreachable, retain input.
          throw new Error('chat request failed');
        }

        const json = (await res.json()) as { data?: ChatResponse } | null;
        const data = json?.data;
        if (!mounted.current) return;

        if (data && data.ok) {
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'assistant',
              content: data.response,
              toolResults: data.toolResults,
            },
          ]);
        } else {
          // Roll back the optimistic user turn, retain the input (Req 1.7).
          setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
          restoreInput();
          setError(
            data?.message ??
              'Your message could not be processed. Your message was kept.'
          );
        }
      } catch {
        if (!mounted.current) return;
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
        restoreInput();
        setError(
          'The home assistant could not be reached. Your message was kept.'
        );
      } finally {
        if (mounted.current) setSending(false);
      }
    },
    [sending, messages, persona]
  );

  // Shared composer used by both the hero and the conversation view.
  const composer = (variant: 'hero' | 'docked') => (
    <ChatComposer
      variant={variant}
      value={input}
      onChange={setInput}
      onSubmit={(text) => void submitMessage(text)}
      sending={sending}
      disabled={sending}
      voice
      placeholder="Message your twin…  (type / for commands)"
    />
  );

  // ── HERO: centered greeting + prompt cards + composer ──────────────────────
  if (!started) {
    const greetingName = firstName?.trim() ? firstName.trim() : 'there';
    return (
      <section
        aria-label="Home chat"
        className="mx-auto flex min-h-[80vh] w-full max-w-3xl flex-col items-center justify-center px-4 py-12"
      >
        <h1 className="text-center text-5xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
          <span className="block text-ora-charcoal">Hey {greetingName} 👋</span>
          <span className="block bg-gradient-to-r from-ora-charcoal via-ora-gold to-ora-charcoal bg-clip-text text-transparent">
            What can I help with?
          </span>
        </h1>
        <p className="mt-5 max-w-xl text-center text-base text-ora-charcoal-light">
          I&apos;m your DOE twin — here to work through today&apos;s stack, leads, and
          reports with you.
        </p>

        <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          {prompts.map(({ label, prompt, icon: Icon }) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void submitMessage(prompt)}
              disabled={sending}
              className="group flex items-center gap-3 rounded-xl border border-ora-sand/70 bg-ora-white px-4 py-3.5 text-left text-sm text-ora-charcoal transition-colors hover:border-ora-gold/60 hover:bg-ora-cream-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon className="h-5 w-5 shrink-0 stroke-[1.5] text-ora-gold" />
              <span className="font-medium">{label}</span>
            </button>
          ))}
        </div>

        <div className="mt-8 w-full max-w-2xl">{composer('hero')}</div>

        {error && (
          <div
            role="alert"
            className="mt-4 w-full max-w-2xl rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600"
          >
            {error}
          </div>
        )}
      </section>
    );
  }

  // ── CONVERSATION: stacked messages + docked composer ───────────────────────
  return (
    <section
      aria-label="Home chat"
      className="mx-auto flex h-[calc(100vh-7rem)] w-full max-w-5xl flex-col"
    >
      <header className="border-b border-ora-sand/60 px-4 py-3">
        <h2 className="text-sm font-semibold text-ora-charcoal">Your DOE twin</h2>
        <p className="mt-0.5 text-xs text-ora-charcoal-light">
          Manage the platform by conversation
        </p>
      </header>

      <div ref={logRef} className="flex-1 space-y-6 overflow-y-auto px-4 py-6">
        {messages.map((m) => (
          <FeedBubble key={m.id} message={m} />
        ))}
        {agentActive && (
          <div className="flex w-full items-start justify-start gap-3" role="status">
            <FeedAvatar isUser={false} />
            <div className="flex w-full max-w-3xl flex-col gap-2">
              <div className="flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-ora-gold-dark">
                <span>DOE Twin</span>
                <span className="text-ora-muted">Your twin</span>
              </div>
              <div className="w-full rounded-2xl rounded-tl-md border border-ora-sand/60 bg-ora-white px-5 py-4 text-sm text-ora-muted">
                Working…
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="border-t border-ora-sand/60 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {composer('docked')}
    </section>
  );
}

export default HomeChat;
