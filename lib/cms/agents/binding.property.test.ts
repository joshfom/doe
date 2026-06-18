import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { z } from "zod";

/**
 * **Feature: agentic-foundation, Property 4: For any catalog and requested tool-name list, bindCatalog produces exactly one binding per requested name with binding.id equal to that Catalog_Entry's name; and if the list contains any name absent from the catalog, bindCatalog throws naming the unresolved name(s) and registers zero bindings for that agent.**
 *
 * **Validates: Requirements 2.1, 2.3, 2.4**
 *
 * `bindCatalog` (Design §Components #2, "Mastra_Tool_Binding") generates the
 * thin Mastra tools an Agent may call from a named subset of the canonical
 * Tool_Catalog. The contract under test has two halves:
 *
 *  - 1:1 mapping (Requirements 2.1, 2.3): every requested catalog name yields
 *    EXACTLY ONE binding whose `id` equals that Catalog_Entry's `name`. Because
 *    an Agent only ever holds tool objects produced here, a name with no
 *    Catalog_Entry can produce no binding — the catalog is the single source of
 *    tool definitions.
 *  - Resolve-first rejection (Requirement 2.4): if the requested list contains
 *    ANY name absent from the catalog, `bindCatalog` throws a
 *    `CatalogBindingError` naming every unresolved name and registers ZERO
 *    bindings for that agent — never a partial set.
 *
 * We generate an arbitrary catalog (a set of uniquely-named entries) and an
 * arbitrary requested list, then assert each half. To observe "exactly one
 * binding per name" and "zero bindings on a miss" we count constructions of the
 * Mastra tool.
 *
 * [deps] [container-only] The real Mastra `createTool` path and the dispatcher
 * seam (`callTool` → live `db`/`dispatchTool`) only run on the container tier
 * (Requirement 15.3) and would block here, so both are mocked. The `createTool`
 * stub faithfully preserves the binding's `id` so the 1:1 mapping is checkable;
 * `callTool` is a no-op because binding never invokes a tool's `execute`.
 */

// Mock the Mastra createTool path. The stub preserves `id` (so binding.id can
// be asserted) and is a spy (so the number of constructed bindings is
// observable — this is how we verify "zero bindings" on the rejection path).
vi.mock("@mastra/core/tools", () => ({
  createTool: vi.fn((opts: { id: string }) => ({ ...opts })),
}));

// Mock the dispatcher seam so importing binding.ts does not pull in the live
// db/dispatch chain. Binding never calls `execute`, so this is never invoked.
vi.mock("./call-tool", () => ({
  callTool: vi.fn(async () => ({ ok: true })),
}));

import { createTool } from "@mastra/core/tools";
import { bindCatalog, CatalogBindingError } from "./binding";
import type { Catalog, CatalogEntry } from "../ai/tools/catalog";

const createToolMock = vi.mocked(createTool);

const AGENT_ACTOR = "agent:test";

/** A complete, minimally-valid Catalog_Entry for a given name. */
function makeEntry(name: string): CatalogEntry {
  return {
    name,
    description: `tool ${name}`,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    requiresOtp: false,
    permission: "resource:action",
    auditActor: AGENT_ACTOR,
    handler: async () => ({}) as never,
  };
}

/** Assemble a Catalog (ReadonlyMap) from a list of unique names. */
function makeCatalog(names: string[]): Catalog {
  return new Map(names.map((n) => [n, makeEntry(n)]));
}

// A non-empty, non-whitespace tool name.
const nameArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => s.trim().length > 0);

// A catalog of uniquely-named entries (possibly empty).
const catalogNamesArb = fc.uniqueArray(nameArb, { maxLength: 8 });

describe("bindCatalog — binding 1:1 and unknown-name rejection (Property 4)", () => {
  it("produces exactly one binding per requested name with binding.id == entry.name", () => {
    fc.assert(
      fc.property(
        catalogNamesArb.chain((names) =>
          fc.record({
            names: fc.constant(names),
            // Requested names are a unique subset of the catalog (resolved case).
            requested:
              names.length === 0
                ? fc.constant<string[]>([])
                : fc.subarray(names),
          }),
        ),
        ({ names, requested }) => {
          const catalog = makeCatalog(names);
          createToolMock.mockClear();

          const bound = bindCatalog(catalog, requested, {
            agentActor: AGENT_ACTOR,
          });

          // Exactly one binding per requested name — the binding map's keys are
          // precisely the requested names.
          expect(Object.keys(bound).sort()).toStrictEqual([...requested].sort());

          // 1:1 — each binding's id equals the Catalog_Entry's name.
          for (const name of requested) {
            expect(bound[name].id).toBe(name);
          }

          // Exactly one tool constructed per requested name (no extras).
          expect(createToolMock).toHaveBeenCalledTimes(requested.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("throws naming every unresolved name and registers zero bindings on any miss", () => {
    fc.assert(
      fc.property(
        catalogNamesArb.chain((names) =>
          fc.record({
            names: fc.constant(names),
            // At least one requested name absent from the catalog.
            unknown: fc.uniqueArray(
              nameArb.filter((n) => !names.includes(n)),
              { minLength: 1, maxLength: 4 },
            ),
            // Optionally also request some names that DO resolve.
            known:
              names.length === 0
                ? fc.constant<string[]>([])
                : fc.subarray(names),
          }),
        ),
        ({ names, unknown, known }) => {
          const catalog = makeCatalog(names);
          createToolMock.mockClear();

          const requested = [...known, ...unknown];

          let thrown: unknown;
          try {
            bindCatalog(catalog, requested, { agentActor: AGENT_ACTOR });
          } catch (e) {
            thrown = e;
          }

          // Rejected at registration time with a CatalogBindingError.
          expect(thrown).toBeInstanceOf(CatalogBindingError);
          const err = thrown as CatalogBindingError;

          // The error names exactly the unresolved name(s)…
          expect([...err.unresolved].sort()).toStrictEqual([...unknown].sort());
          // …and surfaces each one in its message.
          for (const u of unknown) {
            expect(err.message).toContain(u);
          }

          // Zero bindings registered for the agent — no tool was constructed,
          // never a partial set.
          expect(createToolMock).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
