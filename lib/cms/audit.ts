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
  // Audit is best-effort: a failed insert (e.g. FK violation when the
  // synthetic system user is not seeded, transient DB error, etc.) MUST NOT
  // break the calling business operation. We log and swallow.
  try {
    await db.insert(auditLog).values({
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      changes: entry.changes ?? null,
    });
  } catch (err) {
    console.error("[audit] logAudit insert failed (non-fatal)", {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
