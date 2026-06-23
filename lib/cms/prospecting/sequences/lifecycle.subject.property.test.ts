import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  applyTransition,
  hasResolvableSubject,
  type SequenceStatus,
} from "./lifecycle";
import type { BatchSubject } from "../batch/rerun-key";
import type { ProspectFilter } from "../providers";

// Feature: prospecting-sequences, Property 2: Publishability requires a resolvable subject

/**
 * **Validates: Requirements 1.8, 2.2, 2.8, 10.4**
 *
 * Property 2: Publishability requires a resolvable subject.
 *
 * For any Sequence configuration, publishing (and saving, and editing) is
 * accepted **if and only if** its Subject resolves to a filter (carries an
 * `icpFilter`, a `clusterId`, or a `projectId`); when it does not, the publish /
 * save / edit is rejected with a validation error and the Sequence retains its
 * prior status and prior configuration — a rejected publish stays `draft`
 * (Req 1.8), a rejected save creates nothing (Req 2.2, 2.8), and a rejected edit
 * keeps the previous config (Req 10.4).
 *
 * The pure source of truth is `hasResolvableSubject` in `./lifecycle`, which the
 * publish / save / edit gates delegate to (design §1, §4). The gates below model
 * that delegation so the property is asserted against the actual module function
 * rather than a re-implementation of its predicate.
 */

// ── Subject-shape gates (model the route/service delegation, design §1, §4) ──

interface SequenceConfig {
  name: string;
  subject: BatchSubject;
}

/** Publish from `current`: accepted iff the subject resolves and the transition is legal (Req 1.8). */
function attemptPublish(
  current: SequenceStatus,
  subject: BatchSubject
): { ok: boolean; status: SequenceStatus } {
  if (!hasResolvableSubject(subject)) {
    // Rejected with a validation error → status unchanged (a draft stays draft).
    return { ok: false, status: current };
  }
  const t = applyTransition(current, "publish");
  if (!t.ok) return { ok: false, status: current };
  return { ok: true, status: t.next };
}

/** Save/create: accepted iff name non-empty and the subject resolves (Req 2.2, 2.8). */
function attemptSave(
  subject: BatchSubject,
  name: string
): { ok: boolean; created: SequenceConfig | null } {
  if (name.trim().length === 0) return { ok: false, created: null };
  if (!hasResolvableSubject(subject)) return { ok: false, created: null };
  return { ok: true, created: { name, subject } };
}

/** Edit: accepted iff the new subject resolves; a reject retains the prior config (Req 10.4). */
function attemptEdit(
  prior: { status: SequenceStatus; config: SequenceConfig },
  newSubject: BatchSubject
): { ok: boolean; status: SequenceStatus; config: SequenceConfig } {
  if (!hasResolvableSubject(newSubject)) {
    return { ok: false, status: prior.status, config: prior.config };
  }
  return {
    ok: true,
    status: prior.status,
    config: { ...prior.config, subject: newSubject },
  };
}

// ── Generators ───────────────────────────────────────────────────────────────

const STATUSES: readonly SequenceStatus[] = [
  "draft",
  "live",
  "paused",
  "archived",
];

const idArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

const nonEmptyNameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

const prospectFilterArb: fc.Arbitrary<ProspectFilter> = fc.record(
  {
    targetType: fc.constantFrom("person", "company", "intermediary"),
    geography: fc.array(idArb, { maxLength: 3 }),
    titles: fc.array(idArb, { maxLength: 3 }),
    limit: fc.nat({ max: 200 }),
  },
  { requiredKeys: ["targetType"] }
) as fc.Arbitrary<ProspectFilter>;

/**
 * A `{ subject, resolvable }` pair whose `resolvable` flag is decided by
 * construction (whether at least one of `icpFilter` / `clusterId` / `projectId`
 * was included with a truthy value), NOT by re-evaluating the predicate under
 * test. This keeps the assertion `hasResolvableSubject(subject) === resolvable`
 * a genuine test of the module rather than a tautology.
 */
