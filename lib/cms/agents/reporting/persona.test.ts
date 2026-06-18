/**
 * Unit tests for the Twin_Persona & Persona_Store module (S4 task 9.1).
 *
 * Exercises the three operations against an in-memory `PersonaStore` fake:
 *   - readPersona: stored hit, role-default miss, read-failure/timeout fallback,
 *     malformed-value fallback, and isolation by resource key.
 *   - createPersona: first write succeeds; a second submission is rejected with
 *     `already_exists` and the original is retained.
 *   - shapeNarration: alters only the prose; the draft figures are untouched.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6.
 */

import { describe, it, expect } from "vitest";

import type { PipelineMetrics } from "../../metrics/pipeline";
import {
  createPersona,
  defaultPersonaForRoles,
  readPersona,
  shapeNarration,
  twinPersonaSchema,
  type PersonaStore,
  type TwinPersona,
} from "./persona";
import { EXEC_SCOPE_PERMISSION, REP_SCOPE_PERMISSION } from "./scope";

/** A minimal in-memory Persona_Store keyed by resourceId (`user:{userId}`). */
function fakeStore(seed: Record<string, string> = {}): PersonaStore & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(seed));
  return {
    map,
    async read(resourceId) {
      return map.get(resourceId) ?? null;
    },
    async write(resourceId, value) {
      map.set(resourceId, value);
    },
  };
}

const EXEC_PERSONA: TwinPersona = {
  userId: "u-exec",
  tone: "strategic",
  depth: "summary",
  defaultScope: { scope: "exec", period: "all-time" },
  writtenBy: "agent:reporting-twin",
};

const METRICS: PipelineMetrics = {
  scope: "exec",
  period: "all-time",
  metrics: {
    costPerQualifiedLead: [],
    tierFunnel: { hot: 42 },
    speedToLead: null,
    repLoad: [],
    weekOverWeek: null,
  },
};

describe("defaultPersonaForRoles", () => {
  it("derives a strategic/summary exec persona from an exec permission (Req 8.4)", () => {
    const p = defaultPersonaForRoles("u1", [EXEC_SCOPE_PERMISSION]);
    expect(p.tone).toBe("strategic");
    expect(p.depth).toBe("summary");
    expect(p.defaultScope.scope).toBe("exec");
  });

  it("derives an operational/detailed rep persona for a rep-level role (Req 8.4)", () => {
    const p = defaultPersonaForRoles("u2", [REP_SCOPE_PERMISSION]);
    expect(p.tone).toBe("operational");
    expect(p.depth).toBe("detailed");
    expect(p.defaultScope.scope).toBe("rep");
    // The default rep scope omits repId; resolution binds the own repId (Req 3.3).
    expect(p.defaultScope.repId).toBeUndefined();
  });

  it("recognises common exec role names case-insensitively", () => {
    expect(defaultPersonaForRoles("u3", ["Executive"]).defaultScope.scope).toBe("exec");
    expect(defaultPersonaForRoles("u4", ["ADMIN"]).defaultScope.scope).toBe("exec");
  });
});

