/**
 * Agentic Reporting & C-Level Twin (S4) — Twin_Persona & Persona_Store
 * (Design §Components #4 "Twin_Persona & Persona_Store").
 *
 * A Twin_Persona is the per-user narration profile that shapes the
 * Reporting_Agent's narration tone, narration depth, and default Report_Scope —
 * and ONLY the narration; it never alters a reported figure (Requirement 8.2,
 * 8.3). The Persona_Store is NOT a new store: it is the S1 Agent_Memory
 * (`lib/cms/agents/memory.ts`) keyed to the `user` Memory_Entity
 * (`resourceId = user:{userId}`, `scope: "resource"`), so the S1
 * memory-isolation guarantee gives persona isolation for free — a read returns
 * only the requesting user's persona, never another user's (Requirement 8.6,
 * 3.5). This module adds no table and no migration; it composes the existing
 * memory store through `buildMemoryKey`.
 *
 * Three operations (Design §Components #4):
 *   - `readPersona`   — the stored persona, or a role-derived default when none
 *     exists (Requirement 8.4); a read failure or a read exceeding 2s also
 *     falls back to the role default and records an error (Requirement 8.5).
 *   - `createPersona` — associate EXACTLY ONE persona per user; a second
 *     submission for a user that already has one retains the existing
 *     association and returns an `already_exists` error (Requirement 8.1).
 *   - `shapeNarration` — apply tone/depth to a narration draft, leaving every
 *     reported figure identical to the Metrics_Pipeline value (Requirement 8.3).
 *
 * [container-only] The Agent_Memory this module reads/writes runs on the
 * container/worker tier only, never on Next.js serverless; importing the pure
 * helpers (`defaultPersonaForRoles`, `shapeNarration`) opens no connection — the
 * Agent_Memory is constructed lazily on first store access.
 *
 * Design references: §Components #4, §Data Models (`TwinPersona`),
 * §Correctness Properties (Property 10, Property 11).
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6.
 */

import { z } from "zod";

import type { PipelineMetrics } from "../../metrics/pipeline";
import { buildMemoryKey, getAgentMemory } from "../memory";
import {
  EXEC_SCOPE_PERMISSION,
  REP_SCOPE_PERMISSION,
  type ReportScope,
} from "./scope";

// ── Twin_Persona (Design §Data Models) ────────────────────────────────────────

/** A narration tone the persona applies to a shaped response (Req 8.2). */
export type PersonaTone = "strategic" | "operational" | "concise";

/** A narration depth the persona applies to a shaped response (Req 8.2). */
export type PersonaDepth = "summary" | "detailed";

/**
 * The per-user narration profile persisted in the Persona_Store
 * (Agent_Memory[user]).
 *
 *   - `tone`/`depth`   shape only the prose of a response (Req 8.2, 8.3).
 *   - `defaultScope`   shapes the DEFAULT Report_Scope a request resolves to
 *     when it supplies none; it NEVER widens what RBAC permits — scope
 *     resolution still clamps to the role (Requirement 3.1).
 *   - `writtenBy`      the agent identity that wrote the record (S1 Req 4.6).
 */
export interface TwinPersona {
  userId: string;
  tone: PersonaTone;
  depth: PersonaDepth;
  defaultScope: ReportScope;
  writtenBy: string;
}

// ── Persona persistence schema (validated on read; never trusts stored bytes) ─

const reportScopeSchema = z.object({
  scope: z.enum(["exec", "rep"]),
  period: z.string(),
  repId: z.string().optional(),
});

/**
 * The persisted persona shape. A stored value is validated against this schema
 * on read; a value that fails validation is treated as an unreadable persona
 * (it falls back to the role default with an error, Req 8.5) rather than being
 * trusted blindly.
 */
export const twinPersonaSchema = z.object({
  userId: z.string().min(1),
  tone: z.enum(["strategic", "operational", "concise"]),
  depth: z.enum(["summary", "detailed"]),
  defaultScope: reportScopeSchema,
  writtenBy: z.string().min(1),
});

// ── Persona_Store seam (Agent_Memory[user], `scope: "resource"`) ──────────────

/**
 * The minimal read/write seam the persona functions need from the Persona_Store.
 * Both operations are keyed by the `user` Memory_Entity resource key
 * (`user:{userId}`) built with `buildMemoryKey`, so the S1 resource-scoped
 * isolation guarantee applies (Requirement 8.6). A `read` returns the serialised
 * persona string previously written, or `null`/empty when none exists.
 *
 * Injectable so the singleton (Property 11), shaping (Property 10), and
 * read-failure fallback (Req 8.5) behaviours can be exercised without a live
 * database; in production it defaults to the Agent_Memory working-memory store.
 */
export interface PersonaStore {
  read(resourceId: string): Promise<string | null>;
  write(resourceId: string, value: string): Promise<void>;
}

/**
 * The per-user thread anchor for the resource-scoped working-memory record.
 * With `scope: "resource"` the persona is keyed by `resourceId` regardless of
 * thread; the thread id is supplied only to satisfy the Memory API and is
 * derived deterministically from the same resource key.
 */
