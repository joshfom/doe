import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { users, brokerCompanies, brokerProfiles, auditLog } from "../schema";

// Re-use RegistrationError for consistency
import { RegistrationError } from "./registration";

/**
 * Suspends a broker company and cascades deactivation to all linked users.
 * In a transaction: sets company status to "suspended", sets isActive to false
 * for all users linked via brokerProfiles, and logs an audit entry.
 */
export async function suspendCompany(
  db: Database,
  companyId: string,
  actorId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    // Load the company
    const [company] = await tx
      .select()
      .from(brokerCompanies)
      .where(eq(brokerCompanies.id, companyId))
      .limit(1);

    if (!company) {
      throw new RegistrationError("Company not found", 404);
    }

    const oldStatus = company.status;

    // Set company status to suspended
    await tx
      .update(brokerCompanies)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(eq(brokerCompanies.id, companyId));

    // Find all broker profiles linked to this company
    const profiles = await tx
      .select()
      .from(brokerProfiles)
      .where(eq(brokerProfiles.companyId, companyId));

    // Deactivate all linked users
    for (const profile of profiles) {
      await tx
        .update(users)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(users.id, profile.userId));
    }

    // Log audit entry
    await tx.insert(auditLog).values({
      userId: actorId,
      action: "suspend",
      entityType: "company_status_change",
      entityId: companyId,
      summary: `Suspended broker company "${company.companyName}"`,
      changes: { status: { old: oldStatus, new: "suspended" } },
    });
  });
}

/**
 * Reactivates a broker company and restores active-profile users.
 * In a transaction: sets company status to "active", sets isActive to true
 * only for users whose brokerProfile status is "active", and logs an audit entry.
 */
export async function reactivateCompany(
  db: Database,
  companyId: string,
  actorId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    // Load the company
    const [company] = await tx
      .select()
      .from(brokerCompanies)
      .where(eq(brokerCompanies.id, companyId))
      .limit(1);

    if (!company) {
      throw new RegistrationError("Company not found", 404);
    }

    const oldStatus = company.status;

    // Set company status to active
    await tx
      .update(brokerCompanies)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(brokerCompanies.id, companyId));

    // Find all broker profiles linked to this company
    const profiles = await tx
      .select()
      .from(brokerProfiles)
      .where(eq(brokerProfiles.companyId, companyId));

    // Restore isActive only for users with active broker profiles
    for (const profile of profiles) {
      if (profile.status === "active") {
        await tx
          .update(users)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(users.id, profile.userId));
      }
    }

    // Log audit entry
    await tx.insert(auditLog).values({
      userId: actorId,
      action: "reactivate",
      entityType: "company_status_change",
      entityId: companyId,
      summary: `Reactivated broker company "${company.companyName}"`,
      changes: { status: { old: oldStatus, new: "active" } },
    });
  });
}
