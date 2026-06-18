// lib/cms/agents/memory.ts
//
// Agent_Memory (Requirement 4) — durable working + long-term memory for every
// Mastra agent, keyed per Memory_Entity, with a bounded recency-ordered
// Retrieval_Policy and phone-privacy guarantees.
//
// Design §Components #3 (Agent memory), recommendation **Option B**: Mastra's
// `Memory` on `@mastra/pg` (PostgresStore + PgVector) pointed at the SAME
// `DATABASE_URL` (same Postgres, same `pgvector` extension), with the embedder
// reusing the existing Cloudflare AI Gateway transport (see ./embedder). This
// satisfies the roadmap's "reuse pgvector" intent AND the "don't reinvent
// memory" intent in one shot.
//
//   - Durability across process/container restart → Postgres store (Req 4.1)
//   - One Memory_Entity per record, exactly one storage key → buildMemoryKey (Req 4.2)
//   - Bounded, recency-ordered, entity-scoped retrieval → MEMORY_OPTIONS (Req 4.3, 4.4)
//   - Write metadata (writtenBy + UTC timestamp) → memoryEntitySchema (Req 4.6)
//   - No raw phone numbers ever persisted → sanitizeMemory + memoryEntitySchema (Req 4.7)
//
// [container-only] The Mastra runtime that owns this Memory runs on the
// container/worker tier only, never on Next.js serverless (Requirement 15.3).
// [deps] Depends on @mastra/memory + @mastra/pg; the connection is constructed
// lazily so importing the pure helpers (buildMemoryKey, memoryEntitySchema,
// sanitizeMemory) never requires a live database.

import { Memory } from "@mastra/memory";
// NOTE: the installed @mastra/pg exports the storage adapter as `PostgresStore`
// (the design sketch's `PgStore` is the same adapter under its concrete name).
import { PgVector, PostgresStore } from "@mastra/pg";
import { z } from "zod";

import { computePhoneHash, normalizePhoneToE164 } from "../voice/identity";
import { cfEmbedder } from "./embedder";

// ── Memory_Entity keys and the entity key builder (Requirement 4.2) ───────────

/** The five Memory_Entities a memory record may be keyed to (Req 4.2). */
export const MEMORY_ENTITY_KINDS = [
  "user",
  "lead",
  "rep",
  "deal",
  "conversation",
] as const;

export type MemoryEntityKind = (typeof MEMORY_ENTITY_KINDS)[number];

/** The entity a turn (and its memory) is about. */
export interface MemoryEntity {
  kind: MemoryEntityKind;
  /** The entity's identifier (userId, partyId, repId, dealId, conversationId). */
  id: string;
}

/**
 * Exactly one Mastra storage key. Mastra scopes memory by `resourceId`
 * (cross-conversation, per entity) and `threadId` (per conversation); the key
 * builder sets EXACTLY ONE of these, never both, never neither — so every
 * written record is associated with exactly one Memory_Entity (Req 4.2,
 * Property 17).
 */
export type MemoryKey =
  | { resourceId: string; threadId?: undefined }
  | { threadId: string; resourceId?: undefined };

/**
 * Per the design's mapping table:
 *   user → resourceId `user:{id}`     conversation → threadId `conv:{id}`
 *   lead → resourceId `lead:{id}`
 *   rep  → resourceId `rep:{id}`
 *   deal → resourceId `deal:{id}`
 */
const RESOURCE_PREFIX: Record<Exclude<MemoryEntityKind, "conversation">, string> = {
  user: "user",
  lead: "lead",
  rep: "rep",
  deal: "deal",
};

/**
 * Build the single storage key for a Memory_Entity (Req 4.2).
 *
 * `user`/`lead`/`rep`/`deal` map to a cross-conversation `resourceId`;
 * `conversation` maps to a per-conversation `threadId`. The result always
 * carries exactly one key in the allowed entity space.
 *
 * @throws if the entity id is empty — a record must be associated with a
 *   concrete entity.
 */
export function buildMemoryKey(entity: MemoryEntity): MemoryKey {
  const id = entity.id?.trim();
  if (!id) {
    throw new Error(`Memory_Entity "${entity.kind}" requires a non-empty id`);
  }
  if (entity.kind === "conversation") {
    return { threadId: `conv:${id}` };
  }
  return { resourceId: `${RESOURCE_PREFIX[entity.kind]}:${id}` };
}

// ── Working-memory schema (Requirement 4.6, 4.7) ──────────────────────────────

/**
 * The structured working-memory record Mastra maintains per entity. It carries
 * the writing agent's identity (`writtenBy`, Req 4.6) and stores any phone only
 * as a salted hash (`phoneHash`) — NEVER a raw number (Req 4.7, CC-Privacy).
 * Mastra additionally stamps a UTC `createdAt` on stored messages, completing
 * the write-metadata requirement (Req 4.6).
 */
