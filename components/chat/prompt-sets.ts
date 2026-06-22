// ── Shared, role-aware prompt sets ───────────────────────────────────────────
//
// The single source of truth for BOTH the "/" slash-command palette and the
// Prompt_Helper sample questions every chat surface shows, plus the pure role
// resolver that scopes the executive (C-Level) prompts to the signed-in user.
//
// This module EXTENDS `slash-commands.ts` (it re-exports `SlashCommand`,
// `SLASH_COMMANDS`, and `filterSlashCommands` for back-compat) rather than
// replacing it. Everything here is pure data + pure functions: the prompts are
// only *display guidance*. The real authority is the server — a non-privileged
// user who hand-types an executive-style prompt is still denied at the audited
// dispatcher. The prompt set is guidance, not a security boundary.
//
// Design references: §Components #1 (shared prompt-sets module),
// Property 10 (role-aware prompt resolution), Property 11 (custom command sets).

import {
  SLASH_COMMANDS,
  filterSlashCommands,
  type SlashCommand,
} from "@/components/chat/slash-commands";

// Re-export the slash-command primitives so callers can depend on this one
// module for everything (back-compat — Requirement 5.3).
export { SLASH_COMMANDS, filterSlashCommands };
export type { SlashCommand };

// ── Types ─────────────────────────────────────────────────────────────────────

/** A clickable sample question for the Prompt_Helper popup. */
export interface SampleQuestion {
  /** Stable id (used as a React key). */
  id: string;
  /** Shown in the popup. */
  label: string;
  /** The text imported into the composer on click (fill, not send). */
  prompt: string;
}

/** A self-contained, role-tagged prompt set handed to a composer. */
export interface PromptSet {
  commands: ReadonlyArray<SlashCommand>;
  sampleQuestions: ReadonlyArray<SampleQuestion>;
}

/**
 * The capability scope a command/question maps to, used for role filtering.
 * Executive prompts are tagged `"executive"`; everything else `"general"`.
 */
export type PromptScope = "general" | "executive";

export interface ScopedSlashCommand extends SlashCommand {
  scope: PromptScope;
}

export interface ScopedSampleQuestion extends SampleQuestion {
  scope: PromptScope;
}

// ── Scope-tagged catalogs ─────────────────────────────────────────────────────

/**
 * The full slash-command catalog, each entry scope-tagged. The general set is
 * the existing shared `SLASH_COMMANDS` (tagged `"general"`); the executive set
 * names the C-Level data capabilities as pure prompt text (the twin decides
 * which audited tool to call) — Requirement 4.2.
 */
export const ALL_SLASH_COMMANDS: ReadonlyArray<ScopedSlashCommand> = [
  ...SLASH_COMMANDS.map(
    (c): ScopedSlashCommand => ({ ...c, scope: "general" }),
  ),
  {
    command: "allleads",
    label: "All leads",
    description: "Total leads across every source (incl. Lead Engine)",
    message: "How many leads do we have in total across every source?",
    scope: "executive",
  },
  {
    command: "leadsbyuser",
    label: "Leads by user",
    description: "Leads grouped by their owning rep",
    message: "Break down our leads by owning user.",
    scope: "executive",
  },
  {
    command: "userpipeline",
    label: "A user's pipeline",
    description: "One rep's pipeline by tier and stage",
    message: "Show me a specific rep's pipeline — for example, ",
    scope: "executive",
  },
  {
    command: "compareusers",
    label: "Compare two users",
    description: "Compare two reps' pipelines side by side",
    message: "Compare the pipelines of two reps — for example, ",
    scope: "executive",
  },
  {
    command: "usercount",
    label: "Team size",
    description: "How many users are on the platform",
    message: "How many users do we have on the platform?",
    scope: "executive",
  },
  {
    command: "salesforce",
    label: "Salesforce figures",
    description: "Live Salesforce period comparisons and pipeline",
    message: "Pull our live Salesforce figures and compare this period to last.",
    scope: "executive",
  },
];

/**
 * The full sample-question catalog for the Prompt_Helper, each scope-tagged.
 * General questions mirror the everyday twin asks; executive questions name the
 * C-Level data capabilities (Requirement 4.2).
 */
