import { cookies } from "next/headers";
import { or, sql } from "drizzle-orm";
import { db } from "@/lib/cms/db";
import {
  formSubmissions,
  tickets,
  aiConversations,
  dsarDeletionQueue,
} from "@/lib/cms/schema";
import { SESSION_COOKIE_NAME, validateSession } from "@/lib/cms/api/auth";
import { loadUserRoles, resolvePermissions } from "@/lib/cms/rbac/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DSAR Deletion Endpoint
 *
 * Accepts an identifier (email or phone), deletes all local records,
 * and calls PostHog's person-delete API. If PostHog fails, queues
 * the deletion for retry.
 *
 * Requirements: 15.4, 15.5, 15.6, 15.7
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

    // Delete local records across all tables
    const [deletedSubmissions, deletedTickets, deletedConversations] =
      await Promise.all([
        // Delete form_submissions where data contains the identifier
        db
          .delete(formSubmissions)
          .where(
            or(
              sql`lower(${formSubmissions.data}->>'email') = ${identifier}`,
              sql`lower(${formSubmissions.data}->>'phone') = ${identifier}`
            )
          )
          .returning({ id: formSubmissions.id }),

        // Delete tickets matching contactEmail or contactPhone
        db
          .delete(tickets)
          .where(
            or(
              sql`lower(${tickets.contactEmail}) = ${identifier}`,
              sql`lower(${tickets.contactPhone}) = ${identifier}`
            )
          )
          .returning({ id: tickets.id }),

        // Delete ai_conversations (messages cascade via FK)
        db
          .delete(aiConversations)
          .where(
            or(
              sql`lower(${aiConversations.participantEmail}) = ${identifier}`,
              sql`lower(${aiConversations.participantPhone}) = ${identifier}`
            )
          )
          .returning({ id: aiConversations.id }),
      ]);

    // Call PostHog person-delete API
    let posthogDeletionStatus: "completed" | "pending" = "completed";
    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const posthogHost =
      process.env.POSTHOG_HOST || "https://eu.i.posthog.com";

    if (posthogKey) {
      try {
        // Use the identifier as the distinct_id for PostHog person lookup
        const response = await fetch(
          `${posthogHost}/api/projects/@current/persons/?distinct_id=${encodeURIComponent(identifier)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${posthogKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          const persons = data.results || [];

          for (const person of persons) {
            const deleteResponse = await fetch(
              `${posthogHost}/api/projects/@current/persons/${person.id}/`,
              {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${posthogKey}`,
                  "Content-Type": "application/json",
                },
              }
            );

            if (!deleteResponse.ok) {
              throw new Error(
                `PostHog person delete failed: ${deleteResponse.status} ${deleteResponse.statusText}`
              );
            }
          }
        } else if (response.status !== 404) {
          throw new Error(
            `PostHog person lookup failed: ${response.status} ${response.statusText}`
          );
        }
      } catch (error) {
        // Queue for retry on failure (15.5)
        console.error("[DSAR Delete] PostHog API error:", error);
        posthogDeletionStatus = "pending";

        await db.insert(dsarDeletionQueue).values({
          identifier,
          posthogDistinctId: identifier,
          status: "pending",
          attempts: 1,
          lastError:
            error instanceof Error ? error.message : "Unknown error",
          nextRetryAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
        });
      }
    }

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
      deleted: {
        form_submissions: deletedSubmissions.length,
        tickets: deletedTickets.length,
        ai_conversations: deletedConversations.length,
      },
      posthogDeletion: posthogDeletionStatus,
      message:
        deletedSubmissions.length === 0 &&
        deletedTickets.length === 0 &&
        deletedConversations.length === 0
          ? "No data found for the given identifier"
          : "Deletion complete",
      deletedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[DSAR Delete] Unexpected error:", error);
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
