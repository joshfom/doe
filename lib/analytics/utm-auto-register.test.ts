import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
vi.mock("@/lib/cms/db", () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
  },
}));

import { db } from "@/lib/cms/db";
import { autoRegisterUtmLink, type AutoRegisterParams } from "./utm-auto-register";

// Helper to set up the mock chain for insert
function mockInsertReturning(rows: Array<{ id: string }>) {
  const returningFn = vi.fn().mockResolvedValue(rows);
  const onConflictDoNothingFn = vi.fn().mockReturnValue({ returning: returningFn });
  const valuesFn = vi.fn().mockReturnValue({ onConflictDoNothing: onConflictDoNothingFn });
  (db.insert as any).mockReturnValue({ values: valuesFn });
  return { valuesFn, onConflictDoNothingFn, returningFn };
}

// Helper to set up the mock chain for select
function mockSelectResult(rows: Array<{ id: string }>) {
  const limitFn = vi.fn().mockResolvedValue(rows);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  (db.select as any).mockReturnValue({ from: fromFn });
  return { fromFn, whereFn, limitFn };
}

describe("autoRegisterUtmLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validation (Task 2.1)", () => {
    it("returns null when utmSource is empty", async () => {
      const result = await autoRegisterUtmLink({
        utmSource: "",
        utmMedium: "cpc",
        utmCampaign: "spring",
        landingPath: "/page",
      });
      expect(result).toBeNull();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("returns null when utmMedium is empty", async () => {
      const result = await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "",
        utmCampaign: "spring",
        landingPath: "/page",
      });
      expect(result).toBeNull();
    });

    it("returns null when utmCampaign is empty", async () => {
      const result = await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "",
        landingPath: "/page",
      });
      expect(result).toBeNull();
    });

    it("returns null when utmSource is whitespace only", async () => {
      const result = await autoRegisterUtmLink({
        utmSource: "   ",
        utmMedium: "cpc",
        utmCampaign: "spring",
        landingPath: "/page",
      });
      expect(result).toBeNull();
    });
  });

  describe("truncation (Task 2.1)", () => {
    it("truncates fields to 500 characters", async () => {
      const longValue = "a".repeat(600);
      mockInsertReturning([{ id: "new-id" }]);

      await autoRegisterUtmLink({
        utmSource: longValue,
        utmMedium: "cpc",
        utmCampaign: "spring",
        landingPath: "/page",
      });

      const insertCall = (db.insert as any).mock.results[0].value.values;
      const valuesArg = insertCall.mock.calls[0][0];
      expect(valuesArg.utmSource).toHaveLength(500);
    });
  });

  describe("insert success (Task 2.1)", () => {
    it("returns new ID when insert succeeds", async () => {
      mockInsertReturning([{ id: "new-uuid-123" }]);

      const result = await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring_2024",
        landingPath: "/projects/marina",
      });

      expect(result).toBe("new-uuid-123");
    });
  });

  describe("conflict handling (Task 2.2)", () => {
    it("selects existing record on conflict and returns its ID", async () => {
      mockInsertReturning([]); // conflict: 0 rows returned
      mockSelectResult([{ id: "existing-uuid-456" }]);

      const result = await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring_2024",
        landingPath: "/projects/marina",
      });

      expect(result).toBe("existing-uuid-456");
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe("destination_url and tagged_url (Task 2.3)", () => {
    it("strips query string from landingPath for destination_url", async () => {
      mockInsertReturning([{ id: "id-1" }]);

      await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring",
        landingPath: "/projects/marina?utm_source=google&utm_medium=cpc",
      });

      const insertCall = (db.insert as any).mock.results[0].value.values;
      const valuesArg = insertCall.mock.calls[0][0];
      expect(valuesArg.destinationUrl).toBe("/projects/marina");
    });

    it("sets tagged_url to destination with UTM params", async () => {
      mockInsertReturning([{ id: "id-1" }]);

      await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring",
        landingPath: "/projects/marina",
      });

      const insertCall = (db.insert as any).mock.results[0].value.values;
      const valuesArg = insertCall.mock.calls[0][0];
      expect(valuesArg.taggedUrl).toContain("/projects/marina?");
      expect(valuesArg.taggedUrl).toContain("utm_source=google");
      expect(valuesArg.taggedUrl).toContain("utm_medium=cpc");
      expect(valuesArg.taggedUrl).toContain("utm_campaign=spring");
    });

    it("sets auto_registered to true and created_by to null", async () => {
      mockInsertReturning([{ id: "id-1" }]);

      await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring",
        landingPath: "/page",
      });

      const insertCall = (db.insert as any).mock.results[0].value.values;
      const valuesArg = insertCall.mock.calls[0][0];
      expect(valuesArg.autoRegistered).toBe(true);
      expect(valuesArg.createdBy).toBeNull();
    });
  });

  describe("null/empty normalization for utm_term and utm_content (Task 2.4)", () => {
    it("treats null utm_term as empty string", async () => {
      mockInsertReturning([{ id: "id-1" }]);

      await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring",
        utmTerm: null,
        landingPath: "/page",
      });

      const insertCall = (db.insert as any).mock.results[0].value.values;
      const valuesArg = insertCall.mock.calls[0][0];
      // null is stored as null in DB (COALESCE handles matching)
      expect(valuesArg.utmTerm).toBeNull();
    });

    it("treats undefined utm_content as empty string", async () => {
      mockInsertReturning([{ id: "id-1" }]);

      await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring",
        utmContent: undefined,
        landingPath: "/page",
      });

      const insertCall = (db.insert as any).mock.results[0].value.values;
      const valuesArg = insertCall.mock.calls[0][0];
      expect(valuesArg.utmContent).toBeNull();
    });

    it("treats empty string utm_term same as null for matching", async () => {
      mockInsertReturning([{ id: "id-1" }]);

      await autoRegisterUtmLink({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "spring",
        utmTerm: "",
        landingPath: "/page",
      });

      const insertCall = (db.insert as any).mock.results[0].value.values;
      const valuesArg = insertCall.mock.calls[0][0];
      // Empty string normalized to null for DB storage
      expect(valuesArg.utmTerm).toBeNull();
    });
  });
});
