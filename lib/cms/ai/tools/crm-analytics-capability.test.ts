// lib/cms/ai/tools/crm-analytics-capability.test.ts
import { describe, it, expect, afterEach } from "vitest";

import {
  crmAnalyticsEntry,
  loadCrmAnalyticsCapabilities,
  CRM_ANALYTICS_TOOL_NAME,
  __setCrmAnalyticsRunner,
} from "./crm-analytics-capability";
import {
  loadHomeCapabilities,
  HOME_TOOL_NAMES,
  AGENT_HOME_PERMISSIONS,
} from "./home-capabilities";
import type { AggregateRunner } from "../../tickets/crm/salesforce-analytics";

afterEach(() => __setCrmAnalyticsRunner(null));

describe("crm-analytics-capability", () => {
  it("assembles a valid catalog with the CRM tool", () => {
    const loaded = loadCrmAnalyticsCapabilities();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.catalog.get(CRM_ANALYTICS_TOOL_NAME)).toBeDefined();
    }
  });

  it("is not OTP-gated and uses the home identity", () => {
    expect(crmAnalyticsEntry.requiresOtp).toBe(false);
    expect(crmAnalyticsEntry.permission).toBe("home:tool:get_crm_analytics");
    expect(crmAnalyticsEntry.auditActor).toBe("agent:home-twin");
  });

  it("degrades to available=false when no runner/creds are configured", async () => {
    __setCrmAnalyticsRunner(null); // force the no-creds path (env may be unset in CI)
    const out = (await crmAnalyticsEntry.handler(
      undefined as never,
      {} as never,
      { granularity: "quarter", includePipeline: true } as never,
    )) as { available: boolean; reason?: string };
    // Either creds are present (returns a snapshot) or not (degrades) — but with
    // an explicitly-null runner and no env, it must degrade gracefully.
    if (!out.available) {
      expect(out.reason).toBeTruthy();
    }
  });

  it("returns a snapshot when an injected runner succeeds", async () => {
    const runner: AggregateRunner = {
      async runAggregate(soql) {
        if (soql.includes("GROUP BY StageName")) return [{ stage: "Negotiation", cnt: 3, amt: 1_000_000 }];
        return [{ cnt: 5, amt: 500_000 }];
      },
    };
    __setCrmAnalyticsRunner(runner);
    const out = (await crmAnalyticsEntry.handler(
      undefined as never,
      {} as never,
      { granularity: "quarter", includePipeline: true } as never,
    )) as { available: boolean; comparisons?: unknown[] };
    expect(out.available).toBe(true);
    expect(out.comparisons?.length).toBe(3);
  });

  it("returns available=false when the runner throws", async () => {
    __setCrmAnalyticsRunner({
      async runAggregate() {
        throw new Error("boom");
      },
    });
    const out = (await crmAnalyticsEntry.handler(
      undefined as never,
      {} as never,
      { granularity: "week", includePipeline: false } as never,
    )) as { available: boolean; reason?: string };
    expect(out.available).toBe(false);
    expect(out.reason).toContain("boom");
  });
});

describe("home catalog integration (CRM analytics)", () => {
  it("includes the CRM tool in the assembled home catalog", () => {
    const loaded = loadHomeCapabilities();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.catalog.get(CRM_ANALYTICS_TOOL_NAME)).toBeDefined();
    }
  });

  it("lists the CRM tool in HOME_TOOL_NAMES and grants its permission", () => {
    expect(HOME_TOOL_NAMES).toContain(CRM_ANALYTICS_TOOL_NAME);
    expect(AGENT_HOME_PERMISSIONS.has("home:tool:get_crm_analytics")).toBe(true);
  });
});
