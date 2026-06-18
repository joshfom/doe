/**
 * The unified, canonical Tool_Catalog (Agentic Foundation S1, Design §Components #1).
 *
 * Today `lib/cms/ai/tools/registry.ts` defines `ToolDef<N extends ToolName>`
 * bound to the *voice* `ToolName` union with a hardcoded `agent:voice-lead`
 * actor/permission model. This module generalises that into a `CatalogEntry`
 * that is NOT tied to any one agent's tool union and that carries every field
 * Requirement 2.2 mandates (Zod input + output schema, required RBAC
 * permission, OTP requirement flag, and audit actor).
 *
 * The catalog is the single source of tool definitions for every Agent
 * (Requirement 2.1, 2.5): no Agent may invoke a tool whose definition is not a
 * `CatalogEntry`, because the Mastra binding layer generates tools *only* from
 * the loaded catalog.
 *
 * `loadCatalog` validates and assembles the catalog at load time:
 *   - an entry missing any required field is rejected and EXCLUDED, with an
 *     `incomplete_entry` error surfaced for it (Requirement 2.8);
 *   - two entries sharing a name reject the WHOLE catalog with a
 *     `duplicate_name` error (Requirement 2.5, 2.9).
 *
 * `toToolDefinitionSpec` derives the JSON Schema a model needs for native
 * tool-calling from the entry's Zod input schema (Requirement 2.6).
 *
 * Design references: §Components #1 (unified Tool_Catalog and Catalog_Entry).
 * Requirements: 2.1, 2.2, 2.5, 2.6, 2.8, 2.9.
 */

import { z, type ZodType } from "zod";
import type { ToolContext, ToolHandler } from "./registry"; // ToolContext reused (Design §Components #1)

// Re-export the reused context type so catalog consumers need not reach into
// the voice registry directly.
export type { ToolContext, ToolHandler };

/** One typed tool in the single canonical catalog (Requirement 2.2). */
export interface CatalogEntry<I = unknown, O = unknown> {
  /** Unique across the catalog (Requirement 2.9). */
  name: string;
  /** Surfaced to the model for native tool-calling. */
  description: string;
  /** Zod input schema (Requirement 2.2). */
  inputSchema: ZodType<I>;
  /** Zod output schema (Requirement 2.2). */
  outputSchema: ZodType<O>;
  /** OTP requirement flag (Requirement 2.2, 11). */
  requiresOtp: boolean;
  /** Required RBAC permission, `"resource:action"` (Requirement 2.2, 3.4). */
  permission: string;
  /** Audit actor for this entry, e.g. `"agent:text-lead"` (Requirement 2.2, 10.2). */
  auditActor: string;
  /** Executes via existing audited services — never raw DB beyond the service. */
  handler: ToolHandler<I, O>;
}

/** The assembled catalog: a read-only map keyed by unique tool name. */
export type Catalog = ReadonlyMap<string, CatalogEntry>;

/**
 * The fields every `CatalogEntry` must populate (Requirement 2.2). `name` is
 * checked separately so its error message can name the offending position even
 * when the name itself is what is missing.
 */
const REQUIRED_FIELDS = [
  "description",
  "inputSchema",
  "outputSchema",
  "permission",
  "requiresOtp",
  "auditActor",
  "handler",
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** A structured load-time error surfaced by {@link loadCatalog}. */
export interface CatalogLoadError {
  /** The offending entry's name, when it has one. */
  name?: string;
  code: "incomplete_entry" | "duplicate_name";
  message: string;
}

/**
 * The result of assembling the catalog.
 *  - `ok: true`  → every entry was complete and uniquely named.
 *  - `ok: false` → at least one error; `catalog` still carries the entries that
 *    DID load (an incomplete entry only drops itself — Requirement 2.8), unless
 *    a duplicate name poisoned the whole catalog (Requirement 2.9).
 */
export type CatalogLoadResult =
  | { ok: true; catalog: Catalog }
  | { ok: false; errors: CatalogLoadError[]; catalog: Catalog };

/**
 * Tell whether a required field is populated. `requiresOtp` is a boolean, so
 * `false` is a *valid, present* value — only `undefined`/`null` count as
 * missing. All other fields are objects/strings/functions that must be present.
 */
function isFieldPresent(entry: CatalogEntry, field: RequiredField): boolean {
  const value = (entry as unknown as Record<string, unknown>)[field];
  return value !== undefined && value !== null;
}

/**
 * Validate and assemble the catalog at load time. Pure function over the entry
 * array, so it is directly unit- and property-testable.
 *
 *  - missing any required field → reject THAT entry, exclude it, surface an
 *    `incomplete_entry` error (Requirement 2.8);
 *  - duplicate name             → reject the CATALOG, surface a `duplicate_name`
 *    error naming the duplicated tool (Requirement 2.5, 2.9).
 */
export function loadCatalog(entries: CatalogEntry[]): CatalogLoadResult {
  const errors: CatalogLoadError[] = [];
  const seen = new Map<string, CatalogEntry>();
  let duplicate = false;

  for (const entry of entries) {
    const missing = REQUIRED_FIELDS.filter((f) => !isFieldPresent(entry, f));
    const hasName = typeof entry.name === "string" && entry.name.length > 0;

    if (!hasName || missing.length > 0) {
      const missingList = [...(hasName ? [] : ["name"]), ...missing];
      errors.push({
        name: hasName ? entry.name : undefined,
        code: "incomplete_entry",
        message: `Catalog entry "${hasName ? entry.name : "<unnamed>"}" missing: ${missingList.join(", ")}`,
      });
      continue; // exclude the incomplete entry (Requirement 2.8)
    }

    if (seen.has(entry.name)) {
      duplicate = true;
      errors.push({
        name: entry.name,
        code: "duplicate_name",
        message: `Duplicate tool name "${entry.name}"`,
      });
      continue;
    }

    seen.set(entry.name, entry);
  }

  // A duplicate poisons the whole catalog (Requirement 2.9); an incomplete
  // entry only drops itself (Requirement 2.8).
  if (duplicate || errors.length > 0) {
    return { ok: false, errors, catalog: seen };
  }
  return { ok: true, catalog: seen };
}

/** The model-facing tool specification derived from a {@link CatalogEntry}. */
export interface ToolDefinitionSpec {
  name: string;
  description: string;
  /** A valid JSON Schema derived from the entry's Zod input schema. */
  parameters: z.core.JSONSchema.BaseSchema;
}

/**
 * Generate the tool's argument schema as a valid JSON Schema derived from the
 * entry's Zod input schema, for native model tool-calling (Requirement 2.6).
 */
export function toToolDefinitionSpec(entry: CatalogEntry): ToolDefinitionSpec {
  return {
    name: entry.name,
    description: entry.description,
    parameters: z.toJSONSchema(entry.inputSchema),
  };
}
