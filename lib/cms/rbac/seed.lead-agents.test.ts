import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, DataType, type IMemoryDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * Unit tests for the S3 lead-engine agent-identity RBAC seed (task 3.1).
 *
 * Verifies that `seedRbac` seeds the three agent identities — `agent:lead-parse`,
 * `agent:lead-distribution`, `agent:lead-enrichment` — each granting EXACTLY its
 * catalog tool permissions and NO wildcard, resolved through the same engine
 * path the dispatcher uses (`loadUserRoles → resolvePermissions → hasPermission`).
 *
 * Requirements: 12.1, 12.2 (Design §Architecture — "Agent identities and RBAC").
 *
 * Harness: pg-mem with the four RBAC tables created inline. `user_roles.user_id`
 * is `text` so the agent actor strings link exactly as the dispatcher resolves
 * them — mirroring the sibling behavioural-parity harness.
 */

import * as schema from "../schema";
import type { Database } from "../db";
import { seedRbac, LEAD_AGENT_IDENTITIES, leadToolPermission } from "./seed";
import { loadUserRoles, resolvePermissions, hasPermission } from "./engine";

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

/** Resolve the deduplicated permission set the dispatcher would see for an actor. */
async function permissionsFor(db: Database, actor: string): Promise<string[]> {
  const roles = await loadUserRoles(db, actor);
  return resolvePermissions(db, roles);
}

describe("seedRbac — lead-engine agent identities (task 3.1)", () => {
  it("grants each agent exactly its catalog tool permissions", async () => {
    const { db } = buildDb();
    await seedRbac(db);

    for (const identity of LEAD_AGENT_IDENTITIES) {
      const perms = await permissionsFor(db, identity.actor);
      const expected = identity.tools.map((t) => leadToolPermission(t)).sort();
      expect(perms.slice().sort()).toEqual(expected);
    }
  });

  it("each agent can dispatch exactly its own tools and is denied the others", async () => {
    const { db } = buildDb();
    await seedRbac(db);

    for (const identity of LEAD_AGENT_IDENTITIES) {
      const perms = await permissionsFor(db, identity.actor);

      // Granted: every tool in its own grant.
      for (const tool of identity.tools) {
        expect(hasPermission(perms, leadToolPermission(tool))).toBe(true);
      }

      // Denied: every tool belonging to a different agent identity.
      for (const other of LEAD_AGENT_IDENTITIES) {
        if (other.actor === identity.actor) continue;
        for (const otherTool of other.tools) {
          if (identity.tools.includes(otherTool)) continue;
          expect(hasPermission(perms, leadToolPermission(otherTool))).toBe(false);
        }
      }
    }
  });

  it("holds no wildcard — neither global nor resource-level", async () => {
    const { db } = buildDb();
    await seedRbac(db);

    for (const identity of LEAD_AGENT_IDENTITIES) {
      const perms = await permissionsFor(db, identity.actor);
      expect(perms).not.toContain("*:*");
      expect(perms).not.toContain("lead:tool:*");
      expect(perms.some((p) => p.endsWith(":*"))).toBe(false);
      // A wildcard would have wrongly admitted an un-granted tool.
      expect(hasPermission(perms, leadToolPermission("not_a_real_tool"))).toBe(false);
    }
  });

  it("is idempotent — seeding twice yields the same grants and no duplicate links", async () => {
    const { db } = buildDb();
    await seedRbac(db);
    await seedRbac(db);

    for (const identity of LEAD_AGENT_IDENTITIES) {
      const roles = await loadUserRoles(db, identity.actor);
      // Exactly one role linked to the actor after repeated seeding.
      expect(roles.length).toBe(1);

      const perms = await resolvePermissions(db, roles);
      const expected = identity.tools.map((t) => leadToolPermission(t)).sort();
      expect(perms.slice().sort()).toEqual(expected);
    }
  });
});
