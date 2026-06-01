import { Elysia } from "elysia";
import { eq, desc, sql } from "drizzle-orm";
import { authGuard } from "../auth";
import { formDefinitions, formSubmissions } from "../../schema";
import { db } from "../../db";
import { logAudit } from "../../audit";
import type { FormFieldConfig } from "../../types";
import { readAttributionFromRequest } from "@/lib/analytics/attribution";
import { readConsentFromRequest } from "@/lib/analytics/consent-state";
import { getPostHogServer } from "@/lib/analytics/posthog-server";
import { hashIdentifier } from "@/lib/analytics/hash-identifier";
import { sendConversion } from "@/lib/analytics/capi";
import { getActiveConversionGoals } from "../../conversion-goals";

// ── Types ────────────────────────────────────────────────────────────────────

interface ConversionAttribution {
  goalId: string;
  eventName: string;
  displayLabel: string;
  timestamp: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}

const MAX_CONVERSION_ATTRIBUTIONS = 50;

// ── Helper: fire-and-forget push to external endpoint ────────────────────────

function pushToEndpoint(url: string, data: Record<string, unknown>): void {
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => {
    // Fire-and-forget — don't block the response
  });
}

// ── Public routes (no auth) ──────────────────────────────────────────────────

const publicForms = new Elysia({ name: "forms-public" })
  // GET /forms — List form definitions
  .get("/forms", async () => {
    const forms = await db
      .select()
      .from(formDefinitions)
      .orderBy(desc(formDefinitions.createdAt));

    return { data: forms };
  })

  // GET /submissions — List submissions grouped by form
  .get("/submissions", async () => {
    const allSubmissions = await db
      .select()
      .from(formSubmissions)
      .orderBy(desc(formSubmissions.createdAt));

    const forms = await db
      .select()
      .from(formDefinitions);

    // Group submissions by formId
    const grouped = forms.map((form) => ({
      form,
      submissions: allSubmissions.filter((s) => s.formId === form.id),
    }));

    return { data: grouped };
  })

  // POST /submissions — Submit form data (public, no auth)
  .post("/submissions", async ({ body, set, cookie }) => {
    const { formId, data, sourcePageSlug, sourceLocale } = body as {
      formId?: string;
      data?: Record<string, unknown>;
      sourcePageSlug?: string;
      sourceLocale?: string;
    };

    if (!formId) {
      set.status = 400;
      return { error: "formId is required" };
    }

    if (!data || typeof data !== "object") {
      set.status = 400;
      return { error: "data is required and must be an object" };
    }

    // Fetch form definition
    const [form] = await db
      .select()
      .from(formDefinitions)
      .where(eq(formDefinitions.id, formId))
      .limit(1);

    if (!form) {
      set.status = 404;
      return { error: "Form definition not found" };
    }

    // Validate against form definition's required fields
    const fields = form.fields as FormFieldConfig[];
    const errors: Record<string, string> = {};

    for (const field of fields) {
      if (field.required) {
        const value = data[field.name];
        if (value === undefined || value === null || value === "") {
          errors[field.name] = `${field.label} is required`;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      set.status = 400;
      return { error: "Validation failed", details: errors };
    }

    // Read attribution and consent from cookies
    const cookieAdapter = {
      get(name: string) {
        const c = (cookie as Record<string, { value: string | undefined }>)[name];
        if (c && c.value) return { value: c.value };
        return undefined;
      },
    };
    const consent = readConsentFromRequest(cookieAdapter);
    const attribution = readAttributionFromRequest(cookieAdapter);

    // Only persist attribution if marketing consent is granted
    const hasMarketingConsent = consent?.marketing === true;
    const firstTouch = hasMarketingConsent && attribution ? attribution.first_touch : null;
    const lastTouch = hasMarketingConsent && attribution ? attribution.last_touch : null;

    // Store submission
    const [submission] = await db
      .insert(formSubmissions)
      .values({
        formId,
        data,
        sourcePageSlug: sourcePageSlug ?? null,
        sourceLocale: sourceLocale ?? null,
        firstTouchAttribution: firstTouch,
        lastTouchAttribution: lastTouch,
      })
      .returning();

    // Fire PostHog server-side event if attribution is available
    if (hasMarketingConsent && attribution) {
      const posthog = getPostHogServer();
      if (posthog) {
        const email = (data.email as string) ?? submission.id;
        posthog.capture({
          distinctId: email ? hashIdentifier(email) : submission.id,
          event: "lead_qualified",
          properties: {
            submission_id: submission.id,
            form_id: formId,
            source_page: sourcePageSlug ?? undefined,
            first_touch_source: attribution.first_touch.utm_source,
            first_touch_medium: attribution.first_touch.utm_medium,
            first_touch_campaign: attribution.first_touch.utm_campaign,
            last_touch_source: attribution.last_touch.utm_source,
            last_touch_medium: attribution.last_touch.utm_medium,
            last_touch_campaign: attribution.last_touch.utm_campaign,
          },
        });
      }
    }

    // Fire CAPI conversion event (fire-and-forget)
    sendConversion(
      {
        event: "lead_qualified",
        email: (data.email as string) ?? undefined,
        phone: (data.phone as string) ?? undefined,
        attribution: attribution ?? undefined,
        conversionValue: undefined,
        currency: "AED",
      },
      consent
    ).catch((err) => {
      console.error("[forms] CAPI sendConversion failed:", err);
    });

    // Fire-and-forget: push to Salesforce / webhook if configured
    if (form.salesforceEndpoint) {
      pushToEndpoint(form.salesforceEndpoint, data);
    }
    if (form.webhookUrl) {
      pushToEndpoint(form.webhookUrl, data);
    }

    // ── Conversion Goal Attribution ──────────────────────────────────────
    try {
      const goals = await getActiveConversionGoals();
      const firedEventName = "lead_qualified";
      const matchedGoal = goals.find((g) => g.eventName === firedEventName);

      if (matchedGoal && lastTouch) {
        const attribution: ConversionAttribution = {
          goalId: matchedGoal.id,
          eventName: matchedGoal.eventName,
          displayLabel: matchedGoal.displayLabel || matchedGoal.eventName,
          timestamp: new Date().toISOString(),
          utmSource: lastTouch.utm_source || null,
          utmMedium: lastTouch.utm_medium || null,
          utmCampaign: lastTouch.utm_campaign || null,
          utmTerm: lastTouch.utm_term || null,
          utmContent: lastTouch.utm_content || null,
        };

        // Enforce max 50 entries: read existing, trim oldest if needed
        const [current] = await db
          .select({ conversionAttributions: formSubmissions.conversionAttributions })
          .from(formSubmissions)
          .where(eq(formSubmissions.id, submission.id))
          .limit(1);

        const existing: ConversionAttribution[] = Array.isArray(current?.conversionAttributions)
          ? (current.conversionAttributions as ConversionAttribution[])
          : [];

        let updatedAttributions: ConversionAttribution[];
        if (existing.length >= MAX_CONVERSION_ATTRIBUTIONS) {
          // Trim oldest entries to make room
          updatedAttributions = [...existing.slice(existing.length - MAX_CONVERSION_ATTRIBUTIONS + 1), attribution];
        } else {
          updatedAttributions = [...existing, attribution];
        }

        await db
          .update(formSubmissions)
          .set({
            conversionAttributions: sql`${JSON.stringify(updatedAttributions)}::jsonb`,
          })
          .where(eq(formSubmissions.id, submission.id));
      }
    } catch (err) {
      // Proceed normally if conversion goals are unavailable
      console.error("[forms] Conversion goal attribution failed:", err);
    }

    set.status = 201;
    return { data: submission };
  });


// ── Authenticated routes ─────────────────────────────────────────────────────

const protectedForms = new Elysia({ name: "forms-protected" })
  .use(authGuard)

  // POST /forms — Create form definition
  .post("/forms", async ({ body, userId, set }) => {
    const { name, fields, salesforceEndpoint, webhookUrl } = body as {
      name?: string;
      fields?: FormFieldConfig[];
      salesforceEndpoint?: string;
      webhookUrl?: string;
    };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      set.status = 400;
      return { error: "name is required" };
    }

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      set.status = 400;
      return { error: "fields is required and must be a non-empty array" };
    }

    const [created] = await db
      .insert(formDefinitions)
      .values({
        name: name.trim(),
        fields,
        salesforceEndpoint: salesforceEndpoint ?? null,
        webhookUrl: webhookUrl ?? null,
      })
      .returning();

    await logAudit(db, {
      userId,
      action: "create",
      entityType: "form",
      entityId: created.id,
      summary: `Created form "${created.name}"`,
    });

    set.status = 201;
    return { data: created };
  })

  // PUT /forms/:id — Update form definition
  .put("/forms/:id", async ({ params, body, userId, set }) => {
    const { id } = params;
    const { name, fields, salesforceEndpoint, webhookUrl } = body as {
      name?: string;
      fields?: FormFieldConfig[];
      salesforceEndpoint?: string;
      webhookUrl?: string;
    };

    const [existing] = await db
      .select()
      .from(formDefinitions)
      .where(eq(formDefinitions.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Form definition not found" };
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updates.name = name;
    if (fields !== undefined) updates.fields = fields;
    if (salesforceEndpoint !== undefined) updates.salesforceEndpoint = salesforceEndpoint;
    if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl;

    const [updated] = await db
      .update(formDefinitions)
      .set(updates)
      .where(eq(formDefinitions.id, id))
      .returning();

    await logAudit(db, {
      userId,
      action: "update",
      entityType: "form",
      entityId: id,
      summary: `Updated form "${updated.name}"`,
    });

    return { data: updated };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const formsRoutes = new Elysia({ name: "forms" })
  .use(publicForms)
  .use(protectedForms);
