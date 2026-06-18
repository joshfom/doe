import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import type { PipelineMetrics } from "../../metrics/pipeline";
import {
  defaultPersonaForRoles,
  readPersona,
  shapeNarration,
  twinPersonaSchema,
  type PersonaStore,
  type PersonaTone,
  type PersonaDepth,
  type TwinPersona,
} from "./persona";
import { EXEC_SCOPE_PERMISSION, REP_SCOPE_PERMISSION, type ReportScope } from "./scope";

// Feature: agentic-reporting-twin, Property 10: Persona shapes narration but never a figure
//
// *For any* persona (a stored Twin_Persona or the role-derived default) and any
// `PipelineMetrics`, the shaped response leaves every reported figure identical
// to the Metrics_Pipeline value and alters only the narration; and a persona
// read returns only the requesting user's persona, never another user's.
//
// **Validates: Requirements 8.3, 8.4, 8.6**

// ── Iteration floor ───────────────────────────────────────────────────────────
// The spec mandates a >=100-iteration floor; we run exactly the floor to keep
// the suite fast (the properties are pure/in-memory, so 100 is sufficient).
const NUM_RUNS = 100;

// ── Arbitraries ───────────────────────────────────────────────────────────────

const toneArb: fc.Arbitrary<PersonaTone> = fc.constantFrom(
  "strategic",
  "operational",
  "concise",
);
const depthArb: fc.Arbitrary<PersonaDepth> = fc.constantFrom("summary", "detailed");

/** A Report_Scope used as a persona's default scope (shapeNarration never emits it). */
const reportScopeArb: fc.Arbitrary<ReportScope> = fc
  .record(
    {
      scope: fc.constantFrom("exec", "rep"),
      period: fc.constantFrom("all-time", "this-week", "this-month"),
      repId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined }),
    },
    { requiredKeys: ["scope", "period"] },
  )
  .map(({ scope, period, repId }) =>
    repId === undefined
      ? ({ scope, period } as ReportScope)
      : ({ scope, period, repId } as ReportScope),
  );

/** An explicitly-stored Twin_Persona with arbitrary tone/depth/scope. */
const storedPersonaArb: fc.Arbitrary<TwinPersona> = fc.record({
  userId: fc.string({ minLength: 1, maxLength: 10 }),
  tone: toneArb,
  depth: depthArb,
  defaultScope: reportScopeArb,
  writtenBy: fc.constantFrom("agent:reporting-twin", "user:admin"),
});

/** RBAC role/permission tokens, including the two reporting permissions + noise. */
const rolesArb: fc.Arbitrary<string[]> = fc.array(
  fc.constantFrom(
    EXEC_SCOPE_PERMISSION,
    REP_SCOPE_PERMISSION,
    "executive",
    "admin",
    "leads:read",
    "blog:publish",
  ),
  { maxLength: 5 },
);

/** A role-derived default persona — the other half of "any persona" in Property 10. */
const defaultPersonaArb: fc.Arbitrary<TwinPersona> = fc
  .tuple(fc.string({ minLength: 1, maxLength: 10 }), rolesArb)
  .map(([userId, roles]) => defaultPersonaForRoles(userId, roles));

/** Any persona: a stored Twin_Persona or the role-derived default (Req 8.4). */
const anyPersonaArb: fc.Arbitrary<TwinPersona> = fc.oneof(
  storedPersonaArb,
  defaultPersonaArb,
);

/** A numeric figure token as it would appear in a narration draft (int or decimal). */
const figureTokenArb: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 0, max: 100_000 }).map(String),
  fc
    .tuple(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 0, max: 99 }))
    .map(([whole, frac]) => `${whole}.${frac}`),
);

/** Prose words that carry no digits, so the only digits in a draft are figures. */
const wordArb = fc.constantFrom(
  "Cost",
  "per",
  "qualified",
  "lead",
  "is",
  "and",
  "speed",
  "to",
  "tier",
  "HOT",
  "load",
  "leads",
  "funnel",
  "median",
);

/** A narration draft mixing prose words and figure tokens (at least one figure). */
const draftArb: fc.Arbitrary<string> = fc
  .array(fc.oneof(wordArb, figureTokenArb), { minLength: 1, maxLength: 12 })
  .chain((tokens) =>
    // Guarantee at least one figure token so the property exercises real figures.
    figureTokenArb.map((fig) => [...tokens, fig].join(" ")),
  );

