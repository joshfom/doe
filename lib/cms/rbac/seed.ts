import { eq, and } from "drizzle-orm";
import type { Database } from "../db";
import { roles, permissions, rolePermissions, userRoles } from "../schema";

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
  // Executive reporting & twin (C-level). Scoped wildcards matched by
  // `hasPermission` (resource-level `resource:*`): `report:*` covers every
  // reporting tool/scope permission, `home:*` covers every home/twin agent tool.
  // The literal multi-colon scope strings the scope resolver needs
  // (`report:scope:exec` / `report:scope:rep`) are seeded separately by
  // {@link seedExecutiveReportingScopes} because they cannot be expressed via the
  // single-colon split in {@link ROLE_PERMISSION_MAP}.
  { resource: "report", action: "*", description: "Full executive reporting & analytics tools (all report scopes and tools)" },
  { resource: "home", action: "*", description: "Full access to all home/twin agent tools" },
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
  // Voice surface — Demo Console (SSE realtime stream of transcripts/decisions)
  { resource: "voice", action: "console", description: "Access the DOE Voice Demo Console realtime stream" },
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
    name: "c_level",
    displayName: "C-Level Executive",
    description:
      "Executive twin access: org-wide reporting, analytics, CRM brainstorming, platform knowledge, and the live reasoning console",
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

  // Executive twin (C-level). Broad READ access across the business plus the
  // scoped reporting/home wildcards. The literal `report:scope:exec` /
  // `report:scope:rep` strings the scope resolver requires are granted in
  // addition by {@link seedExecutiveReportingScopes}.
  c_level: [
    "report:*", "home:*",
    "reports:read", "leads:read", "bookings:read", "brokers:read",
    "marketing:read", "commissions:read", "invoices:read",
    "audit:read", "settings:read", "users:read", "roles:read",
    "voice:console",
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

// ── Lead-engine agent identities (S3) ────────────────────────────────────────

/**
 * Prefix for per-tool RBAC permission strings dispatched by lead-engine agents,
 * e.g. `lead:tool:update_qualification`. The dispatcher resolves a non-static
 * agent actor through the RBAC engine (`loadUserRoles → resolvePermissions →
 * hasPermission`); a `lead:tool:<name>` permission is stored with resource
 * `lead:tool` and action `<name>`, so `resolvePermissions` reconstructs the
 * exact `lead:tool:<name>` string the catalog entry requires.
 */
export const LEAD_AGENT_TOOL_PERMISSION_PREFIX = "lead:tool";

/** Build the RBAC permission string a lead catalog tool requires. */
export function leadToolPermission(toolName: string): string {
  return `${LEAD_AGENT_TOOL_PERMISSION_PREFIX}:${toolName}`;
}

/**
 * The S3 lead-engine agent identities (Design §Architecture — "Agent
 * identities and RBAC"). Each is seeded as an RBAC role granting EXACTLY the
 * catalog tool permissions it may dispatch — no wildcard. An agent attempting a
 * tool outside its grant is denied by the dispatcher (one audit row, no state
 * change). The agent's `actor` string is linked as the `user_roles.user_id` so
 * the dispatcher's `loadUserRoles(db, actor)` resolves the identity's roles —
 * the same resolution path the dispatcher uses for every non-static agent.
 */
export const LEAD_AGENT_IDENTITIES = [
  {
    // Parse_Agent: extracts structured fields; records qualification + score.
    actor: "agent:lead-parse",
    roleName: "agent_lead_parse",
    displayName: "Lead Parse Agent",
    description:
      "S3 Parse_Agent: extracts structured lead fields and records qualification/score (no wildcard).",
    tools: ["update_qualification", "score_lead"],
  },
  {
    // Distribution_Agent: resolves identity, creates/attaches, assigns owner.
    actor: "agent:lead-distribution",
    roleName: "agent_lead_distribution",
    displayName: "Lead Distribution Agent",
    description:
      "S3 Distribution_Agent: resolves identity, creates/attaches leads, and assigns the owning rep (no wildcard).",
    tools: [
      "record_inbound_lead",
      "attach_inbound_lead",
      "assign_lead_owner",
      "flag_lead_conflict",
    ],
  },
  {
    // Enrichment_Agent: gated personal-data read for the Lead DNA brief.
    actor: "agent:lead-enrichment",
    roleName: "agent_lead_enrichment",
    displayName: "Lead Enrichment Agent",
    description:
      "S3 Enrichment_Agent: gated personal-data reads for the Lead DNA brief (no wildcard).",
    tools: ["enrich_lead_read"],
  },
] as const;

// ── Prospecting agent identities (S7) ────────────────────────────────────────

/**
 * Prefix for per-tool RBAC permission strings dispatched by prospecting agents,
 * e.g. `prospecting:tool:find_comparables`. Mirrors the lead-engine prefix: a
 * `prospecting:tool:<name>` permission is stored with resource `prospecting:tool`
 * and action `<name>`, so `resolvePermissions` reconstructs the exact
 * `prospecting:tool:<name>` string the catalog entry requires.
 */
export const PROSPECTING_AGENT_TOOL_PERMISSION_PREFIX = "prospecting:tool";

/** Build the RBAC permission string a prospecting catalog tool requires. */
export function prospectingToolPermission(toolName: string): string {
  return `${PROSPECTING_AGENT_TOOL_PERMISSION_PREFIX}:${toolName}`;
}

/**
 * The S7 prospecting-workspace agent identities (Design §Architecture — "Agent
 * identities and RBAC"). Each is seeded as an RBAC role granting EXACTLY the
 * catalog tool permissions it may dispatch — no wildcard. An out-of-grant call
 * is denied by the dispatcher (one audit row, no state change — reused S1
 * behaviour).
 *
 * `send_outreach` is deliberately granted to NEITHER agent: a send requires a
 * valid human Approval_Flow token and is dispatched under the approving rep's
 * identity (Design §7), so no agent role may carry `prospecting:tool:send_outreach`.
 */
export const PROSPECTING_AGENT_IDENTITIES = [
  {
    // Prospecting_Agent (the navigator): brief → comparables → hypothesis →
    // search → record/enrich → promote to Lead.
    actor: "agent:prospecting",
    roleName: "agent_prospecting",
    displayName: "Prospecting Agent",
    description:
      "S7 Prospecting_Agent: comparables, market stats, prospect search, enrichment, target recording, and promotion to Lead (no wildcard; cannot send outreach).",
    tools: [
      "find_comparables",
      "market_comps",
      "prospect_search",
      "enrich_target",
      "record_target",
      "promote_target_to_lead",
    ],
  },
  {
    // Outreach_Agent: grounded, editable drafting only. The send is human-gated
    // and never grantable to an agent.
    actor: "agent:outreach",
    roleName: "agent_outreach",
    displayName: "Outreach Agent",
    description:
      "S7 Outreach_Agent: grounded, editable outreach drafting only (no wildcard; send_outreach requires a human Approval_Flow token and is grantable to no agent).",
    tools: ["draft_outreach"],
  },
] as const;

/** The user_type under which the agent-identity roles are seeded. */
const AGENT_ROLE_USER_TYPE = "employee" as const;

/** Matches a canonical UUID — `user_roles.user_id` is a uuid column. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // 3b. Seed the literal executive report-scope permissions and grant them to
  //     the c_level role (multi-colon strings the naive split above cannot map).
  await seedExecutiveReportingScopes(db);

  // 4. Seed the lead-engine agent identities (S3) — roles granting EXACTLY
  //    their catalog tool permissions, linked to their actor identity.
  await seedLeadAgentIdentities(db);

  // 5. Seed the prospecting-workspace agent identities (S7) — same mechanism,
  //    each role granting EXACTLY its catalog tool permissions (no wildcard).
  await seedProspectingAgentIdentities(db);
}

/** The employee role name granted org-wide executive reporting access. */
export const C_LEVEL_ROLE_NAME = "c_level";

/**
 * The literal report-scope permissions the scope resolver checks by exact
 * `includes` (not by `hasPermission` wildcard): `report:scope:exec` (org-wide)
 * and `report:scope:rep` (single-rep drill-down). Stored as resource
 * `report:scope`, action `exec` / `rep`, so `resolvePermissions` reconstructs
 * the exact `report:scope:<x>` string `resolveReportScope` requires.
 */
export const EXECUTIVE_SCOPE_PERMISSIONS = [
  { resource: "report:scope", action: "exec", description: "Org-wide (exec) reporting scope" },
  { resource: "report:scope", action: "rep", description: "Single-rep reporting scope" },
] as const;

/**
 * Ensure the literal executive report-scope permissions exist and grant them to
 * the `c_level` role. Fully idempotent (existence checks + `onConflictDoNothing`),
 * mirroring {@link seedLeadAgentIdentities}. Without this, a C-level user's
 * resolved permissions would not contain the exact `report:scope:exec` string
 * the scope resolver matches, so org-wide figures would not be granted.
 */
export async function seedExecutiveReportingScopes(db: Database): Promise<void> {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(
        eq(roles.name, C_LEVEL_ROLE_NAME),
        eq(roles.userType, AGENT_ROLE_USER_TYPE),
      ),
    )
    .limit(1);

  if (!role) return;

  for (const perm of EXECUTIVE_SCOPE_PERMISSIONS) {
    // Ensure the permission exists (insert without RETURNING, then re-select —
    // the proven pg-mem-safe pattern used by seedLeadAgentIdentities).
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

    const [row] = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.resource, perm.resource),
          eq(permissions.action, perm.action),
        ),
      )
      .limit(1);

    if (!row) continue;

    await db
      .insert(rolePermissions)
      .values({ roleId: role.id, permissionId: row.id })
      .onConflictDoNothing();
  }
}

