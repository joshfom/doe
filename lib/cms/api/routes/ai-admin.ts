import { Elysia } from "elysia";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../../db";
import { authGuard } from "../auth";
import { loadUserRoles } from "../../rbac/engine";
import { runAdminAgent } from "../../ai/admin-agent";
import { adminChatSessions, adminChatMessages } from "../../schema";

/**
 * Admin / staff chat endpoint. Authenticated users can ask the agent to
 * report on platform state and execute operations. Destructive actions
 * return a `pendingAction` object — the UI must echo back the
 * `confirmationToken` to actually run the action.
 *
 * Conversation history (ChatGPT-style):
 *   • Each chat is persisted as an `admin_chat_sessions` row scoped to the
 *     authenticated user, with messages stored in `admin_chat_messages`.
 *   • A `POST /ai/admin/chat` request may include an optional `sessionId`.
 *     When omitted, the server creates a new session and titles it from
 *     the first user message.
 *   • Persistence is best-effort: a failed insert MUST NOT break the chat
 *     turn — the user still gets the assistant reply.
 */

const chatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  confirmationToken: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
});

const sessionIdParam = z.object({ id: z.string().uuid() });

const TITLE_MAX = 60;
function makeTitle(firstUserMessage: string): string {
  const t = firstUserMessage.trim().replace(/\s+/g, " ");
  if (t.length <= TITLE_MAX) return t || "New chat";
  return `${t.slice(0, TITLE_MAX - 1)}…`;
}

async function ensureSession(
  userId: string,
  providedSessionId: string | undefined,
  firstUserMessage: string
): Promise<string | null> {
  try {
    if (providedSessionId) {
      const [row] = await db
        .select({ id: adminChatSessions.id })
        .from(adminChatSessions)
        .where(
          and(
            eq(adminChatSessions.id, providedSessionId),
            eq(adminChatSessions.userId, userId)
          )
        )
        .limit(1);
      if (row) return row.id;
      // Falls through to create a fresh session if the provided id was bogus.
    }
    const [created] = await db
      .insert(adminChatSessions)
      .values({ userId, title: makeTitle(firstUserMessage) })
      .returning({ id: adminChatSessions.id });
    return created?.id ?? null;
  } catch (err) {
    console.error("[ai-admin] ensureSession failed (non-fatal)", err);
    return null;
  }
}

async function persistMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  pendingAction: unknown,
  executed: unknown
): Promise<void> {
  try {
    await db.insert(adminChatMessages).values({
      sessionId,
      role,
      content,
      pendingAction: pendingAction ?? null,
      executed: executed ?? null,
    });
    await db
      .update(adminChatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(adminChatSessions.id, sessionId));
  } catch (err) {
    console.error("[ai-admin] persistMessage failed (non-fatal)", err);
  }
}

export const aiAdminRoutes = new Elysia({ name: "ai-admin" })
  .use(authGuard)
  // ── Chat turn ──────────────────────────────────────────────────────────
  .post("/ai/admin/chat", async ({ body, set, userId }) => {
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join(".")] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    try {
      // Load this session's prior turns (oldest → newest) so a delegated twin
      // turn reasons with conversation context. Best-effort: history failures
      // never block the turn.
      let history: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (parsed.data.sessionId) {
        try {
          const rows = await db
            .select({
              role: adminChatMessages.role,
              content: adminChatMessages.content,
            })
            .from(adminChatMessages)
            .where(eq(adminChatMessages.sessionId, parsed.data.sessionId))
            .orderBy(adminChatMessages.createdAt)
            .limit(20);
          history = rows;
        } catch (err) {
          console.error("[ai-admin] history load failed (non-fatal)", err);
        }
      }

      // Resolve the requesting user's RBAC roles so the twin exposes the
      // executive (C-Level) tools only to a C-Level user (Requirement 12.5).
      // Best-effort: a role load failure threads no roles (non-C-Level), never
      // blocking the turn. The dispatcher remains the hard authorization gate.
      let roles: string[] = [];
      try {
        const rows = await loadUserRoles(db, userId);
        roles = rows.map((r) => r.name);
      } catch (err) {
        console.error("[ai-admin] role load failed (non-fatal)", err);
      }

      const result = await runAdminAgent(db, {
        userId,
        roles,
        message: parsed.data.message,
        confirmationToken: parsed.data.confirmationToken,
        history,
      });

      // Persist this turn into a chat session. A confirmation echo (no real
      // user message) is recorded as "(confirmed action)" so the history
      // reads cleanly.
      const isConfirmation = Boolean(parsed.data.confirmationToken);
      const userText = isConfirmation
        ? "(confirmed action)"
        : parsed.data.message;
      const sessionId = await ensureSession(
        userId,
        parsed.data.sessionId,
        userText
      );
      if (sessionId) {
        await persistMessage(sessionId, "user", userText, null, null);
        await persistMessage(
          sessionId,
          "assistant",
          result.response,
          result.pendingAction ?? null,
          result.executed ?? null
        );
      }

      return { data: { ...result, sessionId } };
    } catch (err) {
      console.error("[ai-admin] runAdminAgent failed", err);
      set.status = 500;
      return {
        error: "Admin agent failed",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  })

  // ── Session list (sidebar) ─────────────────────────────────────────────
  .get("/ai/admin/sessions", async ({ userId }) => {
    const rows = await db
      .select({
        id: adminChatSessions.id,
        title: adminChatSessions.title,
        createdAt: adminChatSessions.createdAt,
        updatedAt: adminChatSessions.updatedAt,
      })
      .from(adminChatSessions)
      .where(eq(adminChatSessions.userId, userId))
      .orderBy(desc(adminChatSessions.updatedAt))
      .limit(100);
    return { data: rows };
  })

  // ── Session messages (load on click) ───────────────────────────────────
  .get("/ai/admin/sessions/:id/messages", async ({ params, set, userId }) => {
    const parsed = sessionIdParam.safeParse(params);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid session id" };
    }
    const [owner] = await db
      .select({ id: adminChatSessions.id })
      .from(adminChatSessions)
      .where(
        and(
          eq(adminChatSessions.id, parsed.data.id),
          eq(adminChatSessions.userId, userId)
        )
      )
      .limit(1);
    if (!owner) {
      set.status = 404;
      return { error: "Session not found" };
    }
    const rows = await db
      .select({
        id: adminChatMessages.id,
        role: adminChatMessages.role,
        content: adminChatMessages.content,
        pendingAction: adminChatMessages.pendingAction,
        executed: adminChatMessages.executed,
        createdAt: adminChatMessages.createdAt,
      })
      .from(adminChatMessages)
      .where(eq(adminChatMessages.sessionId, parsed.data.id))
      .orderBy(adminChatMessages.createdAt);
    return { data: rows };
  })

  // ── Delete session ─────────────────────────────────────────────────────
  .delete("/ai/admin/sessions/:id", async ({ params, set, userId }) => {
    const parsed = sessionIdParam.safeParse(params);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid session id" };
    }
    // Cascade on the FK handles message deletion.
    await db
      .delete(adminChatSessions)
      .where(
        and(
          eq(adminChatSessions.id, parsed.data.id),
          eq(adminChatSessions.userId, userId)
        )
      );
    return { data: { ok: true } };
  });

export default aiAdminRoutes;