const taggedSubjectArb: fc.Arbitrary<{
  subject: BatchSubject;
  resolvable: boolean;
}> = fc
  .record({
    hasIcp: fc.boolean(),
    hasCluster: fc.boolean(),
    hasProject: fc.boolean(),
    icpFilter: prospectFilterArb,
    clusterId: idArb,
    projectId: idArb,
    communityId: fc.option(idArb, { nil: undefined }),
    briefId: fc.option(idArb, { nil: undefined }),
  })
  .map(
    ({
      hasIcp,
      hasCluster,
      hasProject,
      icpFilter,
      clusterId,
      projectId,
      communityId,
      briefId,
    }) => {
      const subject: BatchSubject = {
        kind: hasIcp ? "icp" : "cluster",
      };
      if (hasIcp) subject.icpFilter = icpFilter;
      if (hasCluster) subject.clusterId = clusterId;
      if (hasProject) subject.projectId = projectId;
      if (communityId !== undefined) subject.communityId = communityId;
      if (briefId !== undefined) subject.briefId = briefId;
      return { subject, resolvable: hasIcp || hasCluster || hasProject };
    }
  );

// Minimum 100 iterations per the spec (env override may only raise the count).
const NUM_RUNS = Math.max(100, Number(process.env.PBT_RUNS ?? 100));

// ─────────────────────────────────────────────────────────────────────────────

describe("Feature: prospecting-sequences, Property 2: Publishability requires a resolvable subject", () => {
  // The predicate itself: resolvable iff icpFilter | clusterId | projectId present.
  it("hasResolvableSubject is true iff the subject carries an icpFilter, clusterId, or projectId", () => {
    fc.assert(
      fc.property(taggedSubjectArb, ({ subject, resolvable }) => {
        expect(hasResolvableSubject(subject)).toBe(resolvable);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Publish (Req 1.8): accepted iff resolvable; a rejected publish stays `draft`.
  it("publish from draft is accepted iff the subject resolves, and a rejected publish stays draft", () => {
    fc.assert(
      fc.property(taggedSubjectArb, ({ subject, resolvable }) => {
        const result = attemptPublish("draft", subject);

        expect(result.ok).toBe(resolvable);
        if (resolvable) {
          expect(result.status).toBe("live");
        } else {
          // Rejected with a validation error → remains in draft (Req 1.8).
          expect(result.status).toBe("draft");
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  // Save/create (Req 2.2, 2.8): accepted iff resolvable; a rejected save creates nothing.
  it("save is accepted iff the subject resolves, and a rejected save creates no Sequence", () => {
    fc.assert(
      fc.property(
        taggedSubjectArb,
        nonEmptyNameArb,
        ({ subject, resolvable }, name) => {
          const result = attemptSave(subject, name);

          expect(result.ok).toBe(resolvable);
          if (resolvable) {
            expect(result.created).not.toBeNull();
            expect(result.created?.subject).toBe(subject);
          } else {
            // Rejected with a validation error → no Sequence created (Req 2.8).
            expect(result.created).toBeNull();
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  // Edit (Req 10.4): accepted iff the new subject resolves; a rejected edit retains
  // the prior status AND prior configuration unchanged.
  it("edit is accepted iff the new subject resolves, and a rejected edit keeps the prior status and config", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATUSES),
        taggedSubjectArb, // prior (already-resolvable) config
        taggedSubjectArb, // proposed new subject
        nonEmptyNameArb,
        (priorStatus, prior, next, name) => {
          // A live/published config necessarily already had a resolvable subject;
          // use the prior pair only when it is resolvable so the "prior config" is valid.
          fc.pre(prior.resolvable);

          const priorConfig: SequenceConfig = { name, subject: prior.subject };
          const result = attemptEdit(
            { status: priorStatus, config: priorConfig },
            next.subject
          );

          expect(result.ok).toBe(next.resolvable);
          // Status is never changed by an edit, accepted or rejected.
          expect(result.status).toBe(priorStatus);

          if (next.resolvable) {
            expect(result.config.subject).toBe(next.subject);
          } else {
            // Rejected edit → prior configuration retained unchanged (Req 10.4).
            expect(result.config).toBe(priorConfig);
            expect(result.config.subject).toBe(prior.subject);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