/** Shape of an agent identity seeded as an RBAC role granting exactly its tools. */
interface AgentToolIdentity {
  readonly actor: string;
  readonly roleName: string;
  readonly displayName: string;
  readonly description: string;
  readonly tools: readonly string[];
}

/**
 * Shared agent-identity seeding mechanism reused by every agent program (S3
 * lead-engine, S7 prospecting, …). For each identity this:
 *   1. ensures each `<prefix>:<name>` permission exists (resource `<prefix>`,
 *      action `<name>`),
 *   2. ensures the agent role exists,
 *   3. grants the role exactly those permissions (no wildcard),
 *   4. links the agent actor string as a `user_roles.user_id` so the dispatcher
 *      resolves the identity through the RBAC engine.
 * Fully idempotent: existence checks for permissions/roles, `onConflictDoNothing`
 * for the junction rows.
 */
async function seedAgentToolIdentities(
  db: Database,
  permissionPrefix: string,
  describePermission: (toolName: string) => string,
  identities: readonly AgentToolIdentity[],
): Promise<void> {
  for (const identity of identities) {
    // 1. Ensure each tool permission exists.
    for (const toolName of identity.tools) {
      const existing = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(
            eq(permissions.resource, permissionPrefix),
            eq(permissions.action, toolName),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(permissions).values({
          resource: permissionPrefix,
          action: toolName,
          description: describePermission(toolName),
        });
      }
    }

    // 2. Ensure the agent role exists.
    let [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(
          eq(roles.name, identity.roleName),
          eq(roles.userType, AGENT_ROLE_USER_TYPE),
        ),
      )
      .limit(1);

    if (!role) {
      const inserted = await db
        .insert(roles)
        .values({
          name: identity.roleName,
          displayName: identity.displayName,
          description: identity.description,
          userType: AGENT_ROLE_USER_TYPE,
          isSystem: true,
        })
        .returning({ id: roles.id });
      role = inserted[0];
    }

    if (!role) continue;

    // 3. Grant the role exactly its tool permissions (no wildcard).
    for (const toolName of identity.tools) {
      const [perm] = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(
          and(
            eq(permissions.resource, permissionPrefix),
            eq(permissions.action, toolName),
          ),
        )
        .limit(1);

      if (!perm) continue;

      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permissionId: perm.id })
        .onConflictDoNothing();
    }

    // 4. Link the agent actor identity to the role so loadUserRoles resolves it.
    //    NOTE: `user_roles.user_id` is a `uuid` column, but agent identities are
    //    string actors (e.g. `agent:lead-parse`). Inserting a non-uuid actor
    //    throws `invalid input syntax for type uuid` and aborts the whole RBAC
    //    seed. String agent actors are resolved via the dispatcher's
    //    `STATIC_AGENT_PERMISSIONS` map (see `dispatch.ts`), not `user_roles`, so
    //    we skip the junction insert for any non-uuid actor rather than crash.
    if (UUID_RE.test(identity.actor)) {
      await db
        .insert(userRoles)
        .values({ userId: identity.actor, roleId: role.id })
        .onConflictDoNothing();
    }
  }
}

