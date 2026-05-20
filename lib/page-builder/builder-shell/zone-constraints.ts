/**
 * Zone Constraints — pure resolution of `allow` / `disallow` rules for a
 * Puck zone, used by the Component_Picker to filter insertable component
 * types per zone.
 *
 * Spec: builder-outline-tree-and-toolbar
 * _Requirements: 5.9_
 *
 * The root zone (`root:default-zone`) has no constraints — all registered
 * components are insertable. For any named zone (compound key
 * `"{ownerId}:{zoneName}"`), the constraints come from the owner
 * component's slot field definition at `config.components[ownerType].fields[zoneName]`.
 */

import type { Config, Data } from "@puckeditor/core";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Allow / disallow rules resolved for a single zone.
 *
 * - `allow`: when non-empty, ONLY these component types may be inserted.
 * - `disallow`: when non-empty, these component types are excluded.
 *
 * Both arrays empty means no restriction (all components allowed).
 */
export interface ZoneConstraints {
  allow: string[];
  disallow: string[];
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const ROOT_ZONE = "root:default-zone";
const EMPTY_CONSTRAINTS: ZoneConstraints = { allow: [], disallow: [] };

/**
 * Find the component type for an instance id by scanning the root content
 * and every nested zone in `data.zones`. Returns null when the id is not
 * found (e.g., orphan zone key).
 */
function findOwnerType(ownerId: string, data: Data): string | null {
  const content = (data.content ?? []) as Array<{
    type: string;
    props: { id?: unknown };
  }>;
  for (const item of content) {
    if (item.props?.id === ownerId) {
      return item.type;
    }
  }

  const zones = data.zones;
  if (zones) {
    for (const key of Object.keys(zones)) {
      const items = zones[key] as Array<{
        type: string;
        props: { id?: unknown };
      }>;
      for (const item of items) {
        if (item.props?.id === ownerId) {
          return item.type;
        }
      }
    }
  }

  return null;
}

/**
 * Read the `allow` / `disallow` arrays from a slot field definition on
 * the owner component config. Returns empty arrays when the field is not
 * a slot or is missing.
 */
function readSlotConstraints(
  ownerType: string,
  zoneName: string,
  config: Config,
): ZoneConstraints {
  const componentConfig = config.components?.[ownerType] as
    | { fields?: Record<string, unknown> }
    | undefined;
  const field = componentConfig?.fields?.[zoneName] as
    | { type?: unknown; allow?: unknown; disallow?: unknown }
    | undefined;

  if (!field || field.type !== "slot") {
    return EMPTY_CONSTRAINTS;
  }

  const allow = Array.isArray(field.allow)
    ? (field.allow.filter((v) => typeof v === "string") as string[])
    : [];
  const disallow = Array.isArray(field.disallow)
    ? (field.disallow.filter((v) => typeof v === "string") as string[])
    : [];

  return { allow, disallow };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve allow / disallow constraints for a Puck zone.
 *
 * - For the root zone (`"root:default-zone"`) returns empty arrays.
 * - For a named zone (`"{ownerId}:{zoneName}"`) walks `data` to find the
 *   owner's component type, then reads the slot field's `allow` and
 *   `disallow` arrays from the Puck config.
 * - For an unknown owner or non-slot field, returns empty arrays.
 */
export function resolveZoneConstraints(
  zone: string,
  config: Config,
  data: Data,
): ZoneConstraints {
  if (zone === ROOT_ZONE) {
    return { allow: [], disallow: [] };
  }

  const colonIndex = zone.indexOf(":");
  if (colonIndex === -1) {
    return { allow: [], disallow: [] };
  }

  const ownerId = zone.slice(0, colonIndex);
  const zoneName = zone.slice(colonIndex + 1);

  const ownerType = findOwnerType(ownerId, data);
  if (ownerType === null) {
    return { allow: [], disallow: [] };
  }

  return readSlotConstraints(ownerType, zoneName, config);
}
