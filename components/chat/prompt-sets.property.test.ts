import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  resolvePromptSet,
  isCLevel,
  isValidSlashCommand,
  sanitizeCommands,
  filterSlashCommands,
  ALL_SLASH_COMMANDS,
  ALL_SAMPLE_QUESTIONS,
  type SlashCommand,
} from "./prompt-sets";

const CLEVEL_ROLE = "super_admin";
const CLEVEL_PERMS = ["*:*", "home:*", "analytics:read", "analytics:*"];

const generalCommandMsgs = new Set(
  ALL_SLASH_COMMANDS.filter((c) => c.scope === "general").map((c) => c.message),
);
const executiveCommandMsgs = new Set(
  ALL_SLASH_COMMANDS.filter((c) => c.scope === "executive").map(
    (c) => c.message,
  ),
);
const generalQuestionIds = new Set(
  ALL_SAMPLE_QUESTIONS.filter((q) => q.scope === "general").map((q) => q.id),
);
const executiveQuestionIds = new Set(
  ALL_SAMPLE_QUESTIONS.filter((q) => q.scope === "executive").map((q) => q.id),
);

// ──────────────────────────────────────────────────────────────────────────────
// Feature: ai-prompt-helper-slash-commands, Property 10: Resolved prompt set
// matches the user's role.
// ──────────────────────────────────────────────────────────────────────────────
describe("Property 10 — resolved prompt set matches the role", () => {
  it("general always present; executive present iff C-Level; absent session → general only", () => {
    fc.assert(
      fc.property(
        // An arbitrary session (incl. null, empty, unresolvable roles), with a
        // chance of carrying a C-Level signal.
        fc.option(
          fc.record({
            roles: fc.array(
              fc.constantFrom("rep", "manager", "viewer", CLEVEL_ROLE, "c_level"),
            ),
            permissions: fc.array(
              fc.constantFrom(
                "leads:read",
                "tickets:read",
                ...CLEVEL_PERMS,
              ),
            ),
          }),
          { nil: null },
        ),
        (session) => {
          const set = resolvePromptSet(session);
          const cLevel =
            session != null &&
            isCLevel(session.roles ?? [], session.permissions ?? []);

          const cmdMsgs = new Set(set.commands.map((c) => c.message));
          const qIds = new Set(set.sampleQuestions.map((q) => q.id));

          // All general prompts are always present.
          for (const m of generalCommandMsgs) expect(cmdMsgs.has(m)).toBe(true);
          for (const id of generalQuestionIds) expect(qIds.has(id)).toBe(true);

          // Executive prompts present iff C-Level.
          for (const m of executiveCommandMsgs) {
            expect(cmdMsgs.has(m)).toBe(cLevel);
          }
          for (const id of executiveQuestionIds) {
            expect(qIds.has(id)).toBe(cLevel);
          }

          // No executive prompt ever leaks to a non-C-Level / absent session.
          if (!cLevel) {
            for (const m of cmdMsgs) expect(executiveCommandMsgs.has(m)).toBe(false);
            for (const id of qIds) expect(executiveQuestionIds.has(id)).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Feature: ai-prompt-helper-slash-commands, Property 11: Custom command sets
// preserve the standard interaction model (guard excludes invalid commands).
// ──────────────────────────────────────────────────────────────────────────────
describe("Property 11 — custom command sets are guarded", () => {
  it("invalid commands are dropped; valid commands are retained and filterable", () => {
    const validCmd = fc.record({
      command: fc
        .stringMatching(/^[a-z][a-z0-9_-]{0,11}$/)
        .filter((s) => s.length > 0),
      label: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      description: fc.string({ maxLength: 30 }),
      message: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
    });
    // An invalid command: empty/whitespace token, leading slash, or spaces.
    const invalidCmd = fc.oneof(
      fc.record({
        command: fc.constantFrom("", "  ", "has space", "/slashed"),
        label: fc.string({ minLength: 1 }),
        description: fc.string(),
        message: fc.string({ minLength: 1 }),
      }),
      fc.record({
        command: fc.constant("ok"),
        label: fc.constant(""),
        description: fc.string(),
        message: fc.constant("hi"),
      }),
    );

    fc.assert(
      fc.property(
        fc.array(validCmd, { maxLength: 6 }),
        fc.array(invalidCmd, { maxLength: 6 }),
        (valids, invalids) => {
          const mixed = [...valids, ...invalids] as SlashCommand[];
          const safe = sanitizeCommands(mixed);

          // Every retained command passes the guard.
          for (const c of safe) expect(isValidSlashCommand(c)).toBe(true);
          // No invalid command survives.
          for (const c of safe) {
            expect(c.command.trim().length).toBeGreaterThan(0);
            expect(/\s/.test(c.command)).toBe(false);
            expect(c.command.startsWith("/")).toBe(false);
          }

          // The standard filter still works over the sanitized set: typing the
          // full token surfaces that command.
          for (const c of safe) {
            const matches = filterSlashCommands(`/${c.command}`, safe);
            expect(matches.some((m) => m.command === c.command)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
