/**
 * Locked core event vocabulary. These names are guaranteed to exist and
 * carry the canonical analytics meanings. Adding to this list requires a
 * code change.
 *
 * Custom events managed through the admin panel (see `customEvents` table)
 * extend this list at runtime — they appear alongside the core vocabulary
 * in the page builder dropdown but live in the database.
 */
export const EVENT_VOCABULARY = [
  "page_viewed",
  "section_viewed",
  "cta_clicked",
  "form_started",
  "form_field_abandoned",
  "form_submitted",
  "lead_qualified",
  "viewing_requested",
  "viewing_confirmed",
  "reservation_started",
  "reservation_completed",
  "ai_conversation_started",
  "ai_handoff_to_human",
  "download_brochure",
  "floorplan_viewed",
] as const;

export type EventName = (typeof EVENT_VOCABULARY)[number];

/**
 * Validates that a name belongs to the locked core vocabulary.
 * Custom events bypass this check — use {@link isAcceptedEventName}
 * for runtime validation that includes admin-managed events.
 */
export function isValidEventName(name: string): name is EventName {
  return EVENT_VOCABULARY.includes(name as EventName);
}

/**
 * Validates a name against the union of the core vocabulary and the
 * provided list of custom event names. Use this in the editor / runtime
 * capture path where custom events are allowed.
 */
export function isAcceptedEventName(
  name: string,
  customEventNames: readonly string[],
): boolean {
  return isValidEventName(name) || customEventNames.includes(name);
}

/**
 * Pattern that custom event names must match. Mirrors the snake_case
 * convention of the core vocabulary.
 */
export const CUSTOM_EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface BaseEventProperties {
  project_id?: string;
  unit_type?: string;
  page_template?: string;
  locale: string;
  device_class: "desktop" | "tablet" | "mobile";
  first_touch_source?: string;
  last_touch_source?: string;
  utm_campaign?: string;
}
