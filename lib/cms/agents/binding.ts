// lib/cms/agents/binding.ts
//
// The Mastra_Tool_Binding generator (Design §Components #2). Each requested
// Catalog_Entry becomes EXACTLY ONE Mastra tool via `createTool`, with the
// tool's `id` equal to the Catalog_Entry's `name` (1:1 — Requirement 2.3). The
// generated tool's `execute()` does NO work itself: it calls `callTool`, which
// routes to the audited `dispatchTool`. This is the heart of "agents are the
// brain, the dispatcher is the hands" — an agent literally has no tool object
// for a name that is not a Catalog_Entry, so it can never invoke an off-catalog
// tool (Requirement 2.1, 3.1).
//
// Registration-time safety (Requirement 2.4): if any requested name is absent
// from the catalog, `bindCatalog` throws a {@link CatalogBindingError} naming
// every unresolved name and returns NO bindings — leaving zero bindings
// registered for the affected agent rather than a partial set.
//
// [container-only] The Mastra runtime that registers these bindings runs on the
// container/worker tier only, never on Next.js serverless (Requirement 15.3).
//
// Design references: §Components #2 (Mastra_Tool_Binding → Tool_Dispatcher).
// Requirements: 2.3, 2.4, 3.1.

import { createTool } from "@mastra/core/tools";
import type { Catalog, CatalogEntry } from "../ai/tools/catalog";
import { callTool } from "./call-tool";

/** Per-agent binding options threaded into every generated tool's dispatch. */
export interface BindOptions {
  /** The RBAC identity of the agent these tools are bound for. */
  agentActor: string;
}

/**
 * Thrown at registration time when one or more requested tool names cannot be
 * resolved to a Catalog_Entry. Carries the unresolved names so the caller (and
 * the surfaced error) can name them (Requirement 2.4).
 */
export class CatalogBindingError extends Error {
  /** The requested tool names that were absent from the catalog. */
  readonly unresolved: string[];

  constructor(unresolved: string[], agentActor: string) {
    super(
      `Unresolved tool name(s) for agent "${agentActor}": ${unresolved.join(", ")}`
    );
    this.name = "CatalogBindingError";
    this.unresolved = unresolved;
  }
}

/** The map of generated Mastra tools, keyed by catalog tool name. */
export type BoundTools = Record<string, ReturnType<typeof createTool>>;

/**
 * The Mastra `RequestContext` key under which a per-turn dispatch actor — the
 * REQUESTING USER's identity for the turn — is carried into a bound tool's
 * `execute` (Requirement 8.2). A turn runner that acts on behalf of a signed-in
 * user (the Home_Agent — see `home-agent.ts`) sets it on the `requestContext`
 * passed to `agent.generate`; `readRequestingActor` reads it back here and
 * forwards it to `callTool`, where it becomes the dispatcher's `ctx.actor` (so
 * the audit log records the user, never the agent identity). Absent — the
 * default for agents acting under their own identity (text/admin) — the
 * dispatch falls back to the agent identity, so existing bindings are
 * unaffected.
 */
export const REQUESTING_ACTOR_CONTEXT_KEY = "doe__requestingActor";

/**
 * Defensively read the per-turn requesting actor from the Mastra
 * tool-execution context's `requestContext` (`context.requestContext.get(...)`).
 * The execution-context arg is typed `unknown`, so this tolerates any shape and
 * returns `undefined` unless a non-empty string actor is present — in which
 * case the dispatch falls back to the bound agent identity (non-regressive).
 */
function readRequestingActor(runtimeCtx: unknown): string | undefined {
  const requestContext = (
    runtimeCtx as
      | { requestContext?: { get?: (key: string) => unknown } }
      | null
      | undefined
  )?.requestContext;
  const value = requestContext?.get?.(REQUESTING_ACTOR_CONTEXT_KEY);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Generate Mastra tools for a named subset of catalog entries.
 *
 *  - One binding per requested name, with `binding.id === entry.name` (1:1 —
 *    Requirement 2.3).
 *  - If any requested name is absent from the catalog, throw a
 *    {@link CatalogBindingError} naming the unresolved name(s) and register
 *    ZERO bindings for the agent (Requirement 2.4) — the throw happens before
 *    any tool is constructed, so the affected agent gets no partial binding.
 *  - Every generated tool's `execute()` delegates to `callTool` → `dispatchTool`
 *    and does no work itself (Requirement 3.1).
 *
 * @param catalog    The loaded, validated Tool_Catalog.
 * @param toolNames  The catalog tool names this agent may call.
 * @param opts       The agent's RBAC identity (recorded as the dispatch actor).
 */
export function bindCatalog(
  catalog: Catalog,
  toolNames: string[],
  opts: BindOptions
): BoundTools {
  // Resolve-first, build-second: any miss rejects the WHOLE binding so no
  // partial set is ever registered for the agent (Requirement 2.4).
  const missing = toolNames.filter((name) => !catalog.has(name));
  if (missing.length > 0) {
    throw new CatalogBindingError(missing, opts.agentActor);
  }

  const tools: BoundTools = {};
  for (const name of toolNames) {
    const entry = catalog.get(name) as CatalogEntry;
    tools[name] = createTool({
      id: entry.name, // 1:1 with the Catalog_Entry (Requirement 2.3)
      description: entry.description,
      // Zod input schema; Mastra derives the model-facing JSON Schema from it.
      inputSchema: entry.inputSchema,
      outputSchema: entry.outputSchema,
      // The ONLY thing a binding does: dispatch. Never raw DB (Requirement 3.1).
      // A per-turn requesting actor (Requirement 8.2), when present on the
      // Mastra request context, is forwarded so the dispatcher attributes the
      // audited action to the requesting user rather than the agent identity.
      // UNWRAP the dispatcher envelope: on success return the inner `result`
      // (so it matches `outputSchema` and the agent's tool-result carries clean,
      // typed data for the surface's cards); on failure throw the structured
      // message so the model sees a tool error and narrates it (it never writes
      // partial state — the dispatcher already guarded that).
      execute: async (input, runtimeCtx) => {
        const res = await callTool(entry.name, input, {
          agentActor: opts.agentActor,
          requestingActor: readRequestingActor(runtimeCtx),
          runtimeCtx,
        });
        if (res.ok) return res.result;
        throw new Error(
          res.error?.message ?? `Tool "${entry.name}" did not complete.`,
        );
      },
    });
  }
  return tools;
}
