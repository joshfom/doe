import { describe, it, expect } from "vitest";

import { prospectingBriefSchema } from "./brief";

/**
 * Smoke/example tests for the Prospecting_Brief schema (task 10.18).
 *
 * The S7 increment adds an OPTIONAL `clusterId` to `prospectingBriefSchema`
 * (Req 13.4). These example-based parses pin the additivity contract: a legacy
 * brief carrying only `projectId`/`aiUnitId`/`spec` (no `clusterId`) still
 * validates unchanged, AND a brief WITH a `clusterId` validates too — so adding
 * the field never regressed any existing caller.
 */

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

describe("prospectingBriefSchema — clusterId additivity (Req 13.4)", () => {
  it("validates a brief with only projectId/aiUnitId/spec (no clusterId)", () => {
    const parsed = prospectingBriefSchema.parse({
      projectId: UUID_A,
      aiUnitId: UUID_B,
      spec: { area: "Palm Jumeirah", segment: "ultra_luxury" },
    });
    expect(parsed.clusterId).toBeUndefined();
    expect(parsed.projectId).toBe(UUID_A);
    expect(parsed.aiUnitId).toBe(UUID_B);
    // The spec stays intact, with `features` defaulted to [].
    expect(parsed.spec.area).toBe("Palm Jumeirah");
    expect(parsed.spec.features).toEqual([]);
  });

  it("validates a spec-only brief (no own-catalog reference at all)", () => {
    const parsed = prospectingBriefSchema.parse({
      spec: { segment: "luxury", unitType: "penthouse", bedrooms: 4 },
    });
    expect(parsed.clusterId).toBeUndefined();
    expect(parsed.projectId).toBeUndefined();
    expect(parsed.spec.bedrooms).toBe(4);
  });

  it("also validates a brief WITH a clusterId (the additive field)", () => {
    const parsed = prospectingBriefSchema.parse({
      projectId: UUID_A,
      clusterId: UUID_C,
      spec: { area: "Dubai Marina" },
    });
    expect(parsed.clusterId).toBe(UUID_C);
    expect(parsed.projectId).toBe(UUID_A);
  });

  it("rejects a non-uuid clusterId (the field is a uuid when present)", () => {
    const result = prospectingBriefSchema.safeParse({
      clusterId: "not-a-uuid",
      spec: {},
    });
    expect(result.success).toBe(false);
  });
});
