import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Module-layout guard (Requirement 1.4, Design §Architecture
 * "Module-layout enforcement").
 *
 * Agents and Workflows are recognised STRUCTURALLY: a source file is an
 * Agent/Workflow if it constructs `new Agent(...)` / `createWorkflow(...)` or
 * imports them from `@mastra/core/agent` / `@mastra/core/workflows`. Such files
 * MUST reside under `lib/cms/agents/`. The Tool_Catalog under
 * `lib/cms/ai/tools/` is explicitly exempt (it defines tools, not agents).
 *
 * This file is BOTH the implementation of the guard (the pure path/content
 * acceptance predicate `checkSourceFile`) AND its tests:
 *   - a property test for the pure predicate (Property 1, ≥100 iterations), and
 *   - a real repo scan that currently passes (no Agent/Workflow constructors
 *     outside `lib/cms/agents/`), which is the build-time CI gate.
 */

// ── The guard logic (implementation) ─────────────────────────────────────────

/** The rule surfaced when a file is rejected (Requirement 1.4). */
export const LAYOUT_RULE = "Agents and Workflows must reside under lib/cms/agents/";

/** The one directory where Agents/Workflows may live. */
const AGENTS_DIR = "lib/cms/agents/";

/** Directories exempt from the guard (they define tools, not agents). */
const EXEMPT_DIRS = ["lib/cms/ai/tools/"] as const;

/**
 * Structural markers of an Agent/Workflow source file: the Mastra constructors
 * and the `@mastra/core` agent/workflow imports.
 */
const CONSTRUCTOR_PATTERNS: readonly RegExp[] = [
  /\bnew\s+Agent\s*\(/,
  /\bcreateWorkflow\s*\(/,
  /from\s+["']@mastra\/core\/agent["']/,
  /from\s+["']@mastra\/core\/workflows?["']/,
];

/** Normalise any OS path to forward-slash (repo-relative) form. */
function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** True iff the file content constructs/imports an Agent or Workflow. */
export function containsAgentOrWorkflow(content: string): boolean {
  return CONSTRUCTOR_PATTERNS.some((re) => re.test(content));
}

/** True iff the repo-relative path is an exempt (Tool_Catalog) location. */
export function isExempt(relPath: string): boolean {
  const norm = toPosix(relPath);
  return EXEMPT_DIRS.some((d) => norm.startsWith(d));
}

/** True iff the repo-relative path lives under `lib/cms/agents/`. */
export function isUnderAgentsDir(relPath: string): boolean {
  return toPosix(relPath).startsWith(AGENTS_DIR);
}

export type GuardResult = { ok: true } | { ok: false; message: string };

/**
 * The pure acceptance predicate. A file is accepted when it does not look like
 * an Agent/Workflow, or it is exempt, or it lives under `lib/cms/agents/`.
 * Otherwise it is rejected with a message naming the offending path and the
 * rule (Requirement 1.4).
 */
export function checkSourceFile(relPath: string, content: string): GuardResult {
  if (!containsAgentOrWorkflow(content)) return { ok: true };
  if (isExempt(relPath)) return { ok: true };
  if (isUnderAgentsDir(relPath)) return { ok: true };
  return { ok: false, message: `${toPosix(relPath)}: ${LAYOUT_RULE}` };
}

// ── Property 1: the pure path/content acceptance predicate ───────────────────

/**
 * **Feature: agentic-foundation, Property 1: For any generated source-file path and content containing an Agent or Workflow constructor, the layout guard accepts it iff the path is under lib/cms/agents/, and otherwise rejects it with a message naming the offending path and the rule.**
 *
 * **Validates: Requirements 1.4**
 *
 * The guard's contract for a file that DOES contain an Agent/Workflow marker is
 * an iff: it is accepted exactly when the path is under `lib/cms/agents/`, and
 * any other (non-exempt) location is rejected with a message that names the
 * offending path AND states the rule. (Exempt Tool_Catalog paths are accepted
 * regardless and are therefore excluded from this iff — they are covered by a
 * dedicated example below.)
 *
 * We generate (a) content that always embeds one of the recognised
 * constructor/import markers surrounded by arbitrary text, and (b) arbitrary
 * repo-relative source paths — biased to also produce genuine `lib/cms/agents/`
 * paths — with exempt paths filtered out so the iff is exact. An independent
 * reference predicate (`startsWith("lib/cms/agents/")`) decides the expected
 * acceptance; the test asserts the guard agrees and, on rejection, that the
 * message contains both the path and the rule.
 */

// Content that always contains exactly one recognised marker.
const markerArb = fc.constantFrom(
  "new Agent(",
  "new  Agent (",
  "const a = new Agent({ name: 'x' })",
  "createWorkflow(",
  "export const wf = createWorkflow({",
  'import { Agent } from "@mastra/core/agent";',
  "import { createWorkflow } from '@mastra/core/workflows';",
);
const contentArb = fc
  .tuple(fc.string(), markerArb, fc.string())
  .map(([before, marker, after]) => `${before}\n${marker}\n${after}`);

const fileNameArb = fc.constantFrom(
  "index.ts",
  "runtime.ts",
  "text-agent.ts",
  "admin-agent.ts",
  "foo.ts",
  "bar.tsx",
  "workflow.ts",
);

// Free paths from arbitrary directory segments (may or may not be under agents/).
const freeSegArb = fc.constantFrom(
  "lib",
  "cms",
  "ai",
  "tools",
  "voice",
  "app",
  "scripts",
  "agents",
  "workflows",
  "evals",
  "core",
  "page-builder",
  "api",
  "routes",
);
const freeSegsArb = fc.array(freeSegArb, { minLength: 1, maxLength: 5 });

// Paths rooted under lib/cms/agents/, to guarantee coverage of the accept branch.
const agentsSegsArb = fc
  .array(fc.constantFrom("workflows", "evals", "nested", "core", "sub"), {
    minLength: 0,
    maxLength: 3,
  })
  .map((rest) => ["lib", "cms", "agents", ...rest]);

const pathArb = fc
  .oneof(freeSegsArb, agentsSegsArb)
  .chain((segs) => fileNameArb.map((file) => [...segs, file].join("/")))
  // Exclude exempt paths so the iff under test is exact (they're covered below).
  .filter((p) => !EXEMPT_DIRS.some((d) => p.startsWith(d)));

describe("layout guard — acceptance predicate (Property 1)", () => {
  it("accepts an Agent/Workflow file iff it is under lib/cms/agents/, else rejects naming the path and rule", () => {
    fc.assert(
      fc.property(pathArb, contentArb, (path, content) => {
        // Sanity: every generated content really does carry a marker.
        expect(containsAgentOrWorkflow(content)).toBe(true);

        const result = checkSourceFile(path, content);
        const expectedOk = path.startsWith(AGENTS_DIR); // independent reference

        expect(result.ok).toBe(expectedOk);
        if (!result.ok) {
          // Rejection names the offending path AND states the rule.
          expect(result.message).toContain(path);
          expect(result.message).toContain(LAYOUT_RULE);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("accepts any file with no Agent/Workflow marker, regardless of location", () => {
    fc.assert(
      fc.property(pathArb, fc.string(), (path, noise) => {
        // Guard against the rare case the random noise contains a marker.
        fc.pre(!containsAgentOrWorkflow(noise));
        expect(checkSourceFile(path, noise).ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("exempts the Tool_Catalog (lib/cms/ai/tools/) even when it mentions a marker", () => {
    const res = checkSourceFile(
      "lib/cms/ai/tools/registry.ts",
      'import { createWorkflow } from "@mastra/core/workflows";\nnew Agent(',
    );
    expect(res.ok).toBe(true);
  });
});

// ── The real repo scan (the build-time CI gate) ──────────────────────────────

const SCAN_ROOTS = ["lib", "app", "scripts"] as const;
const SOURCE_FILE = /\.(ts|tsx)$/;

function collectSourceFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (SOURCE_FILE.test(entry.name)) {
      acc.push(full);
    }
  }
}

describe("layout guard — real repository scan (Requirement 1.4)", () => {
  it("finds no Agent/Workflow constructor outside lib/cms/agents/", () => {
    const repoRoot = process.cwd();
    const files: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = join(repoRoot, root);
      if (existsSync(abs)) collectSourceFiles(abs, files);
    }

    // The scan must actually have looked at files (guards against a broken walk).
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const relPath = toPosix(relative(repoRoot, file));
      const content = readFileSync(file, "utf-8");
      const result = checkSourceFile(relPath, content);
      if (!result.ok) violations.push(result.message);
    }

    expect(violations).toStrictEqual([]);
  });
});
