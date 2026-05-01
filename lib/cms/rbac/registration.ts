import { eq, and } from "drizzle-orm";
import { generateRandomString, hashPassword } from "better-auth/crypto";
import type { Database } from "../db";
import {
  users,
  brokerCompanies,
  brokerProfiles,
  userRoles,
  roles,
  auditLog,
} from "../schema";

// ── Agent Types ──────────────────────────────────────────────────────────────

export interface AgentData {
  name: string;
  email: string;
  phone?: string;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface BrokerRegistrationInput {
  companyName: string;
  tradeLicenseNumber: string;
  tradeLicenseDocumentUrl?: string;
  contactEmail: string;
  contactPhone: string;
  adminName: string;
  adminEmail: string;
  adminPhone?: string;
}

// ── Validation ───────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class RegistrationError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, string>
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

function validateRegistrationInput(data: BrokerRegistrationInput): void {
  const missing: Record<string, string> = {};

  if (!data.companyName?.trim()) missing.companyName = "Company name is required";
  if (!data.tradeLicenseNumber?.trim()) missing.tradeLicenseNumber = "Trade license number is required";
  if (!data.contactEmail?.trim()) missing.contactEmail = "Contact email is required";
  if (!data.contactPhone?.trim()) missing.contactPhone = "Contact phone is required";
  if (!data.adminName?.trim()) missing.adminName = "Admin name is required";
  if (!data.adminEmail?.trim()) missing.adminEmail = "Admin email is required";

  if (Object.keys(missing).length > 0) {
    throw new RegistrationError("Validation failed", 400, missing);
  }

  // Validate email formats
  const emailErrors: Record<string, string> = {};
  if (data.contactEmail && !EMAIL_REGEX.test(data.contactEmail)) {
    emailErrors.contactEmail = "Invalid email format";
  }
  if (data.adminEmail && !EMAIL_REGEX.test(data.adminEmail)) {
    emailErrors.adminEmail = "Invalid email format";
  }

  if (Object.keys(emailErrors).length > 0) {
    throw new RegistrationError("Validation failed", 400, emailErrors);
  }
}

// ── Registration Service ─────────────────────────────────────────────────────

/**
 * Registers a new broker company with its admin user in a single transaction.
 * Creates: broker_company (pending), user (broker, inactive), broker_profile (admin, inactive),
 * and assigns the agency_admin role.
 */
export async function registerBrokerCompany(
  db: Database,
  data: BrokerRegistrationInput
): Promise<{
  company: typeof brokerCompanies.$inferSelect;
  user: typeof users.$inferSelect;
  profile: typeof brokerProfiles.$inferSelect;
}> {
  validateRegistrationInput(data);

  // Check for duplicate email
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.adminEmail))
    .limit(1);

  if (existing) {
    throw new RegistrationError(
      "An account with this email already exists",
      409
    );
  }

  // Find the agency_admin role
  const [agencyAdminRole] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.name, "agency_admin"), eq(roles.userType, "broker")))
    .limit(1);

  if (!agencyAdminRole) {
    throw new RegistrationError(
      "System role 'agency_admin' not found. Please run seed first.",
      500
    );
  }

  // Execute everything in a single transaction
  return await db.transaction(async (tx) => {
    const [company] = await tx
      .insert(brokerCompanies)
      .values({
        companyName: data.companyName.trim(),
        tradeLicenseNumber: data.tradeLicenseNumber.trim(),
        tradeLicenseDocumentUrl: data.tradeLicenseDocumentUrl ?? null,
        contactEmail: data.contactEmail.trim(),
        contactPhone: data.contactPhone.trim(),
        status: "pending",
      })
      .returning();

    const [user] = await tx
      .insert(users)
      .values({
        name: data.adminName.trim(),
        email: data.adminEmail.trim(),
        passwordHash: null,
        userType: "broker",
        isActive: false,
        emailVerified: false,
      })
      .returning();

    const [profile] = await tx
      .insert(brokerProfiles)
      .values({
        userId: user.id,
        companyId: company.id,
        isCompanyAdmin: true,
        status: "inactive",
      })
      .returning();

    await tx.insert(userRoles).values({
      userId: user.id,
      roleId: agencyAdminRole.id,
    });

    return { company, user, profile };
  });
}

// ── Approval / Rejection ─────────────────────────────────────────────────────

/**
 * Approves a pending broker company application.
 * Sets company to active, activates the admin user and profile,
 * generates a temporary password, and logs an audit entry.
 */
export async function approveBrokerCompany(
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

    for (const profile of profiles) {
      // Generate temporary password for the user
      const tempPassword = generateRandomString(12, "a-z", "A-Z", "0-9");
      const passwordHash = await hashPassword(tempPassword);

      // Activate the user
      await tx
        .update(users)
        .set({
          isActive: true,
          passwordHash,
          updatedAt: new Date(),
        })
        .where(eq(users.id, profile.userId));

      // Activate the broker profile
      await tx
        .update(brokerProfiles)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(brokerProfiles.id, profile.id));
    }

    // Log audit entry
    await tx.insert(auditLog).values({
      userId: actorId,
      action: "approve",
      entityType: "company_status_change",
      entityId: companyId,
      summary: `Approved broker company "${company.companyName}"`,
      changes: { status: { old: oldStatus, new: "active" } },
    });
  });
}

/**
 * Rejects a pending broker company application.
 * Sets company status to rejected and logs an audit entry.
 */
