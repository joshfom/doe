'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { ArrowUp, Loader2, Send, Slash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceCallButton } from '@/components/voice/VoiceCallButton';
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  type SlashCommand,
} from '@/components/chat/slash-commands';

// ── Shared chat composer ──────────────────────────────────────────────────────
// One composer for every chat surface (Home feed twin + AI control room). It
// provides:
//   • an auto-growing textarea (1 line → up to MAX_HEIGHT, then scrolls)
//   • a "/" slash-command palette (shared SLASH_COMMANDS) with full keyboard
//     navigation (↑/↓ to move, Enter/Tab to pick, Esc to dismiss)
//   • Enter to send, Shift+Enter for a newline
// Styling is selected via `variant` so it matches each surface while keeping a
// single behaviour/implementation.

const MAX_HEIGHT = 200; // px — grows up to here, then the textarea scrolls.

export type ChatComposerVariant = 'hero' | 'docked' | 'panel';

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the text to send (explicit, not read from state). */
  onSubmit: (text: string) => void;
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
  variant?: ChatComposerVariant;
  /** Optional external ref to the textarea (e.g. for programmatic focus). */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Slash commands to expose; defaults to the shared SLASH_COMMANDS. */
  commands?: ReadonlyArray<SlashCommand>;
  autoFocus?: boolean;
  /** Show a voice-call button next to Send (opens the voice experience). */
  voice?: boolean;
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  sending = false,
  placeholder = 'Message…',
  variant = 'panel',
  inputRef,
  commands = SLASH_COMMANDS,
  autoFocus = false,
  voice = false,
}: ChatComposerProps) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = inputRef ?? innerRef;
  const [activeIdx, setActiveIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const matches = useMemo(
    () => filterSlashCommands(value, commands),
    [value, commands],
  );
  const menuVisible = matches.length > 0 && !dismissed;

  // Keep the active item in range as the filter narrows.
  useEffect(() => {
    setActiveIdx((i) => (i >= matches.length ? 0 : i));
  }, [matches.length]);

  // Auto-grow: reset to measure, then clamp to MAX_HEIGHT.
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [ref]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const handleChange = (v: string) => {
    if (dismissed) setDismissed(false);
    onChange(v);
  };

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onChange('');
    setDismissed(true);
    // Collapse the textarea back to a single row after sending.
    requestAnimationFrame(resize);
    onSubmit(trimmed);
  };

  const selectCommand = (cmd: SlashCommand) => {
    submit(cmd.message);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectCommand(matches[activeIdx] ?? matches[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(value);
    }
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(value);
  };

  // ── Variant styling ─────────────────────────────────────────────────────────
  const formClass = cn(
    'relative flex items-end gap-2',
    variant === 'hero' &&
      'rounded-2xl border border-ora-sand/70 bg-ora-white p-2 focus-within:ring-2 focus-within:ring-ora-gold/50',
    variant === 'docked' && 'border-t border-ora-sand/60 bg-ora-white p-3',
  );

  const fieldWrapClass =
    variant === 'panel'
      ? 'flex flex-1 items-end overflow-hidden rounded-2xl border border-ora-sand/70 bg-ora-cream-light/40 transition-colors focus-within:border-ora-gold focus-within:bg-ora-white'
      : 'flex-1';

  const textareaClass = cn(
    'w-full resize-none bg-transparent text-ora-charcoal placeholder:text-ora-muted focus:outline-none focus-visible:outline-none',
    variant === 'hero' && 'px-3 py-2 text-base',
    variant === 'docked' &&
      'rounded border border-ora-sand bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ora-gold/60',
    variant === 'panel' && 'border-0 px-3 py-2.5 text-sm leading-6',
  );

  return (
    <form onSubmit={onFormSubmit} className={formClass}>
      {/* Slash-command palette */}
      {menuVisible && (
        <div
          role="listbox"
          aria-label="Slash commands"
          className="absolute bottom-full left-0 z-50 mb-2 w-full max-w-md overflow-hidden rounded-xl border border-ora-sand/70 bg-ora-white shadow-lg"
        >
          <div className="flex items-center gap-1.5 border-b border-ora-sand/50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ora-muted">
            <Slash className="h-3 w-3 stroke-1" />
            Commands
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {matches.map((cmd, i) => {
              const active = i === activeIdx;
              return (
                <li key={cmd.command}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={(e) => {
                      // Prevent the textarea from losing focus before select.
                      e.preventDefault();
                      selectCommand(cmd);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                      active ? 'bg-ora-cream' : 'hover:bg-ora-cream-light',
                    )}
                  >
                    <span className="font-mono text-xs text-ora-gold-dark">
                      /{cmd.command}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ora-charcoal">
                        {cmd.label}
                      </span>
                      <span className="block truncate text-xs text-ora-muted">
                        {cmd.description}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={fieldWrapClass}>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          autoFocus={autoFocus}
          disabled={disabled}
          className={textareaClass}
          style={{ maxHeight: MAX_HEIGHT }}
        />
      </div>

      <SendButton variant={variant} sending={sending} disabled={disabled || value.trim() === ''} />
      {voice && <VoiceCallButton size={variant === 'hero' ? 'md' : 'sm'} />}
    </form>
  );
}

function SendButton({
  variant,
  sending,
  disabled,
}: {
  variant: ChatComposerVariant;
  sending: boolean;
  disabled: boolean;
}) {
  if (variant === 'hero') {
    return (
      <button
        type="submit"
        disabled={disabled || sending}
        aria-label="Send"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ora-charcoal text-white transition-all hover:bg-ora-charcoal/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sending ? (
          <Loader2 className="h-5 w-5 animate-spin stroke-2" />
        ) : (
          <ArrowUp className="h-5 w-5 stroke-2" />
        )}
      </button>
    );
  }
  if (variant === 'docked') {
    return (
      <button
        type="submit"
        disabled={disabled || sending}
        aria-label="Send"
        className="flex h-10 shrink-0 items-center gap-1.5 bg-ora-charcoal px-4 text-sm font-semibold text-white transition-all hover:bg-ora-charcoal/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
    );
  }
  // panel
  return (
    <button
      type="submit"
      disabled={disabled || sending}
      title={sending ? 'Working…' : 'Send (Enter)'}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ora-gold px-5 text-sm font-medium text-ora-white transition hover:bg-ora-gold-dark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2"
    >
      {sending ? (
        <Loader2 className="h-4 w-4 animate-spin stroke-1" />
      ) : (
        <Send className="h-4 w-4 stroke-1" />
      )}
      <span className="hidden sm:inline">{sending ? 'Working…' : 'Send'}</span>
    </button>
  );
}

export default ChatComposer;
