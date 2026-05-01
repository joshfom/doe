import { describe, it, expect } from "vitest";
import {
  isValidUserType,
  isValidPermissionString,
  hasPermission,
} from "./engine";

describe("isValidUserType", () => {
  it("accepts the four valid user types", () => {
    expect(isValidUserType("employee")).toBe(true);
    expect(isValidUserType("broker")).toBe(true);
    expect(isValidUserType("client")).toBe(true);
    expect(isValidUserType("vendor")).toBe(true);
  });

  it("rejects invalid user types", () => {
    expect(isValidUserType("")).toBe(false);
    expect(isValidUserType("admin")).toBe(false);
    expect(isValidUserType("Employee")).toBe(false);
    expect(isValidUserType("BROKER")).toBe(false);
    expect(isValidUserType("user")).toBe(false);
  });
});

describe("isValidPermissionString", () => {
  it("accepts valid resource:action strings", () => {
    expect(isValidPermissionString("pages:publish")).toBe(true);
    expect(isValidPermissionString("brokers:manage")).toBe(true);
    expect(isValidPermissionString("pages:*")).toBe(false); // * is not alphanumeric
    expect(isValidPermissionString("blog-posts:read")).toBe(true);
    expect(isValidPermissionString("my_resource:my_action")).toBe(true);
  });

  it("rejects invalid permission strings", () => {
    expect(isValidPermissionString("")).toBe(false);
    expect(isValidPermissionString(":")).toBe(false);
    expect(isValidPermissionString("pages:")).toBe(false);
    expect(isValidPermissionString(":action")).toBe(false);
    expect(isValidPermissionString("pages:action:extra")).toBe(false);
    expect(isValidPermissionString("nocolon")).toBe(false);
    expect(isValidPermissionString("has space:action")).toBe(false);
  });
});

describe("hasPermission", () => {
  it("returns true for exact match", () => {
    expect(hasPermission(["pages:publish", "blog:read"], "pages:publish")).toBe(true);
  });

  it("returns true for wildcard match", () => {
    expect(hasPermission(["pages:*"], "pages:publish")).toBe(true);
    expect(hasPermission(["pages:*"], "pages:delete")).toBe(true);
  });

  it("returns false when permission is missing", () => {
    expect(hasPermission(["blog:read"], "pages:publish")).toBe(false);
    expect(hasPermission([], "pages:publish")).toBe(false);
  });

  it("wildcard does not cross resources", () => {
    expect(hasPermission(["blog:*"], "pages:publish")).toBe(false);
  });

  it("handles malformed required string gracefully", () => {
    expect(hasPermission(["pages:publish"], "nocolon")).toBe(false);
  });
});
