import { describe, it, expect, vi, beforeEach } from "vitest";
import { Elysia } from "elysia";

// Mock the database module before importing auth
vi.mock("../db", () => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  };
  return { db: mockDb };
});

// Mock better-auth/crypto
vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn(async (password: string) => `hashed_${password}`),
  verifyPassword: vi.fn(
    async (hash: string, password: string) =>
      hash === `hashed_${password}`
  ),
  generateRandomString: vi.fn(() => "test_session_token_abc123"),
}));

import { db } from "../db";
import { authPlugin, authGuard, validateSession, SESSION_COOKIE_NAME } from "./auth";

const mockDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function chainMock(result: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result),
      }),
    }),
  };
}

function insertMock() {
  return {
    values: vi.fn().mockResolvedValue(undefined),
  };
}

function deleteMock() {
  return {
    where: vi.fn().mockResolvedValue(undefined),
  };
}

describe("authPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /auth/login", () => {
    it("returns 400 when email or password is missing", async () => {
      const app = new Elysia().use(authPlugin);

      const res = await app.handle(
        new Request("http://localhost/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "" }),
        })
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("returns 401 for non-existent user", async () => {
      mockDb.select.mockReturnValue(chainMock([]));

      const app = new Elysia().use(authPlugin);

      const res = await app.handle(
        new Request("http://localhost/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "nobody@example.com",
            password: "wrong",
          }),
        })
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid credentials");
    });

    it("returns 401 for wrong password", async () => {
      mockDb.select.mockReturnValue(
        chainMock([
          {
            id: "user-1",
            email: "admin@example.com",
            name: "Admin",
            passwordHash: "hashed_correct_password",
          },
        ])
      );

      const app = new Elysia().use(authPlugin);

      const res = await app.handle(
        new Request("http://localhost/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "admin@example.com",
            password: "wrong_password",
          }),
        })
      );

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid credentials");
    });

    it("returns user data and sets session cookie on valid login", async () => {
      mockDb.select.mockReturnValue(
        chainMock([
          {
            id: "user-1",
            email: "admin@example.com",
            name: "Admin",
            passwordHash: "hashed_secret123",
          },
        ])
      );
      mockDb.insert.mockReturnValue(insertMock());

      const app = new Elysia().use(authPlugin);

      const res = await app.handle(
        new Request("http://localhost/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "admin@example.com",
            password: "secret123",
          }),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.userId).toBe("user-1");
      expect(body.data.email).toBe("admin@example.com");

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain(SESSION_COOKIE_NAME);
    });
  });

  describe("POST /auth/logout", () => {
    it("clears session cookie and returns success", async () => {
      mockDb.delete.mockReturnValue(deleteMock());

      const app = new Elysia().use(authPlugin);

      const res = await app.handle(
        new Request("http://localhost/auth/logout", {
          method: "POST",
          headers: {
            Cookie: `${SESSION_COOKIE_NAME}=some_token`,
          },
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
    });
  });

  describe("GET /auth/session", () => {
    it("returns 401 when no session cookie is present", async () => {
      const app = new Elysia().use(authPlugin);

      const res = await app.handle(
        new Request("http://localhost/auth/session")
      );

      expect(res.status).toBe(401);
    });

    it("returns 401 for expired/invalid session", async () => {
      mockDb.select.mockReturnValue(chainMock([]));

      const app = new Elysia().use(authPlugin);

      const res = await app.handle(
        new Request("http://localhost/auth/session", {
          headers: {
            Cookie: `${SESSION_COOKIE_NAME}=invalid_token`,
          },
        })
      );

      expect(res.status).toBe(401);
    });
  });
});

describe("authGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for requests without valid session", async () => {
    mockDb.select.mockReturnValue(chainMock([]));

    const app = new Elysia()
      .use(authGuard)
      .get("/protected", ({ userId }) => ({ userId }));

    const res = await app.handle(
      new Request("http://localhost/protected")
    );

    expect(res.status).toBe(401);
  });

  it("provides userId in context for valid session", async () => {
    // First call: validateSession query
    mockDb.select.mockReturnValue(
      chainMock([
        {
          userId: "user-1",
          token: "valid_token",
          expiresAt: new Date(Date.now() + 86400000),
        },
      ])
    );

    const app = new Elysia()
      .use(authGuard)
      .get("/protected", ({ userId }) => ({ userId }));

    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=valid_token`,
        },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user-1");
  });
});
