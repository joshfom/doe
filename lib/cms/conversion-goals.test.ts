import { describe, it, expect, vi, beforeEach } from "vitest";
import { getConversionEventNames, DEFAULT_CONVERSION_EVENTS } from "./conversion-goals";

describe("conversion-goals helper", () => {
  describe("DEFAULT_CONVERSION_EVENTS", () => {
    it("contains the expected fallback events", () => {
      expect(DEFAULT_CONVERSION_EVENTS).toEqual([
        "lead_qualified",
        "reservation_completed",
        "form_submitted",
      ]);
    });
  });

  describe("getConversionEventNames", () => {
    it("returns default events when goals array is empty", () => {
      const result = getConversionEventNames([]);
      expect(result).toEqual(DEFAULT_CONVERSION_EVENTS);
    });

    it("returns event names from provided goals", () => {
      const goals = [
        {
          id: "a1",
          eventName: "demo_booked",
          displayLabel: "Demo Booked",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "b2",
          eventName: "signup_completed",
          displayLabel: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const result = getConversionEventNames(goals);
      expect(result).toEqual(["demo_booked", "signup_completed"]);
    });
  });
});
