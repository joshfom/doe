import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * Unit tests for the `send_whatsapp_brief` job + `ChannelAdapter` (task 16.8).
 *
 * Covers, with a mocked ChannelAdapter (no live WhatsApp credentials):
 *   • composeRepBrief — pure brief composition, omits absent facts, no raw phone;
 *   • WhatsAppChannelAdapter — posts to the WhatsApp Cloud API via injected fetch;
 *   • the job handler against real SQL (pg-mem + migration 0029): reads rep +
 *     lead facts, composes the brief, and sends EXACTLY ONE message through the
 *     injected adapter (Req 9.7 / Property 7 side-effect at-most-once);
 *   • provider-swap: a different ChannelAdapter requires no job-code change;
 *   • failure paths (missing rep / no rep phone / missing party).
 *
 * pg-mem harness mirrors `post-call-processing.test.ts`.
 */

import * as schema from "../schema";
import { parties, leadsMirror, reps } from "../schema";
import type { Database } from "../db";
import {
  composeRepBrief,
  createSendWhatsappBriefHandler,
} from "./send-whatsapp-brief";
import {
  WhatsAppChannelAdapter,
  type ChannelAdapter,
  type ChannelMessage,
} from "./channel-adapter";
import type { JobContext } from "./index";

const MIGRATION_FILE = "0029_demonic_mandrill.sql";

