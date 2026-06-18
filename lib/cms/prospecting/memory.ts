// lib/cms/prospecting/memory.ts
//
// Prospecting research memory key (Design §Components #3; Requirement 9 / P-NoLeak).
//
// The Prospecting_Agent stores a Target's assembled research in S1 Agent_Memory
// keyed `target:{id}` (Design §Components #3: "Research is stored in Agent_Memory
// keyed `target:{id}`, so retrieval for one Target returns only that Target's
// records (Req 9 / P-NoLeak, reuse S1 `scope:"resource"`)."). This module is the
// single source of that key so the `prospecting-run` workflow (task 5.2) and the
// PII-isolation property (task 5.3) agree on exactly one storage key per Target.
//
// S1's `buildMemoryKey` (lib/cms/agents/memory.ts) scopes the five platform
// Memory_Entities; a Target is the prospecting domain's own resource, so its key
// is built here and consumed by the same Mastra `Memory` under the identical
// `scope: "resource"` Retrieval_Policy — a turn about `target:A` can therefore
// only ever see records keyed to `target:A`, never another Target's research.

import type { MemoryKey } from "../agents/memory";

/** The cross-conversation resource prefix for a Target's research memory. */
export const TARGET_MEMORY_PREFIX = "target" as const;

/**
 * Build the single Agent_Memory storage key for a Target's research (Req 9).
 *
 * Returns a cross-conversation `resourceId` of `target:{id}`, mirroring S1's
 * resource-keyed entities (`user:{id}`, `lead:{id}`, …) so the same
 * `scope: "resource"` retrieval keeps one Target's research isolated from every
 * other Target's. Exactly one key is set (`resourceId`), never a `threadId`.
 *
 * @param targetId The Target's identifier (must be non-empty).
 * @throws if `targetId` is empty — research must be associated with a concrete Target.
 */
export function buildTargetMemoryKey(targetId: string): MemoryKey {
  const id = targetId?.trim();
  if (!id) {
    throw new Error("Target research memory requires a non-empty targetId");
  }
  return { resourceId: `${TARGET_MEMORY_PREFIX}:${id}` };
}
