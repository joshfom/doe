import { Elysia } from "elysia";
import { db } from "../../db";
import { formSubmissions, formDefinitions } from "../../schema";
import { eq } from "drizzle-orm";

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

export const interestRoutes = new Elysia({ name: "interest" })
  .post("/interest", async ({ body, set }) => {
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
        })
        .returning();

      set.status = 201;
      return { data: { id: submission.id, message: "Interest registered successfully" } };
    } catch (err) {
      console.error("[interest] Failed to save registration:", err);
      set.status = 500;
      return { error: "Failed to save your registration. Please try again." };
    }
  });
