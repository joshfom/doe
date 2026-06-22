import { describe, it, expect } from "vitest";

import { hasPermission } from "../../rbac/engine";
import {
  AGENT_HOME_PERMISSIONS,
  HOME_TOOL_NAMES,
  HOME_EXECUTIVE_TOOL_NAMES,
  homeToolPermission,
} from "./home-capabilities";
import { EXECUTIVE_TOOL_NAMES } from "./executive-capabilities";

// ──────────────────────────────────────────────────────────────────────────────
// Feature: ai-prompt-helper-slash-commands, Property 14: Executive tools are
// denied to non-C-Level callers and return no data — the load-bearing static-
// grant exclusion. The full dispatcher denial path is exercised by the existing
// dispatch.permission.property.test harness; here we pin the invariant the gate
// rests on: the executive permissions are ABSENT from the agent's static grant,
// so authorization can only resolve through the requesting user's RBAC.
// ──────────────────────────────────────────────────────────────────────────────
describe("Property 14 — executive-tool gate", () => {
  it("the executive tools are bound (present in HOME_TOOL_NAMES)", () => {
    for (const name of EXECUTIVE_TOOL_NAMES) {
      expect(HOME_TOOL_NAMES).toContain(name);
    }
    expect(new Set(HOME_EXECUTIVE_TOOL_NAMES)).toEqual(
      new Set(EXECUTIVE_TOOL_NAMES),
    );
  });

  it("executive permissions are EXCLUDED from the agent's static grant", () => {
    for (const name of EXECUTIVE_TOOL_NAMES) {
      expect(AGENT_HOME_PERMISSIONS.has(homeToolPermission(name))).toBe(false);
    }
  });

  it("non-executive home tools remain in the agent grant (no collateral damage)", () => {
    // e.g. the live-CRM analytics + platform knowledge + stack tools.
    for (const name of ["get_crm_analytics", "get_platform_knowledge", "list_stack"]) {
      expect(AGENT_HOME_PERMISSIONS.has(homeToolPermission(name))).toBe(true);
    }
  });

  it("a C-Level grant (home:*) authorizes; a non-C-Level grant is denied", () => {
    for (const name of EXECUTIVE_TOOL_NAMES) {
      const perm = homeToolPermission(name);
      // c_level holds home:*; super_admin holds *:*.
      expect(hasPermission(["home:*"], perm)).toBe(true);
      expect(hasPermission(["*:*"], perm)).toBe(true);
      // A non-C-Level user (only unrelated perms) is denied.
      expect(hasPermission(["leads:read", "tickets:read"], perm)).toBe(false);
    }
  });
});
