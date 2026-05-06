import { Elysia } from "elysia";
import { z } from "zod";
import { db } from "../../db";
import { authGuard } from "../auth";
import { runAdminAgent } from "../../ai/admin-agent";

/**
 * Admin / staff chat endpoint. Authenticated users can ask the agent to
 * report on platform state (counts, lists) and execute operations
 * (cancel / reschedule appointments, change ticket status, bulk-mark
 * bookings as completed, etc). Destructive actions return a `pendingAction`
 * object — the UI must echo back the `confirmationToken` to actually run
 * the action.
 */

const requestSchema = z.object({
  message: z.string().min(1).max(2000),
  confirmationToken: z.string().uuid().optional(),
});

export const aiAdminRoutes = new Elysia({ name: "ai-admin" })
  .use(authGuard)
  .post("/ai/admin/chat", async ({ body, set, userId }) => {
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join(".")] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    try {
      const result = await runAdminAgent(db, {
        userId,
        message: parsed.data.message,
        confirmationToken: parsed.data.confirmationToken,
      });
      return { data: result };
    } catch (err) {
      console.error("[ai-admin] runAdminAgent failed", err);
      set.status = 500;
      return {
        error: "Admin agent failed",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  });

export default aiAdminRoutes;
