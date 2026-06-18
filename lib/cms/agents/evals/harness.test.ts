// lib/cms/agents/evals/harness.test.ts
//
// Unit/example test for the Eval_Harness (Agentic Foundation S1, task 7.2).
//
// Two guarantees are asserted:
//
//   1. runEvals reports EXACTLY ONE pass/fail EvalReport per fixture case — the
//      report count equals the case count, each report carries a boolean
//      pass/fail, and the reports are in the same order as the cases
//      (Requirement 6.3).
//
//   2. The case set covers EVERY Migrated_Capability of Requirement 8.1 (the ten
//      text capabilities) and Requirement 9.1 (the admin read-only reports), plus
//      the human-in-the-loop confirmation flow (Requirement 6.4). Expected
//      coverage is derived INDEPENDENTLY from the canonical capability modules
//      (TEXT_CAPABILITY_NAMES, adminReportCapabilities) so the eval set can never
//      silently drift from the catalog.
//
// Validates: Requirements 6.3, 6.4.

import { describe, expect, it } from "vitest";

import {
  runEvals,
  createReferenceTextAgent,
  createReferenceAdminAgent,
  runDefaultEvals,
  textEvalCases,
  adminReportEvalCases,
  adminEvalCases,
  allEvalCases,
  adminConfirmationFlowCase,
  TEXT_EVAL_CAPABILITIES,
  ADMIN_REPORT_EVAL_CAPABILITIES,
  ADMIN_CONFIRMATION_FLOW_CAPABILITY,
} from "./index";
import { TEXT_CAPABILITY_NAMES } from "../../ai/tools/text-capabilities";
import { adminReportCapabilities } from "../../ai/tools/admin-capabilities";

// Canonical coverage targets derived straight from the capability modules — NOT
// from the eval module — so the test fails if the eval set drifts from them.
const CANONICAL_TEXT_CAPABILITIES = TEXT_CAPABILITY_NAMES;
const CANONICAL_ADMIN_REPORTS = adminReportCapabilities.map((e) => e.name);

describe("Eval_Harness — one report per case (Requirement 6.3)", () => {
  it("runEvals returns exactly one EvalReport per text case, in order", async () => {
    const agent = createReferenceTextAgent();
    const reports = await runEvals(agent, textEvalCases);

    // Exactly one report per fixture case — no more, no fewer.
    expect(reports).toHaveLength(textEvalCases.length);
    // Reports line up 1:1 with the cases, in the same order.
    expect(reports.map((r) => r.capability)).toEqual(
      textEvalCases.map((c) => c.capability),
    );
    // Every report carries a single boolean pass/fail result.
    for (const report of reports) {
      expect(typeof report.pass).toBe("boolean");
    }
  });

  it("runEvals returns exactly one EvalReport per admin case, in order", async () => {
    const agent = createReferenceAdminAgent();
    const reports = await runEvals(agent, adminEvalCases);

    expect(reports).toHaveLength(adminEvalCases.length);
    expect(reports.map((r) => r.capability)).toEqual(
      adminEvalCases.map((c) => c.capability),
    );
    for (const report of reports) {
      expect(typeof report.pass).toBe("boolean");
    }
  });

  it("runEvals reports each case independently (no merging or dropping)", async () => {
    // Duplicate a case; the harness must still emit one report per input case.
    const agent = createReferenceTextAgent();
    const dupCases = [textEvalCases[0], textEvalCases[0], textEvalCases[1]];
    const reports = await runEvals(agent, dupCases);
    expect(reports).toHaveLength(dupCases.length);
  });

  it("runEvals returns no reports for an empty case set", async () => {
    const reports = await runEvals(createReferenceTextAgent(), []);
    expect(reports).toEqual([]);
  });

  it("each reference agent passes every one of its own cases", async () => {
    // Sanity check that the fixtures are wired to the right tools: a failing
    // case would otherwise hide a coverage gap behind a green count.
    const reports = await runDefaultEvals();
    expect(reports).toHaveLength(allEvalCases.length);
    const failures = reports.filter((r) => !r.pass);
    expect(failures).toEqual([]);
  });
});

describe("Eval_Harness — capability coverage (Requirement 6.4)", () => {
  it("covers every text capability in Requirement 8.1", async () => {
    // The canonical set is the ten text capabilities defined in the catalog.
    expect(CANONICAL_TEXT_CAPABILITIES).toHaveLength(10);

    const covered = new Set(textEvalCases.map((c) => c.capability));
    for (const name of CANONICAL_TEXT_CAPABILITIES) {
      expect(covered.has(name)).toBe(true);
    }

    // The coverage anchor the eval module exposes matches the canonical names.
    expect([...TEXT_EVAL_CAPABILITIES].sort()).toEqual(
      [...CANONICAL_TEXT_CAPABILITIES].sort(),
    );
  });

  it("provides exactly one text case per Requirement 8.1 capability (no gaps, no dupes)", () => {
    const capabilities = textEvalCases.map((c) => c.capability);
    // No duplicate capability cases.
    expect(new Set(capabilities).size).toBe(capabilities.length);
    // The case-set capability set equals the canonical capability set.
    expect([...new Set(capabilities)].sort()).toEqual(
      [...CANONICAL_TEXT_CAPABILITIES].sort(),
    );
  });

  it("covers every admin read-only report in Requirement 9.1", () => {
    expect(CANONICAL_ADMIN_REPORTS).toEqual(
      expect.arrayContaining([
        "report_overview",
        "report_projects",
        "report_clients",
        "report_leads",
        "report_tickets",
        "report_appointments",
      ]),
    );

    const covered = new Set(adminReportEvalCases.map((c) => c.capability));
    for (const name of CANONICAL_ADMIN_REPORTS) {
      expect(covered.has(name)).toBe(true);
    }

    expect([...ADMIN_REPORT_EVAL_CAPABILITIES].sort()).toEqual(
      [...CANONICAL_ADMIN_REPORTS].sort(),
    );
  });

  it("provides exactly one admin report case per Requirement 9.1 report (no gaps, no dupes)", () => {
    const capabilities = adminReportEvalCases.map((c) => c.capability);
    expect(new Set(capabilities).size).toBe(capabilities.length);
    expect([...new Set(capabilities)].sort()).toEqual(
      [...CANONICAL_ADMIN_REPORTS].sort(),
    );
  });

  it("includes the human-in-the-loop confirmation flow case (Requirement 9.3–9.4)", () => {
    expect(adminConfirmationFlowCase.capability).toBe(
      ADMIN_CONFIRMATION_FLOW_CAPABILITY,
    );
    const covered = new Set(adminEvalCases.map((c) => c.capability));
    expect(covered.has(ADMIN_CONFIRMATION_FLOW_CAPABILITY)).toBe(true);
  });

  it("the full case set covers every Requirement 8.1 + 9.1 capability plus the confirmation flow", () => {
    const covered = new Set(allEvalCases.map((c) => c.capability));
    const expected = [
      ...CANONICAL_TEXT_CAPABILITIES,
      ...CANONICAL_ADMIN_REPORTS,
      ADMIN_CONFIRMATION_FLOW_CAPABILITY,
    ];
    for (const name of expected) {
      expect(covered.has(name)).toBe(true);
    }
    // The full suite has one report per case after running.
    expect(allEvalCases).toHaveLength(expected.length);
  });
});
