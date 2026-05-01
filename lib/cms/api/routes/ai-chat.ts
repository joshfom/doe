import { Elysia } from "elysia";
import { z } from "zod";
import { db } from "../../db";
import { handleChatMessage } from "../../ai/chat";
import { validateSession, SESSION_COOKIE_NAME } from "../auth";

// ── Request validation schema ────────────────────────────────────────────────

const chatRequestSchema = z.object({
  message: z.string().min(1, "Message is required"),
  conversationId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email format").optional(),
});

// ── Public chat route (no auth required) ─────────────────────────────────────

export const aiChatRoutes = new Elysia({ name: "ai-chat" })

  // POST /ai/chat — send a message to ORA AI
  .post("/ai/chat", async ({ body, set, cookie }) => {
    // Validate request body
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    const { message, conversationId, phone, email } = parsed.data;

    // Optionally resolve identity from auth session (don't require it)
    let userId: string | undefined;
    try {
      const token = cookie[SESSION_COOKIE_NAME]?.value as string | undefined;
      const resolvedUserId = await validateSession(token);
      if (resolvedUserId) {
        userId = resolvedUserId;
      }
    } catch {
      // Session resolution failed — proceed as anonymous visitor
    }

    // Call chat orchestrator
    const response = await handleChatMessage(db, {
      message,
      conversationId,
      phone,
      email,
      userId,
    });

    return { data: response };
  });

export default aiChatRoutes;
