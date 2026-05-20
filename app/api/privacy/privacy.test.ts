import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock modules ─────────────────────────────────────────────────────────────

const mockCookiesGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookiesGet(name),
  }),
}));

vi.mock("@/lib/cms/api/auth", () => ({
  SESSION_COOKIE_NAME: "ora_session",
  validateSession: vi.fn(),
}));

vi.mock("@/lib/cms/rbac/engine", () => ({
  loadUserRoles: vi.fn(),
  resolvePermissions: vi.fn(),
}));

const mockDbSelect = vi.fn();
const mockDbDelete = vi.fn();
const mockDbInsert = vi.fn();

vi.mock("@/lib/cms/db", () => ({
  db: {
    select: () => mockDbSelect(),
    delete: () => mockDbDelete(),
    insert: () => mockDbInsert(),
  },
}));

vi.mock("@/lib/cms/schema", () => ({
  formSubmissions: { data: "data", id: "id" },
  tickets: { contactEmail: "contact_email", contactPhone: "contact_phone", id: "id" },
  aiConversations: { participantEmail: "participant_email", participantPhone: "participant_phone", id: "id" },
  dsarDeletionQueue: {},
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { POST as exportHandler } from "./export/route";
import { POST as deleteHandler } from "./delete/route";
import { validateSession } from "@/lib/cms/api/auth";
import { loadUserRoles, resolvePermissions } from "@/lib/cms/rbac/engine";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/privacy/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupAdminAuth() {
  mockCookiesGet.mockReturnValue({ value: "valid-token" });
  vi.mocked(validateSession).mockResolvedValue("admin-user-id");
  vi.mocked(loadUserRoles).mockResolvedValue([
    { id: "role-1", name: "super_admin", userType: "employee" },
  ] as any);
  vi.mocked(resolvePermissions).mockResolvedValue(["*:*"]);
}

function setupNoAuth() {
  mockCookiesGet.mockReturnValue(undefined);
  vi.mocked(validateSession).mockResolvedValue(null);
}

function setupNonAdminAuth() {
  mockCookiesGet.mockReturnValue({ value: "valid-token" });
  vi.mocked(validateSession).mockResolvedValue("regular-user-id");
  vi.mocked(loadUserRoles).mockResolvedValue([
    { id: "role-2", name: "viewer", userType: "employee" },
  ] as any);
  vi.mocked(resolvePermissions).mockResolvedValue(["pages:read"]);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DSAR Export Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    setupNoAuth();
    const response = await exportHandler(makeRequest({ identifier: "test@example.com" }));
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 403 when user is not admin", async () => {
    setupNonAdminAuth();
    const response = await exportHandler(makeRequest({ identifier: "test@example.com" }));
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain("admin access required");
  });

  it("returns 400 when identifier is missing", async () => {
    setupAdminAuth();
    const response = await exportHandler(makeRequest({}));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("identifier is required");
  });

  it("returns 400 when identifier is empty string", async () => {
    setupAdminAuth();
    const response = await exportHandler(makeRequest({ identifier: "  " }));
    expect(response.status).toBe(400);
  });

  it("returns same response shape for unknown identifiers (no data leakage)", async () => {
    setupAdminAuth();

    // Mock empty results
    const mockFrom = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    mockDbSelect.mockReturnValue({ from: mockFrom });

    const response = await exportHandler(makeRequest({ identifier: "unknown@example.com" }));
    expect(response.status).toBe(200);
    const data = await response.json();

    // Same response shape with empty arrays
    expect(data).toHaveProperty("identifier");
    expect(data).toHaveProperty("data");
    expect(data.data).toHaveProperty("form_submissions");
    expect(data.data).toHaveProperty("tickets");
    expect(data.data).toHaveProperty("ai_conversations");
    expect(data.data.form_submissions).toEqual([]);
    expect(data.data.tickets).toEqual([]);
    expect(data.data.ai_conversations).toEqual([]);
    expect(data.message).toBe("No data found for the given identifier");
    expect(data).toHaveProperty("exportedAt");
  });

  it("returns data when identifier matches records", async () => {
    setupAdminAuth();

    const mockSubmission = { id: "sub-1", data: { email: "test@example.com" } };
    const mockTicket = { id: "ticket-1", contactEmail: "test@example.com" };
    const mockConversation = { id: "conv-1", participantEmail: "test@example.com" };

    // Each call to select().from().where() returns different data
    let callCount = 0;
    const mockFrom = vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([mockSubmission]);
        if (callCount === 2) return Promise.resolve([mockTicket]);
        return Promise.resolve([mockConversation]);
      }),
    });
    mockDbSelect.mockReturnValue({ from: mockFrom });

    const response = await exportHandler(makeRequest({ identifier: "test@example.com" }));
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.data.form_submissions).toHaveLength(1);
    expect(data.data.tickets).toHaveLength(1);
    expect(data.data.ai_conversations).toHaveLength(1);
    expect(data.message).toBe("Data export complete");
  });
});

describe("DSAR Delete Endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    setupNoAuth();
    const response = await deleteHandler(makeRequest({ identifier: "test@example.com" }));
    expect(response.status).toBe(401);
  });

  it("returns 403 when user is not admin", async () => {
    setupNonAdminAuth();
    const response = await deleteHandler(makeRequest({ identifier: "test@example.com" }));
    expect(response.status).toBe(403);
  });

  it("returns 400 when identifier is missing", async () => {
    setupAdminAuth();
    const response = await deleteHandler(makeRequest({}));
    expect(response.status).toBe(400);
  });

  it("returns same response shape for unknown identifiers (no data leakage)", async () => {
    setupAdminAuth();

    // Mock empty delete results
    const mockWhere = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    });
    mockDbDelete.mockReturnValue({ where: mockWhere });

    const response = await deleteHandler(makeRequest({ identifier: "unknown@example.com" }));
    expect(response.status).toBe(200);
    const data = await response.json();

    // Same response shape with zero counts
    expect(data).toHaveProperty("identifier");
    expect(data).toHaveProperty("deleted");
    expect(data.deleted.form_submissions).toBe(0);
    expect(data.deleted.tickets).toBe(0);
    expect(data.deleted.ai_conversations).toBe(0);
    expect(data.message).toBe("No data found for the given identifier");
    expect(data).toHaveProperty("deletedAt");
  });

  it("deletes records and returns counts", async () => {
    setupAdminAuth();

    let callCount = 0;
    const mockWhere = vi.fn().mockReturnValue({
      returning: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([{ id: "sub-1" }, { id: "sub-2" }]);
        if (callCount === 2) return Promise.resolve([{ id: "ticket-1" }]);
        return Promise.resolve([{ id: "conv-1" }]);
      }),
    });
    mockDbDelete.mockReturnValue({ where: mockWhere });

    const response = await deleteHandler(makeRequest({ identifier: "test@example.com" }));
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.deleted.form_submissions).toBe(2);
    expect(data.deleted.tickets).toBe(1);
    expect(data.deleted.ai_conversations).toBe(1);
    expect(data.message).toBe("Deletion complete");
  });
});
