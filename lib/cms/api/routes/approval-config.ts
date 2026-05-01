import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";
import { authGuard } from "../auth";
import { approvalConfig, approvalConfigApprovers, users } from "../../schema";
import { db } from "../../db";
import type { ContentModule } from "../../types";
import { autoResolvePendingRequests } from "../../approval/service";

const VALID_MODULES: ContentModule[] = [
  "pages",
  "blog",
  "news",
  "construction_updates",
];

// ── Authenticated routes ─────────────────────────────────────────────────────

export const approvalConfigRoutes = new Elysia({ name: "approval-config" })
  .use(authGuard)

  // GET /approval-config — return all module configs with assigned approvers
  .get("/approval-config", async () => {
    const configs = await db.select().from(approvalConfig);

    // Fetch approvers for each config
    const result = await Promise.all(
      configs.map(async (config) => {
        const approvers = await db
          .select({
            id: approvalConfigApprovers.id,
            userId: approvalConfigApprovers.userId,
            userName: users.name,
            userEmail: users.email,
          })
          .from(approvalConfigApprovers)
          .innerJoin(users, eq(approvalConfigApprovers.userId, users.id))
          .where(eq(approvalConfigApprovers.configId, config.id));

        return {
          ...config,
          approvers,
        };
      })
    );

    return { data: result };
  })

  // PUT /approval-config/:module — update toggle + approvers for a module
  .put("/approval-config/:module", async ({ params, body, set }) => {
    const { module: moduleName } = params;
    const { enabled, approverIds } = body as {
      enabled?: boolean;
      approverIds?: string[];
    };

    // Validate module against ContentModule enum
    if (!VALID_MODULES.includes(moduleName as ContentModule)) {
      set.status = 400;
      return { error: `Invalid module: ${moduleName}. Must be one of: ${VALID_MODULES.join(", ")}` };
    }

    const contentModule = moduleName as ContentModule;

    // Validate non-empty approver list when enabling
    if (enabled === true && (!approverIds || approverIds.length === 0)) {
      set.status = 400;
      return { error: "At least one approver is required when enabling approval" };
    }

    // Validate approver user IDs exist in users table
    if (approverIds && approverIds.length > 0) {
      const existingUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, approverIds));

      const existingIds = new Set(existingUsers.map((u) => u.id));
      const invalidIds = approverIds.filter((id) => !existingIds.has(id));

      if (invalidIds.length > 0) {
        set.status = 400;
        return { error: `Invalid approver IDs: ${invalidIds.join(", ")}` };
      }
    }

    // Upsert the config row
    const [existing] = await db
      .select()
      .from(approvalConfig)
      .where(eq(approvalConfig.contentModule, contentModule))
      .limit(1);

    let configId: string;

    if (existing) {
      await db
        .update(approvalConfig)
        .set({
          enabled: enabled ?? existing.enabled,
          updatedAt: new Date(),
        })
        .where(eq(approvalConfig.id, existing.id));
      configId = existing.id;
    } else {
      const [created] = await db
        .insert(approvalConfig)
        .values({
          contentModule,
          enabled: enabled ?? false,
        })
        .returning();
      configId = created.id;
    }

    // Update approvers if provided
    if (approverIds) {
      // Remove existing approvers
      await db
        .delete(approvalConfigApprovers)
        .where(eq(approvalConfigApprovers.configId, configId));

      // Insert new approvers
      if (approverIds.length > 0) {
        await db.insert(approvalConfigApprovers).values(
          approverIds.map((userId) => ({
            configId,
            userId,
          }))
        );
      }
    }

    // When disabling: auto-resolve pending requests
    const wasEnabled = existing?.enabled ?? false;
    const isNowDisabled = enabled === false;

    if (wasEnabled && isNowDisabled) {
      await autoResolvePendingRequests(db, contentModule);
    }

    // Return updated config with approvers
    const [updatedConfig] = await db
      .select()
      .from(approvalConfig)
      .where(eq(approvalConfig.id, configId))
      .limit(1);

    const approvers = await db
      .select({
        id: approvalConfigApprovers.id,
        userId: approvalConfigApprovers.userId,
        userName: users.name,
        userEmail: users.email,
      })
      .from(approvalConfigApprovers)
      .innerJoin(users, eq(approvalConfigApprovers.userId, users.id))
      .where(eq(approvalConfigApprovers.configId, configId));

    return { data: { ...updatedConfig, approvers } };
  });
