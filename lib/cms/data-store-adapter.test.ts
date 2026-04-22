import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiDataStore } from "./data-store-adapter";
import type { PageData } from "@/lib/page-builder";

const sampleData: PageData = {
  root: { props: { title: "Test" } },
  content: [{ type: "HeroBanner", props: { id: "hero-1", heading: "Hello" } }],
};

describe("ApiDataStore", () => {
  let store: ApiDataStore;

  beforeEach(() => {
    vi.restoreAllMocks();
    store = new ApiDataStore("http://localhost:3001");
  });

  describe("save", () => {
    it("sends PUT with data and credentials", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: {} }), { status: 200 })
      );

      await store.save("page-1", sampleData);

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3001/api/pages/page-1",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: sampleData }),
          credentials: "include",
        }
      );
    });

    it("throws on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
      );

      await expect(store.save("page-1", sampleData)).rejects.toThrow("Unauthorized");
    });
  });

  describe("load", () => {
    it("returns PageData on success", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: sampleData }), { status: 200 })
      );

      const result = await store.load("page-1");
      expect(result).toEqual(sampleData);
    });

    it("returns null on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("", { status: 404 })
      );

      const result = await store.load("page-1");
      expect(result).toBeNull();
    });

    it("includes credentials in request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: sampleData }), { status: 200 })
      );

      await store.load("page-1");

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3001/api/pages/page-1",
        { credentials: "include" }
      );
    });
  });

  describe("delete", () => {
    it("sends DELETE with credentials", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await store.delete("page-1");

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3001/api/pages/page-1",
        { method: "DELETE", credentials: "include" }
      );
    });

    it("throws on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "System page" }), { status: 403 })
      );

      await expect(store.delete("page-1")).rejects.toThrow("System page");
    });
  });

  describe("constructor defaults", () => {
    it("uses env-based URL when no baseUrl provided", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: sampleData }), { status: 200 })
      );

      const defaultStore = new ApiDataStore();
      await defaultStore.load("page-1");

      // Should use the default URL from env or fallback
      const calledUrl = (fetchSpy.mock.calls[0]![0] as string);
      expect(calledUrl).toContain("/api/pages/page-1");
    });
  });
});
