import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockShutdown = vi.fn().mockResolvedValue(undefined);
const mockConstructor = vi.fn();

vi.mock("posthog-node", () => {
  return {
    PostHog: class MockPostHog {
      constructor(...args: unknown[]) {
        mockConstructor(...args);
      }
      shutdown = mockShutdown;
    },
  };
});

describe("getPostHogServer", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    mockConstructor.mockClear();
    mockShutdown.mockClear();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null when NEXT_PUBLIC_POSTHOG_KEY is not set", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const { getPostHogServer } = await import("./posthog-server");
    expect(getPostHogServer()).toBeNull();
  });

  it("returns null when NEXT_PUBLIC_POSTHOG_KEY is empty string", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "";
    const { getPostHogServer } = await import("./posthog-server");
    expect(getPostHogServer()).toBeNull();
  });

  it("returns a PostHog instance when key is set", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test123";
    const { getPostHogServer } = await import("./posthog-server");
    const client = getPostHogServer();
    expect(client).not.toBeNull();
  });

  it("returns the same singleton instance on subsequent calls", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test123";
    const { getPostHogServer } = await import("./posthog-server");
    const first = getPostHogServer();
    const second = getPostHogServer();
    expect(first).toBe(second);
  });

  it("uses EU host by default", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test123";
    delete process.env.POSTHOG_HOST;
    const { getPostHogServer } = await import("./posthog-server");
    getPostHogServer();
    expect(mockConstructor).toHaveBeenCalledWith("phc_test123", {
      host: "https://eu.i.posthog.com",
      flushAt: 20,
      flushInterval: 10000,
    });
  });

  it("uses POSTHOG_HOST env var when set", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test123";
    process.env.POSTHOG_HOST = "https://custom.posthog.com";
    const { getPostHogServer } = await import("./posthog-server");
    getPostHogServer();
    expect(mockConstructor).toHaveBeenCalledWith("phc_test123", {
      host: "https://custom.posthog.com",
      flushAt: 20,
      flushInterval: 10000,
    });
  });
});
