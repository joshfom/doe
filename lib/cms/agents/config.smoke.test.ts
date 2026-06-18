// lib/cms/agents/config.smoke.test.ts
//
// Configuration smoke checks (Agentic Foundation S1, task 8.2). A single
// hermetic, single-execution example test (NOT a property test) that asserts the
// foundation's configuration invariants hold together:
//
//   1. package.json pins `@mastra/core` to an exact MAJOR.MINOR.PATCH (no range
//      operators)                                                       (Req 1.1, 16.1)
//   2. the single Mastra entry point (runtime.ts) registers all five pieces —
//      agents (textAgent + adminAgent), workflows, the Tool_Catalog binding
//      (bindCatalog), Agent_Memory (getAgentMemory), tracing (tracingExporter),
//      plus model tiering via DoeModelGateway                           (Req 1.3)
//   3. the catalog exposes all ten text capabilities and the named admin report
//      entries                                                          (Req 8.1, 9.1)
//   4. the eval set covers every Req 8.1/9.1 capability                 (Req 6.4)
//   5. MODEL_TIERS has >= 2 non-empty tiers                             (Req 5.2)
//   6. app/api/[...slugs]/route.ts still exports runtime="nodejs" and
//      dynamic="force-dynamic"                                          (Req 15.1)
//   7. the Mastra runtime is imported only by worker entrypoints, never by any
//      app/ route/page/layout module                                   (Req 15.3)
//   8. decisions.md contains all required resolutions and deferrals    (Req 16.1, 16.2)
//
// HERMETIC BY DESIGN: this test never instantiates the full Mastra runtime
// (which pulls @mastra/core, the DB connection, and env). The runtime
// registration assertions are made by STATIC FILE READS of runtime.ts/index.ts,
// and only the lightweight, side-effect-free modules (text-capabilities,
// admin-capabilities, gateway MODEL_TIERS, the eval coverage anchors) are
// imported. It runs with no network and no credentials.
//
// [next-docs] The route-settings assertion (#6) reads the relevant Next.js 16
// guide convention (route segment config: `runtime`, `dynamic`) and asserts the
// settings by READING app/api/[...slugs]/route.ts content — it never modifies
// the file. Per the Next.js 16 docs, `runtime` ('nodejs' | 'edge') and
// `dynamic` remain valid route-segment exports (Cache Components is not enabled
// in this app), so the hard-won settings are preserved verbatim.
//
// Design references: §Testing Strategy (Smoke/configuration).
// Requirements: 1.1, 1.3, 5.2, 6.4, 8.1, 9.1, 15.1, 15.3, 16.1, 16.2.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MODEL_TIERS } from "./gateway";
import { TEXT_CAPABILITY_NAMES } from "../ai/tools/text-capabilities";
import { adminReportCapabilities } from "../ai/tools/admin-capabilities";
import {
  allEvalCases,
  TEXT_EVAL_CAPABILITIES,
  ADMIN_REPORT_EVAL_CAPABILITIES,
} from "./evals";

// ── Paths (resolved from this file, so cwd-independent) ───────────────────────

const here = path.dirname(fileURLToPath(import.meta.url)); // lib/cms/agents
const repoRoot = path.resolve(here, "../../.."); // repo root

const read = (rel: string): string =>
  readFileSync(path.join(repoRoot, rel), "utf8");

// ── Expected capability sets (the canonical Req 8.1 / 9.1 names) ──────────────

const EXPECTED_TEXT_CAPABILITIES = [
  "create_lead",
  "register_lead",
  "create_ticket",
  "create_booking",
  "cancel_appointment",
  "reschedule_appointment",
  "request_otp",
  "request_handover",
  "navigate",
  "provide_contact",
] as const;

const EXPECTED_ADMIN_REPORTS = [
  "report_overview",
  "report_projects",
  "report_clients",
  "report_leads",
  "report_tickets",
  "report_appointments",
] as const;

describe("Agentic Foundation — configuration smoke checks (task 8.2)", () => {
  // 1. Exact Mastra pin (Req 1.1) ─────────────────────────────────────────────
  // Asserted via regex (no hardcoded version) so it never conflicts with task
  // 8.1 adjusting the exact resolved patch.
  describe("package.json (Req 1.1)", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };

    it("pins @mastra/core to an exact MAJOR.MINOR.PATCH (no range operators)", () => {
      const pin = pkg.dependencies?.["@mastra/core"];
      expect(pin, "@mastra/core must be a declared dependency").toBeTypeOf(
        "string",
      );
      // Exact semver: digits.digits.digits, no ^ ~ * >= <= || x ranges.
      expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  // 2. Single Mastra entry point registers all five pieces (Req 1.3) ──────────
  describe("single Mastra entry point — runtime.ts (Req 1.3)", () => {
    const runtimeSrc = read("lib/cms/agents/runtime.ts");
    const indexSrc = read("lib/cms/agents/index.ts");

    it("declares exactly one `new Mastra(...)` configuration", () => {
      // Count the actual instantiation statement, not prose in comments that
      // mention `new Mastra(...)`.
      const occurrences =
        runtimeSrc.match(/export\s+const\s+mastra\s*=\s*new Mastra\s*\(/g) ?? [];
      expect(occurrences).toHaveLength(1);
    });

    it("registers the agents map with textAgent and adminAgent", () => {
      const agentsBlock = runtimeSrc.match(/agents:\s*\{([^}]*)\}/);
      expect(agentsBlock, "an `agents: { ... }` registration must exist").not
        .toBeNull();
      expect(agentsBlock![1]).toContain("textAgent");
      expect(agentsBlock![1]).toContain("adminAgent");
    });

    it("registers a workflows map", () => {
      expect(runtimeSrc).toMatch(/workflows:\s*\{/);
    });

    it("binds the Tool_Catalog by re-exporting bindCatalog", () => {
      expect(runtimeSrc).toMatch(/export\s*\{\s*bindCatalog\s*\}/);
    });

    it("registers Agent_Memory via getAgentMemory()", () => {
      const memoryBlock = runtimeSrc.match(/memory:\s*\{([^}]*)\}/);
      expect(memoryBlock, "a `memory: { ... }` registration must exist").not
        .toBeNull();
      expect(memoryBlock![1]).toContain("getAgentMemory()");
    });

    it("registers tracing via the tracingExporter re-export", () => {
      expect(runtimeSrc).toMatch(/export\s*\{\s*tracingExporter\s*\}/);
    });

    it("registers model tiering via DoeModelGateway", () => {
      const gatewaysBlock = runtimeSrc.match(/gateways:\s*\{([^}]*)\}/);
      expect(gatewaysBlock, "a `gateways: { ... }` registration must exist").not
        .toBeNull();
      expect(gatewaysBlock![1]).toContain("new DoeModelGateway()");
    });

    it("re-exports the mastra instance and typed helpers from index.ts", () => {
      expect(indexSrc).toContain("mastra");
      expect(indexSrc).toContain("runAgentTurn");
      expect(indexSrc).toContain("routeCapability");
    });
  });

  // 3. Catalog contains all ten text capabilities + named admin reports ───────
  describe("catalog coverage (Req 8.1, 9.1)", () => {
    it("exposes all ten text capabilities (TEXT_CAPABILITY_NAMES)", () => {
      expect([...TEXT_CAPABILITY_NAMES].sort()).toEqual(
        [...EXPECTED_TEXT_CAPABILITIES].sort(),
      );
    });

    it("exposes the six named admin report entries (adminReportCapabilities)", () => {
      const reportNames = adminReportCapabilities.map((e) => e.name).sort();
      expect(reportNames).toEqual([...EXPECTED_ADMIN_REPORTS].sort());
    });
  });

  // 4. Eval set covers every Req 8.1 / 9.1 capability (Req 6.4) ────────────────
  describe("eval coverage (Req 6.4)", () => {
    const coveredCapabilities = new Set(allEvalCases.map((c) => c.capability));

    it("the coverage anchors match the canonical catalog", () => {
      expect([...TEXT_EVAL_CAPABILITIES].sort()).toEqual(
        [...EXPECTED_TEXT_CAPABILITIES].sort(),
      );
      expect([...ADMIN_REPORT_EVAL_CAPABILITIES].sort()).toEqual(
        [...EXPECTED_ADMIN_REPORTS].sort(),
      );
    });

    it("provides at least one eval case for every text capability (Req 8.1)", () => {
      for (const name of EXPECTED_TEXT_CAPABILITIES) {
        expect(coveredCapabilities.has(name), `missing eval case: ${name}`).toBe(
          true,
        );
      }
    });

    it("provides at least one eval case for every admin report (Req 9.1)", () => {
      for (const name of EXPECTED_ADMIN_REPORTS) {
        expect(coveredCapabilities.has(name), `missing eval case: ${name}`).toBe(
          true,
        );
      }
    });
  });

  // 5. MODEL_TIERS has >= 2 non-empty tiers (Req 5.2) ─────────────────────────
  describe("model tiering (Req 5.2)", () => {
    it("defines at least two non-empty Model_Tiers", () => {
      const entries = Object.entries(MODEL_TIERS);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      for (const [tier, model] of entries) {
        expect(typeof model, `tier ${tier} must map to a string`).toBe(
          "string",
        );
        expect((model as string).trim().length, `tier ${tier} must be non-empty`)
          .toBeGreaterThan(0);
      }
    });
  });

  // 6. Route settings preserved (Req 15.1) ────────────────────────────────────
  // Asserted by reading the file content; the file is never modified here.
  describe("app/api/[...slugs]/route.ts settings (Req 15.1)", () => {
    const routeSrc = read("app/api/[...slugs]/route.ts");

    it('still exports runtime = "nodejs"', () => {
      expect(routeSrc).toMatch(
        /export\s+const\s+runtime\s*=\s*["']nodejs["']/,
      );
    });

    it('still exports dynamic = "force-dynamic"', () => {
      expect(routeSrc).toMatch(
        /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
      );
    });
  });

  // 7. Runtime imported only by worker entrypoints, never by app/ (Req 15.3) ──
  describe("worker-tier isolation (Req 15.3)", () => {
    it("no app/ route/page/layout module imports the Mastra agents runtime", () => {
      const appDir = path.join(repoRoot, "app");
      const offenders: string[] = [];

      const sourceFiles: string[] = [];
      const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) {
            walk(full);
          } else if (/\.(ts|tsx)$/.test(name)) {
            sourceFiles.push(full);
          }
        }
      };
      walk(appDir);

      // Sanity: we actually scanned app/ source files.
      expect(sourceFiles.length).toBeGreaterThan(0);

      // Match a static import that resolves to the agents runtime/index, e.g.
      //   import { mastra } from "@/lib/cms/agents";
      //   import { runAgentTurn } from "../../lib/cms/agents/runtime";
      // The Tool_Catalog under lib/cms/ai/tools is a different path and is fine;
      // agents are loaded lazily via dynamic import() inside lib/cms code only.
      const staticImportOfAgents =
        /import\s[^;]*?from\s*["'][^"']*lib\/cms\/agents(?:\/(?:index|runtime))?["']/;

      for (const file of sourceFiles) {
        const src = readFileSync(file, "utf8");
        if (staticImportOfAgents.test(src)) {
          offenders.push(path.relative(repoRoot, file));
        }
      }

      expect(
        offenders,
        `app/ modules must not statically import the Mastra runtime: ${offenders.join(", ")}`,
      ).toEqual([]);
    });
  });

  // 8. decisions.md resolutions + deferrals (Req 16.1, 16.2) ──────────────────
  describe("decisions.md (Req 16.1, 16.2)", () => {
    const decisionsSrc = read(".kiro/specs/agentic-foundation/decisions.md");

    /** Extract the body of `## Decision N — ...` up to the next `## ` heading. */
    const decisionSection = (n: number): string | null => {
      const start = decisionsSrc.search(
        new RegExp(`^##\\s+Decision\\s+${n}\\s`, "m"),
      );
      if (start === -1) return null;
      const rest = decisionsSrc.slice(start);
      const nextHeading = rest.slice(3).search(/^##\s/m);
      return nextHeading === -1 ? rest : rest.slice(0, nextHeading + 3);
    };

    it("records the required resolutions for decisions 1, 2, 3, 4, 5, 7 (Req 16.1)", () => {
      for (const n of [1, 2, 3, 4, 5, 7]) {
        const section = decisionSection(n);
        expect(section, `Decision ${n} section is missing`).not.toBeNull();
        expect(section!, `Decision ${n} must be marked resolved`).toMatch(
          /Resolved/i,
        );
      }
    });

    it("defers decisions 6 and 8 with their owning specs (Req 16.2)", () => {
      // Decision 6 → S2 (salesforce-lead-core); Decision 8 → S4 (agentic-reporting-twin).
      expect(decisionsSrc).toMatch(/Deferred/i);
      expect(decisionsSrc).toMatch(/\b6\.[^\n]*S2[^\n]*salesforce-lead-core/i);
      expect(decisionsSrc).toMatch(/\b8\.[^\n]*S4[^\n]*agentic-reporting-twin/i);
    });
  });
});
