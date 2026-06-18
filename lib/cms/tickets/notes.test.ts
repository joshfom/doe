import { describe, it, expect, vi } from "vitest";

import type { Database } from "../db";
import {
  assertValidNote,
  createNote,
  NoteValidationError,
  type CreateNoteInput,
} from "./notes";

/**
 * Unit tests for the note write-path guards (salesforce-lead-core task 6.5).
 *
 * `assertValidNote` is pure and synchronous — it enforces every structural
 * invariant and throws a typed {@link NoteValidationError} BEFORE anything is
 * persisted. These tests pin the three structural rejections the task calls out:
 *
 *   - actor_type ∉ {ai,user,system}  → code `invalid_actor_type` (Req 14.2)
 *   - actor_type 'user' + null author → code `missing_author`     (Req 14.3)
 *   - neither ticketId nor leadPartyId → code `missing_association` (Req 14.8)
 *
 * and confirm a structurally valid input is accepted. A final test proves the
 * guard runs BEFORE the insert in `createNote`: a db whose `.insert` throws if
 * ever called is never reached for invalid input.
 *
 * **Validates: Requirements 14.2, 14.3, 14.8**
 */

/** A structurally valid base note: system actor, lead association, clean text. */
function validInput(overrides: Partial<CreateNoteInput> = {}): CreateNoteInput {
  return {
    actorType: "system",
    leadPartyId: "11111111-1111-1111-1111-111111111111",
    content: "Followed up with the lead about pricing options.",
    ...overrides,
  };
}

describe("assertValidNote — actor_type guard (Req 14.2)", () => {
  it("rejects an actor_type outside {ai,user,system} with code invalid_actor_type", () => {
    const input = validInput({
      // Simulate an untyped agentic value the TS-only enum can't catch.
      actorType: "robot" as unknown as CreateNoteInput["actorType"],
    });

    try {
      assertValidNote(input);
      expect.unreachable("assertValidNote should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NoteValidationError);
      expect((err as NoteValidationError).code).toBe("invalid_actor_type");
      expect((err as NoteValidationError).field).toBe("actorType");
    }
  });

  it.each(["ai", "user", "system"] as const)(
    "accepts the valid actor_type %s",
    (actorType) => {
      const input =
        actorType === "user"
          ? validInput({
              actorType,
              authorId: "22222222-2222-2222-2222-222222222222",
            })
          : validInput({ actorType });
      expect(() => assertValidNote(input)).not.toThrow();
    }
  );
});

describe("assertValidNote — author guard (Req 14.3)", () => {
  it("rejects a 'user' note with a null author_id with code missing_author", () => {
    const input = validInput({ actorType: "user", authorId: null });

    try {
      assertValidNote(input);
      expect.unreachable("assertValidNote should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NoteValidationError);
      expect((err as NoteValidationError).code).toBe("missing_author");
      expect((err as NoteValidationError).field).toBe("authorId");
    }
  });

  it("rejects a 'user' note with an undefined author_id with code missing_author", () => {
    const input = validInput({ actorType: "user" }); // authorId omitted

    try {
      assertValidNote(input);
      expect.unreachable("assertValidNote should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NoteValidationError);
      expect((err as NoteValidationError).code).toBe("missing_author");
    }
  });

  it("permits ai/system notes with a null author", () => {
    expect(() =>
      assertValidNote(validInput({ actorType: "ai", authorId: null }))
    ).not.toThrow();
    expect(() =>
      assertValidNote(validInput({ actorType: "system", authorId: null }))
    ).not.toThrow();
  });
});

describe("assertValidNote — association guard (Req 14.8)", () => {
  it("rejects a note with neither ticketId nor leadPartyId with code missing_association", () => {
    const input = validInput({ ticketId: null, leadPartyId: null });

    try {
      assertValidNote(input);
      expect.unreachable("assertValidNote should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NoteValidationError);
      expect((err as NoteValidationError).code).toBe("missing_association");
      expect((err as NoteValidationError).field).toBe("ticketId|leadPartyId");
    }
  });

  it("accepts a note associated with a ticket only", () => {
    expect(() =>
      assertValidNote(
        validInput({
          ticketId: "33333333-3333-3333-3333-333333333333",
          leadPartyId: null,
        })
      )
    ).not.toThrow();
  });

  it("accepts a note associated with a lead only", () => {
    expect(() => assertValidNote(validInput())).not.toThrow();
  });
});

describe("assertValidNote — valid input is accepted (Req 14.2, 14.3, 14.8)", () => {
  it("returns normalized values for a structurally valid system+lead note", () => {
    const values = assertValidNote(validInput());
    expect(values).toMatchObject({
      actorType: "system",
      authorId: null,
      ticketId: null,
      leadPartyId: "11111111-1111-1111-1111-111111111111",
      content: "Followed up with the lead about pricing options.",
      isInternal: true,
    });
  });
});

describe("createNote — guard runs before any insert (Req 14.2, 14.3, 14.8)", () => {
  /** A db whose `.insert` throws the moment it is touched. */
  function explodingDb(): { db: Database; insert: ReturnType<typeof vi.fn> } {
    const insert = vi.fn(() => {
      throw new Error("insert must NOT be called for an invalid note");
    });
    return { db: { insert } as unknown as Database, insert };
  }

  it.each([
    [
      "invalid_actor_type",
      validInput({
        actorType: "robot" as unknown as CreateNoteInput["actorType"],
      }),
    ],
    ["missing_author", validInput({ actorType: "user", authorId: null })],
    [
      "missing_association",
      validInput({ ticketId: null, leadPartyId: null }),
    ],
  ] as const)(
    "throws NoteValidationError (%s) and never reaches the insert",
    async (code, input) => {
      const { db, insert } = explodingDb();

      await expect(createNote(db, input)).rejects.toMatchObject({
        name: "NoteValidationError",
        code,
      });
      expect(insert).not.toHaveBeenCalled();
    }
  );
});