export const memoryEntitySchema = z.object({
  entityKind: z.enum(MEMORY_ENTITY_KINDS),
  displayName: z.string().optional(),
  /** Salted SHA-256 phone hash — never a raw E.164 number (Req 4.7). */
  phoneHash: z.string().optional(),
  preferences: z.record(z.string(), z.string()).optional(),
  lastSummary: z.string().max(500).optional(),
  /** The writing agent's identity, e.g. "agent:text-lead" (Req 4.6). */
  writtenBy: z.string().min(1),
});

export type MemoryEntityRecord = z.infer<typeof memoryEntitySchema>;

// ── sanitizeMemory() pre-write hook (Requirement 4.7, CC-Privacy) ─────────────

/**
 * Matches phone-like runs: an optional leading `+`, a leading digit, then a run
 * of digits/separators, ending on a digit. Candidates are validated by
 * attempting E.164 normalisation before being treated as phone numbers, so
 * non-phone digit strings are left untouched.
 */
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{6,18}\d/g;

/** Replace every plausible phone number in a string with its salted hash. */
function hashPhonesInString(value: string, salt?: string): string {
  return value.replace(PHONE_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, "");
    // E.164 plausibility gate — 8..15 digits (matches normalizePhoneToE164).
    if (digits.length < 8 || digits.length > 15) return match;
    try {
      const e164 = normalizePhoneToE164(match);
      return computePhoneHash(e164, salt);
    } catch {
      // Not a usable phone number — leave the original text as-is.
      return match;
    }
  });
}

/**
 * Pre-write hook: recursively scan a candidate memory value and replace any raw
 * phone number with its salted hash (reusing the voice surface's
 * `PHONE_HASH_SALT`-based helper), so neither working memory nor recalled
 * messages ever persist a raw number (Req 4.7, Property 19).
 *
 * Pure and structure-preserving: returns a sanitized clone, leaving the input
 * untouched. Strings are scrubbed; objects/arrays are walked; other primitives
 * pass through unchanged.
 *
 * @param value Any candidate memory value (string, object, array, primitive).
 * @param salt  Optional explicit salt (tests); defaults to `PHONE_HASH_SALT`.
 */
export function sanitizeMemory<T>(value: T, salt?: string): T {
  return sanitizeValue(value, salt) as T;
}

function sanitizeValue(value: unknown, salt?: string): unknown {
  if (typeof value === "string") {
    return hashPhonesInString(value, salt);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, salt));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = sanitizeValue(item, salt);
    }
    return out;
  }
  return value;
}

// ── Retrieval_Policy: bounded, recency-ordered, entity-scoped (Req 4.3, 4.4) ──

/**
 * Maximum recent messages returned per turn — the recency window. Mastra
 * returns these most-recent-write-first and never more than this count
 * (Req 4.3). With no records for an entity it returns an empty set, not an
 * error (Req 4.4).
 */
export const MEMORY_LAST_MESSAGES = 20;

/** Maximum semantically-recalled records per turn (the configurable bound). */
export const MEMORY_SEMANTIC_TOP_K = 8;

/**
 * Memory options shared by the runtime. `scope: "resource"` keeps retrieval
 * scoped to the turn's Memory_Entity, so a turn for `lead:A` can only ever see
 * records keyed to `lead:A` — never another entity's (Req 4.3).
 */
export const MEMORY_OPTIONS = {
  lastMessages: MEMORY_LAST_MESSAGES,
  semanticRecall: {
    topK: MEMORY_SEMANTIC_TOP_K,
    messageRange: 2,
    scope: "resource",
  },
  workingMemory: {
    enabled: true,
    schema: memoryEntitySchema,
    scope: "resource",
  },
} as const;

// ── The Agent_Memory instance (Requirement 4.1) ──────────────────────────────

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim().length === 0) {
    throw new Error(
      "DATABASE_URL is not set. Agent_Memory requires a Postgres connection " +
        "(PostgresStore + PgVector) on the same database as the rest of DOE."
    );
  }
  return url;
}

/**
 * Construct the Agent_Memory: Mastra `Memory` backed by `PostgresStore`
 * (threads, messages, working memory) and `PgVector` (semantic recall), both
 * pointed at `DATABASE_URL`, with `cfEmbedder` for embeddings and the bounded,
 * entity-scoped `MEMORY_OPTIONS` (Req 4.1, 4.3).
 *
 * @param connectionString Optional override (tests); defaults to `DATABASE_URL`.
 */
export function createAgentMemory(connectionString: string = getDatabaseUrl()): Memory {
  return new Memory({
    storage: new PostgresStore({ id: "doe-agent-memory", connectionString }),
    vector: new PgVector({ id: "doe-agent-vector", connectionString }),
    embedder: cfEmbedder,
    options: MEMORY_OPTIONS,
  });
}

let cachedMemory: Memory | undefined;

/**
 * The lazily-constructed Agent_Memory singleton consumed by the Mastra runtime
 * (registered as the single config entry point's `storage`). Construction is
 * deferred to first use so importing the pure helpers above never opens a
 * database connection.
 */
export function getAgentMemory(): Memory {
  cachedMemory ??= createAgentMemory();
  return cachedMemory;
}
