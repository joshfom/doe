import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "../db";
import {
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
  suggestAlternativeSlots,
} from "./actions";

// ── Mock audit ───────────────────────────────────────────────────────────────

vi.mock("../audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

import { logAudit } from "../audit";
const mockLogAudit = logAudit as ReturnType<typeof vi.fn>;

// ── Mock DB helper ───────────────────────────────────────────────────────────

/**
 * Creates a mock database that supports chained select/insert/update/delete.
 * Each call to a top-level method (select, insert, update, delete) consumes
 * the next result in the queue.
 */
function createMockDb(queryResults: unknown[][]) {
  let callIndex = 0;

  function nextResult() {
    const result = queryResults[callIndex] ?? [];
    callIndex++;
    return result;
  }

  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      const result = nextResult();
      // .where() returns a thenable with optional .limit()
      const whereMock: any = Object.assign(Promise.resolve(result), {
        limit: vi.fn().mockResolvedValue(result),
      });
      // .from() is also thenable (for queries without .where(), e.g. generateReferenceNumber)
      const fromMock: any = Object.assign(Promise.resolve(result), {
        where: vi.fn().mockReturnValue(whereMock),
      });
      return {
        from: vi.fn().mockReturnValue(fromMock),
      };
    }),

    insert: vi.fn().mockImplementation(() => {
      const result = nextResult();
      return {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(result),
        }),
      };
    }),

    update: vi.fn().mockImplementation(() => {
      const result = nextResult();
      return {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(result),
            then: (resolve: (v: unknown[]) => void) => resolve(result),
            [Symbol.toStringTag]: "Promise",
          }),
        }),
      };
    }),

    delete: vi.fn().mockImplementation(() => {
      const result = nextResult();
      return {
        where: vi.fn().mockResolvedValue(result),
      };
    }),
  };

  return mockDb as unknown as Database;
}

// ── Sample data ──────────────────────────────────────────────────────────────

const validBookingInput = {
  contactName: "Ahmed Hassan",
  contactEmail: "ahmed@example.com",
  contactPhone: "+971501234567",
  appointmentType: "site_visit" as const,
  scheduledDate: "2025-08-15",
  scheduledTime: "10:00",
  notes: "First visit",
};

const sampleAppointment = {
  id: "apt-1",
  referenceNumber: "ORA-APT-000001",
  appointmentType: "site_visit",
  scheduledDate: "2025-08-15",
  scheduledTime: "10:00",
  status: "confirmed",
  contactName: "Ahmed Hassan",
};

// ── bookAppointment tests ────────────────────────────────────────────────────

describe("bookAppointment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an appointment with valid input", async () => {
    // Query 1: hasConflict → select count from aiAppointments → no conflict
    // Query 2: generateReferenceNumber → select count from aiAppointments → 0 existing
    // Query 3: insert appointment → returning the new record
    const db = createMockDb([
      [{ total: 0 }], // hasConflict check
      [{ total: 0 }], // generateReferenceNumber count
      [sampleAppointment], // insert returning
    ]);

    const result = await bookAppointment(db, validBookingInput);

    expect(result.id).toBe("apt-1");
    expect(result.referenceNumber).toBe("ORA-APT-000001");
    expect(result.status).toBe("confirmed");
    expect(result.contactName).toBe("Ahmed Hassan");
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "ai_appointment_create",
        entityType: "ai_appointment",
        entityId: "apt-1",
      })
    );
  });

  it("throws error when contact name is missing", async () => {
    const db = createMockDb([]);

    await expect(
      bookAppointment(db, { ...validBookingInput, contactName: "" })
    ).rejects.toThrow("Contact name is required");
  });

  it("throws error when scheduled date is missing", async () => {
    const db = createMockDb([]);

    await expect(
      bookAppointment(db, { ...validBookingInput, scheduledDate: "" })
    ).rejects.toThrow("Scheduled date is required");
  });

  it("throws error when scheduled time is missing", async () => {
    const db = createMockDb([]);

    await expect(
      bookAppointment(db, { ...validBookingInput, scheduledTime: "" })
    ).rejects.toThrow("Scheduled time is required");
  });

  it("throws error when appointment type is missing", async () => {
    const db = createMockDb([]);

    await expect(
      bookAppointment(db, { ...validBookingInput, appointmentType: "" as any })
    ).rejects.toThrow("Appointment type is required");
  });

  it("throws error when time slot is already booked (double-booking prevention)", async () => {
    // Query 1: hasConflict → select count → conflict exists
    const db = createMockDb([
      [{ total: 1 }], // hasConflict returns true
    ]);

    await expect(bookAppointment(db, validBookingInput)).rejects.toThrow(
      "Time slot 2025-08-15 10:00 is already booked"
    );
  });

  it("generates sequential reference numbers", async () => {
    const appointmentWithSeq5 = {
      ...sampleAppointment,
      referenceNumber: "ORA-APT-000005",
    };

    // Query 1: hasConflict → no conflict
    // Query 2: generateReferenceNumber → 4 existing appointments
    // Query 3: insert returning
    const db = createMockDb([
      [{ total: 0 }],
      [{ total: 4 }],
      [appointmentWithSeq5],
    ]);

    const result = await bookAppointment(db, validBookingInput);

    expect(result.referenceNumber).toBe("ORA-APT-000005");
  });
});