describe("readPersona", () => {
  it("returns the stored persona when one exists (Req 8.6)", async () => {
    const store = fakeStore({ "user:u-exec": JSON.stringify(EXEC_PERSONA) });
    const res = await readPersona("u-exec", [EXEC_SCOPE_PERMISSION], { store });
    expect(res.source).toBe("stored");
    expect(res.error).toBeUndefined();
    expect(res.persona).toEqual(EXEC_PERSONA);
  });

  it("falls back to the role default when no persona is stored (Req 8.4)", async () => {
    const store = fakeStore();
    const res = await readPersona("u-new", [REP_SCOPE_PERMISSION], { store });
    expect(res.source).toBe("default");
    expect(res.error).toBeUndefined();
    expect(res.persona.tone).toBe("operational");
  });

  it("falls back with an error on a read failure (Req 8.5)", async () => {
    const store: PersonaStore = {
      async read() {
        throw new Error("store down");
      },
      async write() {},
    };
    const res = await readPersona("u-exec", [EXEC_SCOPE_PERMISSION], { store });
    expect(res.source).toBe("default");
    expect(res.error).toMatch(/could not be read/i);
    expect(res.persona.tone).toBe("strategic");
  });

  it("falls back with an error when the read exceeds the timeout (Req 8.5)", async () => {
    const store: PersonaStore = {
      read: () => new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 50)),
      async write() {},
    };
    const res = await readPersona("u-exec", [EXEC_SCOPE_PERMISSION], {
      store,
      timeoutMs: 5,
    });
    expect(res.source).toBe("default");
    expect(res.error).toMatch(/could not be read/i);
  });

  it("falls back with an error when the stored value is malformed (Req 8.5)", async () => {
    const store = fakeStore({ "user:u-exec": "{not json" });
    const res = await readPersona("u-exec", [EXEC_SCOPE_PERMISSION], { store });
    expect(res.source).toBe("default");
    expect(res.error).toMatch(/malformed/i);
  });

  it("reads only the requesting user's resource key (Req 8.6)", async () => {
    const store = fakeStore({
      "user:u-exec": JSON.stringify(EXEC_PERSONA),
      "user:u-other": JSON.stringify({ ...EXEC_PERSONA, userId: "u-other", tone: "concise" }),
    });
    const res = await readPersona("u-exec", [EXEC_SCOPE_PERMISSION], { store });
    expect(res.persona.userId).toBe("u-exec");
    expect(res.persona.tone).toBe("strategic");
  });
});

describe("createPersona", () => {
  it("associates a persona on first submission (Req 8.1)", async () => {
    const store = fakeStore();
    const res = await createPersona(EXEC_PERSONA, { store });
    expect(res).toEqual({ ok: true });
    expect(store.map.get("user:u-exec")).toBe(JSON.stringify(EXEC_PERSONA));
  });

  it("rejects a second submission and retains the original (Req 8.1)", async () => {
    const store = fakeStore();
    await createPersona(EXEC_PERSONA, { store });

    const second: TwinPersona = { ...EXEC_PERSONA, tone: "concise", depth: "detailed" };
    const res = await createPersona(second, { store });

    expect(res).toEqual({ ok: false, error: "already_exists" });
    // The original association is retained, not overwritten.
    expect(JSON.parse(store.map.get("user:u-exec")!).tone).toBe("strategic");
  });

  it("throws on an invalid persona (caller bug)", async () => {
    const store = fakeStore();
    // @ts-expect-error — deliberately invalid tone to exercise validation.
    await expect(createPersona({ ...EXEC_PERSONA, tone: "loud" }, { store })).rejects.toThrow();
  });
});

describe("shapeNarration", () => {
  it("leaves every draft figure untouched while changing the prose (Req 8.3)", () => {
    const draft = "Cost per qualified lead is 42 and speed-to-lead is 120s.";
    const shaped = shapeNarration(EXEC_PERSONA, METRICS, draft);

    expect(shaped).not.toBe(draft); // prose was shaped
    expect(shaped).toContain("42");
    expect(shaped).toContain("120s");
    expect(shaped).toContain("Strategic read:");
  });

  it("applies operational/detailed framing with a breakdown prompt (Req 8.2)", () => {
    const repPersona = defaultPersonaForRoles("r1", [REP_SCOPE_PERMISSION]);
    const draft = "Your load is 17 leads.";
    const shaped = shapeNarration(repPersona, METRICS, draft);

    expect(shaped).toContain("Operational detail:");
    expect(shaped).toContain("17");
    expect(shaped).toMatch(/breakdown/i);
  });

  it("a concise persona adds only a brief lead-in", () => {
    const concise: TwinPersona = { ...EXEC_PERSONA, tone: "concise", depth: "summary" };
    const shaped = shapeNarration(concise, METRICS, "HOT tier is 9.");
    expect(shaped).toBe("In brief: HOT tier is 9.");
  });
});

describe("twinPersonaSchema", () => {
  it("accepts a well-formed persona and round-trips through JSON", () => {
    const round = twinPersonaSchema.parse(JSON.parse(JSON.stringify(EXEC_PERSONA)));
    expect(round).toEqual(EXEC_PERSONA);
  });
});
