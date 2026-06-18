// lib/cms/ai/tools/platform-capabilities.ts
//
// The `get_platform_knowledge` Catalog_Entry — the audited boundary the
// Home_Agent (the C-level twin surface) binds to answer questions ABOUT the DOE
// platform itself: "what is DOE", "what can it do", "why build our own agentic
// core instead of buying", "what's the future".
//
// Like every capability module (reporting/lead/home), this invents NO new
// dispatcher, RBAC engine, OTP gate, or audit path: the entry is a `CatalogEntry`
// that, when invoked, flows through the unchanged `dispatchTool`
// (Zod → RBAC → OTP → audit → execute). The handler is pure (it calls
// `searchPlatformKnowledge`, which opens no database connection and calls no
// model), so the tool reads no personal data and is not OTP-gated — it returns
// only reviewed, public-to-staff platform facts.
//
// It is spliced into the home catalog (`home-capabilities.ts`) so the dispatcher
// can resolve it (the dispatcher falls back to the home catalog for names that
// are not voice-registry tools), and its `home:tool:get_platform_knowledge`
// permission is carried in the Home_Agent's static grant.

import { z } from "zod";

import {
  searchPlatformKnowledge,
  PLATFORM_KNOWLEDGE_DEFAULT_TOP_K,
} from "../../agents/platform/knowledge";
import {
  loadCatalog,
  type CatalogEntry,
  type CatalogLoadResult,
} from "./catalog";

// ── Identity & permission (reuses the home identity) ──────────────────────────

/**
 * The platform-knowledge tool is bound under the Home_Agent identity (the C-level
 * twin surface). Its RBAC permission follows the `home:tool:<name>` convention so
 * the Home_Agent's existing static grant authorizes it with no new scheme.
 */
export const PLATFORM_KNOWLEDGE_TOOL_NAME = "get_platform_knowledge";

/** The audit actor recorded for a platform-knowledge dispatch. */
export const PLATFORM_AGENT_ACTOR = "agent:home-twin";

/** Build the `home:tool:<name>` permission string for a platform tool. */
export function platformToolPermission(name: string): string {
  return `home:tool:${name}`;
}

/** The tool name(s) this module contributes to the home catalog. */
export const PLATFORM_TOOL_NAMES = [PLATFORM_KNOWLEDGE_TOOL_NAME] as const;

// ── Zod schemas ───────────────────────────────────────────────────────────────

const PLATFORM_CATEGORIES = [
  "overview",
  "capabilities",
  "architecture",
  "build-vs-buy",
  "governance",
  "future",
] as const;

const getPlatformKnowledgeInput = z.object({
  /** The platform question to answer, e.g. "why build instead of buy?". */
  query: z.string().min(1),
  /** Optional category filter to narrow the retrieval. */
  category: z.enum(PLATFORM_CATEGORIES).optional(),
  /** Max sections to return. */
  topK: z.number().int().min(1).max(8).default(PLATFORM_KNOWLEDGE_DEFAULT_TOP_K),
});

const getPlatformKnowledgeOutput = z.object({
  matches: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.enum(PLATFORM_CATEGORIES),
      summary: z.string(),
      content: z.string(),
      score: z.number(),
    }),
  ),
});

// ── entry() helper (mirrors the sibling capability modules) ───────────────────

function entry<I, O>(e: CatalogEntry<I, O>): CatalogEntry {
  return e as unknown as CatalogEntry;
}

/**
 * `get_platform_knowledge` — retrieve reviewed facts about the DOE platform
 * itself (what it is, what it does, build-vs-buy, governance, the roadmap). The
 * agent NARRATES the returned sections; it never invents platform facts. Pure
 * retrieval: no DB access, no personal data, not OTP-gated.
 */
export const platformKnowledgeEntry: CatalogEntry = entry({
  name: PLATFORM_KNOWLEDGE_TOOL_NAME,
  description:
    "Retrieve reviewed knowledge ABOUT the DOE platform itself — what DOE is, " +
    "what it can do today, how it is built, the honest case for building it vs " +
    "buying a ready-made agent (including when NOT to build), security/governance, " +
    "and the roadmap. Use this for any question about the platform as a product " +
    "or technology. Narrate the returned sections; never invent platform facts.",
  inputSchema: getPlatformKnowledgeInput,
  outputSchema: getPlatformKnowledgeOutput,
  requiresOtp: false,
  permission: platformToolPermission(PLATFORM_KNOWLEDGE_TOOL_NAME),
  auditActor: PLATFORM_AGENT_ACTOR,
  handler: async (_db, _ctx, input) => {
    const matches = searchPlatformKnowledge(input.query, {
      topK: input.topK,
      category: input.category,
    });
    return { matches };
  },
});

/** The platform Catalog_Entries this module contributes. */
export const platformCapabilityEntries: CatalogEntry[] = [platformKnowledgeEntry];

/**
 * Validate and assemble just the platform capabilities through {@link loadCatalog}.
 * Lets the module be self-checked in isolation (mirrors `loadHomeCapabilities`).
 */
export function loadPlatformCapabilities(): CatalogLoadResult {
  return loadCatalog(platformCapabilityEntries);
}
