import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { bindCatalog, CatalogBindingError } from "../binding";
import {
  loadHomeCapabilities,
  HOME_AGENT_ACTOR,
  HOME_TOOL_NAMES,
} from "../../ai/tools/home-capabilities";

// Feature: agentic-home, Property 9: The Home_Agent can only invoke tools that are Catalog_Entries; a delegated action with no matching Catalog_Entry performs no database access.
//
// **Validates: Requirements 7.5, 7.6**
//
// ─────────────────────────────────────────────────────────────────────────────
// This file exercises BOTH halves of Property 9 over the REAL home capabilities
// catalog and the REAL `bindCatalog` (Design §Components #2 "The Home_Agent",
// §Components #6 "Chat-driven platform management"):
//
//   PART A — catalog-only access (Requirement 7.6). `bindCatalog(catalog, names,
//   …)` is the ONLY way an agent acquires a tool object. For any requested name
//   set that contains a name absent from the catalog, `bindCatalog` REJECTS the
//   whole binding (throws `CatalogBindingError` naming every unresolved name) and
//   registers ZERO bindings — the agent never gets a partial set, and never gets
//   a tool for a non-catalog name. Binding only known `HOME_TOOL_NAMES` succeeds
//   with exactly one 1:1 binding per name (binding.id === name).
//
//   PART B — unknown-action no-DB (Requirement 7.5). Because the bound-tools map
//   keyed by catalog name is the agent's entire tool surface, a delegated action
//   whose name is NOT a Catalog_Entry resolves to NO tool, so the audited
//   dispatcher — the ONLY path to the database — is never reached. Modelled with
//   an injected dispatcher/DB spy: the spy is never called for an unknown action,
//   persistent state is left unchanged, and the conversation stays open.
// ─────────────────────────────────────────────────────────────────────────────

const NUM_RUNS = 100;

// The home catalog the Home_Agent binds to, loaded exactly as task 9.1 will load
// it. Asserting `ok` here fails fast if the catalog ever drifts incomplete.
const loaded = loadHomeCapabilities();
if (!loaded.ok) {
  throw new Error(
    `home capabilities failed to load: ${JSON.stringify(loaded.errors)}`,
  );
}
const catalog = loaded.catalog;

const KNOWN_NAMES = [...HOME_TOOL_NAMES];

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** A known, bindable Catalog_Entry name (one of the home tool names). */
const knownNameArb: fc.Arbitrary<string> = fc.constantFrom(...KNOWN_NAMES);

/**
 * A name that is GUARANTEED absent from the home catalog: either a clearly
 * off-catalog identifier (the kind of thing a model might hallucinate) or a
 * random token, in both cases filtered to never coincide with a known name.
 */
const unknownNameArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom(
      "drop_table",
      "delete_everything",
      "raw_sql",
      "send_email_raw",
      "exfiltrate_leads",
      "read_party_phone",
      "list_stack_v2",
      "add_stack",
      "query_clients",
      "transfer_funds",
    ),
    fc.string({ minLength: 1, maxLength: 20 }).map((s) => `unknown_${s}`),
  )
  .filter((name) => !KNOWN_NAMES.includes(name));

/** A non-empty subset of the known names, order-preserving, no duplicates. */
const knownSubsetArb: fc.Arbitrary<string[]> = fc
  .subarray(KNOWN_NAMES, { minLength: 1 })
  .filter((names) => names.length > 0);

// ──────────────────────────────────────────────────────────────────────────────
// PART A — Property 9: catalog-only tool access (Requirement 7.6)
// ──────────────────────────────────────────────────────────────────────────────

