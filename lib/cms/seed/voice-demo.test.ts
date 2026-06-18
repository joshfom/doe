import { describe, it, expect } from "vitest";

import {
  buildReps,
  buildPartiesAndLeads,
  buildMarketingSpend,
  buildViewingSlots,
  KNOWN_WARM_CALLER,
} from "./voice-demo";

/**
 * Unit tests for the DOE voice demo seed builders (task 18.1).
 *
 * These exercise the pure row-builders (no DB) to lock in the dataset
 * guarantees the spec and downstream tasks depend on:
 *
 *   • Requirement 11.4 — every demo-scoped row carries `demo = true`.
 *   • Requirement 11.5 — synthetic personas incl. a known WARM caller and an
 *     unassigned-routing case, reps, viewing slots, and a 90-day metrics set.
 *   • The lead `source` values all have matching `marketing_spend` channels
 *     (except organic `web`), so the `metrics_*` cost-per-qualified-lead views
 *     return meaningful figures.
 */

describe("buildReps", () => {
  it("seeds Sara (EN/AR, Bayn) and Omar (EN), both demo-scoped with capacity", () => {
    const reps = buildReps();
    expect(reps).toHaveLength(2);

    const sara = reps.find((r) => r.key === "sara")!;
    expect(sara.languages).toEqual(["en", "ar"]);
    expect(sara.projects).toContain("Bayn");
    expect(sara.capacity).toBe(3);
    expect(sara.openHotCount).toBe(2);

    const omar = reps.find((r) => r.key === "omar")!;
    expect(omar.languages).toEqual(["en"]);
    expect(omar.openHotCount).toBe(1);

    for (const r of reps) {
      expect(r.demo).toBe(true);
      expect(r.phone).toMatch(/^\+9715\d+$/);
    }
  });
});

describe("buildPartiesAndLeads", () => {
  it("includes a known WARM caller (Khalid) that is left unassigned for live routing", () => {
    const { parties, leads } = buildPartiesAndLeads();

    const khalidParty = parties.find((p) => p.key === KNOWN_WARM_CALLER.key);
    expect(khalidParty).toBeDefined();
    expect(khalidParty!.name).toBe(KNOWN_WARM_CALLER.name);
    expect(khalidParty!.phone).toBe(KNOWN_WARM_CALLER.phone);

    const khalidLead = leads.find((l) => l.partyKey === KNOWN_WARM_CALLER.key)!;
    expect(khalidLead.tier).toBe("WARM");
    expect(khalidLead.projectInterest).toBe("Bayn");
    expect(khalidLead.unitInterest).toBe("2BR");
    // Unassigned → routing happens live on stage (also the unassigned case).
    expect(khalidLead.assignedRepKey).toBeNull();
  });

  it("has at least one unassigned-routing lead beyond Khalid", () => {
    const { leads } = buildPartiesAndLeads();
    const unassigned = leads.filter((l) => l.assignedRepKey === null);
    expect(unassigned.length).toBeGreaterThan(1);
  });

  it("marks every party and lead as demo-scoped (Req 11.4)", () => {
    const { parties, leads } = buildPartiesAndLeads();
    expect(parties.every((p) => p.demo === true)).toBe(true);
    expect(leads.every((l) => l.demo === true)).toBe(true);
  });

  it("spreads lead arrival across roughly the last 90 days (Req 11.5)", () => {
    const { parties } = buildPartiesAndLeads();
    const now = Date.now();
    const ninetyOneDaysMs = 91 * 24 * 60 * 60 * 1000;
    for (const p of parties) {
      const age = now - p.createdAt.getTime();
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThanOrEqual(ninetyOneDaysMs);
    }
    // Enough distinct arrival days to make week buckets non-trivial.
    const distinctDays = new Set(
      parties.map((p) => p.createdAt.toISOString().slice(0, 10))
    );
    expect(distinctDays.size).toBeGreaterThan(20);
  });

  it("is deterministic across runs (stable rehearsal figures)", () => {
    const a = buildPartiesAndLeads();
    const b = buildPartiesAndLeads();
    expect(a.parties.length).toBe(b.parties.length);
    expect(a.leads.map((l) => `${l.partyKey}:${l.tier}:${l.source}`)).toEqual(
      b.leads.map((l) => `${l.partyKey}:${l.tier}:${l.source}`)
    );
  });
});

describe("buildMarketingSpend", () => {
  it("emits demo-scoped weekly spend for every paid channel over 90 days", () => {
    const spend = buildMarketingSpend();
    expect(spend.length).toBeGreaterThan(0);
    for (const s of spend) {
      expect(s.demo).toBe(true);
      expect(Number(s.spend)).toBeGreaterThan(0);
      expect(s.currency).toBe("AED");
    }
    // Organic `web` has no spend rows (cost is null/zero in the views).
    expect(spend.some((s) => s.channel === "web")).toBe(false);
  });

  it("covers the same channels the leads attribute to (so CPQL views join)", () => {
    const { leads } = buildPartiesAndLeads();
    const spendChannels = new Set(buildMarketingSpend().map((s) => s.channel));
    const paidLeadChannels = new Set(
      leads.map((l) => l.source).filter((c) => c !== "web" && c !== "Meta")
    );
    // Every paid lead source (excluding organic web + Khalid's march campaign
    // which is Meta) has a corresponding spend channel.
    for (const c of paidLeadChannels) {
      expect(spendChannels.has(c)).toBe(true);
    }
    expect(spendChannels.has("Meta")).toBe(true);
  });

  it("makes events the high-spend / low-yield anomaly vs an efficient channel", () => {
    const spend = buildMarketingSpend();
    const { leads } = buildPartiesAndLeads();

    const totalSpend = (ch: string) =>
      spend.filter((s) => s.channel === ch).reduce((a, s) => a + Number(s.spend), 0);
    const qualified = (ch: string) => leads.filter((l) => l.source === ch).length;

    const cpql = (ch: string) => totalSpend(ch) / Math.max(1, qualified(ch));

    // The events channel should have a much worse cost-per-qualified-lead than
    // the efficient Google channel — the narratable anomaly.
    expect(cpql("events")).toBeGreaterThan(cpql("Google"));
  });
});

describe("buildViewingSlots", () => {
  it("seeds demo-scoped Bayn slots on Thu/Fri/Sat with some still open", () => {
    const slots = buildViewingSlots();
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(s.demo).toBe(true);
      expect(s.project).toBe("Bayn");
      // JS getDay: Thu=4, Fri=5, Sat=6.
      expect([4, 5, 6]).toContain(s.startsAt.getDay());
    }
    expect(slots.some((s) => !s.taken)).toBe(true);
  });
});
