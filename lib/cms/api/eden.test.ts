import { describe, it, expect, vi } from "vitest";

// `./index` pulls in the full Elysia app (DB, RBAC seeders, etc.). We only need
// the `treaty` factory to observe how `makeApiClient` wires headers, so mock the
// eden module and stub the app import to keep this a fast, isolated unit test.
const treatySpy = vi.fn((_baseUrl: string, _opts?: unknown) => ({ __client: true }));

vi.mock("@elysiajs/eden", () => ({
  treaty: (baseUrl: string, opts?: unknown) => treatySpy(baseUrl, opts),
}));

vi.mock("./index", () => ({ api: {} }));

import { makeApiClient } from "./eden";

describe("makeApiClient", () => {
  it("returns a treaty client for the given base URL", () => {
    const client = makeApiClient("https://api.example.com");
    expect(client).toBeDefined();
    expect(treatySpy).toHaveBeenCalledWith("https://api.example.com", {
      headers: undefined,
    });
  });

  it("attaches an Authorization: Bearer header when a service token is provided", () => {
    makeApiClient("https://api.example.com", "svc-token-123");
    expect(treatySpy).toHaveBeenCalledWith("https://api.example.com", {
      headers: { Authorization: "Bearer svc-token-123" },
    });
  });
});
