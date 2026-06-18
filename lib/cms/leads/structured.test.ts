import { describe, it, expect } from "vitest";

import {
  extractStructuredFields,
  structuredLeadFieldsSchema,
} from "./structured";

/**
 * Unit tests for the deterministic Structured_Lead_Fields extractor — the parse
 * step behind the Console's "Run analysis" action. Pure logic, no DB.
 */
describe("extractStructuredFields", () => {
  it("classifies a buying enquiry and extracts unit + budget", () => {
    const f = extractStructuredFields(
      "Hi, I'm interested in buying a 2BR apartment in Dubai Marina, budget around 2.5M.",
      {}
    );
    expect(f.intent).toBe("buy");
    expect(f.unitInterest).toBe("2BR");
    expect(f.budgetBand).toMatch(/2\.5M/i);
  });

  it("normalizes a spelled-out unit type to a tidy band", () => {
    const f = extractStructuredFields("Looking for a 3 bedroom villa to rent", {});
    expect(f.intent).toBe("rent");
    // "3 bedroom" → "3BR"; "villa" also matches but the bedroom count wins first.
    expect(f.unitInterest).toBe("3BR");
  });

  it("captures a timeline phrase", () => {
    const f = extractStructuredFields("I want to move in ASAP", {});
    expect(f.timeline?.toLowerCase()).toContain("asap");
  });

  it("uses the campaign attribution as the project signal", () => {
    const f = extractStructuredFields("Tell me more", {
      attribution: { utm_campaign: "marina-launch" },
    });
    expect(f.projectInterest).toBe("marina-launch");
  });

  it("prefers an explicit name in the content, else the captured name hint", () => {
    expect(extractStructuredFields("My name is Aisha Al Mansoori", {}).name).toBe(
      "Aisha Al Mansoori"
    );
    expect(extractStructuredFields("no name here", { name: "Fallback Name" }).name).toBe(
      "Fallback Name"
    );
  });

  it("leaves unknown fields unset and defaults intent to unknown", () => {
    const f = extractStructuredFields("", {});
    expect(f.intent).toBe("unknown");
    expect(f.unitInterest).toBeUndefined();
    expect(f.budgetBand).toBeUndefined();
    expect(f.projectInterest).toBeUndefined();
  });

  it("always returns a value valid against the canonical schema", () => {
    const samples = [
      "rent a studio next month",
      "selling my apartment",
      "investment opportunity with good roi",
      "schedule a viewing this week",
      "",
    ];
    for (const s of samples) {
      const f = extractStructuredFields(s, {});
      expect(structuredLeadFieldsSchema.safeParse(f).success).toBe(true);
    }
  });
});