const PERSONA_THREAD_PREFIX = "persona";

let cachedDefaultStore: PersonaStore | undefined;

/**
 * The default Persona_Store: the S1 Agent_Memory working memory, resource-scoped
 * to the `user` Memory_Entity. Constructed lazily (and memoised) so importing
 * this module never opens a database connection — only the first store access
 * does, and only on the container/worker tier.
 */
function defaultPersonaStore(): PersonaStore {
  if (cachedDefaultStore) return cachedDefaultStore;
  const memory = getAgentMemory();
  cachedDefaultStore = {
    async read(resourceId) {
      return memory.getWorkingMemory({
        resourceId,
        threadId: `${PERSONA_THREAD_PREFIX}:${resourceId}`,
      });
    },
    async write(resourceId, value) {
      await memory.updateWorkingMemory({
        resourceId,
        threadId: `${PERSONA_THREAD_PREFIX}:${resourceId}`,
        workingMemory: value,
      });
    },
  };
  return cachedDefaultStore;
}

/** The single resource key (`user:{userId}`) for a user's persona record. */
function personaResourceId(userId: string): string {
  const key = buildMemoryKey({ kind: "user", id: userId });
  // `user` always maps to a resourceId (never a threadId) — see buildMemoryKey.
  return key.resourceId as string;
}

// ── Role-derived default persona (Requirement 8.4, 8.5) ───────────────────────

/** The agent identity stamped on a default persona (it was not user-authored). */
export const DEFAULT_PERSONA_WRITER = "agent:reporting-twin";

/** The default period label, matching `resolveReportScope`/`queryPipelineMetrics`. */
const DEFAULT_PERIOD = "all-time";

/**
 * Role/permission tokens (case-insensitive) that mark a user as exec-level for
 * the purpose of the DEFAULT persona. This decides only the default tone/depth
 * and default scope; it never grants access — RBAC and `resolveReportScope`
 * remain the sole authority on what a user may read (Requirement 3.1, 16.4).
 */
const EXEC_ROLE_HINTS: readonly string[] = [
  EXEC_SCOPE_PERMISSION,
  "exec",
  "executive",
  "c-level",
  "c_level",
  "admin",
];

function isExecRole(roles: readonly string[]): boolean {
  return roles.some((role) => {
    const token = role.trim().toLowerCase();
    return EXEC_ROLE_HINTS.some((hint) => hint.toLowerCase() === token);
  });
}

/**
 * Derive the default Twin_Persona from the user's RBAC role(s) (Requirement 8.4,
 * 8.5). An exec-level role defaults to a strategic, summary persona over the
 * org-wide (`exec`) scope; any other role (including a rep-level role, which
 * holds `report:scope:rep`) defaults to an operational, detailed persona over
 * its own rep scope. The default rep scope omits `repId` — scope resolution
 * binds it to the user's own `repId` at request time (Requirement 3.3), so the
 * default never widens RBAC.
 *
 * Pure: no I/O, no store access.
 */
export function defaultPersonaForRoles(
  userId: string,
  roles: readonly string[],
): TwinPersona {
  if (isExecRole(roles)) {
    return {
      userId,
      tone: "strategic",
      depth: "summary",
      defaultScope: { scope: "exec", period: DEFAULT_PERIOD },
      writtenBy: DEFAULT_PERSONA_WRITER,
    };
  }
  return {
    userId,
    tone: "operational",
    depth: "detailed",
    defaultScope: { scope: "rep", period: DEFAULT_PERIOD },
    writtenBy: DEFAULT_PERSONA_WRITER,
  };
}

// ── readPersona (Requirement 8.4, 8.5, 8.6) ───────────────────────────────────

/** The default Persona_Store read budget (Requirement 8.5): 2 seconds. */
export const PERSONA_READ_TIMEOUT_MS = 2000;

/**
 * The outcome of reading a user's persona.
 *   - `persona` — the stored persona, or the role-derived default.
 *   - `source`  — `"stored"` when read from the Persona_Store; `"default"` when
 *     no persona existed or the read failed/timed out.
 *   - `error`   — set only on a read failure or timeout (Req 8.5): an indication
 *     that the Twin_Persona could not be read. The agent still produces a
 *     response using the default persona.
 */
export interface ReadPersonaResult {
  persona: TwinPersona;
  source: "stored" | "default";
  error?: string;
}

/** Options for `readPersona`; `store` is injectable for testing. */
export interface ReadPersonaOptions {
  /** Read budget before falling back to the default (Req 8.5). Default 2000ms. */
  timeoutMs?: number;
  /** Persona_Store override; defaults to the Agent_Memory working-memory store. */
  store?: PersonaStore;
}

