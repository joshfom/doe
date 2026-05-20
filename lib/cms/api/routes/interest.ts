import { Elysia } from "elysia";
import { db } from "../../db";
import { formSubmissions, formDefinitions } from "../../schema";
import { eq } from "drizzle-orm";
import { readAttributionFromRequest } from "@/lib/analytics/attribution";
import { readConsentFromRequest } from "@/lib/analytics/consent-state";
import { getPostHogServer } from "@/lib/analytics/posthog-server";
import { hashIdentifier } from "@/lib/analytics/hash-identifier";
import { sendConversion } from "@/lib/analytics/capi";

/**
 * Well-known form ID for "Register Interest" submissions.
 * Auto-created on first submission if it doesn't exist.
 */
const REGISTER_INTEREST_FORM_NAME = "register-interest";

async function ensureRegisterInterestForm(): Promise<string> {
  // Check if form definition exists
  const [existing] = await db
    .select({ id: formDefinitions.id })
    .from(formDefinitions)
    .where(eq(formDefinitions.name, REGISTER_INTEREST_FORM_NAME))
    .limit(1);

  if (existing) return existing.id;

  // Create it
  const [created] = await db
    .insert(formDefinitions)
    .values({
      name: REGISTER_INTEREST_FORM_NAME,
      fields: [
        { name: "firstName", label: "First Name", type: "text", required: true },
        { name: "lastName", label: "Last Name", type: "text", required: true },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "phone", label: "Phone", type: "tel", required: true },
        { name: "hearAbout", label: "How did you hear about us?", type: "select", required: false },
        { name: "marketingConsent", label: "Marketing Consent", type: "checkbox", required: false },
        { name: "source", label: "Source", type: "text", required: false },
      ],
    })
    .returning();

  return created.id;
}

// ── Public interest registration endpoint (no auth) ──────────────────────────

/**
 * Adapts Elysia's cookie object to the interface expected by
 * readAttributionFromRequest and readConsentFromRequest.
 */
function adaptCookies(
  cookie: Record<string, { value: string | undefined }>
): { get(name: string): { value: string } | undefined } {
  return {
    get(name: string) {
      const c = cookie[name];
      if (c && c.value) return { value: c.value };
      return undefined;
    },
  };
}

export const interestRoutes = new Elysia({ name: "interest" })
  .post("/interest", async ({ body, set, cookie }) => {
    const { firstName, lastName, email, phone, hearAbout, marketingConsent, source } =
      body as {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        hearAbout?: string | null;
        marketingConsent?: boolean;
        source?: string | null;
      };

    // Validate required fields
    if (!firstName?.trim()) {
      set.status = 400;
      return { error: "First name is required" };
    }
    if (!lastName?.trim()) {
      set.status = 400;
      return { error: "Last name is required" };
    }
    if (!email?.trim()) {
      set.status = 400;
      return { error: "Email is required" };
    }
    if (!phone?.trim()) {
      set.status = 400;
      return { error: "Phone number is required" };
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      set.status = 400;
      return { error: "Please provide a valid email address" };
    }

    try {
      const formId = await ensureRegisterInterestForm();

      // Read attribution and consent from cookies
      const cookieAdapter = adaptCookies(cookie as Record<string, { value: string | undefined }>);
      const consent = readConsentFromRequest(cookieAdapter);
      const attribution = readAttributionFromRequest(cookieAdapter);

      // Only persist attribution if marketing consent is granted
      const hasMarketingConsent = consent?.marketing === true;
      const firstTouch = hasMarketingConsent && attribution ? attribution.first_touch : null;
      const lastTouch = hasMarketingConsent && attribution ? attribution.last_touch : null;

      const [submission] = await db
        .insert(formSubmissions)
        .values({
          formId,
          data: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            phone: phone.trim(),
            hearAbout: hearAbout ?? null,
            marketingConsent: marketingConsent ?? false,
            source: source ?? null,
            submittedAt: new Date().toISOString(),
          },
          sourcePageSlug: source ?? null,
          sourceLocale: null,
          firstTouchAttribution: firstTouch,
          lastTouchAttribution: lastTouch,
        })
        .returning();

      // Fire PostHog server-side event if attribution is available
      if (hasMarketingConsent && attribution) {
        const posthog = getPostHogServer();
        if (posthog) {
          posthog.capture({
            distinctId: hashIdentifier(email.trim()),
            event: "lead_qualified",
            properties: {
              submission_id: submission.id,
              source_page: source ?? undefined,
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
          email: email.trim(),
          phone: phone?.trim(),
          attribution: attribution ?? undefined,
          conversionValue: undefined,
          currency: "AED",
        },
        consent
      ).catch((err) => {
        console.error("[interest] CAPI sendConversion failed:", err);
      });

      set.status = 201;
      return { data: { id: submission.id, message: "Interest registered successfully" } };
    } catch (err) {
      console.error("[interest] Failed to save registration:", err);
      set.status = 500;
      return { error: "Failed to save your registration. Please try again." };
    }
  });