export const ALL_SAMPLE_QUESTIONS: ReadonlyArray<ScopedSampleQuestion> = [
  {
    id: "q-overview",
    label: "Today's overview",
    prompt: "Give me an overview of today.",
    scope: "general",
  },
  {
    id: "q-leads",
    label: "Latest leads",
    prompt: "Check my latest leads.",
    scope: "general",
  },
  {
    id: "q-pipeline",
    label: "Pipeline summary",
    prompt: "Summarize my pipeline.",
    scope: "general",
  },
  {
    id: "q-report",
    label: "Daily report",
    prompt: "Draft my daily report.",
    scope: "general",
  },
  {
    id: "q-all-leads",
    label: "All leads",
    prompt: "How many leads do we have in total across every source?",
    scope: "executive",
  },
  {
    id: "q-leads-by-user",
    label: "Leads by user",
    prompt: "Break down our leads by owning user.",
    scope: "executive",
  },
  {
    id: "q-user-pipeline",
    label: "A user's pipeline",
    prompt: "Show me a specific rep's pipeline — for example, ",
    scope: "executive",
  },
  {
    id: "q-compare-users",
    label: "Compare two users",
    prompt: "Compare the pipelines of two reps — for example, ",
    scope: "executive",
  },
  {
    id: "q-user-count",
    label: "Team size",
    prompt: "How many users do we have on the platform?",
    scope: "executive",
  },
  {
    id: "q-salesforce",
    label: "Salesforce figures",
    prompt: "Pull our live Salesforce figures and compare this period to last.",
    scope: "executive",
  },
];

// ── Pure role resolver ────────────────────────────────────────────────────────

/**
 * Whether a session is C-Level. Mirrors the analytics page's
 * `hasAnalyticsAccess()` signal exactly: super_admin role, OR a permission of
 * `*:*` / `home:*` / `analytics:read` (also accepting `analytics:*`). Pure and
 * deterministic over the supplied roles/permissions.
 */
export function isCLevel(roles: string[], permissions: string[]): boolean {
  return (
    roles.includes("super_admin") ||
    permissions.includes("*:*") ||
    permissions.includes("home:*") ||
    permissions.includes("analytics:read") ||
    permissions.includes("analytics:*")
  );
}

/**
 * Resolve the display prompt set for a signed-in session. C-Level →
 * general + executive prompts; any non-C-Level session → general only; a
 * null/unresolvable session → the default non-privileged (general) set
 * (Requirement 4.1, 4.3, 4.5, 4.6). Never surfaces an executive prompt to a
 * non-C-Level or absent session.
 */
export function resolvePromptSet(
  session: { roles?: string[]; permissions?: string[] } | null,
): PromptSet {
  const roles = session?.roles ?? [];
  const permissions = session?.permissions ?? [];
  const cLevel = session != null && isCLevel(roles, permissions);
  const allowed = (scope: PromptScope): boolean =>
    scope === "general" || cLevel;

  return {
    commands: ALL_SLASH_COMMANDS.filter((c) => allowed(c.scope)).map(
      ({ scope: _scope, ...cmd }) => cmd,
    ),
    sampleQuestions: ALL_SAMPLE_QUESTIONS.filter((q) => allowed(q.scope)).map(
      ({ scope: _scope, ...q }) => q,
    ),
  };
}

/**
 * The default non-privileged prompt set (general only), used when a composer is
 * rendered without an explicit set and no session is available.
 */
export const DEFAULT_PROMPT_SET: PromptSet = resolvePromptSet(null);

// ── Command-contract guard ────────────────────────────────────────────────────

/**
 * The contract a caller-supplied {@link SlashCommand} must satisfy so the
 * composer's fill-not-send, filtering, and keyboard-navigation model keeps
 * working over it (Requirement 5.4, 5.5):
 *
 *  - `command` is a non-empty token with NO whitespace and NO leading slash
 *    (the palette prepends the `/` and filters on a whitespace-free query — a
 *    spaced or slashed token could never match or could break filtering);
 *  - `label` is a non-empty string (the option needs an accessible name);
 *  - `message` is a non-empty string (there must be prompt text to fill).
 *
 * A command failing this guard is dropped by {@link sanitizeCommands}; the
 * remaining commands retain the standard interaction model.
 */
export function isValidSlashCommand(cmd: unknown): cmd is SlashCommand {
  if (cmd == null || typeof cmd !== "object") return false;
  const c = cmd as Record<string, unknown>;
  const okString = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  if (!okString(c.command)) return false;
  if (/\s/.test(c.command as string)) return false;
  if ((c.command as string).startsWith("/")) return false;
  if (!okString(c.label)) return false;
  if (!okString(c.message)) return false;
  // `description` is optional in spirit but typed as required; tolerate missing.
  return true;
}

/**
 * Drop every caller-supplied command that fails {@link isValidSlashCommand},
 * keeping the valid remainder in order (Requirement 5.4, 5.5). Pure.
 */
export function sanitizeCommands(
  commands: ReadonlyArray<SlashCommand>,
): SlashCommand[] {
  return commands.filter((c) => isValidSlashCommand(c));
}
