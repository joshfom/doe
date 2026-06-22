import { Elysia } from "elysia";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { authGuard } from "../auth";
import { users } from "../../schema";
import { sendGraphMail } from "../../ai/email";

/**
 * AI Analytics — email the on-screen summary to the signed-in executive.
 *
 * The chat turns themselves run through the existing admin agent
 * (`POST /ai/admin/chat`); this adds the one extra capability the executive
 * analytics surface needs: emailing the current summary to yourself.
 *
 * SAFETY: the recipient is ALWAYS the authenticated user's own address, looked
 * up server-side from `users` by the session `userId`. The client never
 * supplies a recipient, so this can only ever email you your own summary —
 * there is no arbitrary-send vector. The send reuses the same Microsoft Graph
 * sender the morning briefing uses (`sendGraphMail`).
 *
 * This lives in its own Elysia instance (rather than the conversation-stats
 * `ai-analytics.ts`, which is gated by `ai:analytics:read` via `identityGuard`)
 * so it can use `authGuard` for the `userId` and is not coupled to that
 * permission.
 */

const emailSummarySchema = z.object({
  /** The on-screen summary text to send (the assistant's latest answer). */
  summary: z.string().trim().min(1, "Nothing to send yet.").max(20_000),
  /** Optional heading shown in the email (e.g. the question that was asked). */
  title: z.string().trim().max(200).optional(),
});

/** Escape user/agent text before embedding it in the HTML email body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the summary into a branded, decision-support email. The body is the
 * agent's summary (escaped, newlines preserved); the footer makes the advisory
 * stance and provenance explicit so the figures are never mistaken for a
 * mandate.
 */
function buildSummaryEmailHtml(input: {
  summary: string;
  title?: string;
  generatedAt: Date;
}): string {
  const body = escapeHtml(input.summary).replace(/\n/g, "<br/>");
  const heading = input.title ? escapeHtml(input.title) : "Your analytics summary";
  const stamp = input.generatedAt.toUTCString();
  return [
    '<div style="font-family:Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#2b2b2b">',
    '  <div style="border-bottom:2px solid #c9a96a;padding-bottom:12px;margin-bottom:20px">',
    '    <span style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9a7b3f;font-weight:700">ORA · AI Analytics</span>',
    `    <h1 style="font-size:20px;margin:6px 0 0;color:#2b2b2b">${heading}</h1>`,
    "  </div>",
    `  <div style="font-size:15px;line-height:1.7">${body}</div>`,
    '  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e7e0d3;font-size:12px;line-height:1.6;color:#7a7468">',
    "    <p style=\"margin:0 0 6px\"><strong>Decision support, not a directive.</strong> These figures are computed from ORA&#39;s data and meant to help you see the bigger picture quickly. Where a direction is suggested, treat it as a lean — take a closer look before you commit.</p>",
    `    <p style="margin:0">Generated ${escapeHtml(stamp)}.</p>`,
    "  </div>",
    "</div>",
  ].join("\n");
}

export const aiAnalyticsEmailRoutes = new Elysia({ name: "ai-analytics-email" })
  .use(authGuard)
  // ── Email the on-screen summary to the signed-in executive ───────────────
  .post("/ai/analytics/email-summary", async ({ body, set, userId }) => {
    const parsed = emailSummarySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join(".")] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    // Resolve the recipient = the authenticated user's own email. Never trust a
    // client-supplied address.
    const [user] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.email) {
      set.status = 404;
      return { error: "We couldn't find an email address on your account." };
    }

    const generatedAt = new Date();
    const subject = `ORA — Your AI Analytics summary · ${generatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;

    const result = await sendGraphMail({
      to: user.email,
      subject,
      htmlContent: buildSummaryEmailHtml({
        summary: parsed.data.summary,
        title: parsed.data.title,
        generatedAt,
      }),
    });

    if (!result.success) {
      set.status = 502;
      return {
        error:
          "The email service isn't available right now, so the summary wasn't sent.",
        details: result.error,
      };
    }

    return { data: { sent: true, to: user.email } };
  });

export default aiAnalyticsEmailRoutes;