export async function rejectBrokerCompany(
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

    // Set company status to rejected
    await tx
      .update(brokerCompanies)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(brokerCompanies.id, companyId));

    // Log audit entry
    await tx.insert(auditLog).values({
      userId: actorId,
      action: "reject",
      entityType: "company_status_change",
      entityId: companyId,
      summary: `Rejected broker company "${company.companyName}"`,
      changes: { status: { old: oldStatus, new: "rejected" } },
    });
  });
}


// ── Agent Management ─────────────────────────────────────────────────────────

/**
 * Verifies the caller is a company admin and returns their broker profile.
 * Throws RegistrationError if the caller is not a company admin.
 */
async function verifyCompanyAdmin(
  db: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
  companyAdminUserId: string
) {
  const [adminProfile] = await db
    .select()
    .from(brokerProfiles)
    .where(eq(brokerProfiles.userId, companyAdminUserId))
    .limit(1);

  if (!adminProfile) {
    throw new RegistrationError(
      "Caller does not have a broker profile",
      403
    );
  }

  if (!adminProfile.isCompanyAdmin) {
    throw new RegistrationError(
      "Only company admins can manage agents",
      403
    );
  }

  return adminProfile;
}

/**
 * Adds a new agent to the company admin's broker company.
 * Creates a user (broker, active, unverified email, no password),
 * a broker profile linked to the admin's company, assigns the "agent" role,
 * and generates a temporary password.
 */
export async function addAgent(
  db: Database,
  companyAdminUserId: string,
  agentData: AgentData
): Promise<{
  user: typeof users.$inferSelect;
  profile: typeof brokerProfiles.$inferSelect;
}> {
  // Validate agent email
  if (!agentData.name?.trim()) {
    throw new RegistrationError("Agent name is required", 400);
  }
  if (!agentData.email?.trim()) {
    throw new RegistrationError("Agent email is required", 400);
  }
  if (!EMAIL_REGEX.test(agentData.email)) {
    throw new RegistrationError("Invalid email format", 400);
  }

  // Verify caller is company admin
  const adminProfile = await verifyCompanyAdmin(db, companyAdminUserId);

  // Check for duplicate email
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, agentData.email.trim()))
    .limit(1);

  if (existing) {
    throw new RegistrationError(
      "An account with this email already exists",
      409
    );
  }

  // Find the agent role
  const [agentRole] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.name, "agent"), eq(roles.userType, "broker")))
    .limit(1);

  if (!agentRole) {
    throw new RegistrationError(
      "System role 'agent' not found. Please run seed first.",
      500
    );
  }

  return await db.transaction(async (tx) => {
    // Generate temporary password
    const tempPassword = generateRandomString(12, "a-z", "A-Z", "0-9");
    const passwordHashValue = await hashPassword(tempPassword);

    const [user] = await tx
      .insert(users)
      .values({
        name: agentData.name.trim(),
        email: agentData.email.trim(),
        passwordHash: passwordHashValue,
        userType: "broker",
        isActive: true,
        emailVerified: false,
      })
      .returning();

    const [profile] = await tx
      .insert(brokerProfiles)
      .values({
        userId: user.id,
        companyId: adminProfile.companyId,
        isCompanyAdmin: false,
        status: "active",
      })
      .returning();

    await tx.insert(userRoles).values({
      userId: user.id,
      roleId: agentRole.id,
      grantedBy: companyAdminUserId,
    });

    // Log audit entry
    await tx.insert(auditLog).values({
      userId: companyAdminUserId,
      action: "add_agent",
      entityType: "agent_management",
      entityId: user.id,
      summary: `Added agent "${user.name}" to company`,
      changes: {
        agent: { email: user.email, name: user.name },
        companyId: adminProfile.companyId,
      },
    });

    return { user, profile };
  });
}

/**
 * Deactivates an agent within the company admin's broker company.
 * Sets the agent's broker profile status to inactive and user isActive to false.
 * Rejects if caller is not a company admin or agent belongs to a different company.
 */
export async function deactivateAgent(
  db: Database,
  companyAdminUserId: string,
  agentUserId: string
): Promise<void> {
  // Verify caller is company admin
  const adminProfile = await verifyCompanyAdmin(db, companyAdminUserId);

  // Load the target agent's broker profile
  const [agentProfile] = await db
    .select()
    .from(brokerProfiles)
    .where(eq(brokerProfiles.userId, agentUserId))
    .limit(1);

  if (!agentProfile) {
    throw new RegistrationError("Agent not found", 404);
  }

  // Verify agent belongs to the same company
  if (agentProfile.companyId !== adminProfile.companyId) {
    throw new RegistrationError(
      "Cannot manage agents from a different company",
      403
    );
  }

  await db.transaction(async (tx) => {
    // Set broker profile status to inactive
    await tx
      .update(brokerProfiles)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(brokerProfiles.userId, agentUserId));

    // Set user isActive to false
    await tx
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, agentUserId));

    // Log audit entry
    await tx.insert(auditLog).values({
      userId: companyAdminUserId,
      action: "deactivate_agent",
      entityType: "agent_management",
      entityId: agentUserId,
      summary: `Deactivated agent in company`,
      changes: {
        agentUserId,
        companyId: adminProfile.companyId,
        profileStatus: { old: agentProfile.status, new: "inactive" },
        isActive: { old: true, new: false },
      },
    });
  });
}
