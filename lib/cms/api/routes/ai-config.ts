import { Elysia } from "elysia";
import { z } from "zod";
import { db } from "../../db";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import { aiConfig } from "../../schema";
import { eq, sql } from "drizzle-orm";

// ── Request validation schema ────────────────────────────────────────────────

const updateConfigSchema = z.record(z.string(), z.string());

// ── Config routes (auth required) ────────────────────────────────────────────

export const aiConfigRoutes = new Elysia({ name: "ai-config" })
  .use(identityGuard)
  .use(requirePermission("ai:config:manage"))

  // GET /ai/config — returns all AI configuration parameters
  .get("/ai/config", async () => {
    const rows = await db.select().from(aiConfig);

    const config: Record<string, string> = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }

    return { data: config };
  })

  // PUT /ai/config — update configuration parameters (upsert pattern)
  .put("/ai/config", async ({ body, set }) => {
    const parsed = updateConfigSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid configuration format. Expected key-value pairs." };
    }

    const entries = parsed.data;

    for (const [key, value] of Object.entries(entries)) {
      // Upsert: insert on conflict update
      await db
        .insert(aiConfig)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: aiConfig.key,
          set: { value, updatedAt: new Date() },
        });
    }

    // Return updated config
    const rows = await db.select().from(aiConfig);
    const config: Record<string, string> = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }

    return { data: config };
  });

export default aiConfigRoutes;