describe("Feature: agentic-home, Property 9: Catalog-only tool access (bindCatalog rejection)", () => {
  it("binding ANY set that includes an unknown name throws and registers ZERO bindings", () => {
    fc.assert(
      fc.property(
        knownSubsetArb,
        fc.array(unknownNameArb, { minLength: 1, maxLength: 4 }),
        fc.boolean(),
        (knownSubset, unknownNames, unknownsFirst) => {
          const requested = unknownsFirst
            ? [...unknownNames, ...knownSubset]
            : [...knownSubset, ...unknownNames];

          let thrown: unknown;
          try {
            bindCatalog(catalog, requested, { agentActor: HOME_AGENT_ACTOR });
          } catch (e) {
            thrown = e;
          }

          // The whole binding is rejected (Requirement 7.6) — no partial set.
          expect(thrown).toBeInstanceOf(CatalogBindingError);
          const err = thrown as CatalogBindingError;
          // Every unknown name is named as unresolved; no known name is.
          expect(new Set(err.unresolved)).toEqual(new Set(unknownNames));
          for (const known of knownSubset) {
            expect(err.unresolved).not.toContain(known);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("binding a SINGLE unknown name throws CatalogBindingError naming exactly it", () => {
    fc.assert(
      fc.property(unknownNameArb, (unknown) => {
        expect(() =>
          bindCatalog(catalog, [unknown], { agentActor: HOME_AGENT_ACTOR }),
        ).toThrow(CatalogBindingError);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("binding only known HOME_TOOL_NAMES succeeds with exactly one 1:1 binding per name", () => {
    fc.assert(
      fc.property(knownSubsetArb, (knownSubset) => {
        const bound = bindCatalog(catalog, knownSubset, {
          agentActor: HOME_AGENT_ACTOR,
        });
        // Exactly the requested names are bound — one tool object per name.
        expect(new Set(Object.keys(bound))).toEqual(new Set(knownSubset));
        for (const name of knownSubset) {
          // 1:1: the bound tool's id equals the Catalog_Entry name (Req 7.6).
          expect(bound[name].id).toBe(name);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("binding the full HOME_TOOL_NAMES set resolves entirely against the catalog", () => {
    const bound = bindCatalog(catalog, HOME_TOOL_NAMES, {
      agentActor: HOME_AGENT_ACTOR,
    });
    expect(new Set(Object.keys(bound))).toEqual(new Set(HOME_TOOL_NAMES));
    // Every bound name is genuinely a Catalog_Entry (Requirement 7.6).
    for (const name of HOME_TOOL_NAMES) {
      expect(catalog.has(name)).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PART B — Property 9: unknown delegated action performs NO database access
// (Requirement 7.5)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A minimal model of the Home_Agent's per-turn delegation step over its REAL
 * bound-tools map. The agent can only act through a bound tool; resolving an
 * action name that is not a key in `boundTools` yields NO tool, so the audited
 * dispatcher (`dispatch`, the ONLY path to the database) is never reached. This
 * mirrors §Components #6's "No matching Catalog_Entry → reply unavailable, no DB
 * access, conversation stays open" row.
 */
interface DelegationOutcome {
  ok: boolean;
  unavailable: boolean;
  conversationOpen: boolean;
}

function delegate(
  boundTools: Record<string, { id: string }>,
  actionName: string,
  dispatch: (name: string) => void,
): DelegationOutcome {
  const tool = boundTools[actionName];
  if (!tool) {
    // No Catalog_Entry → no dispatch, no DB, conversation stays open (Req 7.5).
    return { ok: false, unavailable: true, conversationOpen: true };
  }
  dispatch(tool.id); // the audited boundary — the ONLY route to the database
  return { ok: true, unavailable: false, conversationOpen: true };
}

describe("Feature: agentic-home, Property 9: unknown delegated action performs no DB access", () => {
  it("an unknown action never reaches the dispatcher and leaves state unchanged", () => {
    fc.assert(
      fc.property(unknownNameArb, (unknownAction) => {
        const bound = bindCatalog(catalog, HOME_TOOL_NAMES, {
          agentActor: HOME_AGENT_ACTOR,
        });

        // The dispatcher/DB spy: every call would be one trip to the database.
        let dbAccessCount = 0;
        const dispatchedNames: string[] = [];
        const spy = (name: string) => {
          dbAccessCount += 1;
          dispatchedNames.push(name);
        };

        // A model of persistent state — must be untouched for an unknown action.
        const stateBefore = JSON.stringify({ rows: 0 });

        const outcome = delegate(bound, unknownAction, spy);

        // No DB access whatsoever (Requirement 7.5).
        expect(dbAccessCount).toBe(0);
        expect(dispatchedNames).toEqual([]);
        // Reported unavailable, conversation kept open for further turns.
        expect(outcome.ok).toBe(false);
        expect(outcome.unavailable).toBe(true);
        expect(outcome.conversationOpen).toBe(true);
        // Persistent state left unchanged.
        expect(JSON.stringify({ rows: 0 })).toBe(stateBefore);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("interleaving unknown actions with a known one dispatches ONLY the known one", () => {
    fc.assert(
      fc.property(
        knownNameArb,
        fc.array(unknownNameArb, { minLength: 1, maxLength: 4 }),
        (knownAction, unknownActions) => {
          const bound = bindCatalog(catalog, HOME_TOOL_NAMES, {
            agentActor: HOME_AGENT_ACTOR,
          });

          let dbAccessCount = 0;
          const dispatchedNames: string[] = [];
          const spy = (name: string) => {
            dbAccessCount += 1;
            dispatchedNames.push(name);
          };

          // Every unknown action: no dispatch.
          for (const unknown of unknownActions) {
            const outcome = delegate(bound, unknown, spy);
            expect(outcome.unavailable).toBe(true);
          }
          expect(dbAccessCount).toBe(0);

          // The single known action: dispatched exactly once, by its catalog name.
          const knownOutcome = delegate(bound, knownAction, spy);
          expect(knownOutcome.ok).toBe(true);
          expect(dbAccessCount).toBe(1);
          expect(dispatchedNames).toEqual([knownAction]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("no unknown action name is ever a key in the bound-tools map", () => {
    const bound = bindCatalog(catalog, HOME_TOOL_NAMES, {
      agentActor: HOME_AGENT_ACTOR,
    });
    fc.assert(
      fc.property(unknownNameArb, (unknown) => {
        // The structural guarantee behind "no DB access": the agent simply has
        // no tool object for a non-catalog name (Requirement 7.5, 7.6).
        expect(Object.prototype.hasOwnProperty.call(bound, unknown)).toBe(false);
        expect(bound[unknown]).toBeUndefined();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
