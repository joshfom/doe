import { Elysia } from "elysia";
import { z } from "zod";
import { authGuard } from "../auth";
import { sendOtpEmail } from "../../ai/email";

// ── Request schema ───────────────────────────────────────────────────────────

const testEmailSchema = z.object({
  recipient: z.string().email("Invalid email format"),
  language: z.enum(["en", "ar"]).optional(),
});

// ── Env presence check (does NOT leak secret values) ─────────────────────────

function checkEnv() {
  return {
    AZURE_COMMUNICATION_TENANT_ID: !!process.env.AZURE_COMMUNICATION_TENANT_ID,
    AZURE_COMMUNICATION_CLIENT_ID: !!process.env.AZURE_COMMUNICATION_CLIENT_ID,
    AZURE_COMMUNICATION_CLIENT_SECRET:
      !!process.env.AZURE_COMMUNICATION_CLIENT_SECRET,
    AZURE_COMMUNICATION_SENDER:
      process.env.AZURE_COMMUNICATION_SENDER ?? null,
  };
}

// ── Routes (authenticated) ───────────────────────────────────────────────────

export const aiEmailTestRoutes = new Elysia({ name: "ai-email-test" })
  .use(authGuard)

  // GET /ai/email-test — report which env vars are configured
  .get("/ai/email-test", () => {
    return { data: { env: checkEnv() } };
  })

  // POST /ai/email-test — send a sample OTP email and report result
  .post("/ai/email-test", async ({ body, set }) => {
    const parsed = testEmailSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return {
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const env = checkEnv();
    const missing = Object.entries(env)
      .filter(([k, v]) => k !== "AZURE_COMMUNICATION_SENDER" && !v)
      .map(([k]) => k);
    if (env.AZURE_COMMUNICATION_SENDER === null) missing.push("AZURE_COMMUNICATION_SENDER");

    if (missing.length > 0) {
      set.status = 500;
      return {
        error: "Missing Azure Communication env vars",
        env,
        missing,
      };
    }

    const { recipient, language } = parsed.data;

    const sampleCode = String(Math.floor(100000 + Math.random() * 900000));

    try {
      const result = await sendOtpEmail({
        recipientEmail: recipient,
        otpCode: sampleCode,
        recipientName: "Tester",
        language: language ?? "en",
      });

      if (!result.success) {
        set.status = 500;
        return {
          error: "Email send failed",
          details: result.error ?? "Unknown error",
          env,
        };
      }

      return {
        data: {
          success: true,
          recipient,
          env,
          message: `Sample OTP email sent to ${recipient}.`,
        },
      };
    } catch (err) {
      set.status = 500;
      return {
        error: "Email send threw exception",
        details: err instanceof Error ? err.message : String(err),
        env,
      };
    }
  });

export default aiEmailTestRoutes;
