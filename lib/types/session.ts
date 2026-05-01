/**
 * Frontend types for the enhanced session response from /api/auth/session.
 * Mirrors the backend EnhancedSessionResponse shape defined in the RBAC design.
 */

export type UserType = "employee" | "broker" | "client" | "vendor";

export interface BrokerContext {
  companyId: string;
  companyName: string;
  companyStatus: string;
  isCompanyAdmin: boolean;
  profileStatus: string;
}

export interface SessionData {
  userId: string;
  email: string;
  name: string;
  userType: UserType;
  isActive: boolean;
  emailVerified: boolean;
  roles: string[];
  permissions: string[];
  broker?: BrokerContext;
}
