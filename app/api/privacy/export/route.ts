import { cookies } from "next/headers";
import { or, sql } from "drizzle-orm";
import { db } from "@/lib/cms/db";
import {
  formSubmissions,
  tickets,
  aiConversations,
} from "@/lib/cms/schema";
import { SESSION_COOKIE_NAME, validateSession } from "@/lib/cms/api/auth";
import { loadUserRoles, resolvePermissions } from "@/lib/cms/rbac/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DSAR Export Endpoint
 *
 * Accepts an identifier (email or phone) and returns all personal data
 * associated with that identifier across form_submissions, tickets, and
 * ai_conversations.
 *
 * Requirements: 15.3, 15.6, 15.7
 */
export async function POST(request: Request): Promise<Response> {
  // Introduce a small consistent delay to prevent timing attacks (25.3)
  const startTime = Date.now();

  try {
    // Require admin auth (15.6)
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE_NAME)?.value;
    const userId = await validateSession(token);

    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const hasAccess = await checkAdminAccess(userId);
    if (!hasAccess) {
      return Response.json(
        { error: "Forbidden: admin access required" },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json().catch(() => null);
    if (!body || typeof body.identifier !== "string" || !body.identifier.trim()) {
      return Response.json(
        { error: "identifier is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    const identifier = body.identifier.trim().toLowerCase();

    // Query all personal data across tables
    const [submissions, ticketRecords, conversations] = await Promise.all([
      // form_submissions: data JSONB may contain email or phone
      db
        .select()
        .from(formSubmissions)
        .where(
          or(
            sql`lower(${formSubmissions.data}->>'email') = ${identifier}`,
            sql`lower(${formSubmissions.data}->>'phone') = ${identifier}`
          )
        ),

      // tickets: contactEmail or contactPhone
      db
        .select()
        .from(tickets)
        .where(
          or(
            sql`lower(${tickets.contactEmail}) = ${identifier}`,
            sql`lower(${tickets.contactPhone}) = ${identifier}`
          )
        ),

      // ai_conversations: participantEmail or participantPhone
      db
        .select()
        .from(aiConversations)
        .where(
          or(
            sql`lower(${aiConversations.participantEmail}) = ${identifier}`,
            sql`lower(${aiConversations.participantPhone}) = ${identifier}`
          )
        ),
    ]);

    // Ensure consistent response timing to prevent leaking existence (25.3)
    const elapsed = Date.now() - startTime;
    const minResponseTime = 200; // ms
    if (elapsed < minResponseTime) {
      await new Promise((resolve) =>
        setTimeout(resolve, minResponseTime - elapsed)
      );
    }

    // Return same response shape regardless of whether data was found (25.3)
    return Response.json({
      identifier,
      data: {
        form_submissions: submissions,
        tickets: ticketRecords,
        ai_conversations: conversations,
      },
      message:
        submissions.length === 0 &&
        ticketRecords.length === 0 &&
        conversations.length === 0
          ? "No data found for the given identifier"
          : "Data export complete",
      exportedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[DSAR Export] Unexpected error:", error);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Check if the user has admin access (super_admin role or settings:update permission).
 */
async function checkAdminAccess(userId: string): Promise<boolean> {
  try {
    const userRolesList = await loadUserRoles(db, userId);
    const roleNames = userRolesList.map((r) => r.name);
    const perms = await resolvePermissions(db, userRolesList);
    return (
      roleNames.includes("super_admin") ||
      perms.includes("*:*") ||
      perms.includes("settings:update") ||
      perms.includes("settings:*")
    );
  } catch {
    return false;
  }
}
