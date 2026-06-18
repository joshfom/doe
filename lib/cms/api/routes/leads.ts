import { Elysia } from "elysia";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db";
import { inboundLeads, leadsMirror, sfOutbox } from "../../schema";
import { enqueueOutbox } from "../../outbox";
import { recordInbound } from "../../leads/intake";
import { analyzeInboundLead } from "../../leads/analyze";
import {
  inboundLeadSchema,
  LEAD_SOURCES,
  type InboundLead,
} from "../../leads/inbound";
import { registeredSources } from "../../leads/adapters";
import { RateLimiter } from "../../tickets/rate-limit";

// ── Lead simulation / test-harness routes ────────────────────────────────────
//
// A small, deliberately self-contained surface for POSTing *simulated* inbound
// leads from any external source (web_form / email / whatsapp / meta_lead_ads /
// portal) so the Lead Engine intake spine can be exercised end-to-end from
// Postman without a live source transport or provider credentials.
//
// Unlike the per-source ingestion adapters (which expect each provider's exact
// Raw_Payload shape and gate on that provider's credentials), this endpoint
// builds the canonical `InboundLead` directly from simple fields and hands it
// to the SAME durable `recordInbound` the production ingestion worker uses. So
// it exercises the real intake path — idempotent dedupe, phone hashing,
// attribution capture and the `lead.ingested` event — for ANY source.
//
// SECURITY: this writes to the production `inbound_leads` ledger, so it is
// token-guarded. Set `LEAD_SIMULATION_TOKEN` and send it as
// `Authorization: Bearer <token>` (or `x-simulation-token: <token>`). When the
// env var is unset the surface is available ONLY outside production
// (`NODE_ENV !== "production"`); in production without a token it is refused.

// ── Auth ─────────────────────────────────────────────────────────────────────

