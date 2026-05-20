/**
 * migrate-data.ts — Applies Puck's `migrate()` helper to convert legacy
 * DropZone-based data (stored in `zones`) to the inline slot data model.
 *
 * Call this on any page data loaded from the database before passing it to
 * `<Puck>` or `<Render>`. The function is idempotent — if the data already
 * uses the slot model (no matching zones), it passes through unchanged.
 *
 * For the Columns component, which uses dynamic zone names (`column-0`,
 * `column-1`, etc.), we rely on the slot fields defined directly on the
 * component config (`"column-0"` through `"column-5"`). Puck's `migrate()`
 * matches zone names to slot field names automatically.
 */

import { migrate, type Data } from "@puckeditor/core";
import { pageBuilderConfig } from "./config";

/**
 * Migrate legacy DropZone data to inline slot data.
 * Safe to call on already-migrated data (no-op).
 */
export function migratePageData(data: Data): Data {
  return migrate(data, pageBuilderConfig);
}