// ── cancelAppointment tests ──────────────────────────────────────────────────

describe("cancelAppointment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels an existing confirmed appointment", async () => {
    // Query 1: select existing appointment
    // Query 2: update status to cancelled
    const db = createMockDb([
      [{ id: "apt-1", status: "confirmed" }], // existing appointment
      [], // update result (void)
    ]);

    await cancelAppointment(db, "ORA-APT-000001", "conv-1");

    expect(mockLogAudit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "ai_appointment_cancel",
        entityType: "ai_appointment",
        entityId: "apt-1",
      })
    );
  });

  it("throws error when appointment is not found", async () => {
    // Query 1: select → empty (not found)
    const db = createMockDb([[]]);

    await expect(
      cancelAppointment(db, "ORA-APT-999999", "conv-1")
    ).rejects.toThrow("Appointment ORA-APT-999999 not found");
  });

  it("throws error when appointment is already cancelled", async () => {
    // Query 1: select → already cancelled
    const db = createMockDb([[{ id: "apt-1", status: "cancelled" }]]);

    await expect(
      cancelAppointment(db, "ORA-APT-000001", "conv-1")
    ).rejects.toThrow("Appointment ORA-APT-000001 is already cancelled");
  });
});

// ── rescheduleAppointment tests ──────────────────────────────────────────────

describe("rescheduleAppointment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reschedules an appointment to an available slot", async () => {
    const rescheduledAppointment = {
      id: "apt-1",
      referenceNumber: "ORA-APT-000001",
      appointmentType: "site_visit",
      scheduledDate: "2025-08-20",
      scheduledTime: "14:00",
      status: "rescheduled",
      contactName: "Ahmed Hassan",
    };

    // Query 1: select existing appointment
    // Query 2: hasConflict → no conflict
    // Query 3: update returning rescheduled record
    const db = createMockDb([
      [{ id: "apt-1", status: "confirmed", contactName: "Ahmed Hassan" }],
      [{ total: 0 }], // no conflict
      [rescheduledAppointment], // update returning
    ]);

    const result = await rescheduleAppointment(
      db,
      "ORA-APT-000001",
      "2025-08-20",
      "14:00"
    );

    expect(result.status).toBe("rescheduled");
    expect(result.scheduledDate).toBe("2025-08-20");
    expect(result.scheduledTime).toBe("14:00");
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
  });

  it("throws error when appointment is not found", async () => {
    const db = createMockDb([[]]);

    await expect(
      rescheduleAppointment(db, "ORA-APT-999999", "2025-08-20", "14:00")
    ).rejects.toThrow("Appointment ORA-APT-999999 not found");
  });

  it("throws error when appointment is cancelled", async () => {
    const db = createMockDb([
      [{ id: "apt-1", status: "cancelled", contactName: "Ahmed" }],
    ]);

    await expect(
      rescheduleAppointment(db, "ORA-APT-000001", "2025-08-20", "14:00")
    ).rejects.toThrow("Cannot reschedule a cancelled appointment");
  });

  it("throws error when new time slot has a conflict", async () => {
    // Query 1: select existing appointment
    // Query 2: hasConflict → conflict exists
    const db = createMockDb([
      [{ id: "apt-1", status: "confirmed", contactName: "Ahmed" }],
      [{ total: 1 }], // conflict
    ]);

    await expect(
      rescheduleAppointment(db, "ORA-APT-000001", "2025-08-20", "14:00")
    ).rejects.toThrow("Time slot 2025-08-20 14:00 is already booked");
  });
});

