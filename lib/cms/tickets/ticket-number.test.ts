import { describe, it, expect } from "vitest";
import { formatTicketNumber, parseTicketNumber } from "./ticket-number";

describe("formatTicketNumber", () => {
  it("zero-pads single digit to 6 digits", () => {
    expect(formatTicketNumber(1)).toBe("ORA-000001");
  });

  it("zero-pads two digits", () => {
    expect(formatTicketNumber(42)).toBe("ORA-000042");
  });

  it("handles 6-digit number without padding", () => {
    expect(formatTicketNumber(999999)).toBe("ORA-999999");
  });

  it("handles numbers larger than 6 digits", () => {
    expect(formatTicketNumber(1000000)).toBe("ORA-1000000");
  });
});

describe("parseTicketNumber", () => {
  it("extracts numeric portion from valid ticket number", () => {
    expect(parseTicketNumber("ORA-000001")).toBe(1);
  });

  it("extracts number from ORA-000042", () => {
    expect(parseTicketNumber("ORA-000042")).toBe(42);
  });

  it("extracts number from ORA-999999", () => {
    expect(parseTicketNumber("ORA-999999")).toBe(999999);
  });

  it("returns null for invalid prefix", () => {
    expect(parseTicketNumber("TKT-000001")).toBeNull();
  });

  it("returns null for missing prefix", () => {
    expect(parseTicketNumber("000001")).toBeNull();
  });

  it("returns null for wrong digit count", () => {
    expect(parseTicketNumber("ORA-00001")).toBeNull();
    expect(parseTicketNumber("ORA-0000001")).toBeNull();
  });

  it("returns null for non-numeric characters", () => {
    expect(parseTicketNumber("ORA-00ab01")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseTicketNumber("")).toBeNull();
  });

  it("returns null for lowercase prefix", () => {
    expect(parseTicketNumber("ora-000001")).toBeNull();
  });
});
