import { Elysia } from "elysia";
import { z } from "zod";
import { db } from "../../db";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import { aiClients, aiTenants, aiUnits } from "../../schema";
import { eq, and, sql, count, desc, or } from "drizzle-orm";
import { logAudit } from "../../audit";

// ── Request validation schemas ───────────────────────────────────────────────

const createClientSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").nullable().optional(),
  phone: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  preferredLanguage: z.enum(["en", "ar"]).optional().default("en"),
  notes: z.string().nullable().optional(),
});

const updateClientSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email("Invalid email").nullable().optional(),
  phone: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  preferredLanguage: z.enum(["en", "ar"]).optional(),
  notes: z.string().nullable().optional(),
});

const createTenantSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").nullable().optional(),
  phone: z.string().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  leaseStartDate: z.string().nullable().optional(),
  leaseEndDate: z.string().nullable().optional(),
  rentAmount: z.number().nullable().optional(),
  paymentFrequency: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const updateTenantSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email("Invalid email").nullable().optional(),
  phone: z.string().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  leaseStartDate: z.string().nullable().optional(),
  leaseEndDate: z.string().nullable().optional(),
  rentAmount: z.number().nullable().optional(),
  paymentFrequency: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const createUnitSchema = z.object({
  projectName: z.string().min(1, "Project name is required"),
  unitNumber: z.string().min(1, "Unit number is required"),
  unitType: z.enum(["apartment", "villa", "townhouse", "office"]),
  floorNumber: z.number().int().nullable().optional(),
  areaSqm: z.number().nullable().optional(),
  status: z
    .enum(["available", "sold", "reserved", "rented", "under_construction"])
    .optional()
    .default("available"),
  constructionProgress: z.number().int().min(0).max(100).nullable().optional(),
  estimatedHandoverDate: z.string().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
});

