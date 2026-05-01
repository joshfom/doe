import type { Database } from "../db";
import { logAudit } from "../audit";

/**
 * Log a role assignment or revocation event.
 */
export async function logRoleAssignment(
  db: Database,
  actorId: string,
  targetUserId: string,
  roleName: string,
  action: "assign" | "revoke"
): Promise<void> {
  await logAudit(db, {
    userId: actorId,
    action,
    entityType: "role_assignment",
    entityId: targetUserId,
    summary: `Role "${roleName}" ${action === "assign" ? "assigned to" : "revoked from"} user ${targetUserId}`,
    changes: {
      role: { old: action === "revoke" ? roleName : null, new: action === "assign" ? roleName : null },
    },
  });
}

/**
 * Log a permission addition or removal on a role.
 */
export async function logPermissionChange(
  db: Database,
  actorId: string,
  roleName: string,
  permissionString: string,
  action: "add" | "remove"
): Promise<void> {
  await logAudit(db, {
    userId: actorId,
    action,
    entityType: "permission_change",
    entityId: roleName,
    summary: `Permission "${permissionString}" ${action === "add" ? "added to" : "removed from"} role "${roleName}"`,
    changes: {
      permission: { old: action === "remove" ? permissionString : null, new: action === "add" ? permissionString : null },
    },
  });
}

/**
 * Log an access denial event from the middleware.
 */
export async function logAccessDenial(
  db: Database,
  userId: string,
  requiredPermission: string,
  reason: string
): Promise<void> {
  await logAudit(db, {
    userId,
    action: "deny",
    entityType: "access_denial",
    entityId: requiredPermission,
    summary: `Access denied for permission "${requiredPermission}": ${reason}`,
  });
}

/**
 * Log a broker company status change.
 */
export async function logCompanyStatusChange(
  db: Database,
  actorId: string,
  companyId: string,
  oldStatus: string,
  newStatus: string
): Promise<void> {
  await logAudit(db, {
    userId: actorId,
    action: "update",
    entityType: "company_status_change",
    entityId: companyId,
    summary: `Company ${companyId} status changed from "${oldStatus}" to "${newStatus}"`,
    changes: {
      status: { old: oldStatus, new: newStatus },
    },
  });
}
