import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { aiClients, aiTenants, aiUnits, users } from "../schema";

// ── Types ────────────────────────────────────────────────────────────────────

export interface UnitRecord {
  id: string;
  projectName: string;
  unitNumber: string;
  unitType: string;
  floorNumber: number | null;
  areaSqm: number | null;
  status: string;
  constructionProgress: number | null;
  estimatedHandoverDate: string | null;
}

export interface IdentityResult {
  type: "client" | "tenant" | "visitor";
  clientId?: string;
  tenantId?: string;
  firstName?: string;
  units: UnitRecord[];
  /** When true, multiple records matched and the user must provide additional info (email or unit number) to disambiguate. */
  needsDisambiguation?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getUnitsForClient(db: Database, clientId: string): Promise<UnitRecord[]> {
  const rows = await db
    .select({
      id: aiUnits.id,
      projectName: aiUnits.projectName,
      unitNumber: aiUnits.unitNumber,
      unitType: aiUnits.unitType,
      floorNumber: aiUnits.floorNumber,
      areaSqm: aiUnits.areaSqm,
      status: aiUnits.status,
      constructionProgress: aiUnits.constructionProgress,
      estimatedHandoverDate: aiUnits.estimatedHandoverDate,
    })
    .from(aiUnits)
    .where(eq(aiUnits.clientId, clientId));

  return rows;
}

async function getUnitsForTenant(db: Database, tenantId: string): Promise<UnitRecord[]> {
  const rows = await db
    .select({
      id: aiUnits.id,
      projectName: aiUnits.projectName,
      unitNumber: aiUnits.unitNumber,
      unitType: aiUnits.unitType,
      floorNumber: aiUnits.floorNumber,
      areaSqm: aiUnits.areaSqm,
      status: aiUnits.status,
      constructionProgress: aiUnits.constructionProgress,
      estimatedHandoverDate: aiUnits.estimatedHandoverDate,
    })
    .from(aiUnits)
    .where(eq(aiUnits.tenantId, tenantId));

  return rows;
}

// ── resolveIdentityByPhone ───────────────────────────────────────────────────

/**
 * Resolve a user identity by phone number.
 * Queries both aiClients and aiTenants tables.
 * If multiple records match, returns a disambiguation flag.
 */
export async function resolveIdentityByPhone(
  db: Database,
  phone: string
): Promise<IdentityResult> {
  const matchedClients = await db
    .select({
      id: aiClients.id,
      firstName: aiClients.firstName,
    })
    .from(aiClients)
    .where(eq(aiClients.phone, phone));

  const matchedTenants = await db
    .select({
      id: aiTenants.id,
      firstName: aiTenants.firstName,
    })
    .from(aiTenants)
    .where(eq(aiTenants.phone, phone));

  const totalMatches = matchedClients.length + matchedTenants.length;

  // No matches — visitor
  if (totalMatches === 0) {
    return { type: "visitor", units: [] };
  }

  // Multiple matches — disambiguation needed
  if (totalMatches > 1) {
    return {
      type: "visitor",
      units: [],
      needsDisambiguation: true,
    };
  }

  // Single client match
  if (matchedClients.length === 1) {
    const client = matchedClients[0];
    const units = await getUnitsForClient(db, client.id);
    return {
      type: "client",
      clientId: client.id,
      firstName: client.firstName,
      units,
    };
  }

  // Single tenant match
  const tenant = matchedTenants[0];
  const units = await getUnitsForTenant(db, tenant.id);
  return {
    type: "tenant",
    tenantId: tenant.id,
    firstName: tenant.firstName,
    units,
  };
}

// ── resolveIdentityByEmail ───────────────────────────────────────────────────

/**
 * Resolve a user identity by email address.
 * Queries both aiClients and aiTenants tables.
 * If multiple records match, returns a disambiguation flag.
 */
export async function resolveIdentityByEmail(
  db: Database,
  email: string
): Promise<IdentityResult> {
  const matchedClients = await db
    .select({
      id: aiClients.id,
      firstName: aiClients.firstName,
    })
    .from(aiClients)
    .where(eq(aiClients.email, email));

  const matchedTenants = await db
    .select({
      id: aiTenants.id,
      firstName: aiTenants.firstName,
    })
    .from(aiTenants)
    .where(eq(aiTenants.email, email));

  const totalMatches = matchedClients.length + matchedTenants.length;

  // No matches — visitor
  if (totalMatches === 0) {
    return { type: "visitor", units: [] };
  }

  // Multiple matches — disambiguation needed
  if (totalMatches > 1) {
    return {
      type: "visitor",
      units: [],
      needsDisambiguation: true,
    };
  }

  // Single client match
  if (matchedClients.length === 1) {
    const client = matchedClients[0];
    const units = await getUnitsForClient(db, client.id);
    return {
      type: "client",
      clientId: client.id,
      firstName: client.firstName,
      units,
    };
  }

  // Single tenant match
  const tenant = matchedTenants[0];
  const units = await getUnitsForTenant(db, tenant.id);
  return {
    type: "tenant",
    tenantId: tenant.id,
    firstName: tenant.firstName,
    units,
  };
}

// ── resolveIdentityBySession ─────────────────────────────────────────────────

/**
 * Resolve a user identity from an authenticated session user ID.
 * Looks up the user's email from the users table, then checks if that email
 * is linked to a client or tenant record.
 */
export async function resolveIdentityBySession(
  db: Database,
  userId: string
): Promise<IdentityResult> {
  // Look up the user's email from the auth users table
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return { type: "visitor", units: [] };
  }

  // Use the email to resolve identity
  return resolveIdentityByEmail(db, user.email);
}
