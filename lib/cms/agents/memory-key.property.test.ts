import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildMemoryKey,
  MEMORY_ENTITY_KINDS,
  type MemoryEntity,
  type MemoryEntityKind,
} from "./memory";

/**
 * **Feature: agentic-foundation, Property 17: For any Memory_Entity drawn from {user, lead, rep, deal, conversation}, the key builder produces exactly one storage key in the allowed entity space, so every written record is associated with exactly one entity.**
 *
 * **Validates: Requirements 4.2**
 *
 * `buildMemoryKey` (Design §Components #3, "Memory_Entity keys and scoping")
 * maps each of the five Memory_Entities onto Mastra's two scoping dimensions:
 * `user`/`lead`/`rep`/`deal` become a cross-conversation `resourceId`
 * (`{kind}:{id}`) and `conversation` becomes a per-conversation `threadId`
 * (`conv:{id}`). The contract (Requirement 4.2) is that every memory record is
 * keyed to EXACTLY ONE Memory_Entity — so the produced `MemoryKey` must carry
 * exactly one of `{ resourceId, threadId }` (never both, never neither), and
 * that key must live in the allowed entity space (the correct dimension and
 * prefix for the entity's kind).
 *
 * We generate arbitrary entities across all five kinds with arbitrary
 * non-empty ids, and an independent reference model computes which dimension
 * and prefixed key each kind must yield. The test asserts that, for every
 * entity, `buildMemoryKey` (a) sets exactly one storage key (the XOR), and
 * (b) sets the right dimension with the right prefixed value — i.e. the key is
 * the single allowed key for that one entity.
 */

// ── Independent reference model of the entity → key mapping ──────────────────
// Mirrors the design's scoping table WITHOUT reusing the implementation's
// control flow: the first four kinds key a `resourceId` of `{kind}:{trimmedId}`;
// `conversation` keys a `threadId` of `conv:{trimmedId}`.
function expectedKey(
  kind: MemoryEntityKind,
  id: string,
): { resourceId: string; threadId?: undefined } | { threadId: string; resourceId?: undefined } {
  const trimmed = id.trim();
  if (kind === "conversation") return { threadId: `conv:${trimmed}` };
  return { resourceId: `${kind}:${trimmed}` };
}

// An id that is non-empty after trimming (the builder rejects empty ids). We
// allow surrounding whitespace to exercise the builder's trimming, but require
// at least one non-whitespace character so the entity is concrete.
const idArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

const entityArb: fc.Arbitrary<MemoryEntity> = fc.record({
  kind: fc.constantFrom(...MEMORY_ENTITY_KINDS),
  id: idArb,
});

describe("buildMemoryKey — entity key builder (Property 17)", () => {
  it("produces exactly one storage key in the allowed entity space for every Memory_Entity", () => {
    fc.assert(
      fc.property(entityArb, (entity) => {
        const key = buildMemoryKey(entity);
        const exp = expectedKey(entity.kind, entity.id);

        const hasResource = key.resourceId !== undefined;
        const hasThread = key.threadId !== undefined;

        // (a) Exactly one storage key — never both, never neither (XOR). This is
        // what guarantees every written record is associated with exactly one
        // Memory_Entity.
        expect(hasResource !== hasThread).toBe(true);

        // (b) The single key lives in the allowed entity space: the correct
        // scoping dimension and the correct prefixed value for this kind.
        if (entity.kind === "conversation") {
          expect(hasThread).toBe(true);
          expect(key.threadId).toBe(exp.threadId);
        } else {
          expect(hasResource).toBe(true);
          expect(key.resourceId).toBe(exp.resourceId);
        }
      }),
      { numRuns: 200 },
    );
  });
});
