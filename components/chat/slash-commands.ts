// ── Shared slash commands ─────────────────────────────────────────────────────
// A single source of truth for the "/" command palette used by every chat
// surface (the Home feed twin and the AI control room). Typing "/" in any
// composer opens this list; selecting a command sends its `message` as a turn.
//
// Keep these grounded in what the agents can actually do. Both surfaces share
// the list so the shortcuts behave identically everywhere.

export interface SlashCommand {
  /** Token typed after the slash, e.g. "overview" → "/overview". */
  command: string;
  /** Short display label shown in the palette. */
  label: string;
  /** One-line description of what the command does. */
  description: string;
  /** The message sent to the agent when the command is chosen. */
  message: string;
}

export const SLASH_COMMANDS: ReadonlyArray<SlashCommand> = [
  {
    command: 'overview',
    label: 'Overview',
    description: 'Snapshot of everything happening today',
    message: 'Give me an overview of today',
  },
  {
    command: 'stack',
    label: "Today's stack",
    description: 'What needs my attention right now',
    message: "What's on my stack today?",
  },
  {
    command: 'tickets',
    label: 'My tickets',
    description: 'How many tickets I have today',
    message: 'How many tickets do I have today?',
  },
  {
    command: 'priority',
    label: 'Top priority',
    description: 'My single most important ticket',
    message: "What's my most important ticket?",
  },
  {
    command: 'appointments',
    label: 'Appointments',
    description: "Today's appointments",
    message: 'Do I have appointments today?',
  },
  {
    command: 'leads',
    label: 'Latest leads',
    description: 'Recent inbound leads across sources',
    message: 'Check my latest leads',
  },
  {
    command: 'pipeline',
    label: 'Pipeline',
    description: 'Summarize the current pipeline',
    message: 'Summarize my pipeline',
  },
  {
    command: 'report',
    label: 'Daily report',
    description: 'Draft my daily report',
    message: 'Draft my daily report',
  },
  {
    command: 'aitoday',
    label: 'AI did today',
    description: 'What the AI handled today',
    message: 'What did the AI do today?',
  },
  {
    command: 'help',
    label: 'Help',
    description: 'See everything I can do',
    message: 'help',
  },
];

/**
 * Filter commands for the palette based on the current composer text. Returns
 * an empty array when the slash palette should not be shown (no leading slash,
 * or the user has already typed a space — i.e. moved on to free text).
 */
export function filterSlashCommands(
  value: string,
  commands: ReadonlyArray<SlashCommand> = SLASH_COMMANDS,
): SlashCommand[] {
  if (!value.startsWith('/')) return [];
  const rest = value.slice(1);
  // Once a space is typed the "/" was free text, not a command.
  if (/\s/.test(rest)) return [];
  const q = rest.toLowerCase();
  return commands.filter(
    (c) =>
      c.command.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q),
  );
}
