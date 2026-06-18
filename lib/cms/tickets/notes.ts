/**
 * Lead / Ticket note write-path guards (salesforce-lead-core Design §6.2,
 * Requirement 14).
 *
 * A {@link Note} (`ticket_notes`) is the activity record that downstream
 * reporting (S3/S5) consumes. S2 evolved the table so a note can be attributed
 * to an AI actor, a human user, or the system, and can attach to a Ticket, a
 * Lead, or both. The schema (`lib/cms/schema.ts`) carries the columns and an
 * at-least-one-association CHECK, but the schema enum is a TypeScript-only
 * constraint and the per-actor / privacy rules cannot be expressed in DDL, so
 * the real write-path invariants are enforced here, in the note service, before
 * anything is persisted (Design §6.2 "Write-path invariants enforced in the
 * note service"):
 *
 *   1. `actor_type` ∈ {`ai`,`user`,`system`}, else reject (Req 14.1, 14.2).
 *   2. `actor_type = 'user'` requires a non-null `author_id`; `ai`/`system`
 *      permit a null author (Req 14.3, 14.4, 14.5, 14.6).
 *   3. at least one of `ticket_id` / `lead_party_id` is set (Req 14.7, 14.8);
 *      the DB CHECK `ticket_notes_assoc_chk` is the backstop.
 *   4. `assertNoRawPhone(content)` before persisting (Req 14.9, 14.10); a
 *      phone-shaped value surfaces as a privacy-violation rejection and the
 *      note is NOT persisted.
 *
 * Every violation throws a typed error ({@link NoteValidationError} or
 * {@link NotePrivacyViolationError}) and NO row is written — the guard rejects
 * before the insert (Req 14.2, 14.5, 14.8, 14.10).
 *
 * ── Agentic boundary (Req 14.11 / CC-Audit) ──────────────────────────────────
 *
 * When a note is created or read THROUGH THE AGENTIC SURFACE, the operation
 * MUST flow through the S1 audited dispatcher
 * (`lib/cms/ai/tools/dispatch.ts` → `dispatchTool`), which is the single,
 * Zod-validated, permission-checked, audited choke point every agent tool call
 * goes through (agentic-foundation Req 2.10/3.x/10.x/11.x). An agent never
 * calls {@link createNote} / {@link listNotes} directly.
 *
 * The integration point is concrete: this module exports {@link noteCatalogEntries}
 * — `CatalogEntry` definitions (`lib/cms/ai/tools/catalog.ts`) for `create_note`
 * and `read_notes` whose handlers call the guarded service below. Registering
 * those entries in the S1 unified Tool_Catalog makes them dispatchable, so
 * `dispatchTool(db, "create_note" | "read_notes", input, ctx)` becomes the
 * audited path. Because `dispatchTool` writes exactly one audit entry per
 * dispatch via `logAudit`, the guarded service itself does NOT audit — the
 * dispatcher owns the audited boundary (Req 14.11). Non-agentic / internal
 * callers invoke the service functions directly and own their own audit, as the
 * legacy `addNote` in `./service.ts` already does.
 */

import { asc, eq } from "drizzle-orm";
import { z, type ZodType } from "zod";

import type { Database } from "../db";
import { ticketNotes } from "../schema";
import { assertNoRawPhone, RawPhoneError } from "../crm/phone-privacy";
import type { CatalogEntry, ToolContext } from "../ai/tools/catalog";

// ── Domain types ──────────────────────────────────────────────────────────────

/** The creator attribution carried on a note (Req 14.1). */
export type NoteActorType = "ai" | "user" | "system";

/** The closed set of valid `actor_type` values (Req 14.1, 14.2). */
export const NOTE_ACTOR_TYPES = ["ai", "user", "system"] as const;

/** A persisted `ticket_notes` row. */
export type TicketNote = typeof ticketNotes.$inferSelect;

/** Input to {@link createNote}. */
export interface CreateNoteInput {
  /** Creator attribution — must be one of {@link NOTE_ACTOR_TYPES} (Req 14.1). */
  actorType: NoteActorType;
  /** Authoring human user; required when `actorType === 'user'` (Req 14.3, 14.4). */
  authorId?: string | null;
  /** Ticket association; nullable when the note attaches to a Lead only. */
  ticketId?: string | null;
  /** Lead (party) association; nullable when the note attaches to a Ticket only. */
  leadPartyId?: string | null;
  /** Note content — guarded against raw phone numbers (Req 14.9, 14.10). */
  content: string;
  /** Internal-only flag; defaults to true. */
  isInternal?: boolean;
}

