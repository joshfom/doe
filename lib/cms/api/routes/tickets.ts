import { Elysia } from "elysia";
import { db } from "../../db";
import {
  identityGuard,
  requirePermission,
} from "../../rbac/middleware";
import {
  createTicket,
  assignTicket,
  addNote,
  getTicketById,
  listTickets,
  updateTicketRequest,
} from "../../tickets/service";
import { transitionTicketStatus } from "../../tickets/lifecycle";
import {
  createTicketSchema,
  publicTicketSchema,
  transitionStatusSchema,
  assignTicketSchema,
  addNoteSchema,
  ticketFiltersSchema,
  updateTicketRequestSchema,
  requestTicketApprovalSchema,
  decideTicketApprovalSchema,
  cancelTicketApprovalSchema,
} from "../../tickets/validation";
import { RateLimiter } from "../../tickets/rate-limit";
import {
  requestTicketApproval,
  decideTicketApproval,
  cancelTicketApproval,
  getTicketApprovals,
  listPendingApprovals,
} from "../../tickets/approvals";

// ── Module-level rate limiter (single instance, not per-request) ─────────────

const publicRateLimiter = new RateLimiter(5, 15 * 60 * 1000);

// ── Public routes (no auth) ──────────────────────────────────────────────────

const publicTickets = new Elysia({ name: "tickets-public" })

  // POST /tickets/public — create ticket from public form (unauthenticated, rate-limited)
  .post("/tickets/public", async ({ body, set, request }) => {
    // Extract IP from request headers or connection
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

    // Rate limit check
    if (!publicRateLimiter.isAllowed(ip)) {
      set.status = 429;
      return { error: "Too many requests. Please try again later." };
    }

    // Validate input
    const parsed = publicTicketSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    // Record the request for rate limiting
    publicRateLimiter.record(ip);

    const result = await createTicket(db, {
      ...parsed.data,
      source: "form",
      createdBy: null,
    });

    set.status = 201;
    return { data: { ticketId: result.ticketId, ticketNumber: result.ticketNumber } };
  });

// ── Authenticated routes ─────────────────────────────────────────────────────

const protectedTickets = new Elysia({ name: "tickets-protected" })
  .use(identityGuard)

  // POST /tickets — create ticket (authenticated, requires tickets:create)
  .use(requirePermission("tickets:create"))
  .post("/tickets", async ({ body, userId, set }) => {
    const parsed = createTicketSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    const result = await createTicket(db, {
      ...parsed.data,
      createdBy: userId,
    });

    set.status = 201;
    return { data: { ticketId: result.ticketId, ticketNumber: result.ticketNumber } };
  });

const ticketReadRoutes = new Elysia({ name: "tickets-read" })
  .use(identityGuard)
  .use(requirePermission("tickets:read"))

  // GET /tickets — list tickets with filtering, search, pagination
  .get("/tickets", async ({ query }) => {
    const parsed = ticketFiltersSchema.safeParse(query);
    const filters = parsed.success ? parsed.data : {};

    const result = await listTickets(db, filters);

    return {
      data: result.tickets,
      total: result.total,
      statusCounts: result.statusCounts,
    };
  })

  // GET /tickets/:id — get ticket detail with notes and audit trail
  .get("/tickets/:id", async ({ params, set }) => {
    const { id } = params;

    const result = await getTicketById(db, id);
    if (!result) {
      set.status = 404;
      return { error: "Ticket not found" };
    }

    return { data: result };
  });

const ticketUpdateRoutes = new Elysia({ name: "tickets-update" })
  .use(identityGuard)
  .use(requirePermission("tickets:update"))

  // PATCH /tickets/:id/status — transition ticket status
  .patch("/tickets/:id/status", async ({ params, body, userId, set }) => {
    const { id } = params;

    const parsed = transitionStatusSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    try {
      const updated = await transitionTicketStatus(
        db,
        id,
        parsed.data.newStatus,
        userId,
        parsed.data.assigneeId
      );
      return { data: updated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("Ticket not found")) {
        set.status = 404;
        return { error: "Ticket not found" };
      }

      if (message.includes("Invalid status transition")) {
        set.status = 400;
        return { error: message };
      }

      if (message.includes("Assignee is required")) {
        set.status = 400;
        return { error: message };
      }

      throw error;
    }
  })

  // POST /tickets/:id/notes — add note to ticket
  .post("/tickets/:id/notes", async ({ params, body, userId, set }) => {
    const { id } = params;

    const parsed = addNoteSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    // Verify ticket exists
    const ticket = await getTicketById(db, id);
    if (!ticket) {
      set.status = 404;
      return { error: "Ticket not found" };
    }

    const note = await addNote(
      db,
      id,
      userId,
      parsed.data.content,
      parsed.data.isInternal
    );

    set.status = 201;
    return { data: note };
  })

  // PATCH /tickets/:id/request — update request type / community / project / unit / requestData / scheduling
  .patch("/tickets/:id/request", async ({ params, body, userId, set }) => {
    const { id } = params;

    const parsed = updateTicketRequestSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.map((p) => String(p)).join(".")] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    try {
      const updated = await updateTicketRequest(db, id, userId, parsed.data);
      return { data: updated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Ticket not found")) {
        set.status = 404;
        return { error: "Ticket not found" };
      }
      // ZodError from validateRequestData
      if (error && typeof error === "object" && "issues" in error) {
        set.status = 400;
        const issues = (error as { issues: { path: PropertyKey[]; message: string }[] }).issues;
        const fieldErrors: Record<string, string> = {};
        for (const issue of issues) {
          fieldErrors[`requestData.${issue.path.map((p) => String(p)).join(".")}`] = issue.message;
        }
        return { error: "Invalid request data", details: fieldErrors };
      }
      throw error;
    }
  });