/** Constant-time compare of the presented token against `LEAD_SIMULATION_TOKEN`. */
function isValidSimulationToken(presented: string | null): boolean {
  const expected = process.env.LEAD_SIMULATION_TOKEN;
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract a bearer token from an `Authorization: Bearer <token>` header. */
function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Decide whether a request may use the simulation surface.
 *
 * - When `LEAD_SIMULATION_TOKEN` is set → the presented token must match it.
 * - When it is NOT set → allowed only outside production, so the surface is
 *   never silently open on a production deployment.
 */
function isAuthorized(request: Request): boolean {
  const expected = process.env.LEAD_SIMULATION_TOKEN;
  if (expected) {
    const presented =
      bearerToken(request.headers.get("authorization")) ??
      request.headers.get("x-simulation-token");
    return isValidSimulationToken(presented);
  }
  return process.env.NODE_ENV !== "production";
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

/** Generous limit for a test harness: 60 simulated leads per IP per minute. */
const simulationRateLimiter = new RateLimiter(60, 60 * 1000);

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? "unknown";
}

// ── Request validation ────────────────────────────────────────────────────────

/**
 * The simplified body the simulation endpoint accepts. Every field maps onto
 * the canonical `InboundLead`; `source` is required and the rest are optional
 * with sensible defaults (`capturedAt` → now, `idempotencyKey` → a fresh
 * per-submission key, `content` → "").
 */
const simulateLeadSchema = z.object({
  source: z.enum(LEAD_SOURCES),
  name: z.string().max(255).optional(),
  email: z.string().max(254).optional(),
  phone: z.string().optional(),
  content: z.string().max(10_000).optional(),
  attribution: z.record(z.string(), z.string()).optional(),
  idempotencyKey: z.string().min(1).max(255).optional(),
  capturedAt: z.iso.datetime().optional(),
  /** Arbitrary verbatim provider payload retained on the ledger row. */
  rawPayload: z.unknown().optional(),
});

// ── Routes ─────────────────────────────────────────────────────────────────────

export const leadsRoutes = new Elysia({ name: "leads", prefix: "/leads" })
  // Token guard scoped to every route in this module.
  .onBeforeHandle(({ request, set }) => {
    if (!isAuthorized(request)) {
      set.status = 401;
      return {
        error:
          "Unauthorized. Set LEAD_SIMULATION_TOKEN and send it as " +
          "'Authorization: Bearer <token>' or 'x-simulation-token: <token>'.",
      };
    }
  })

  // GET /api/leads/sources — the valid `source` values and which have a live
  // ingestion adapter wired, so a tester knows what to pass.
  .get("/sources", () => ({
    sources: LEAD_SOURCES,
    adapters: registeredSources(),
  }))

  // POST /api/leads/simulate — record a simulated inbound lead for any source.
  .post("/simulate", async ({ body, set, request }) => {
    const ip = clientIp(request);
    if (!simulationRateLimiter.isAllowed(ip)) {
      set.status = 429;
      return { error: "Too many requests. Please try again later." };
    }

    const parsed = simulateLeadSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join(".")] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    simulationRateLimiter.record(ip);

    const data = parsed.data;
    const capturedAt = data.capturedAt ?? new Date().toISOString();

    // Build the canonical InboundLead. The raw payload is retained verbatim:
    // either the caller's `rawPayload`, or an envelope of the simulated fields.
    const candidate = {
      source: data.source,
      capturedAt,
      name: data.name,
      email: data.email,
      phone: data.phone,
      content: data.content ?? "",
      rawPayload:
        data.rawPayload ??
        ({
          simulated: true,
          source: data.source,
          capturedAt,
          name: data.name,
          email: data.email,
          content: data.content ?? "",
        } as const),
      attribution: data.attribution,
      idempotencyKey:
        data.idempotencyKey ?? `${data.source}:sim:${randomUUID()}`,
    };

    const validated = inboundLeadSchema.safeParse(candidate);
    if (!validated.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of validated.error.issues) {
        fieldErrors[issue.path.join(".")] = issue.message;
      }
      return { error: "Canonical lead validation failed", details: fieldErrors };
    }

    const lead: InboundLead = validated.data;

    try {
      const result = await recordInbound(db, lead);
      set.status = result.deduped ? 200 : 201;
      return {
        ok: true,
        id: result.id,
        deduped: result.deduped,
        source: lead.source,
        status: "received" as const,
        idempotencyKey: lead.idempotencyKey,
      };
    } catch (err) {
      // The most likely failure is an un-normalizable phone number (the intake
      // spine normalizes to E.164 before hashing); surface it as a 422.
      set.status = 422;
      return {
        error: "Failed to record inbound lead",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  })

  // GET /api/leads/inbound — inspect recently recorded inbound leads and their
  // intake status. Never returns the transient raw phone (privacy); phones are
  // surfaced only as the salted hash.
  .get("/inbound", async ({ query, set }) => {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const statusFilter = query.status as string | undefined;

    const allowedStatuses = ["received", "parsed", "queued", "failed"];
    if (statusFilter && !allowedStatuses.includes(statusFilter)) {
      set.status = 400;
      return {
        error: `Invalid status filter. Allowed: ${allowedStatuses.join(", ")}`,
      };
    }

    const base = db
      .select({
        id: inboundLeads.id,
        source: inboundLeads.source,
        status: inboundLeads.status,
        name: inboundLeads.name,
        email: inboundLeads.email,
        phoneHash: inboundLeads.phoneHash,
        content: inboundLeads.content,
        attribution: inboundLeads.attribution,
        structured: inboundLeads.structured,
        partyId: inboundLeads.partyId,
        attempts: inboundLeads.attempts,
        lastError: inboundLeads.lastError,
        idempotencyKey: inboundLeads.idempotencyKey,
        createdAt: inboundLeads.createdAt,
        updatedAt: inboundLeads.updatedAt,
      })
      .from(inboundLeads);

    const rows = await (statusFilter
      ? base.where(
          eq(
            inboundLeads.status,
            statusFilter as "received" | "parsed" | "queued" | "failed"
          )
        )
      : base
    )
      .orderBy(desc(inboundLeads.createdAt))
      .limit(limit);

    return { count: rows.length, leads: rows };
  })

  // GET /api/leads/inbound/:id — a single inbound lead's detail, including
  // leads_mirror qualification data when the lead has been resolved to a Party.
  .get("/inbound/:id", async ({ params, set }) => {
    const [row] = await db
      .select({
        id: inboundLeads.id,
        source: inboundLeads.source,
        status: inboundLeads.status,
        name: inboundLeads.name,
        email: inboundLeads.email,
        phoneHash: inboundLeads.phoneHash,
        content: inboundLeads.content,
        rawPayload: inboundLeads.rawPayload,
        attribution: inboundLeads.attribution,
        structured: inboundLeads.structured,
        partyId: inboundLeads.partyId,
        attempts: inboundLeads.attempts,
        lastError: inboundLeads.lastError,
        idempotencyKey: inboundLeads.idempotencyKey,
        createdAt: inboundLeads.createdAt,
        updatedAt: inboundLeads.updatedAt,
      })
      .from(inboundLeads)
      .where(eq(inboundLeads.id, params.id))
      .limit(1);

    if (!row) {
      set.status = 404;
      return { error: "Inbound lead not found" };
    }

    // If the lead is linked to a Party, fetch its qualification mirror.
    let mirror: typeof leadsMirror.$inferSelect | null = null;
    if (row.partyId) {
      const [m] = await db
        .select()
        .from(leadsMirror)
        .where(eq(leadsMirror.partyId, row.partyId))
        .limit(1);
      mirror = m ?? null;
    }

    // Check if there is a pending/sent SF outbox entry for this lead.
    const jobKeyPrefix = `lead:${row.id}:`;
    const [outboxRow] = await db
      .select({
        id: sfOutbox.id,
        status: sfOutbox.status,
        attempts: sfOutbox.attempts,
        sfId: sfOutbox.sfId,
        updatedAt: sfOutbox.updatedAt,
      })
      .from(sfOutbox)
      .where(eq(sfOutbox.jobKey, `${jobKeyPrefix}manual-sync`))
      .limit(1);

    return { ...row, mirror: mirror ?? undefined, sfSync: outboxRow ?? undefined };
  })

  // POST /api/leads/inbound/:id/sync-sf — enqueue a lead_upsert to the
  // Salesforce outbox for manual one-click sync.
  .post("/inbound/:id/sync-sf", async ({ params, set }) => {
    const [row] = await db
      .select({
        id: inboundLeads.id,
        name: inboundLeads.name,
        email: inboundLeads.email,
        content: inboundLeads.content,
        source: inboundLeads.source,
        structured: inboundLeads.structured,
        partyId: inboundLeads.partyId,
        attribution: inboundLeads.attribution,
      })
      .from(inboundLeads)
      .where(eq(inboundLeads.id, params.id))
      .limit(1);

    if (!row) {
      set.status = 404;
      return { error: "Inbound lead not found" };
    }

    // Split name into first / last for SF Lead object.
    const nameParts = (row.name ?? "").trim().split(/\s+/);
    const firstName = nameParts.slice(0, -1).join(" ") || nameParts[0] || "";
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

    // Build the lead_upsert payload from available data.
    const structured =
      typeof row.structured === "object" && row.structured !== null
        ? (row.structured as Record<string, unknown>)
        : {};

    const payload: Record<string, unknown> = {
      partyId: row.partyId ?? undefined,
      firstName,
      lastName,
      email: row.email ?? undefined,
      company: (structured.company as string | undefined) ?? "Unknown",
      status: "Open - Not Contacted",
      source: row.source,
      projectInterest:
        (structured.projectInterest as string | undefined) ??
        (row.attribution as Record<string, string> | null)?.utm_campaign ??
        undefined,
      budgetBand: (structured.budgetBand as string | undefined) ?? undefined,
      leadNote: row.content ? row.content.slice(0, 1000) : undefined,
    };

    const jobKey = `lead:${row.id}:manual-sync`;

    try {
      const outboxId = await enqueueOutbox(db, "lead_upsert", payload, jobKey);
      set.status = 200;
      return { ok: true, outboxId, jobKey, queued: true };
    } catch (err) {
      set.status = 500;
      return {
        error: "Failed to enqueue Salesforce sync",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  })

  // POST /api/leads/inbound/:id/analyze — run (or re-run) the lead-analysis
  // pipeline: parse structured fields, resolve identity against the party graph
  // + Salesforce mirror, qualify, score, assign an owner, and enqueue the
  // Salesforce sync. This is the "Run analysis" / "Re-analyze" Console action;
  // it advances a lead past `received` synchronously instead of waiting on the
  // container-tier Parse_Agent. Safe to call repeatedly (idempotent).
  .post("/inbound/:id/analyze", async ({ params, set }) => {
    try {
      const result = await analyzeInboundLead(db, params.id);
      if (!result) {
        set.status = 404;
        return { error: "Inbound lead not found" };
      }
      set.status = 200;
      return result;
    } catch (err) {
      set.status = 500;
      return {
        error: "Lead analysis failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });
