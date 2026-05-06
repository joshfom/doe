import { eq, and } from "drizzle-orm";
import type { Database } from "../db";
import { roles, permissions, rolePermissions } from "../schema";

// ── Permission Definitions ───────────────────────────────────────────────────

export const PERMISSIONS = [
  // Pages
  { resource: "pages", action: "read", description: "View pages" },
  { resource: "pages", action: "create", description: "Create pages" },
  { resource: "pages", action: "update", description: "Update pages" },
  { resource: "pages", action: "delete", description: "Delete pages" },
  { resource: "pages", action: "publish", description: "Publish pages" },
  // Blog posts
  { resource: "posts", action: "read", description: "View blog posts" },
  { resource: "posts", action: "create", description: "Create blog posts" },
  { resource: "posts", action: "update", description: "Update blog posts" },
  { resource: "posts", action: "delete", description: "Delete blog posts" },
  { resource: "posts", action: "publish", description: "Publish blog posts" },
  // Media
  { resource: "media", action: "read", description: "View media" },
  { resource: "media", action: "create", description: "Upload media" },
  { resource: "media", action: "update", description: "Update media" },
  { resource: "media", action: "delete", description: "Delete media" },
  // Component templates
  { resource: "components", action: "read", description: "View component templates" },
  { resource: "components", action: "create", description: "Create component templates" },
  { resource: "components", action: "update", description: "Update component templates" },
  { resource: "components", action: "delete", description: "Delete component templates" },
  // Broker management
  { resource: "brokers", action: "read", description: "View brokers" },
  { resource: "brokers", action: "manage", description: "Manage broker applications" },
  // Bookings
  { resource: "bookings", action: "read", description: "View bookings" },
  { resource: "bookings", action: "create", description: "Create bookings" },
  { resource: "bookings", action: "update", description: "Update bookings" },
  { resource: "bookings", action: "delete", description: "Delete bookings" },
  // Leads
  { resource: "leads", action: "read", description: "View leads" },
  { resource: "leads", action: "create", description: "Create leads" },
  { resource: "leads", action: "update", description: "Update leads" },
  { resource: "leads", action: "delete", description: "Delete leads" },
  // Commissions
  { resource: "commissions", action: "read", description: "View commissions" },
  { resource: "commissions", action: "approve", description: "Approve commissions" },
  { resource: "commissions", action: "update", description: "Update commissions" },
  // Invoices
  { resource: "invoices", action: "read", description: "View invoices" },
  { resource: "invoices", action: "create", description: "Create invoices" },
  { resource: "invoices", action: "update", description: "Update invoices" },
  // Financial reporting
  { resource: "reports", action: "read", description: "View financial reports" },
  // Settings
  { resource: "settings", action: "read", description: "View settings" },
  { resource: "settings", action: "update", description: "Update settings" },
  // Users
  { resource: "users", action: "read", description: "View users" },
  { resource: "users", action: "create", description: "Create users" },
  { resource: "users", action: "update", description: "Update users" },
  { resource: "users", action: "delete", description: "Delete users" },
  // Roles
  { resource: "roles", action: "read", description: "View roles" },
  { resource: "roles", action: "create", description: "Create roles" },
  { resource: "roles", action: "update", description: "Update roles" },
  { resource: "roles", action: "delete", description: "Delete roles" },
  // Audit
  { resource: "audit", action: "read", description: "View audit logs" },
  // Broker portal: agents
  { resource: "agents", action: "read", description: "View agents" },
  { resource: "agents", action: "manage", description: "Manage agents" },
  // Broker portal: company
  { resource: "company", action: "read", description: "View company details" },
  { resource: "company", action: "update", description: "Update company details" },
  // Broker portal: own bookings
  { resource: "own_bookings", action: "read", description: "View own bookings" },
  { resource: "own_bookings", action: "create", description: "Create own bookings" },
  { resource: "own_bookings", action: "update", description: "Update own bookings" },
  // Broker portal: own leads
  { resource: "own_leads", action: "read", description: "View own leads" },
  { resource: "own_leads", action: "create", description: "Create own leads" },
  { resource: "own_leads", action: "update", description: "Update own leads" },
  // Project / construction operations (off-plan stage)
  { resource: "projects", action: "read", description: "View development projects" },
  { resource: "projects", action: "update", description: "Update project status, milestones, photos" },
  { resource: "site_permits", action: "read", description: "View construction-site permits" },
  { resource: "site_permits", action: "approve", description: "Approve hot-works / work-at-height / lift permits" },
  // Marketing collateral
  { resource: "marketing", action: "read", description: "View marketing assets and leads" },
  { resource: "marketing", action: "manage", description: "Manage brochures, campaigns, RSVPs" },
  // Site security gatehouse
  { resource: "gate", action: "read", description: "View gate passes and visitor log" },
  { resource: "gate", action: "checkin", description: "Check visitors / vehicles in and out at the gate" },
  // Vendor / contractor self-service portal
  { resource: "own_permits", action: "read", description: "View own submitted permits" },
  { resource: "own_permits", action: "create", description: "Submit construction-site permits" },
  { resource: "own_deliveries", action: "read", description: "View own material deliveries" },
  { resource: "own_deliveries", action: "create", description: "Schedule own material deliveries" },
  // Client (buyer / booked) self-service
  { resource: "own_unit", action: "read", description: "View own unit / SPA status" },
  { resource: "own_payments", action: "read", description: "View own payment milestones" },
  { resource: "own_documents", action: "read", description: "View own oqood / NOC / handover documents" },
  // Wildcard (super_admin)
  { resource: "*", action: "*", description: "Full access to all resources" },
] as const;

// ── Role Definitions ─────────────────────────────────────────────────────────

export const SYSTEM_ROLES = [
  // Employee roles
  {
    name: "super_admin",
    displayName: "Super Administrator",
    description: "Full access to all platform features",
    userType: "employee" as const,
  },
  {
    name: "content_manager",
    displayName: "Content Manager",
    description: "Manage pages, blog posts, media, and component templates",
    userType: "employee" as const,
  },
  {
    name: "sales_manager",
    displayName: "Sales Manager",
    description: "Manage brokers, bookings, and leads",
    userType: "employee" as const,
  },
  {
    name: "finance",
    displayName: "Finance",
    description: "Manage commissions, invoices, and financial reporting",
    userType: "employee" as const,
  },
  {
    name: "viewer",
    displayName: "Viewer",
    description: "Read-only access across all resources",
    userType: "employee" as const,
  },
  // Broker roles
  {
    name: "agency_admin",
    displayName: "Agency Administrator",
    description: "Manage agents and company settings in the broker portal",
    userType: "broker" as const,
  },
  {
    name: "agent",
    displayName: "Agent",
    description: "Access own bookings and leads in the broker portal",
    userType: "broker" as const,
  },
  // Off-plan / construction-stage employee roles
  {
    name: "project_manager",
    displayName: "Project Manager",
    description: "Owns construction progress, approvals, and pre-handover operations",
    userType: "employee" as const,
  },
  {
    name: "hse_officer",
    displayName: "HSE Officer",
    description: "Approves hot-works, work-at-height and other safety permits on site",
    userType: "employee" as const,
  },
  {
    name: "site_security",
    displayName: "Site Security",
    description: "Validates gate passes and material deliveries at the construction site",
    userType: "employee" as const,
  },
  {
    name: "marketing",
    displayName: "Marketing",
    description: "Manages brochures, launch events, and marketing-driven leads",
    userType: "employee" as const,
  },
  // Client-side roles (off-plan stage — no occupants yet)
  {
    name: "prospective_buyer",
    displayName: "Prospective Buyer",
    description: "Public visitor / lead exploring Bayn before reserving a unit",
    userType: "client" as const,
  },
  {
    name: "booked_client",
    displayName: "Booked Client",
    description: "Reserved or SPA-signed buyer awaiting handover",
    userType: "client" as const,
  },
  // Vendor-side roles
  {
    name: "contractor",
    displayName: "Main Contractor",
    description: "Construction main contractor submitting site permits and deliveries",
    userType: "vendor" as const,
  },
  {
    name: "consultant",
    displayName: "Consultant / Engineer",
    description: "Project consultant requesting inspections and approvals",
    userType: "vendor" as const,
  },
] as const;

// ── Role → Permission Mappings ───────────────────────────────────────────────

/** Maps role name to the permission keys (resource:action) it should have */
export const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  super_admin: ["*:*"],

  content_manager: [
    "pages:read", "pages:create", "pages:update", "pages:delete", "pages:publish",
    "posts:read", "posts:create", "posts:update", "posts:delete", "posts:publish",
    "media:read", "media:create", "media:update", "media:delete",
    "components:read", "components:create", "components:update", "components:delete",
  ],

  sales_manager: [
    "brokers:read", "brokers:manage",
    "bookings:read", "bookings:create", "bookings:update", "bookings:delete",
    "leads:read", "leads:create", "leads:update", "leads:delete",
  ],

  finance: [
    "commissions:read", "commissions:approve", "commissions:update",
    "invoices:read", "invoices:create", "invoices:update",
    "reports:read",
  ],

  viewer: [
    "pages:read", "posts:read", "media:read", "components:read",
    "brokers:read", "bookings:read", "leads:read",
    "commissions:read", "invoices:read", "reports:read",
    "settings:read", "users:read", "roles:read", "audit:read",
  ],

  agency_admin: [
    "agents:read", "agents:manage",
    "company:read", "company:update",
    "own_bookings:read", "own_bookings:create", "own_bookings:update",
    "own_leads:read", "own_leads:create", "own_leads:update",
  ],

  agent: [
    "own_bookings:read", "own_bookings:create", "own_bookings:update",
    "own_leads:read", "own_leads:create", "own_leads:update",
  ],

  // Off-plan / construction-stage employee roles
  project_manager: [
    "projects:read", "projects:update",
    "site_permits:read", "site_permits:approve",
    "settings:read", "audit:read",
  ],

  hse_officer: [
    "site_permits:read", "site_permits:approve",
    "projects:read",
  ],

  site_security: [
    "gate:read", "gate:checkin",
  ],

  marketing: [
    "marketing:read", "marketing:manage",
    "pages:read", "posts:read", "media:read",
    "leads:read", "leads:create", "leads:update",
  ],

  // Client-side roles (off-plan stage — no occupants yet)
  prospective_buyer: [
    "marketing:read",
  ],

  booked_client: [
    "own_unit:read",
    "own_payments:read",
    "own_documents:read",
    "marketing:read",
  ],

  // Vendor-side roles
  contractor: [
    "own_permits:read", "own_permits:create",
    "own_deliveries:read", "own_deliveries:create",
  ],

  consultant: [
    "own_permits:read", "own_permits:create",
    "projects:read",
  ],
};

// ── Seed Function ────────────────────────────────────────────────────────────

export async function seedRbac(db: Database): Promise<void> {
  // 1. Seed permissions (idempotent: check before insert)
  for (const perm of PERMISSIONS) {
    const existing = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.resource, perm.resource),
          eq(permissions.action, perm.action),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(permissions).values({
        resource: perm.resource,
        action: perm.action,
        description: perm.description,
      });
    }
  }

  // 2. Seed system roles (idempotent: check by name + userType)
  for (const role of SYSTEM_ROLES) {
    const existing = await db
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(eq(roles.name, role.name), eq(roles.userType, role.userType)),
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(roles).values({
        name: role.name,
        displayName: role.displayName,
        description: role.description,
        userType: role.userType,
        isSystem: true,
      });
    }
  }

  // 3. Seed role_permissions junction records (idempotent: onConflictDoNothing)
  for (const [roleName, permKeys] of Object.entries(ROLE_PERMISSION_MAP)) {
    // Find the role
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, roleName))
      .limit(1);

    if (!role) continue;

    for (const permKey of permKeys) {
      const [resource, action] = permKey.split(":");

      // Find the permission
      const [perm] = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(
            eq(permissions.resource, resource),
            eq(permissions.action, action),
          ),
        )
        .limit(1);

      if (!perm) continue;

      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: perm.id })
        .onConflictDoNothing();
    }
  }

  console.log("RBAC seed complete: roles, permissions, and mappings seeded.");
}
