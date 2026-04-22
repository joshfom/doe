import type { AuditAction, AuditEntityType } from "./types";
import type { Database } from "./db";
import { auditLog } from "./schema";

export interface AuditLogEntry {
  userId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
}

export async function logAudit(
  db: Database,
  entry: AuditLogEntry
): Promise<void> {
  await db.insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary,
    changes: entry.changes ?? null,
  });
}
