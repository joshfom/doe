import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { aiConfig } from "../schema";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScopeConfig {
  permittedCategories: string[];
  blockedKeywords: string[];
}

// ── isWithinScope ────────────────────────────────────────────────────────────

/**
 * Checks whether a user query falls within the permitted scope.
 *
 * Returns `false` if the query contains any blocked keyword (case-insensitive).
 * If `permittedCategories` is empty, all topics are permitted (unless blocked).
 * If `permittedCategories` is non-empty, the query must match at least one
 * permitted category (case-insensitive substring match) to be considered in scope.
 */
export function isWithinScope(query: string, config: ScopeConfig): boolean {
  const lowerQuery = query.toLowerCase();

  // Check blocked keywords first — any match means out of scope
  for (const keyword of config.blockedKeywords) {
    if (keyword && lowerQuery.includes(keyword.toLowerCase())) {
      return false;
    }
  }

  // If no permitted categories are defined, all topics are allowed
  if (config.permittedCategories.length === 0) {
    return true;
  }

  // Check if the query matches at least one permitted category
  for (const category of config.permittedCategories) {
    if (category && lowerQuery.includes(category.toLowerCase())) {
      return true;
    }
  }

  return false;
}

// ── loadScopeConfig ──────────────────────────────────────────────────────────

/**
 * Reads scope configuration from the aiConfig table.
 *
 * Expects two keys:
 * - `scope_permitted_categories`: JSON array string of permitted topic categories
 * - `scope_blocked_keywords`: JSON array string of blocked keywords
 *
 * Returns sensible defaults (empty arrays) if keys are not found or values are invalid.
 */
export async function loadScopeConfig(db: Database): Promise<ScopeConfig> {
  const [categoriesRow] = await db
    .select({ value: aiConfig.value })
    .from(aiConfig)
    .where(eq(aiConfig.key, "scope_permitted_categories"))
    .limit(1);

  const [keywordsRow] = await db
    .select({ value: aiConfig.value })
    .from(aiConfig)
    .where(eq(aiConfig.key, "scope_blocked_keywords"))
    .limit(1);

  return {
    permittedCategories: parseJsonArray(categoriesRow?.value),
    blockedKeywords: parseJsonArray(keywordsRow?.value),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Safely parses a JSON string expected to be an array of strings.
 * Returns an empty array if the value is undefined, null, or not a valid JSON array.
 */
function parseJsonArray(value: string | undefined | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
    return [];
  } catch {
    return [];
  }
}