// ── Typed errors ────────────────────────────────────────────────────────────

/** Discriminants for a note write-path validation rejection. */
export type NoteValidationCode =
  | "invalid_actor_type"
  | "missing_author"
  | "missing_association"
  | "empty_content";

/**
 * Thrown when a note write violates a structural invariant (Req 14.2, 14.5,
 * 14.8). The caller surfaces this as a validation-failure indication; the note
 * is NOT persisted.
 */
export class NoteValidationError extends Error {
  readonly code: NoteValidationCode;
  /** The offending field, for the caller's validation-failure indication. */
  readonly field: string;

  constructor(code: NoteValidationCode, field: string, message: string) {
    super(message);
    this.name = "NoteValidationError";
    this.code = code;
    this.field = field;
  }
}

/**
 * Thrown when a note's content contains a raw phone-shaped value (Req 14.9,
 * 14.10 / CC-Privacy). Wraps the {@link RawPhoneError} from the phone-privacy
 * guard. The caller records a privacy-violation indication; the note is NOT
 * persisted.
 */
export class NotePrivacyViolationError extends Error {
  readonly code = "note_privacy_violation" as const;
  /** Dotted path to the offending value (from the underlying guard). */
  readonly path: string;
  /** The phone-shaped substring that triggered the rejection. */
  readonly match: string;

  constructor(cause: RawPhoneError) {
    super(
      `Note content contains a raw phone-shaped value — refusing to persist (privacy violation).`
    );
    this.name = "NotePrivacyViolationError";
    this.path = cause.path;
    this.match = cause.match;
  }
}

// ── Write-path guard ──────────────────────────────────────────────────────────

/**
 * Apply every note write-path invariant and return the normalized values ready
 * to persist, or throw a typed error WITHOUT touching the database
 * (Design §6.2). Pure and synchronous, so it is directly unit-testable and is
 * the single source of the guard logic shared by {@link createNote} and the
 * agentic catalog handler.
 *
 * Order of checks is deliberate: structural validity first (actor_type, author,
 * association, content), then the privacy guard last, so a structurally invalid
 * note is rejected as a validation failure rather than a privacy violation.
 *
 * @throws {NoteValidationError}     on an invalid actor_type, a `user` note with
 *                                   no author, no ticket/lead association, or
 *                                   empty content (Req 14.2, 14.5, 14.8).
 * @throws {NotePrivacyViolationError} when the content carries a raw phone
 *                                   number (Req 14.10).
 */
export function assertValidNote(input: CreateNoteInput): {
  actorType: NoteActorType;
  authorId: string | null;
  ticketId: string | null;
  leadPartyId: string | null;
  content: string;
  isInternal: boolean;
} {
  // 1. actor_type ∈ {ai, user, system} (Req 14.1, 14.2). The schema enum is a
  //    TS-only constraint, so an untyped agentic value must be rejected here.
  if (!NOTE_ACTOR_TYPES.includes(input.actorType)) {
    throw new NoteValidationError(
      "invalid_actor_type",
      "actorType",
      `actor_type must be one of ${NOTE_ACTOR_TYPES.join(", ")}; received "${String(
        input.actorType
      )}".`
    );
  }

  // 2. A `user` note requires a non-null author; ai/system permit null
  //    (Req 14.3, 14.4, 14.5, 14.6).
  const authorId = input.authorId ?? null;
  if (input.actorType === "user" && authorId === null) {
    throw new NoteValidationError(
      "missing_author",
      "authorId",
      `A note with actor_type "user" requires a non-null author_id.`
    );
  }

  // 3. At least one of ticket_id / lead_party_id (Req 14.7, 14.8). The DB CHECK
  //    ticket_notes_assoc_chk is the backstop.
  const ticketId = input.ticketId ?? null;
  const leadPartyId = input.leadPartyId ?? null;
  if (ticketId === null && leadPartyId === null) {
    throw new NoteValidationError(
      "missing_association",
      "ticketId|leadPartyId",
      `A note must be associated with at least one of a Ticket (ticketId) or a Lead (leadPartyId).`
    );
  }

  // 4. Non-empty content. `content` is NOT NULL in the schema; an empty/blank
  //    note carries no activity record, so reject it as a validation failure.
  const content = input.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new NoteValidationError(
      "empty_content",
      "content",
      `Note content must be a non-empty string.`
    );
  }

  // 5. No raw phone in note content (Req 14.9, 14.10 / CC-Privacy). Surface the
  //    guard's RawPhoneError as a note privacy-violation rejection.
  try {
    assertNoRawPhone(content);
  } catch (err) {
    if (err instanceof RawPhoneError) {
      throw new NotePrivacyViolationError(err);
    }
    throw err;
  }

  return {
    actorType: input.actorType,
    // ai/system permit a null author (Req 14.6); a provided author is kept.
    authorId,
    ticketId,
    leadPartyId,
    content,
    isInternal: input.isInternal ?? true,
  };
}

