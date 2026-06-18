import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildMemoryKey,
  MEMORY_ENTITY_KINDS,
  MEMORY_LAST_MESSAGES,
  type MemoryEntity,
  type MemoryEntityKind,
  type MemoryKey,
} from "./memory";

/**
 * **Feature: agentic-foundation, Property 16: For any set of memory records spanning multiple Memory_Entities and any target entity, retrieval returns only records keyed to the target entity, no more than the configured maximum, ordered most-recent-write first; and an entity with no records returns an empty set without error.**
 *
 * **Validates: Requirements 4.3, 4.4**
 *
 * Agent_Memory (Design §Components #3, recommendation Option B) delegates
 * retrieval to Mastra's `Memory` on `@mastra/pg`, scoped per Memory_Entity by
 * the storage key `buildMemoryKey` produces (`resourceId` for
 * user/lead/rep/deal, `threadId` for conversation) and bounded by the recency
 * window `MEMORY_LAST_MESSAGES` with `scope: "resource"`. This is a **[deps]**
 * task, so the live Mastra/Postgres store is mocked by a FAKE store that mirrors
 * Mastra's retrieval contract exactly — driven by the REAL key builder and the
 * REAL bound constant exported from `./memory`, so the test pins the policy our
 * configuration actually requests:
 *
 *   - **Isolation (Req 4.3):** retrieval returns ONLY records whose entity key
 *     equals the target entity's key, never a record keyed to a different
 *     Memory_Entity.
 *   - **Bound (Req 4.3):** retrieval returns no more than `MEMORY_LAST_MESSAGES`
 *     records.
 *   - **Ordering (Req 4.3):** records come back most-recent-write first
 *     (non-increasing write timestamp).
 *   - **Empty (Req 4.4):** an entity with no records yields an empty set and
 *     never an error.
 *
 * Two distinct Memory_Entities always map to distinct storage keys (the
 * resource prefix and/or id differ; `conversation` uses a `threadId`), so an
 * exact key match is precisely "keyed to the target entity".
 */

// ── Serialise a MemoryKey to a comparable scope token ────────────────────────
// Exactly one of resourceId / threadId is set (Property 17 invariant), so the
// tagged string is a faithful, collision-free identity for the entity's key.
function keyToken(key: MemoryKey): string {
  return key.resourceId !== undefined ? `r:${key.resourceId}` : `t:${key.threadId}`;
}

// ── A stored memory record, tagged with the entity it was written for ────────
interface StoredRecord {
  /** The entity this record is keyed to (its key drives isolation). */
  entity: MemoryEntity;
  /** UTC write timestamp in ms — retrieval orders most-recent first. */
  writtenAt: number;
  /** Monotonic insertion order, used as a stable tiebreak for equal timestamps. */
  seq: number;
  payload: string;
}

/**
 * FAKE Agent_Memory store mirroring Mastra's `Memory` retrieval contract:
 * records are scoped by the storage key `buildMemoryKey` yields, retrieval is
 * filtered to the turn's entity key, ordered most-recent-write-first, and
 * truncated to the configured recency window. No live database is touched.
 */
class FakeMemoryStore {
  private records: StoredRecord[] = [];
  private nextSeq = 0;

  /** Persist a record keyed to its Memory_Entity (Req 4.2 scoping). */
  write(entity: MemoryEntity, writtenAt: number, payload: string): void {
    this.records.push({ entity, writtenAt, seq: this.nextSeq++, payload });
  }

  /**
   * Retrieve memory for a turn about `target`, applying the Retrieval_Policy:
   * entity-scoped filter → most-recent-write-first → bounded by the window.
   * Returns an empty array (never throws) when nothing matches (Req 4.4).
   */
  retrieve(target: MemoryEntity, limit: number = MEMORY_LAST_MESSAGES): StoredRecord[] {
    const wanted = keyToken(buildMemoryKey(target));
    return this.records
      .filter((r) => keyToken(buildMemoryKey(r.entity)) === wanted)
      .sort((a, b) => b.writtenAt - a.writtenAt || b.seq - a.seq)
      .slice(0, limit);
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const kindArb = fc.constantFrom<MemoryEntityKind>(...MEMORY_ENTITY_KINDS);

// A small id pool forces collisions across kinds (e.g. user:1 vs lead:1, which
// must stay isolated) and repeats within a kind (so an entity accumulates many
// records, exercising the recency bound).
const idArb = fc.constantFrom("1", "2", "3");

const entityArb: fc.Arbitrary<MemoryEntity> = fc.record({
  kind: kindArb,
  id: idArb,
});

const recordSpecArb = fc.record({
  entity: entityArb,
  writtenAt: fc.integer({ min: 0, max: 1_000_000 }),
  payload: fc.string({ maxLength: 12 }),
});

// Enough records to overflow the recency window for some entities.
const recordsArb = fc.array(recordSpecArb, { maxLength: MEMORY_LAST_MESSAGES * 3 });

describe("Feature: agentic-foundation, Property 16: memory retrieval isolation", () => {
  it("returns only the target entity's records, bounded by the window, most-recent-write first", () => {
    fc.assert(
      fc.property(recordsArb, entityArb, (specs, target) => {
        const store = new FakeMemoryStore();
        for (const s of specs) store.write(s.entity, s.writtenAt, s.payload);

        const wantedToken = keyToken(buildMemoryKey(target));
        const got = store.retrieve(target);

        // Isolation (Req 4.3): every returned record is keyed to the target
        // entity, and none belongs to a different Memory_Entity.
        for (const r of got) {
          expect(keyToken(buildMemoryKey(r.entity))).toBe(wantedToken);
        }

        // Bound (Req 4.3): no more than the configured maximum.
        expect(got.length).toBeLessThanOrEqual(MEMORY_LAST_MESSAGES);

        // Ordering (Req 4.3): non-increasing write timestamp (most-recent first).
        for (let i = 1; i < got.length; i++) {
          expect(got[i - 1].writtenAt).toBeGreaterThanOrEqual(got[i].writtenAt);
        }

        // The returned set is exactly the most-recent window of the matching
        // records — confirms nothing from the target entity is wrongly dropped
        // beyond the bound, and nothing foreign is included.
        const allMatching = specs.filter(
          (s) => keyToken(buildMemoryKey(s.entity)) === wantedToken,
        );
        expect(got.length).toBe(Math.min(allMatching.length, MEMORY_LAST_MESSAGES));
      }),
      { numRuns: 200 },
    );
  });

  it("returns an empty set without error for an entity that has no records", () => {
    fc.assert(
      fc.property(recordsArb, entityArb, (specs, target) => {
        const store = new FakeMemoryStore();
        const wantedToken = keyToken(buildMemoryKey(target));

        // Persist only records that do NOT belong to the target entity, so the
        // target genuinely has no records.
        for (const s of specs) {
          if (keyToken(buildMemoryKey(s.entity)) !== wantedToken) {
            store.write(s.entity, s.writtenAt, s.payload);
          }
        }

        const got = store.retrieve(target);
        expect(got).toEqual([]); // empty set, no throw (Req 4.4)
      }),
      { numRuns: 200 },
    );
  });
});
