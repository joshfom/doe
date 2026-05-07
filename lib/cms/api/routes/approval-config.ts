import { Elysia } from "elysia";
import { eq, inArray, asc } from "drizzle-orm";
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

    // Fetch approvers for each config, sorted by position
    const result = await Promise.all(
      configs.map(async (config) => {
        const approvers = await db
          .select({
            id: approvalConfigApprovers.id,
            userId: approvalConfigApprovers.userId,
            userName: users.name,
            userEmail: users.email,
            position: approvalConfigApprovers.position,
          })
          .from(approvalConfigApprovers)
          .innerJoin(users, eq(approvalConfigApprovers.userId, users.id))
          .where(eq(approvalConfigApprovers.configId, config.id))
          .orderBy(asc(approvalConfigApprovers.position));

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
    const { enabled, approverIds, approvers } = body as {
      enabled?: boolean;
      approverIds?: string[];
      approvers?: { userId: string; position: number }[];
    };

    // Validate module against ContentModule enum
    if (!VALID_MODULES.includes(moduleName as ContentModule)) {
      set.status = 400;
      return { error: `Invalid module: ${moduleName}. Must be one of: ${VALID_MODULES.join(", ")}` };
    }

    const contentModule = moduleName as ContentModule;

    // Determine the effective approver list — prefer `approvers` (with positions) over legacy `approverIds`
    let effectiveApprovers: { userId: string; position: number }[] | undefined;

    if (approvers && approvers.length > 0) {
      // Validate: check for duplicate positions
      const positions = approvers.map((a) => a.position);
      const uniquePositions = new Set(positions);
      if (uniquePositions.size !== positions.length) {
        set.status = 400;
        return { error: "Positions must be unique and contiguous" };
      }

      // Normalize positions: sort by provided position, then assign contiguous 1-based integers
      const sorted = [...approvers].sort((a, b) => a.position - b.position);
      effectiveApprovers = sorted.map((a, idx) => ({
        userId: a.userId,
        position: idx + 1,
      }));
    } else if (approverIds && approverIds.length > 0) {
      // Legacy format: assign positions based on array order
      effectiveApprovers = approverIds.map((userId, idx) => ({
        userId,
        position: idx + 1,
      }));
    }

    // Validate non-empty approver list when enabling
    if (enabled === true && (!effectiveApprovers || effectiveApprovers.length === 0)) {
      set.status = 400;
      return { error: "At least one approver is required when enabling approval" };
    }

    // Validate approver user IDs exist in users table
    if (effectiveApprovers && effectiveApprovers.length > 0) {
      const userIds = effectiveApprovers.map((a) => a.userId);
      const existingUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, userIds));

      const existingIds = new Set(existingUsers.map((u) => u.id));
      const invalidIds = userIds.filter((id) => !existingIds.has(id));

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
    if (effectiveApprovers) {
      // Remove existing approvers
      await db
        .delete(approvalConfigApprovers)
        .where(eq(approvalConfigApprovers.configId, configId));

      // Insert new approvers with positions
      if (effectiveApprovers.length > 0) {
        await db.insert(approvalConfigApprovers).values(
          effectiveApprovers.map((a) => ({
            configId,
            userId: a.userId,
            position: a.position,
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

    // Return updated config with approvers sorted by position
    const [updatedConfig] = await db
      .select()
      .from(approvalConfig)
      .where(eq(approvalConfig.id, configId))
      .limit(1);

    const returnedApprovers = await db
      .select({
        id: approvalConfigApprovers.id,
        userId: approvalConfigApprovers.userId,
        userName: users.name,
        userEmail: users.email,
        position: approvalConfigApprovers.position,
      })
      .from(approvalConfigApprovers)
      .innerJoin(users, eq(approvalConfigApprovers.userId, users.id))
      .where(eq(approvalConfigApprovers.configId, configId))
      .orderBy(asc(approvalConfigApprovers.position));

    return { data: { ...updatedConfig, approvers: returnedApprovers } };
  });
