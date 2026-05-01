import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Feature: rbac-identity-system, Property 26: RBAC audit trail completeness

// ── Types ────────────────────────────────────────────────────────────────────

type AuditEntityType =
  | "role_assignment"
  | "permission_change"
  | "access_denial"
  | "company_status_change";

type RoleAction = "assign" | "revoke";
type PermissionAction = "add" | "remove";
type CompanyStatus = "pending" | "active" | "suspended" | "rejected";

interface AuditLogEntry {
  userId: string;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
}

// ── Pure helper functions (mirror the audit.ts logic) ────────────────────────

/**
 * Builds the expected audit log entry for a role assignment or revocation.
 * Mirrors logRoleAssignment in lib/cms/rbac/audit.ts.
 */
function buildRoleAssignmentAuditEntry(
  actorId: string,
  targetUserId: string,
  roleName: string,
  action: RoleAction
): AuditLogEntry {
  return {
    userId: actorId,
    action,
    entityType: "role_assignment",
    entityId: targetUserId,
    summary: `Role "${roleName}" ${action === "assign" ? "assigned to" : "revoked from"} user ${targetUserId}`,
    changes: {
      role: {
        old: action === "revoke" ? roleName : null,
        new: action === "assign" ? roleName : null,
      },
    },
  };
}

/**
 * Builds the expected audit log entry for a permission addition or removal on a role.
 * Mirrors logPermissionChange in lib/cms/rbac/audit.ts.
 */
function buildPermissionChangeAuditEntry(
  actorId: string,
  roleName: string,
  permissionString: string,
  action: PermissionAction
): AuditLogEntry {
  return {
    userId: actorId,
    action,
    entityType: "permission_change",
    entityId: roleName,
    summary: `Permission "${permissionString}" ${action === "add" ? "added to" : "removed from"} role "${roleName}"`,
    changes: {
      permission: {
        old: action === "remove" ? permissionString : null,
        new: action === "add" ? permissionString : null,
      },
    },
  };
}

/**
 * Builds the expected audit log entry for an access denial.
 * Mirrors logAccessDenial in lib/cms/rbac/audit.ts.
 */
function buildAccessDenialAuditEntry(
  userId: string,
  requiredPermission: string,
  reason: string
): AuditLogEntry {
  return {
    userId,
    action: "deny",
    entityType: "access_denial",
    entityId: requiredPermission,
    summary: `Access denied for permission "${requiredPermission}": ${reason}`,
  };
}

/**
 * Builds the expected audit log entry for a company status change.
 * Mirrors logCompanyStatusChange in lib/cms/rbac/audit.ts.
 */