const PREREQUISITE_SQL = `
  CREATE TABLE "ai_clients"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_tenants"  ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_appointments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_conversations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE "ai_messages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.registerFunction({
    name: "pg_notify",
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: () => "",
  });

  mem.public.none(PREREQUISITE_SQL);

  const migrationSql = readFileSync(
    join(process.cwd(), "drizzle", MIGRATION_FILE),
    "utf-8"
  );
  for (const stmt of splitStatements(migrationSql)) {
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;
      const result = originalQuery(clean, values, cb);
      if (
        wantArray &&
        result &&
        typeof (result as Promise<unknown>).then === "function"
      ) {
        return (result as Promise<{ rows: Record<string, unknown>[] }>).then(
          (r) => ({ ...r, rows: r.rows.map((row) => Object.values(row)) })
        );
      }
      return result;
    }
    return originalQuery(config, values, cb);
  };

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
}

/** A fake ChannelAdapter that records every message it is asked to send. */
class FakeChannelAdapter implements ChannelAdapter {
  readonly provider: string;
  readonly sent: ChannelMessage[] = [];
  constructor(provider = "fake") {
    this.provider = provider;
  }
  async send(message: ChannelMessage) {
    this.sent.push(message);
    return { messageId: `fake-${this.sent.length}`, provider: this.provider };
  }
}

async function seedRepAndLead(
  db: Database,
  opts: {
    repPhone?: string | null;
    leadName?: string | null;
    tier?: "HOT" | "WARM" | "NURTURE";
    projectInterest?: string;
    budgetBand?: string;
    lastInteractionSummary?: string;
  } = {}
): Promise<{ repId: string; partyId: string }> {
  const [rep] = await db
    .insert(reps)
    .values({
      name: "Aisha",
      languages: ["en", "ar"],
      projects: ["Bayn"],
      capacity: 3,
      openHotCount: 0,
      phone: opts.repPhone === undefined ? "+971500000001" : opts.repPhone,
    })
    .returning({ id: reps.id });

  const [party] = await db
    .insert(parties)
    .values({ type: "person", name: opts.leadName ?? "Lina", language: "en" })
    .returning({ id: parties.id });

  await db.insert(leadsMirror).values({
    partyId: party.id,
    tier: opts.tier ?? "HOT",
    projectInterest: opts.projectInterest ?? "Bayn",
    budgetBand: opts.budgetBand ?? "2M-3M",
    lastInteractionSummary:
      opts.lastInteractionSummary ?? "Keen on a 2-bed, wants a viewing.",
  });

  return { repId: rep.id, partyId: party.id };
}

function ctx(jobKey: string, partyId: string | null): JobContext {
  return { jobId: randomUUID(), jobKey, kind: "send_whatsapp_brief", partyId };
}

describe("composeRepBrief (Req 9.7)", () => {
  it("includes the rep name, lead name, and all present qualification facts", () => {
    const brief = composeRepBrief({
      repName: "Aisha",
      leadName: "Lina",
      tier: "HOT",
      projectInterest: "Bayn",
      unitInterest: "2-bed",
      budgetBand: "2M-3M",
      lastInteractionSummary: "Wants a viewing this week.",
    });
    expect(brief).toContain("Aisha");
    expect(brief).toContain("Lina");
    expect(brief).toContain("Tier HOT");
    expect(brief).toContain("project Bayn");
    expect(brief).toContain("unit 2-bed");
    expect(brief).toContain("budget 2M-3M");
    expect(brief).toContain("Wants a viewing this week.");
  });

  it("omits absent facts and never contains a raw phone number (Req 14.5)", () => {
    const brief = composeRepBrief({
      repName: "Aisha",
      leadName: null,
      tier: null,
      projectInterest: null,
      unitInterest: null,
      budgetBand: null,
      lastInteractionSummary: null,
    });
    expect(brief).toContain("Aisha");
    expect(brief).toContain("a new lead");
    expect(brief).not.toMatch(/tier/i);
    expect(brief).not.toMatch(/budget/i);
    // No phone-like digit run anywhere in the brief body.
    expect(brief).not.toMatch(/\+?\d{8,}/);
  });
});

describe("WhatsAppChannelAdapter (creds mocked via injected fetch)", () => {
  it("POSTs a text message to the WhatsApp Cloud API and returns the message id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.ABC" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const adapter = new WhatsAppChannelAdapter(
      {
        apiBaseUrl: "https://graph.example.com/v21.0",
        phoneNumberId: "PN123",
        accessToken: "tok",
      },
      fakeFetch
    );

    const result = await adapter.send({ to: "+971500000001", body: "Hi" });

    expect(result).toEqual({ messageId: "wamid.ABC", provider: "whatsapp" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://graph.example.com/v21.0/PN123/messages");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.to).toBe("+971500000001");
    expect(body.text.body).toBe("Hi");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok"
    );
  });

  it("throws with provider detail when the API responds with an error", async () => {
    const fakeFetch = (async () =>
      new Response("bad token", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
    const adapter = new WhatsAppChannelAdapter(
      { apiBaseUrl: "https://x", phoneNumberId: "PN", accessToken: "t" },
      fakeFetch
    );
    await expect(adapter.send({ to: "+9715", body: "Hi" })).rejects.toThrow(
      /WhatsApp send failed \(401/
    );
  });
});

describe("send_whatsapp_brief handler (Req 9.7)", () => {
  let db: Database;

  beforeEach(() => {
    ({ db } = buildDb());
  });

  it("composes the brief from rep + lead facts and sends exactly one message through the adapter", async () => {
    const { repId, partyId } = await seedRepAndLead(db);
    const adapter = new FakeChannelAdapter("whatsapp");
    const handler = createSendWhatsappBriefHandler(adapter);

    await handler(db, { repId, partyId }, ctx(`whatsapp:${repId}:${partyId}`, partyId));

    expect(adapter.sent).toHaveLength(1);
    const msg = adapter.sent[0];
    expect(msg.to).toBe("+971500000001"); // the rep's phone
    expect(msg.body).toContain("Aisha");
    expect(msg.body).toContain("Lina");
    expect(msg.body).toContain("Tier HOT");
    expect(msg.body).toContain("project Bayn");
    expect(msg.body).toContain("budget 2M-3M");
  });

  it("is provider-agnostic: a different adapter receives the same brief with no job-code change", async () => {
    const { repId, partyId } = await seedRepAndLead(db);
    const smsAdapter = new FakeChannelAdapter("sms");
    const handler = createSendWhatsappBriefHandler(smsAdapter);

    await handler(db, { repId, partyId }, ctx(`whatsapp:${repId}:${partyId}`, partyId));

    expect(smsAdapter.provider).toBe("sms");
    expect(smsAdapter.sent).toHaveLength(1);
    expect(smsAdapter.sent[0].body).toContain("Aisha");
  });

  it("throws when the rep does not exist", async () => {
    const { partyId } = await seedRepAndLead(db);
    const handler = createSendWhatsappBriefHandler(new FakeChannelAdapter());
    const missingRep = randomUUID();
    await expect(
      handler(db, { repId: missingRep, partyId }, ctx("k", partyId))
    ).rejects.toThrow(/rep .* not found/);
  });

  it("throws when the rep has no contact number", async () => {
    const { repId, partyId } = await seedRepAndLead(db, { repPhone: null });
    const adapter = new FakeChannelAdapter();
    const handler = createSendWhatsappBriefHandler(adapter);
    await expect(
      handler(db, { repId, partyId }, ctx("k", partyId))
    ).rejects.toThrow(/no contact number/);
    expect(adapter.sent).toHaveLength(0); // nothing sent on failure
  });

  it("throws when the party does not exist", async () => {
    const { repId } = await seedRepAndLead(db);
    const handler = createSendWhatsappBriefHandler(new FakeChannelAdapter());
    const missingParty = randomUUID();
    await expect(
      handler(db, { repId, partyId: missingParty }, ctx("k", missingParty))
    ).rejects.toThrow(/party .* not found/);
  });

  it("rejects payloads missing repId or partyId", async () => {
    const handler = createSendWhatsappBriefHandler(new FakeChannelAdapter());
    await expect(handler(db, { partyId: "p" }, ctx("k", "p"))).rejects.toThrow(
      /repId is required/
    );
    await expect(handler(db, { repId: "r" }, ctx("k", null))).rejects.toThrow(
      /partyId is required/
    );
  });
});
