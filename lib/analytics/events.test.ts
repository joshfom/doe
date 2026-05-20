import { describe, it, expect } from "vitest";
import { EVENT_VOCABULARY, isValidEventName } from "./events";
import type { EventName, BaseEventProperties } from "./events";

describe("EVENT_VOCABULARY", () => {
  it("contains exactly 15 event names", () => {
    expect(EVENT_VOCABULARY).toHaveLength(15);
  });

  it("includes all required event names", () => {
    const expected = [
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
    ];
    expect([...EVENT_VOCABULARY]).toEqual(expected);
  });

  it("is a readonly tuple (as const)", () => {
    // Verify it's treated as a readonly array
    const vocab: readonly string[] = EVENT_VOCABULARY;
    expect(vocab).toBeDefined();
  });
});

describe("isValidEventName", () => {
  it("returns true for valid event names", () => {
    expect(isValidEventName("page_viewed")).toBe(true);
    expect(isValidEventName("cta_clicked")).toBe(true);
    expect(isValidEventName("ai_handoff_to_human")).toBe(true);
    expect(isValidEventName("floorplan_viewed")).toBe(true);
  });

  it("returns false for invalid event names", () => {
    expect(isValidEventName("invalid_event")).toBe(false);
    expect(isValidEventName("")).toBe(false);
    expect(isValidEventName("PAGE_VIEWED")).toBe(false);
    expect(isValidEventName("page_viewed ")).toBe(false);
  });

  it("acts as a type guard narrowing string to EventName", () => {
    const name: string = "lead_qualified";
    if (isValidEventName(name)) {
      // TypeScript should narrow this to EventName
      const eventName: EventName = name;
      expect(eventName).toBe("lead_qualified");
    }
  });
});

describe("BaseEventProperties", () => {
  it("accepts a valid object with all required fields", () => {
    const props: BaseEventProperties = {
      locale: "en",
      device_class: "desktop",
    };
    expect(props.locale).toBe("en");
    expect(props.device_class).toBe("desktop");
  });

  it("accepts a valid object with all fields", () => {
    const props: BaseEventProperties = {
      project_id: "marina",
      unit_type: "2br-apartment",
      page_template: "project-landing",
      locale: "ar",
      device_class: "mobile",
      first_touch_source: "google",
      last_touch_source: "facebook",
      utm_campaign: "marina_q1_awareness",
    };
    expect(props.project_id).toBe("marina");
    expect(props.device_class).toBe("mobile");
  });
});