/**
 * Seed the S3 lead-engine agent identities into the RBAC tables — roles
 * granting EXACTLY their catalog tool permissions (no wildcard), linked to
 * their actor identity. Delegates to the shared {@link seedAgentToolIdentities}
 * mechanism.
 */
export async function seedLeadAgentIdentities(db: Database): Promise<void> {
  await seedAgentToolIdentities(
    db,
    LEAD_AGENT_TOOL_PERMISSION_PREFIX,
    (toolName) => `Lead-engine agent permission for the ${toolName} catalog tool`,
    LEAD_AGENT_IDENTITIES,
  );

  console.log("Lead-engine agent identities seed complete.");
}

/**
 * Seed the S7 prospecting-workspace agent identities into the RBAC tables —
 * `agent:prospecting` and `agent:outreach`, each granting EXACTLY its catalog
 * tool permissions (no wildcard). `send_outreach` is granted to neither (the
 * send is human-gated by an Approval_Flow token). Reuses the same
 * {@link seedAgentToolIdentities} mechanism as the lead-engine identities.
 */
export async function seedProspectingAgentIdentities(db: Database): Promise<void> {
  await seedAgentToolIdentities(
    db,
    PROSPECTING_AGENT_TOOL_PERMISSION_PREFIX,
    (toolName) => `Prospecting agent permission for the ${toolName} catalog tool`,
    PROSPECTING_AGENT_IDENTITIES,
  );

  console.log("Prospecting agent identities seed complete.");
}
