import { Elysia } from "elysia";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { auditLog } from "../../schema";
import { db } from "../../db";

export const auditRoutes = new Elysia({ name: "audit" })
  // GET /audit — List audit entries in reverse chronological order with optional filters
  .get("/audit", async ({ query }) => {
    const { entityType, action, userId, startDate, endDate } = query as {
      entityType?: string;
      action?: string;
      userId?: string;
      startDate?: string;
      endDate?: string;
    };

    const conditions: SQL[] = [];

    if (entityType) {
      conditions.push(eq(auditLog.entityType, entityType));
    }

    if (action) {
      conditions.push(eq(auditLog.action, action));
    }

    if (userId) {
      conditions.push(eq(auditLog.userId, userId));
    }

    if (startDate) {
      conditions.push(gte(auditLog.createdAt, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(auditLog.createdAt, new Date(endDate)));
    }

    const rows = await db
      .select()
      .from(auditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt));

    return { data: rows };
  });