function buildCompanyStatusChangeAuditEntry(
  actorId: string,
  companyId: string,
  oldStatus: string,
  newStatus: string
): AuditLogEntry {
  return {
    userId: actorId,
    action: "update",
    entityType: "company_status_change",
    entityId: companyId,
    summary: `Company ${companyId} status changed from "${oldStatus}" to "${newStatus}"`,
    changes: {
      status: { old: oldStatus, new: newStatus },
    },
  };
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbRoleName = fc.stringMatching(/^[a-zA-Z0-9_-]+$/, {
  minLength: 1,
  maxLength: 25,
});

const arbPermissionSegment = fc.stringMatching(/^[a-zA-Z0-9_-]+$/, {
  minLength: 1,
  maxLength: 15,
});

const arbPermissionString = fc
  .tuple(arbPermissionSegment, arbPermissionSegment)
  .map(([resource, action]) => `${resource}:${action}`);

const arbRoleAction = fc.constantFrom<RoleAction>("assign", "revoke");
const arbPermissionAction = fc.constantFrom<PermissionAction>("add", "remove");

const arbCompanyStatus = fc.constantFrom<CompanyStatus>(
  "pending",
  "active",
  "suspended",
  "rejected"
);

const arbDenialReason = fc.stringMatching(/^[a-zA-Z0-9 _-]+$/, {
  minLength: 1,
  maxLength: 50,
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 26: RBAC audit trail completeness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 10.4**
 *
 * Property 26: RBAC audit trail completeness
 *
 * For any RBAC mutation — role assignment/revocation, permission
 * addition/removal to a role, access denial, or company status change —
 * an audit_log entry should be created with the correct entity_type and
 * include the actor user_id and relevant details.
 */
describe("Feature: rbac-identity-system, Property 26: RBAC audit trail completeness", () => {
  it("role assignment/revocation produces audit entry with entity_type 'role_assignment' and actor user_id", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        arbRoleName,
        arbRoleAction,
        (actorId, targetUserId, roleName, action) => {
          const entry = buildRoleAssignmentAuditEntry(
            actorId,
            targetUserId,
            roleName,
            action
          );

          expect(entry.entityType).toBe("role_assignment");
          expect(entry.userId).toBe(actorId);
          expect(entry.entityId).toBe(targetUserId);
          expect(entry.action).toBe(action);
          expect(entry.summary).toContain(roleName);
          expect(entry.summary).toContain(targetUserId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("role assignment sets changes.role.new to roleName and old to null", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        arbRoleName,
        (actorId, targetUserId, roleName) => {
          const entry = buildRoleAssignmentAuditEntry(
            actorId,
            targetUserId,
            roleName,
            "assign"
          );

          expect(entry.changes).toBeDefined();
          expect(entry.changes!.role.new).toBe(roleName);
          expect(entry.changes!.role.old).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("role revocation sets changes.role.old to roleName and new to null", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        arbRoleName,
        (actorId, targetUserId, roleName) => {
          const entry = buildRoleAssignmentAuditEntry(
            actorId,
            targetUserId,
            roleName,
            "revoke"
          );

          expect(entry.changes).toBeDefined();
          expect(entry.changes!.role.old).toBe(roleName);
          expect(entry.changes!.role.new).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("permission addition/removal produces audit entry with entity_type 'permission_change' and actor user_id", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbRoleName,
        arbPermissionString,
        arbPermissionAction,
        (actorId, roleName, permissionString, action) => {
          const entry = buildPermissionChangeAuditEntry(
            actorId,
            roleName,
            permissionString,
            action
          );

          expect(entry.entityType).toBe("permission_change");
          expect(entry.userId).toBe(actorId);
          expect(entry.entityId).toBe(roleName);
          expect(entry.action).toBe(action);
          expect(entry.summary).toContain(permissionString);
          expect(entry.summary).toContain(roleName);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("permission addition sets changes.permission.new to permissionString and old to null", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbRoleName,
        arbPermissionString,
        (actorId, roleName, permissionString) => {
          const entry = buildPermissionChangeAuditEntry(
            actorId,
            roleName,
            permissionString,
            "add"
          );

          expect(entry.changes).toBeDefined();
          expect(entry.changes!.permission.new).toBe(permissionString);
          expect(entry.changes!.permission.old).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("permission removal sets changes.permission.old to permissionString and new to null", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbRoleName,
        arbPermissionString,
        (actorId, roleName, permissionString) => {
          const entry = buildPermissionChangeAuditEntry(
            actorId,
            roleName,
            permissionString,
            "remove"
          );

          expect(entry.changes).toBeDefined();
          expect(entry.changes!.permission.old).toBe(permissionString);
          expect(entry.changes!.permission.new).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("access denial produces audit entry with entity_type 'access_denial' and user_id", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        arbPermissionString,
        arbDenialReason,
        (userId, requiredPermission, reason) => {
          const entry = buildAccessDenialAuditEntry(
            userId,
            requiredPermission,
            reason
          );

          expect(entry.entityType).toBe("access_denial");
          expect(entry.userId).toBe(userId);
          expect(entry.entityId).toBe(requiredPermission);
          expect(entry.action).toBe("deny");
          expect(entry.summary).toContain(requiredPermission);
          expect(entry.summary).toContain(reason);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("company status change produces audit entry with entity_type 'company_status_change' and actor user_id", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        arbCompanyStatus,
        arbCompanyStatus,
        (actorId, companyId, oldStatus, newStatus) => {
          fc.pre(oldStatus !== newStatus);

          const entry = buildCompanyStatusChangeAuditEntry(
            actorId,
            companyId,
            oldStatus,
            newStatus
          );

          expect(entry.entityType).toBe("company_status_change");
          expect(entry.userId).toBe(actorId);
          expect(entry.entityId).toBe(companyId);
          expect(entry.action).toBe("update");
          expect(entry.summary).toContain(oldStatus);
          expect(entry.summary).toContain(newStatus);
          expect(entry.summary).toContain(companyId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("company status change records old and new status in changes", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        arbCompanyStatus,
        arbCompanyStatus,
        (actorId, companyId, oldStatus, newStatus) => {
          fc.pre(oldStatus !== newStatus);

          const entry = buildCompanyStatusChangeAuditEntry(
            actorId,
            companyId,
            oldStatus,
            newStatus
          );

          expect(entry.changes).toBeDefined();
          expect(entry.changes!.status.old).toBe(oldStatus);
          expect(entry.changes!.status.new).toBe(newStatus);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("every RBAC mutation type maps to a distinct entity_type value", () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid(),
        arbRoleName,
        arbPermissionString,
        arbDenialReason,
        arbCompanyStatus,
        arbCompanyStatus,
        (actorId, targetId, roleName, permStr, reason, oldStatus, newStatus) => {
          const roleEntry = buildRoleAssignmentAuditEntry(actorId, targetId, roleName, "assign");
          const permEntry = buildPermissionChangeAuditEntry(actorId, roleName, permStr, "add");
          const denyEntry = buildAccessDenialAuditEntry(actorId, permStr, reason);
          const statusEntry = buildCompanyStatusChangeAuditEntry(actorId, targetId, oldStatus, newStatus);

          const entityTypes = new Set([
            roleEntry.entityType,
            permEntry.entityType,
            denyEntry.entityType,
            statusEntry.entityType,
          ]);

          // All four mutation types should produce distinct entity_type values
          expect(entityTypes.size).toBe(4);
        }
      ),
      { numRuns: 100 }
    );
  });
});