// ── Guarded service (DB-touching) ─────────────────────────────────────────────

/**
 * Create a note after enforcing every write-path invariant (Design §6.2,
 * Req 14.1–14.10). On any violation a typed error is thrown and NO row is
 * persisted. Does NOT write an audit entry: the audited boundary is owned by
 * the caller — the S1 dispatcher for the agentic path (Req 14.11) or the
 * invoking service for internal callers.
 *
 * @throws {NoteValidationError}       structural invariant violation (not persisted).
 * @throws {NotePrivacyViolationError} raw phone in content (not persisted).
 */
export async function createNote(
  db: Database,
  input: CreateNoteInput
): Promise<TicketNote> {
  const values = assertValidNote(input);

  const [note] = await db
    .insert(ticketNotes)
    .values({
      actorType: values.actorType,
      authorId: values.authorId,
      ticketId: values.ticketId,
      leadPartyId: values.leadPartyId,
      content: values.content,
      isInternal: values.isInternal,
    })
    .returning();

  return note;
}

/** Read a single note by id, or `null` when it does not exist. */
export async function getNote(
  db: Database,
  noteId: string
): Promise<TicketNote | null> {
  const [note] = await db
    .select()
    .from(ticketNotes)
    .where(eq(ticketNotes.id, noteId));
  return note ?? null;
}

/** List the notes attached to a Ticket, oldest first. */
export async function listNotesForTicket(
  db: Database,
  ticketId: string
): Promise<TicketNote[]> {
  return db
    .select()
    .from(ticketNotes)
    .where(eq(ticketNotes.ticketId, ticketId))
    .orderBy(asc(ticketNotes.createdAt));
}

/** List the notes attached to a Lead (party), oldest first. */
export async function listNotesForLead(
  db: Database,
  leadPartyId: string
): Promise<TicketNote[]> {
  return db
    .select()
    .from(ticketNotes)
    .where(eq(ticketNotes.leadPartyId, leadPartyId))
    .orderBy(asc(ticketNotes.createdAt));
}

// ── Agentic boundary — S1 audited dispatcher integration (Req 14.11) ──────────
//
// These CatalogEntry definitions are the concrete integration point with the S1
// audited dispatcher (`lib/cms/ai/tools/dispatch.ts`). Registering them in the
// S1 unified Tool_Catalog (`lib/cms/ai/tools/catalog.ts` → `loadCatalog`) routes
// `create_note` / `read_notes` through `dispatchTool`, which Zod-validates,
// permission-checks, and writes the single audit entry per call. Agentic note
// create/read therefore never touches the DB directly — it always flows through
// the dispatcher (CC-Audit).

/** RBAC permission prefix for the note tools, e.g. `crm:tool:create_note`. */
export const NOTE_TOOL_PERMISSION_PREFIX = "crm:tool";

/** Audit actor recorded for note tools when none is supplied by the dispatch ctx. */
export const NOTE_AGENT_ACTOR = "agent:crm-notes";

/** Input schema for the agentic `create_note` tool (Req 14.1–14.10 at the boundary). */
const createNoteToolInput: ZodType<CreateNoteInput> = z.object({
  actorType: z.enum(NOTE_ACTOR_TYPES),
  authorId: z.string().uuid().nullable().optional(),
  ticketId: z.string().uuid().nullable().optional(),
  leadPartyId: z.string().uuid().nullable().optional(),
  content: z.string().min(1),
  isInternal: z.boolean().optional(),
});

