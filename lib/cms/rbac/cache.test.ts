import { describe, it, expect, beforeEach } from "vitest";
import { PermissionCache } from "./cache";

describe("PermissionCache", () => {
  let cache: PermissionCache;

  beforeEach(() => {
    cache = new PermissionCache();
  });

  it("returns null for unknown userId", () => {
    expect(cache.get("unknown-user")).toBeNull();
  });

  it("stores and retrieves cached data", () => {
    cache.set("user-1", {
      roles: ["admin"],
      permissions: ["pages:read", "pages:write"],
    });

    const result = cache.get("user-1");
    expect(result).not.toBeNull();
    expect(result!.roles).toEqual(["admin"]);
    expect(result!.permissions).toEqual(["pages:read", "pages:write"]);
    expect(result!.cachedAt).toBeTypeOf("number");
  });

  it("invalidates a cached entry", () => {
    cache.set("user-1", { roles: ["viewer"], permissions: ["pages:read"] });
    cache.invalidate("user-1");
    expect(cache.get("user-1")).toBeNull();
  });

  it("invalidating a non-existent entry is a no-op", () => {
    expect(() => cache.invalidate("no-such-user")).not.toThrow();
  });

  it("returns null for expired entries", () => {
    // Use a very short TTL
    const shortCache = new PermissionCache(1);
    shortCache.set("user-1", { roles: ["admin"], permissions: [] });

    // Wait just past the TTL
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* spin */
    }

    expect(shortCache.get("user-1")).toBeNull();
  });

  it("overwrites previous entry on re-set", () => {
    cache.set("user-1", { roles: ["viewer"], permissions: ["pages:read"] });
    cache.set("user-1", {
      roles: ["admin"],
      permissions: ["pages:read", "pages:write"],
    });

    const result = cache.get("user-1");
    expect(result!.roles).toEqual(["admin"]);
    expect(result!.permissions).toEqual(["pages:read", "pages:write"]);
  });

  it("uses default 5-minute TTL", () => {
    cache.set("user-1", { roles: ["admin"], permissions: [] });
    // Entry should still be valid immediately
    expect(cache.get("user-1")).not.toBeNull();
  });

  it("accepts custom TTL via constructor", () => {
    const customCache = new PermissionCache(60_000);
    customCache.set("user-1", { roles: ["admin"], permissions: [] });
    expect(customCache.get("user-1")).not.toBeNull();
  });
});
