import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * Unit tests for the S7 prospecting-workspace agent-identity RBAC seed (task 3.1).
 *
 * Verifies that `seedRbac` seeds the two agent identities — `agent:prospecting`
 * and `agent:outreach` — each granting EXACTLY its catalog tool permissions and
 * NO wildcard, and that `send_outreach` is grantable to NEITHER (the send is
 * human-gated by an Approval_Flow token).
 *
 * Requirements: 8.1 (Design §Architecture — "Agent identities and RBAC").
 *
 * The agent actors are non-uuid strings (`agent:prospecting`) and the production
 * `user_roles.user_id` is a uuid FK, so the seed deliberately does not link them
 * via `user_roles` (the dispatcher resolves them in-process). These tests
 * therefore resolve each identity's grant directly from its seeded role through
 * the same engine path (`resolvePermissions`/`hasPermission`) the dispatcher uses.
 */

import * as schema from "../schema";
import { roles } from "../schema";
import type { Database } from "../db";
import {
  seedRbac,
  PROSPECTING_AGENT_IDENTITIES,
  prospectingToolPermission,
} from "./seed";
import { resolvePermissions, hasPermission, type Role } from "./engine";

const RBAC_TABLES_SQL = `
  CREATE TABLE "roles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "display_name" text NOT NULL,
    "description" text,
    "user_type" text NOT NULL,
    "is_system" boolean NOT NULL DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE TABLE "permissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "resource" text NOT NULL,
    "action" text NOT NULL,
    "description" text
  );
  CREATE TABLE "role_permissions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "role_id" uuid NOT NULL,
    "permission_id" uuid NOT NULL
  );
  CREATE TABLE "user_roles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text NOT NULL,
    "role_id" uuid NOT NULL,
    "granted_by" uuid,
    "granted_at" timestamp DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "roles_name_user_type_idx" ON "roles" ("name","user_type");
  CREATE UNIQUE INDEX "permissions_resource_action_idx" ON "permissions" ("resource","action");
  CREATE UNIQUE INDEX "role_permissions_unique_idx" ON "role_permissions" ("role_id","permission_id");
  CREATE UNIQUE INDEX "user_roles_unique_idx" ON "user_roles" ("user_id","role_id");
`;

function buildDb(): { mem: IMemoryDb; db: Database } {
  const mem = newDb();

  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  mem.public.none(RBAC_TABLES_SQL);

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  // pg-mem's node-postgres adapter rejects `types.getTypeParser` and
  // `rowMode: "array"`; strip both, mirroring the sibling RBAC/dispatch tests.
  const originalQuery = pool.query.bind(pool);
  pool.query = (config: unknown, values?: unknown, cb?: unknown) => {
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      const wantArray = cfg.rowMode === "array";
      const clean = { ...cfg };
      delete clean.rowMode;
      delete clean.types;
      const result = originalQuery(clean, values, cb);
      if (
        wantArray &&
        result &&
        typeof (result as Promise<unknown>).then === "function"
      ) {
        return (result as Promise<{ rows: Record<string, unknown>[] }>).then(
          (r) => ({ ...r, rows: r.rows.map((row) => Object.values(row)) })
        );
      }
      return result;
    }
    return originalQuery(config, values, cb);
  };

  const db = drizzle(pool, { schema }) as unknown as Database;
  return { mem, db };
}

/** All role rows seeded for a given role name (across user types). */
async function rolesByName(db: Database, name: string): Promise<Role[]> {
  return db.select().from(roles).where(eq(roles.name, name));
}

/** Resolve the deduplicated permission set granted by the named seeded role. */
async function permissionsForRole(db: Database, roleName: string): Promise<string[]> {
  const found = await rolesByName(db, roleName);
  return resolvePermissions(db, found);
}

describe("seedRbac — prospecting-workspace agent identities (task 3.1)", () => {
  it("grants each agent exactly its catalog tool permissions", async () => {
    const { db } = buildDb();
    await seedRbac(db);

    for (const identity of PROSPECTING_AGENT_IDENTITIES) {
      const perms = await permissionsForRole(db, identity.roleName);
      const expected = identity.tools.map((t) => prospectingToolPermission(t)).sort();
      expect(perms.slice().sort()).toEqual(expected);
    }
  });

  it("each agent can dispatch exactly its own tools and is denied the others", async () => {
    const { db } = buildDb();
    await seedRbac(db);

    for (const identity of PROSPECTING_AGENT_IDENTITIES) {
      const perms = await permissionsForRole(db, identity.roleName);

      // Granted: every tool in its own grant.
      for (const tool of identity.tools) {
        expect(hasPermission(perms, prospectingToolPermission(tool))).toBe(true);
      }

      // Denied: every tool belonging to a different prospecting identity.
      for (const other of PROSPECTING_AGENT_IDENTITIES) {
        if (other.roleName === identity.roleName) continue;
        for (const otherTool of other.tools) {
          if (identity.tools.includes(otherTool)) continue;
          expect(hasPermission(perms, prospectingToolPermission(otherTool))).toBe(false);
        }
      }
    }
  });

  it("grants send_outreach to neither agent — it is human-gated, never agent-grantable", async () => {
    const { db } = buildDb();
    await seedRbac(db);

    const sendPerm = prospectingToolPermission("send_outreach");
    for (const identity of PROSPECTING_AGENT_IDENTITIES) {
      const perms = await permissionsForRole(db, identity.roleName);
      expect(perms).not.toContain(sendPerm);
      expect(hasPermission(perms, sendPerm)).toBe(false);
    }
  });

  it("holds no wildcard — neither global nor resource-level", async () => {
    const { db } = buildDb();
    await seedRbac(db);

    for (const identity of PROSPECTING_AGENT_IDENTITIES) {
      const perms = await permissionsForRole(db, identity.roleName);
      expect(perms).not.toContain("*:*");
      expect(perms).not.toContain("prospecting:tool:*");
      expect(perms.some((p) => p.endsWith(":*"))).toBe(false);
      // A wildcard would have wrongly admitted an un-granted tool.
      expect(hasPermission(perms, prospectingToolPermission("not_a_real_tool"))).toBe(false);
    }
  });

  it("is idempotent — seeding twice yields the same grants and one role per identity", async () => {
    const { db } = buildDb();
    await seedRbac(db);
    await seedRbac(db);

    for (const identity of PROSPECTING_AGENT_IDENTITIES) {
      // Exactly one role row per identity name after repeated seeding.
      const found = await rolesByName(db, identity.roleName);
      expect(found.length).toBe(1);

      const perms = await resolvePermissions(db, found);
      const expected = identity.tools.map((t) => prospectingToolPermission(t)).sort();
      expect(perms.slice().sort()).toEqual(expected);
    }
  });
});