// ── suggestAlternativeSlots tests ────────────────────────────────────────────

describe("suggestAlternativeSlots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper: compute the date string that suggestAlternativeSlots will use
   * for a given input date and day offset. This mirrors the implementation's
   * `new Date(date + "T00:00:00").toISOString().split("T")[0]` logic so
   * tests are timezone-agnostic.
   */
  function expectedDate(inputDate: string, dayOffset: number = 0): string {
    const d = new Date(inputDate + "T00:00:00");
    d.setDate(d.getDate() + dayOffset);
    return d.toISOString().split("T")[0];
  }

  it("returns available slots when no bookings exist", async () => {
    // Query 1: getBookedSlots for the requested date → no bookings
    const db = createMockDb([
      [], // no booked slots on the date
    ]);

    const slots = await suggestAlternativeSlots(db, "2025-08-15", "site_visit", 3);

    expect(slots).toHaveLength(3);
    const day0 = expectedDate("2025-08-15");
    expect(slots[0]).toEqual({ date: day0, time: "09:00" });
    expect(slots[1]).toEqual({ date: day0, time: "10:00" });
    expect(slots[2]).toEqual({ date: day0, time: "11:00" });
  });

  it("skips booked slots and returns only available ones", async () => {
    // Query 1: getBookedSlots → 09:00 and 10:00 are booked
    const db = createMockDb([
      [{ time: "09:00" }, { time: "10:00" }], // booked slots
    ]);

    const slots = await suggestAlternativeSlots(db, "2025-08-15", "site_visit", 3);

    expect(slots).toHaveLength(3);
    const day0 = expectedDate("2025-08-15");
    // Should skip 09:00 and 10:00, return 11:00, 12:00, 13:00
    expect(slots[0]).toEqual({ date: day0, time: "11:00" });
    expect(slots[1]).toEqual({ date: day0, time: "12:00" });
    expect(slots[2]).toEqual({ date: day0, time: "13:00" });
  });

  it("spans multiple days when a day is fully booked", async () => {
    // Day 1: all 8 business hour slots booked
    const allBookedSlots = [
      { time: "09:00" },
      { time: "10:00" },
      { time: "11:00" },
      { time: "12:00" },
      { time: "13:00" },
      { time: "14:00" },
      { time: "15:00" },
      { time: "16:00" },
    ];
    // Day 2: no bookings
    const db = createMockDb([
      allBookedSlots, // day 1 fully booked
      [], // day 2 empty
    ]);

    const slots = await suggestAlternativeSlots(db, "2025-08-15", "site_visit", 3);

    expect(slots).toHaveLength(3);
    const day1 = expectedDate("2025-08-15", 1);
    // All slots should be on the next day
    expect(slots[0].date).toBe(day1);
    expect(slots[0].time).toBe("09:00");
  });

  it("returns empty array when all slots are booked within search window", async () => {
    // Create a mock that returns all slots booked for 14 days
    const allBooked = [
      { time: "09:00" },
      { time: "10:00" },
      { time: "11:00" },
      { time: "12:00" },
      { time: "13:00" },
      { time: "14:00" },
      { time: "15:00" },
      { time: "16:00" },
    ];
    const results: unknown[][] = [];
    for (let i = 0; i < 14; i++) {
      results.push(allBooked);
    }
    const db = createMockDb(results);

    const slots = await suggestAlternativeSlots(db, "2025-08-15", "site_visit", 3);

    expect(slots).toHaveLength(0);
  });

  it("defaults to 3 slots when count is not specified", async () => {
    const db = createMockDb([[]]);

    const slots = await suggestAlternativeSlots(db, "2025-08-15", "site_visit");

    expect(slots).toHaveLength(3);
  });
});