const updateUnitSchema = z.object({
  projectName: z.string().min(1).optional(),
  unitNumber: z.string().min(1).optional(),
  unitType: z.enum(["apartment", "villa", "townhouse", "office"]).optional(),
  floorNumber: z.number().int().nullable().optional(),
  areaSqm: z.number().nullable().optional(),
  status: z
    .enum(["available", "sold", "reserved", "rented", "under_construction"])
    .optional(),
  constructionProgress: z.number().int().min(0).max(100).nullable().optional(),
  estimatedHandoverDate: z.string().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseValidation(parsed: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  if (parsed.success) return null;
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error!.issues) {
    const field = issue.path.map(String).join(".");
    fieldErrors[field] = issue.message;
  }
  return { error: "Validation failed", details: fieldErrors };
}

// ── Client routes ────────────────────────────────────────────────────────────

const clientRoutes = new Elysia({ name: "ai-clients" })
  .use(identityGuard)
  .use(requirePermission("ai:clients:manage"))

  // GET /ai/clients — paginated list with search
  .get("/ai/clients", async ({ query }) => {
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        sql`(
          ${aiClients.firstName} ILIKE ${term}
          OR ${aiClients.lastName} ILIKE ${term}
          OR ${aiClients.email} ILIKE ${term}
          OR ${aiClients.phone} ILIKE ${term}
        )`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ total: count() })
      .from(aiClients)
      .where(whereClause);

    const total = totalResult?.total ?? 0;

    const clients = await db
      .select()
      .from(aiClients)
      .where(whereClause)
      .orderBy(desc(aiClients.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: clients,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  })

  // GET /ai/clients/:id — single client by ID
  .get("/ai/clients/:id", async ({ params, set }) => {
    const { id } = params;

    const [client] = await db
      .select()
      .from(aiClients)
      .where(eq(aiClients.id, id))
      .limit(1);

    if (!client) {
      set.status = 404;
      return { error: "Client not found" };
    }

    return { data: client };
  })

  // POST /ai/clients — create client
  .post("/ai/clients", async ({ body, set, userId }) => {
    const parsed = createClientSchema.safeParse(body);
    const validationError = parseValidation(parsed);
    if (validationError) {
      set.status = 400;
      return validationError;
    }

    const data = parsed.data!;
    const [client] = (await db
      .insert(aiClients)
      .values({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        nationality: data.nationality ?? null,
        preferredLanguage: data.preferredLanguage,
        notes: data.notes ?? null,
      })
      .returning()) as any[];

    await logAudit(db, {
      userId,
      action: "ai_client_create",
      entityType: "ai_client",
      entityId: client.id,
      summary: `Created AI client "${data.firstName} ${data.lastName}"`,
    });

    set.status = 201;
    return { data: client };
  })

  // PUT /ai/clients/:id — update client
  .put("/ai/clients/:id", async ({ params, body, set, userId }) => {
    const { id } = params;

    const parsed = updateClientSchema.safeParse(body);
    const validationError = parseValidation(parsed);
    if (validationError) {
      set.status = 400;
      return validationError;
    }

    const [existing] = await db
      .select({ id: aiClients.id })
      .from(aiClients)
      .where(eq(aiClients.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Client not found" };
    }

    const data = parsed.data!;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.firstName !== undefined) updates.firstName = data.firstName;
    if (data.lastName !== undefined) updates.lastName = data.lastName;
    if (data.email !== undefined) updates.email = data.email;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.nationality !== undefined) updates.nationality = data.nationality;
    if (data.preferredLanguage !== undefined) updates.preferredLanguage = data.preferredLanguage;
    if (data.notes !== undefined) updates.notes = data.notes;

    const [updated] = (await db
      .update(aiClients)
      .set(updates)
      .where(eq(aiClients.id, id))
      .returning()) as any[];

    await logAudit(db, {
      userId,
      action: "ai_client_update",
      entityType: "ai_client",
      entityId: id,
      summary: `Updated AI client "${updated.firstName} ${updated.lastName}"`,
    });

    return { data: updated };
  })

  // DELETE /ai/clients/:id — delete client
  .delete("/ai/clients/:id", async ({ params, set }) => {
    const { id } = params;

    const [existing] = await db
      .select({ id: aiClients.id })
      .from(aiClients)
      .where(eq(aiClients.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Client not found" };
    }

    await db.delete(aiClients).where(eq(aiClients.id, id));
    return { data: { success: true } };
  });

// ── Tenant routes ────────────────────────────────────────────────────────────

const tenantRoutes = new Elysia({ name: "ai-tenants" })
  .use(identityGuard)
  .use(requirePermission("ai:tenants:manage"))

  // GET /ai/tenants — paginated list with search
  .get("/ai/tenants", async ({ query }) => {
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        sql`(
          ${aiTenants.firstName} ILIKE ${term}
          OR ${aiTenants.lastName} ILIKE ${term}
          OR ${aiTenants.email} ILIKE ${term}
          OR ${aiTenants.phone} ILIKE ${term}
        )`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ total: count() })
      .from(aiTenants)
      .where(whereClause);

    const total = totalResult?.total ?? 0;

    const tenants = await db
      .select()
      .from(aiTenants)
      .where(whereClause)
      .orderBy(desc(aiTenants.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: tenants,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  })

  // POST /ai/tenants — create tenant
  .post("/ai/tenants", async ({ body, set, userId }) => {
    const parsed = createTenantSchema.safeParse(body);
    const validationError = parseValidation(parsed);
    if (validationError) {
      set.status = 400;
      return validationError;
    }

    const data = parsed.data!;
    const [tenant] = (await db
      .insert(aiTenants)
      .values({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone ?? null,
        unitId: data.unitId ?? null,
        leaseStartDate: data.leaseStartDate ?? null,
        leaseEndDate: data.leaseEndDate ?? null,
        rentAmount: data.rentAmount ?? null,
        paymentFrequency: data.paymentFrequency ?? null,
        notes: data.notes ?? null,
      })
      .returning()) as any[];

    await logAudit(db, {
      userId,
      action: "ai_tenant_create",
      entityType: "ai_tenant",
      entityId: tenant.id,
      summary: `Created AI tenant "${data.firstName} ${data.lastName}"`,
    });

    set.status = 201;
    return { data: tenant };
  })

  // PUT /ai/tenants/:id — update tenant
  .put("/ai/tenants/:id", async ({ params, body, set, userId }) => {
    const { id } = params;

    const parsed = updateTenantSchema.safeParse(body);
    const validationError = parseValidation(parsed);
    if (validationError) {
      set.status = 400;
      return validationError;
    }

    const [existing] = await db
      .select({ id: aiTenants.id })
      .from(aiTenants)
      .where(eq(aiTenants.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Tenant not found" };
    }

    const data = parsed.data!;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.firstName !== undefined) updates.firstName = data.firstName;
    if (data.lastName !== undefined) updates.lastName = data.lastName;
    if (data.email !== undefined) updates.email = data.email;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.unitId !== undefined) updates.unitId = data.unitId;
    if (data.leaseStartDate !== undefined) updates.leaseStartDate = data.leaseStartDate;
    if (data.leaseEndDate !== undefined) updates.leaseEndDate = data.leaseEndDate;
    if (data.rentAmount !== undefined) updates.rentAmount = data.rentAmount;
    if (data.paymentFrequency !== undefined) updates.paymentFrequency = data.paymentFrequency;
    if (data.notes !== undefined) updates.notes = data.notes;

    const [updated] = (await db
      .update(aiTenants)
      .set(updates)
      .where(eq(aiTenants.id, id))
      .returning()) as any[];

    await logAudit(db, {
      userId,
      action: "ai_tenant_update",
      entityType: "ai_tenant",
      entityId: id,
      summary: `Updated AI tenant "${updated.firstName} ${updated.lastName}"`,
    });

    return { data: updated };
  })

  // DELETE /ai/tenants/:id — delete tenant
  .delete("/ai/tenants/:id", async ({ params, set }) => {
    const { id } = params;

    const [existing] = await db
      .select({ id: aiTenants.id })
      .from(aiTenants)
      .where(eq(aiTenants.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Tenant not found" };
    }

    await db.delete(aiTenants).where(eq(aiTenants.id, id));
    return { data: { success: true } };
  });

// ── Unit routes ──────────────────────────────────────────────────────────────

const unitRoutes = new Elysia({ name: "ai-units" })
  .use(identityGuard)
  .use(requirePermission("ai:units:manage"))

  // GET /ai/units — paginated list with search and filtering
  .get("/ai/units", async ({ query }) => {
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];

    if (query.status) {
      conditions.push(
        eq(
          aiUnits.status,
          query.status as "available" | "sold" | "reserved" | "rented" | "under_construction"
        )
      );
    }

    if (query.unitType) {
      conditions.push(
        eq(
          aiUnits.unitType,
          query.unitType as "apartment" | "villa" | "townhouse" | "office"
        )
      );
    }

    if (query.projectName) {
      const term = `%${query.projectName}%`;
      conditions.push(sql`${aiUnits.projectName} ILIKE ${term}`);
    }

    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        sql`(
          ${aiUnits.projectName} ILIKE ${term}
          OR ${aiUnits.unitNumber} ILIKE ${term}
        )`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db
      .select({ total: count() })
      .from(aiUnits)
      .where(whereClause);

    const total = totalResult?.total ?? 0;

    const units = await db
      .select()
      .from(aiUnits)
      .where(whereClause)
      .orderBy(desc(aiUnits.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data: units,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  })

  // POST /ai/units — create unit
  .post("/ai/units", async ({ body, set, userId }) => {
    const parsed = createUnitSchema.safeParse(body);
    const validationError = parseValidation(parsed);
    if (validationError) {
      set.status = 400;
      return validationError;
    }

    const data = parsed.data!;

    // Validate referential integrity for clientId
    if (data.clientId) {
      const [client] = await db
        .select({ id: aiClients.id })
        .from(aiClients)
        .where(eq(aiClients.id, data.clientId))
        .limit(1);
      if (!client) {
        set.status = 400;
        return { error: "Referenced client not found" };
      }
    }

    // Validate referential integrity for tenantId
    if (data.tenantId) {
      const [tenant] = await db
        .select({ id: aiTenants.id })
        .from(aiTenants)
        .where(eq(aiTenants.id, data.tenantId))
        .limit(1);
      if (!tenant) {
        set.status = 400;
        return { error: "Referenced tenant not found" };
      }
    }

    const [unit] = (await db
      .insert(aiUnits)
      .values({
        projectName: data.projectName,
        unitNumber: data.unitNumber,
        unitType: data.unitType,
        floorNumber: data.floorNumber ?? null,
        areaSqm: data.areaSqm ?? null,
        status: data.status,
        constructionProgress: data.constructionProgress ?? null,
        estimatedHandoverDate: data.estimatedHandoverDate ?? null,
        clientId: data.clientId ?? null,
        tenantId: data.tenantId ?? null,
      })
      .returning()) as any[];

    await logAudit(db, {
      userId,
      action: "ai_unit_create",
      entityType: "ai_unit",
      entityId: unit.id,
      summary: `Created AI unit "${data.projectName} - ${data.unitNumber}"`,
    });

    set.status = 201;
    return { data: unit };
  })

  // PUT /ai/units/:id — update unit
  .put("/ai/units/:id", async ({ params, body, set, userId }) => {
    const { id } = params;

    const parsed = updateUnitSchema.safeParse(body);
    const validationError = parseValidation(parsed);
    if (validationError) {
      set.status = 400;
      return validationError;
    }

    const [existing] = await db
      .select({ id: aiUnits.id })
      .from(aiUnits)
      .where(eq(aiUnits.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Unit not found" };
    }

    const data = parsed.data!;

    // Validate referential integrity for clientId
    if (data.clientId) {
      const [client] = await db
        .select({ id: aiClients.id })
        .from(aiClients)
        .where(eq(aiClients.id, data.clientId))
        .limit(1);
      if (!client) {
        set.status = 400;
        return { error: "Referenced client not found" };
      }
    }

    // Validate referential integrity for tenantId
    if (data.tenantId) {
      const [tenant] = await db
        .select({ id: aiTenants.id })
        .from(aiTenants)
        .where(eq(aiTenants.id, data.tenantId))
        .limit(1);
      if (!tenant) {
        set.status = 400;
        return { error: "Referenced tenant not found" };
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.projectName !== undefined) updates.projectName = data.projectName;
    if (data.unitNumber !== undefined) updates.unitNumber = data.unitNumber;
    if (data.unitType !== undefined) updates.unitType = data.unitType;
    if (data.floorNumber !== undefined) updates.floorNumber = data.floorNumber;
    if (data.areaSqm !== undefined) updates.areaSqm = data.areaSqm;
    if (data.status !== undefined) updates.status = data.status;
    if (data.constructionProgress !== undefined) updates.constructionProgress = data.constructionProgress;
    if (data.estimatedHandoverDate !== undefined) updates.estimatedHandoverDate = data.estimatedHandoverDate;
    if (data.clientId !== undefined) updates.clientId = data.clientId;
    if (data.tenantId !== undefined) updates.tenantId = data.tenantId;

    const [updated] = (await db
      .update(aiUnits)
      .set(updates)
      .where(eq(aiUnits.id, id))
      .returning()) as any[];

    await logAudit(db, {
      userId,
      action: "ai_unit_update",
      entityType: "ai_unit",
      entityId: id,
      summary: `Updated AI unit "${updated.projectName} - ${updated.unitNumber}"`,
    });

    return { data: updated };
  })

  // DELETE /ai/units/:id — delete unit
  .delete("/ai/units/:id", async ({ params, set }) => {
    const { id } = params;

    const [existing] = await db
      .select({ id: aiUnits.id })
      .from(aiUnits)
      .where(eq(aiUnits.id, id))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Unit not found" };
    }

    await db.delete(aiUnits).where(eq(aiUnits.id, id));
    return { data: { success: true } };
  });

// ── Combine and export ───────────────────────────────────────────────────────

export const aiRecordsRoutes = new Elysia({ name: "ai-records" })
  .use(clientRoutes)
  .use(tenantRoutes)
  .use(unitRoutes);

export default aiRecordsRoutes;