/** Reject after `ms` so a slow Persona_Store read falls back to the default (Req 8.5). */
function timeoutAfter(ms: number): { promise: Promise<never>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(
      () => reject(new Error(`persona read exceeded ${ms}ms`)),
      ms,
    );
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * Read the requesting user's Twin_Persona, or fall back to a role-derived
 * default (Requirement 8.4, 8.5, 8.6).
 *
 * Behaviour:
 *   - No stored persona → the role default, `source: "default"`, no error
 *     (Requirement 8.4).
 *   - A stored, valid persona → that persona, `source: "stored"` (Requirement 8.6
 *     — the resource-scoped store returns only this user's record).
 *   - A read failure, a read exceeding `timeoutMs` (default 2s), or a stored
 *     value that fails validation → the role default, `source: "default"`, with
 *     an `error` indicating the persona could not be read (Requirement 8.5).
 *
 * Never throws: a Persona_Store failure is always converted into the default
 * fallback so the agent can still produce a response.
 */
export async function readPersona(
  userId: string,
  roles: readonly string[],
  opts: ReadPersonaOptions = {},
): Promise<ReadPersonaResult> {
  const fallback = defaultPersonaForRoles(userId, roles);
  const store = opts.store ?? defaultPersonaStore();
  const timeoutMs = opts.timeoutMs ?? PERSONA_READ_TIMEOUT_MS;
  const resourceId = personaResourceId(userId);

  const timeout = timeoutAfter(timeoutMs);
  let raw: string | null;
  try {
    raw = await Promise.race([store.read(resourceId), timeout.promise]);
  } catch (err) {
    return {
      persona: fallback,
      source: "default",
      error: `Twin_Persona could not be read: ${errorMessage(err)}`,
    };
  } finally {
    timeout.cancel();
  }

  // No persona stored for this user — apply the role default (Req 8.4).
  if (raw === null || raw.trim().length === 0) {
    return { persona: fallback, source: "default" };
  }

  const parsed = parsePersona(raw);
  if (!parsed) {
    return {
      persona: fallback,
      source: "default",
      error: "Twin_Persona could not be read: stored persona is malformed",
    };
  }
  return { persona: parsed, source: "stored" };
}

function parsePersona(raw: string): TwinPersona | null {
  try {
    const result = twinPersonaSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── createPersona (Requirement 8.1) ───────────────────────────────────────────

/** Options for `createPersona`; `store` is injectable for testing. */
export interface CreatePersonaOptions {
  store?: PersonaStore;
}

/**
 * The outcome of associating a persona with a user.
 *   - `{ ok: true }`                       — the persona was associated.
 *   - `{ ok: false; error: "already_exists" }` — the user already had a persona;
 *     the existing association is retained and the submission is rejected
 *     (Requirement 8.1).
 */
export type CreatePersonaResult =
  | { ok: true }
  | { ok: false; error: "already_exists" };

/**
 * Associate EXACTLY ONE Twin_Persona with a user (Requirement 8.1).
 *
 * If the user already has a persona, the existing association is retained and an
 * `already_exists` error is returned — a second submission never overwrites the
 * first. Otherwise the persona is validated and persisted to the Persona_Store
 * keyed to that user's `user` Memory_Entity.
 *
 * @throws if `p` fails persona validation (a caller bug, not a runtime state).
 */
export async function createPersona(
  p: TwinPersona,
  opts: CreatePersonaOptions = {},
): Promise<CreatePersonaResult> {
  const persona = twinPersonaSchema.parse(p);
  const store = opts.store ?? defaultPersonaStore();
  const resourceId = personaResourceId(persona.userId);

  const existing = await store.read(resourceId);
  if (existing !== null && existing.trim().length > 0) {
    // Retain the existing association; reject the second submission (Req 8.1).
    return { ok: false, error: "already_exists" };
  }

  await store.write(resourceId, JSON.stringify(persona));
  return { ok: true };
}

// ── shapeNarration (Requirement 8.2, 8.3) ─────────────────────────────────────

/**
 * Tone framing prepended to a narration draft. Pure prose — it contains no
 * figures, so it cannot alter a reported figure.
 */
const TONE_LEAD_IN: Record<PersonaTone, string> = {
  strategic: "Strategic read:",
  operational: "Operational detail:",
  concise: "In brief:",
};

/**
 * Apply a persona to a narration draft, shaping ONLY the prose and leaving every
 * reported figure identical to the Metrics_Pipeline value (Requirement 8.2,
 * 8.3).
 *
 * The figure-safety guarantee is structural: the draft body — which carries the
 * figures the agent already narrated from `figures` — is included VERBATIM. The
 * persona only adds framing around it (a tone lead-in, and for a `detailed`
 * depth a closing prompt to dig deeper), so no numeric token in the draft is
 * ever edited, rounded, or recomputed. `figures` is accepted to make the
 * figure-preserving contract explicit at the call site and available to callers
 * that assert it; it is never mutated.
 *
 * Pure: no I/O, no store access, no arithmetic on figures.
 */
export function shapeNarration(
  persona: TwinPersona,
  _figures: PipelineMetrics,
  draft: string,
): string {
  const leadIn = TONE_LEAD_IN[persona.tone];
  const body = draft.trim();
  const shaped =
    persona.depth === "detailed"
      ? `${leadIn} ${body}\n\nAsk for a breakdown of any figure above for the underlying detail.`
      : `${leadIn} ${body}`;
  return shaped;
}
