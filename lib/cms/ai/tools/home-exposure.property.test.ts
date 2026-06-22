import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  activeToolNames,
  isCLevelRoles,
  HOME_EXECUTIVE_TOOL_NAMES,
  HOME_TOOL_NAMES,
} from "./home-capabilities";

// ──────────────────────────────────────────────────────────────────────────────
// Feature: ai-prompt-helper-slash-commands, Property 17: Tool exposure excludes
// executive tools for non-C-Level turns.
// ──────────────────────────────────────────────────────────────────────────────
describe("Property 17 — tool exposure excludes executive tools for non-C-Level", () => {
  it("exposed executive set is non-empty iff the turn is C-Level", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            "rep",
            "manager",
            "viewer",
            "marketing",
            "super_admin",
            "c_level",
          ),
        ),
        (roles) => {
          const active = activeToolNames(roles);
          const cLevel = isCLevelRoles(roles);

          const exposedExec = HOME_EXECUTIVE_TOOL_NAMES.filter((n) =>
            active.includes(n),
          );

          // Non-empty iff C-Level.
          expect(exposedExec.length > 0).toBe(cLevel);

          if (cLevel) {
            // C-Level turn is offered the full home tool set.
            expect(new Set(active)).toEqual(new Set(HOME_TOOL_NAMES));
            for (const n of HOME_EXECUTIVE_TOOL_NAMES) {
              expect(active.includes(n)).toBe(true);
            }
          } else {
            // Non-C-Level turn is offered NONE of the executive tools, but keeps
            // every non-executive home tool.
            for (const n of HOME_EXECUTIVE_TOOL_NAMES) {
              expect(active.includes(n)).toBe(false);
            }
            const nonExec = HOME_TOOL_NAMES.filter(
              (n) => !HOME_EXECUTIVE_TOOL_NAMES.includes(n as never),
            );
            expect(new Set(active)).toEqual(new Set(nonExec));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