/** A representative PipelineMetrics value (shapeNarration ignores it but takes it). */
const pipelineMetricsArb: fc.Arbitrary<PipelineMetrics> = fc
  .record({
    scope: fc.constantFrom("exec", "rep"),
    period: fc.constantFrom("all-time", "this-week"),
    hot: fc.integer({ min: 0, max: 9999 }),
    warm: fc.integer({ min: 0, max: 9999 }),
  })
  .map(({ scope, period, hot, warm }) => ({
    scope,
    period,
    metrics: {
      costPerQualifiedLead: [],
      tierFunnel: { hot, warm },
      speedToLead: null,
      repLoad: [],
      weekOverWeek: null,
    },
  }));

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Every numeric token (int or decimal), in order of appearance. */
function numericTokens(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

/** A minimal in-memory Persona_Store keyed by resourceId (`user:{userId}`). */
function fakeStore(seed: Record<string, string> = {}): PersonaStore {
  const map = new Map(Object.entries(seed));
  return {
    async read(resourceId) {
      return map.get(resourceId) ?? null;
    },
    async write(resourceId, value) {
      map.set(resourceId, value);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Property 10 — figures untouched: shaping alters only the narration
// ─────────────────────────────────────────────────────────────────────────────

// Feature: agentic-reporting-twin, Property 10: Persona shapes narration but never a figure
describe("Feature: agentic-reporting-twin, Property 10: Persona shapes narration but never a figure", () => {
  it("preserves every figure token in the draft, altering only the narration (Req 8.3, 8.4)", () => {
    fc.assert(
      fc.property(anyPersonaArb, pipelineMetricsArb, draftArb, (persona, metrics, draft) => {
        const shaped = shapeNarration(persona, metrics, draft);
        const body = draft.trim();

        // The draft body — which carries the figures — is included VERBATIM.
        expect(shaped).toContain(body);

        // Every numeric figure survives unchanged and in the same order: the
        // shaped output's figure tokens equal the draft's exactly. The persona
        // framing contributes no digits, so any altered figure would show here.
        expect(numericTokens(shaped)).toEqual(numericTokens(body));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("derives a schema-valid default persona for any role set (Req 8.4)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), rolesArb, (userId, roles) => {
        const persona = defaultPersonaForRoles(userId, roles);
        // A complete, well-formed persona is always produced (no stored persona needed).
        expect(() => twinPersonaSchema.parse(persona)).not.toThrow();
        expect(persona.userId).toBe(userId);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Property 10 — isolation: a read returns only the requesting user's persona
  // ───────────────────────────────────────────────────────────────────────────

  it("a persona read returns only the requesting user's persona, never another user's (Req 8.6)", async () => {
    // Distinct, store-safe user ids so each maps to its own `user:{id}` key.
    const usersArb = fc
      .uniqueArray(fc.integer({ min: 0, max: 99_999 }), { minLength: 2, maxLength: 6 })
      .map((ns) => ns.map((n) => `u-${n}`));

    const TONES: PersonaTone[] = ["strategic", "operational", "concise"];
    const DEPTHS: PersonaDepth[] = ["summary", "detailed"];

    await fc.assert(
      fc.asyncProperty(usersArb, fc.nat(), rolesArb, async (users, pick, roles) => {
        // One distinct persona per user, seeded under its own resource key.
        const personas: TwinPersona[] = users.map((userId, i) => ({
          userId,
          tone: TONES[i % TONES.length],
          depth: DEPTHS[i % DEPTHS.length],
          defaultScope: { scope: "exec", period: "all-time" },
          writtenBy: "agent:reporting-twin",
        }));
        const seed: Record<string, string> = {};
        personas.forEach((p) => {
          seed[`user:${p.userId}`] = JSON.stringify(p);
        });
        const store = fakeStore(seed);

        const i = pick % users.length;
        const res = await readPersona(users[i], roles, { store });

        // The read returns this user's stored persona...
        expect(res.source).toBe("stored");
        expect(res.persona).toEqual(personas[i]);
        expect(res.persona.userId).toBe(users[i]);

        // ...and never leaks any other user's persona.
        personas.forEach((other, j) => {
          if (j !== i) expect(res.persona.userId).not.toBe(other.userId);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
