import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Smoke/example test for the own-catalog read route (task 10.18, Req 13.3).
 *
 * `GET /api/prospecting/own-catalog` is a PURE SQL read over the OWN catalog
 * (`communities` / `projects` / `project_clusters`), RBAC-gated by the file's
 * `identityGuard` + `requirePermission("leads:read")`, that lazy-loads the
 * community → project → cluster picker one level at a time. These example-based
 * tests drive the real route module in-process via Elysia's
 * `app.handle(new Request(...))` (the same mechanism the Next mount uses,
 * mirroring `ai-knowledge-base.test.ts`) and pin:
 *   - the response SHAPE (`{ communities, projects, clusters }`); and
 *   - the SCOPING by query params (projects load only with a `communityId`,
 *     clusters only with a `projectId`).
 *
 * The heavy collaborators (dispatch, the catalog tools, the Own_Subject
 * resolver, the realtime bus) are mocked away so only the route's read + scoping
 * logic is exercised; the db is mocked to serve rows keyed by the REAL schema
 * table identities the route selects from.
 */

// ── Mocks (before importing the route) ───────────────────────────────────────

const communityRows = [
  {
    id: "comm-1",
    nameEn: "Palm Jumeirah",
    nameAr: "نخلة جميرا",
    city: "Dubai",
    region: "Dubai",
    status: "active",
  },
];
const projectRows = [
  {
    id: "proj-1",
    communityId: "comm-1",
    nameEn: "Palm Tower",
    nameAr: "برج النخلة",
    status: "active",
  },
];
const clusterRows = [
  {
    id: "clus-1",
    projectId: "proj-1",
    name: "Signature Villas",
    nameAr: null,
    slug: "signature-villas",
    segment: "ultra_luxury",
    unitTypes: ["villa"],
    bedroomsMin: 4,
    bedroomsMax: 6,
    priceMinAed: 20000000,
    priceMaxAed: 60000000,
    avgPricePerSqft: 4200,
    totalUnits: 12,
  },
];

// The db mock resolves each select() chain to the rows for the table passed to
// `.from()`, compared by identity against the real schema tables. The table
// references are shared via a hoisted holder populated from the real `schema`
// import below (the route imports the SAME unmocked module, so identities
// match). The chain is thenable + chainable so `.from().orderBy()` and
// `.from().where().orderBy()` both await to rows.
const h = vi.hoisted(() => ({ schema: null as any }));

vi.mock("../../db", () => {
  return {
    get db() {
      return {
        select() {
          let rows: unknown[] = [];
          const builder: Record<string, unknown> = {
            from(table: unknown) {
              if (table === h.schema.communities) rows = communityRows;
              else if (table === h.schema.projects) rows = projectRows;
              else if (table === h.schema.projectClusters) rows = clusterRows;
              else rows = [];
              return builder;
            },
            where() {
              return builder;
            },
            orderBy() {
              return builder;
            },
            limit() {
              return builder;
            },
            then(onF: (v: unknown[]) => unknown, onR?: (e: unknown) => unknown) {
              return Promise.resolve(rows).then(onF, onR);
            },
          };
          return builder;
        },
      };
    },
  };
});

// RBAC: pass through with an authenticated employee identity (mirrors the
// sibling route tests). The own-catalog route requires `leads:read`.
vi.mock("../../rbac/middleware", () => {
  const { Elysia } = require("elysia");
  return {
    identityGuard: new Elysia({ name: "identityGuard" }).derive(
      { as: "scoped" },
      () => ({ userId: "rep-user-id", userType: "employee", isActive: true })
    ),
    requirePermission: () =>
      new Elysia({ name: "requirePermission:leads:read" }).derive(
        { as: "scoped" },
        () => ({ resolvedPermissions: ["leads:read"] })
      ),
  };
});

// Heavy collaborators the own-catalog route does NOT touch — mocked so importing
// the route module stays lean and side-effect-free.
vi.mock("../../ai/tools/dispatch", () => ({ dispatchTool: vi.fn() }));
vi.mock("../../ai/tools/prospecting-capabilities", () => ({
  PROSPECTING_AGENT_ACTOR: "agent:prospecting",
  PROSPECTING_OUTREACH_AGENT_ACTOR: "agent:outreach",
}));
vi.mock("../../prospecting/own-subject", () => ({
  resolveComparisonSpec: vi.fn(),
}));
vi.mock("../../realtime/subscribe", () => ({ streamEvents: vi.fn() }));
vi.mock("../../realtime/events", () => ({ publishEvent: vi.fn() }));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { Elysia } from "elysia";
import * as schema from "../../schema";
import { prospectingRoutes } from "./prospecting";

// Populate the hoisted holder with the REAL schema tables so the db mock can
// compare `.from()` targets by identity (same module instance as the route).
h.schema = schema;

function createApp() {
  return new Elysia().use(prospectingRoutes);
}

async function getOwnCatalog(
  app: ReturnType<typeof createApp>,
  qs = ""
): Promise<{ status: number; body: any }> {
  const res = await app.handle(
    new Request(`http://localhost/prospecting/own-catalog${qs}`, {
      method: "GET",
      headers: { Cookie: "ora_session=valid" },
    })
  );
  return { status: res.status, body: await res.json() };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/prospecting/own-catalog (Req 13.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the { communities, projects, clusters } shape", async () => {
    const { status, body } = await getOwnCatalog(createApp());
    expect(status).toBe(200);
    expect(body).toHaveProperty("communities");
    expect(body).toHaveProperty("projects");
    expect(body).toHaveProperty("clusters");
  });

  it("seeds communities and leaves projects/clusters empty with no params", async () => {
    const { body } = await getOwnCatalog(createApp());
    expect(body.communities).toHaveLength(1);
    expect(body.communities[0].nameEn).toBe("Palm Jumeirah");
    // No communityId / projectId → no lower-level reads (scoping, Req 13.3).
    expect(body.projects).toEqual([]);
    expect(body.clusters).toEqual([]);
  });

  it("loads projects only once a communityId is supplied", async () => {
    const { body } = await getOwnCatalog(createApp(), "?communityId=comm-1");
    expect(body.communities).toHaveLength(1);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].communityId).toBe("comm-1");
    // Still no projectId → clusters stay empty.
    expect(body.clusters).toEqual([]);
  });

  it("loads clusters once both communityId and projectId are supplied", async () => {
    const { body } = await getOwnCatalog(
      createApp(),
      "?communityId=comm-1&projectId=proj-1"
    );
    expect(body.projects).toHaveLength(1);
    expect(body.clusters).toHaveLength(1);
    expect(body.clusters[0].projectId).toBe("proj-1");
    expect(body.clusters[0].slug).toBe("signature-villas");
  });
});
