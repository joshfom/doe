import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

import type { Database } from "../db";
import {
  createMorningBriefingHandler,
  buildMorningBriefingHtml,
  type BriefingEmail,
  type BriefingMailer,
  type MetricsReader,
  type WeekOverWeekMetrics,
} from "./morning-briefing";
import type { JobContext } from "./index";

/**
 * Unit tests for the `morning_briefing` job handler (task 16.7, Req 9.6).
 *
 * The handler is exercised fully offline by injecting fakes for the three
 * collaborators (metrics reader, narrator, Graph mailer) — no live SQL views,
 * no AI gateway, no Microsoft Graph credentials. We assert that:
 *   • the deltas read from the view are the figures handed to the narrator
 *     (the LLM narrates, it never computes — FR-T1);
 *   • the rendered email carries the narrative and the view's figures;
 *   • the recipient resolves from the payload (and from the env fallback);
 *   • a mail delivery failure surfaces as a throw so the spine records failure.
 */

const METRICS: WeekOverWeekMetrics = {
  currentWeek: "2026-05-04",
  priorWeek: "2026-04-27",
  qualifiedTotal: 18,
  priorQualifiedTotal: 12,
  qualifiedTotalDelta: 6,
  hot: 7,
  priorHot: 4,
  hotDelta: 3,
  spend: 42000,
  priorSpend: 38000,
  spendDelta: 4000,
  medianSpeedToLeadSeconds: 1800,
  priorMedianSpeedToLeadSeconds: 2400,
  medianSpeedToLeadDelta: -600,
  costPerQualifiedLead: 2333.33,
  priorCostPerQualifiedLead: 3166.67,
};

// The injected reader ignores the db, so a stub satisfies the signature.
const stubDb = {} as unknown as Database;

function ctx(jobKey: string): JobContext {
  return { jobId: randomUUID(), jobKey, kind: "morning_briefing", partyId: null };
}

function fakeReader(metrics: WeekOverWeekMetrics | null): MetricsReader {
  return async () => metrics;
}

interface Captured {
  emails: BriefingEmail[];
  narratorArg: WeekOverWeekMetrics | null | undefined;
}

function makeMailer(captured: Captured, ok = true): BriefingMailer {
  return async (email) => {
    captured.emails.push(email);
    return ok ? { success: true } : { success: false, error: "graph 503" };
  };
}

describe("morning_briefing handler (Req 9.6)", () => {
  it("reads deltas from the view, narrates them, and delivers via Graph mail", async () => {
    const captured: Captured = { emails: [], narratorArg: undefined };

    const handler = createMorningBriefingHandler({
      readMetrics: fakeReader(METRICS),
      narrate: async (metrics) => {
        captured.narratorArg = metrics;
        return "Strong start — qualified leads and HOT leads both climbed.";
      },
      sendMail: makeMailer(captured),
    });

    await handler(
      stubDb,
      { recipientEmail: "exec@ora.ae", recipientName: "Layla" },
      ctx("briefing:2026-05-04")
    );

    // The figures handed to the narrator are EXACTLY the view's deltas.
    expect(captured.narratorArg).toEqual(METRICS);

    // Exactly one mail delivered, to the payload recipient.
    expect(captured.emails).toHaveLength(1);
    const [email] = captured.emails;
    expect(email.to).toEqual(["exec@ora.ae"]);
    expect(email.subject).toMatch(/Morning Briefing/);

    // The body carries both the narrative and the view's figures.
    expect(email.htmlContent).toContain("Strong start");
    expect(email.htmlContent).toContain("18"); // qualifiedTotal
    expect(email.htmlContent).toContain("+6"); // qualifiedTotalDelta
    expect(email.htmlContent).toContain("+3"); // hotDelta
  });

  it("resolves the recipient from ORA_BRIEFING_RECIPIENT_EMAIL when payload omits it", async () => {
    const captured: Captured = { emails: [], narratorArg: undefined };
    const prev = process.env.ORA_BRIEFING_RECIPIENT_EMAIL;
    process.env.ORA_BRIEFING_RECIPIENT_EMAIL = "a@ora.ae, b@ora.ae";

    try {
      const handler = createMorningBriefingHandler({
        readMetrics: fakeReader(METRICS),
        narrate: async () => "ok",
        sendMail: makeMailer(captured),
      });

      await handler(stubDb, {}, ctx("briefing:env"));

      expect(captured.emails[0].to).toEqual(["a@ora.ae", "b@ora.ae"]);
    } finally {
      if (prev === undefined) delete process.env.ORA_BRIEFING_RECIPIENT_EMAIL;
      else process.env.ORA_BRIEFING_RECIPIENT_EMAIL = prev;
    }
  });

  it("throws when no recipient is configured (so the spine records failure)", async () => {
    const prev = process.env.ORA_BRIEFING_RECIPIENT_EMAIL;
    delete process.env.ORA_BRIEFING_RECIPIENT_EMAIL;

    try {
      const handler = createMorningBriefingHandler({
        readMetrics: fakeReader(METRICS),
        narrate: async () => "ok",
        sendMail: makeMailer({ emails: [], narratorArg: undefined }),
      });

      await expect(
        handler(stubDb, {}, ctx("briefing:none"))
      ).rejects.toThrow(/no recipient/);
    } finally {
      if (prev !== undefined) process.env.ORA_BRIEFING_RECIPIENT_EMAIL = prev;
    }
  });

  it("throws when Graph mail delivery fails (so the spine records failure)", async () => {
    const captured: Captured = { emails: [], narratorArg: undefined };
    const handler = createMorningBriefingHandler({
      readMetrics: fakeReader(METRICS),
      narrate: async () => "ok",
      sendMail: makeMailer(captured, false),
    });

    await expect(
      handler(stubDb, { recipientEmail: "exec@ora.ae" }, ctx("briefing:fail"))
    ).rejects.toThrow(/mail delivery failed/);
  });

  it("still delivers a briefing when there is no weekly data yet", async () => {
    const captured: Captured = { emails: [], narratorArg: undefined };
    const handler = createMorningBriefingHandler({
      readMetrics: fakeReader(null),
      narrate: async (m) => {
        captured.narratorArg = m;
        return "No activity recorded yet.";
      },
      sendMail: makeMailer(captured),
    });

    await handler(
      stubDb,
      { recipientEmail: "exec@ora.ae" },
      ctx("briefing:empty")
    );

    expect(captured.narratorArg).toBeNull();
    expect(captured.emails).toHaveLength(1);
    expect(captured.emails[0].htmlContent).toContain("No activity recorded yet.");
  });
});

describe("buildMorningBriefingHtml", () => {
  it("renders an RTL Arabic document when language is ar", () => {
    const html = buildMorningBriefingHtml({
      recipientName: "ليلى",
      narrative: "ملخص",
      metrics: METRICS,
      language: "ar",
    });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("إيجاز الصباح");
  });

  it("renders an LTR English document with the metrics table", () => {
    const html = buildMorningBriefingHtml({
      recipientName: "Layla",
      narrative: "Summary",
      metrics: METRICS,
      language: "en",
    });
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("Morning Briefing");
    expect(html).toContain("HOT leads");
  });
});