const ticketAssignRoutes = new Elysia({ name: "tickets-assign" })
  .use(identityGuard)
  .use(requirePermission("tickets:assign"))

  // PATCH /tickets/:id/assign — assign/reassign ticket
  .patch("/tickets/:id/assign", async ({ params, body, userId, set }) => {
    const { id } = params;

    const parsed = assignTicketSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        fieldErrors[field] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }

    try {
      const updated = await assignTicket(
        db,
        id,
        parsed.data.assigneeId,
        userId
      );
      return { data: updated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("Ticket not found")) {
        set.status = 404;
        return { error: "Ticket not found" };
      }

      if (message.includes("Assignee not found")) {
        set.status = 400;
        return { error: "Assignee not found" };
      }

      if (message.includes("Assignee must be an active user")) {
        set.status = 400;
        return { error: message };
      }

      if (message.includes("Assignee must be an employee")) {
        set.status = 400;
        return { error: message };
      }

      throw error;
    }
  });

// ── Approval routes ──────────────────────────────────────────────────────────

const ticketApprovalReadRoutes = new Elysia({ name: "tickets-approval-read" })
  .use(identityGuard)
  .use(requirePermission("tickets:read"))

  // GET /tickets/:id/approvals — list approvals for a ticket
  .get("/tickets/:id/approvals", async ({ params }) => {
    const data = await getTicketApprovals(db, params.id);
    return { data };
  })

  // GET /tickets/approvals/pending — list pending approvals across tickets
  .get("/tickets/approvals/pending", async ({ query }) => {
    const scope = typeof query.scope === "string" ? query.scope : undefined;
    const parsed = scope
      ? requestTicketApprovalSchema.safeParse({ scope })
      : null;
    const data = await listPendingApprovals(db, {
      scope: parsed?.success ? parsed.data.scope : undefined,
    });
    return { data };
  });

const ticketApprovalWriteRoutes = new Elysia({ name: "tickets-approval-write" })
  .use(identityGuard)
  .use(requirePermission("tickets:approve"))

  // POST /tickets/:id/approvals — open (or reopen) an approval request
  .post("/tickets/:id/approvals", async ({ params, body, userId, set }) => {
    const parsed = requestTicketApprovalSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.join(".")] = issue.message;
      }
      return { error: "Validation failed", details: fieldErrors };
    }
    const data = await requestTicketApproval(db, {
      ticketId: params.id,
      scope: parsed.data.scope,
      requestedBy: userId,
    });
    return { data };
  })

  // PATCH /tickets/approvals/:approvalId — decide an approval
  .patch(
    "/tickets/approvals/:approvalId",
    async ({ params, body, userId, set }) => {
      const parsed = decideTicketApprovalSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          fieldErrors[issue.path.join(".")] = issue.message;
        }
        return { error: "Validation failed", details: fieldErrors };
      }
      try {
        const data = await decideTicketApproval(
          db,
          params.approvalId,
          userId,
          parsed.data.decision,
          parsed.data.comment
        );
        return { data };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("not found")) {
          set.status = 404;
          return { error: message };
        }
        if (message.includes("already")) {
          set.status = 409;
          return { error: message };
        }
        throw error;
      }
    }
  )

  // DELETE /tickets/approvals/:approvalId — cancel a pending approval
  .delete(
    "/tickets/approvals/:approvalId",
    async ({ params, body, userId, set }) => {
      const parsed = cancelTicketApprovalSchema.safeParse(body ?? {});
      if (!parsed.success) {
        set.status = 400;
        return { error: "Validation failed" };
      }
      try {
        const data = await cancelTicketApproval(
          db,
          params.approvalId,
          userId,
          parsed.data.reason
        );
        return { data };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("not found")) {
          set.status = 404;
          return { error: message };
        }
        if (message.includes("already")) {
          set.status = 409;
          return { error: message };
        }
        throw error;
      }
    }
  );

// ── Combine and export ───────────────────────────────────────────────────────

export const ticketsRoutes = new Elysia({ name: "tickets" })
  .use(publicTickets)
  .use(protectedTickets)
  .use(ticketReadRoutes)
  .use(ticketUpdateRoutes)
  .use(ticketAssignRoutes)
  .use(ticketApprovalReadRoutes)
  .use(ticketApprovalWriteRoutes);
