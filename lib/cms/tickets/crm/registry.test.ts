import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CrmAdapter, CrmCaseInput, CrmCaseResult } from "./adapter";
import { registerAdapter, getActiveAdapter, clearAdapters } from "./registry";

// ── Stub adapter for testing ─────────────────────────────────────────────────

function createStubAdapter(name: string): CrmAdapter {
  return {
    name,
    createCase: async (_input: CrmCaseInput): Promise<CrmCaseResult> => ({
      externalId: "ext-123",
      status: "created",
    }),
    updateCase: async (
      _externalId: string,
      _updates: Partial<CrmCaseInput>
    ): Promise<CrmCaseResult> => ({
      externalId: "ext-123",
      status: "updated",
    }),
    getCaseStatus: async (_externalId: string): Promise<string> => "open",
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CRM Adapter Registry", () => {
  const originalEnv = process.env.CRM_ADAPTER;

  beforeEach(() => {
    clearAdapters();
    delete process.env.CRM_ADAPTER;
  });

  afterEach(() => {
    clearAdapters();
    if (originalEnv !== undefined) {
      process.env.CRM_ADAPTER = originalEnv;
    } else {
      delete process.env.CRM_ADAPTER;
    }
  });

  describe("registerAdapter", () => {
    it("registers an adapter that can be retrieved", () => {
      const adapter = createStubAdapter("salesforce");
      registerAdapter("salesforce", adapter);
      process.env.CRM_ADAPTER = "salesforce";

      const active = getActiveAdapter();
      expect(active).toBe(adapter);
      expect(active?.name).toBe("salesforce");
    });

    it("overwrites a previously registered adapter with the same name", () => {
      const first = createStubAdapter("salesforce");
      const second = createStubAdapter("salesforce");
      registerAdapter("salesforce", first);
      registerAdapter("salesforce", second);
      process.env.CRM_ADAPTER = "salesforce";

      const active = getActiveAdapter();
      expect(active).toBe(second);
    });

    it("supports multiple adapters registered under different names", () => {
      const sf = createStubAdapter("salesforce");
      const hs = createStubAdapter("hubspot");
      registerAdapter("salesforce", sf);
      registerAdapter("hubspot", hs);

      process.env.CRM_ADAPTER = "salesforce";
      expect(getActiveAdapter()).toBe(sf);

      process.env.CRM_ADAPTER = "hubspot";
      expect(getActiveAdapter()).toBe(hs);
    });
  });

  describe("getActiveAdapter", () => {
    it("returns null when CRM_ADAPTER env var is not set", () => {
      registerAdapter("salesforce", createStubAdapter("salesforce"));
      // CRM_ADAPTER is not set
      expect(getActiveAdapter()).toBeNull();
    });

    it("returns null when CRM_ADAPTER env var is empty string", () => {
      registerAdapter("salesforce", createStubAdapter("salesforce"));
      process.env.CRM_ADAPTER = "";
      expect(getActiveAdapter()).toBeNull();
    });

    it("returns null when CRM_ADAPTER names an unregistered adapter", () => {
      registerAdapter("salesforce", createStubAdapter("salesforce"));
      process.env.CRM_ADAPTER = "hubspot";
      expect(getActiveAdapter()).toBeNull();
    });

    it("returns the correct adapter when CRM_ADAPTER matches a registered name", () => {
      const adapter = createStubAdapter("salesforce");
      registerAdapter("salesforce", adapter);
      process.env.CRM_ADAPTER = "salesforce";

      expect(getActiveAdapter()).toBe(adapter);
    });
  });

  describe("clearAdapters", () => {
    it("removes all registered adapters", () => {
      registerAdapter("salesforce", createStubAdapter("salesforce"));
      registerAdapter("hubspot", createStubAdapter("hubspot"));
      process.env.CRM_ADAPTER = "salesforce";

      expect(getActiveAdapter()).not.toBeNull();

      clearAdapters();
      expect(getActiveAdapter()).toBeNull();
    });
  });

  describe("CrmAdapter interface contract", () => {
    it("adapter implements createCase, updateCase, getCaseStatus", async () => {
      const adapter = createStubAdapter("test");

      const createResult = await adapter.createCase({
        ticketNumber: "ORA-000001",
        subject: "Test",
        description: "Test description",
        contactName: "John",
        contactEmail: "john@example.com",
        priority: "medium",
        status: "open",
      });
      expect(createResult).toHaveProperty("externalId");
      expect(createResult).toHaveProperty("status");

      const updateResult = await adapter.updateCase("ext-123", {
        status: "resolved",
      });
      expect(updateResult).toHaveProperty("externalId");
      expect(updateResult).toHaveProperty("status");

      const caseStatus = await adapter.getCaseStatus("ext-123");
      expect(typeof caseStatus).toBe("string");
    });
  });
});