/** Output schema for the agentic `create_note` tool. */
const createNoteToolOutput = z.object({
  id: z.string(),
  actorType: z.enum(NOTE_ACTOR_TYPES),
  ticketId: z.string().nullable(),
  leadPartyId: z.string().nullable(),
  authorId: z.string().nullable(),
  createdAt: z.date(),
});
type CreateNoteToolOutput = z.infer<typeof createNoteToolOutput>;

/** Input schema for the agentic `read_notes` tool — by note id, ticket, or lead. */
const readNotesToolInput = z
  .object({
    noteId: z.string().uuid().optional(),
    ticketId: z.string().uuid().optional(),
    leadPartyId: z.string().uuid().optional(),
  })
  .refine(
    (v) => Boolean(v.noteId || v.ticketId || v.leadPartyId),
    "Provide one of noteId, ticketId, or leadPartyId."
  );
type ReadNotesToolInput = z.infer<typeof readNotesToolInput>;

/** Output schema for the agentic `read_notes` tool — always a list. */
const readNotesToolOutput = z.array(
  z.object({
    id: z.string(),
    actorType: z.enum(NOTE_ACTOR_TYPES),
    ticketId: z.string().nullable(),
    leadPartyId: z.string().nullable(),
    authorId: z.string().nullable(),
    content: z.string(),
    isInternal: z.boolean(),
    createdAt: z.date(),
  })
);
type ReadNotesToolOutput = z.infer<typeof readNotesToolOutput>;

/**
 * The `create_note` catalog entry. Its handler re-applies the guarded service
 * (defense in depth on top of the Zod boundary validation `dispatchTool` runs
 * first), so a violation is rejected and nothing is persisted (Req 14.2, 14.5,
 * 14.8, 14.10).
 */
export const createNoteCatalogEntry: CatalogEntry<
  CreateNoteInput,
  CreateNoteToolOutput
> = {
  name: "create_note",
  description:
    "Create a Lead/Ticket note with creator attribution. actor_type must be " +
    "ai, user, or system; a user note requires author_id; the note must " +
    "associate with a ticket and/or a lead; content must not contain a raw " +
    "phone number.",
  inputSchema: createNoteToolInput,
  outputSchema: createNoteToolOutput,
  requiresOtp: false,
  permission: `${NOTE_TOOL_PERMISSION_PREFIX}:create_note`,
  auditActor: NOTE_AGENT_ACTOR,
  handler: async (db: Database, _ctx: ToolContext, input: CreateNoteInput) => {
    const note = await createNote(db, input);
    return {
      id: note.id,
      actorType: note.actorType as NoteActorType,
      ticketId: note.ticketId,
      leadPartyId: note.leadPartyId,
      authorId: note.authorId,
      createdAt: note.createdAt,
    };
  },
};

/**
 * The `read_notes` catalog entry. Reads notes by id, ticket, or lead through
 * the audited dispatcher (Req 14.11).
 */
export const readNotesCatalogEntry: CatalogEntry<
  ReadNotesToolInput,
  ReadNotesToolOutput
> = {
  name: "read_notes",
  description:
    "Read Lead/Ticket notes by noteId, ticketId, or leadPartyId. Returns the " +
    "matching notes as a list.",
  inputSchema: readNotesToolInput,
  outputSchema: readNotesToolOutput,
  requiresOtp: false,
  permission: `${NOTE_TOOL_PERMISSION_PREFIX}:read_notes`,
  auditActor: NOTE_AGENT_ACTOR,
  handler: async (db: Database, _ctx: ToolContext, input: ReadNotesToolInput) => {
    let rows: TicketNote[];
    if (input.noteId) {
      const note = await getNote(db, input.noteId);
      rows = note ? [note] : [];
    } else if (input.ticketId) {
      rows = await listNotesForTicket(db, input.ticketId);
    } else {
      rows = await listNotesForLead(db, input.leadPartyId!);
    }
    return rows.map((n) => ({
      id: n.id,
      actorType: n.actorType as NoteActorType,
      ticketId: n.ticketId,
      leadPartyId: n.leadPartyId,
      authorId: n.authorId,
      content: n.content,
      isInternal: n.isInternal,
      createdAt: n.createdAt,
    }));
  },
};

/**
 * The note catalog entries to register in the S1 unified Tool_Catalog so that
 * agentic note create/read flows through the audited dispatcher (Req 14.11).
 */
export const noteCatalogEntries: CatalogEntry[] = [
  createNoteCatalogEntry as CatalogEntry,
  readNotesCatalogEntry as CatalogEntry,
];
