import { describe, it, expect } from "vitest";
import {
  createTicketSchema,
  publicTicketSchema,
  transitionStatusSchema,
  assignTicketSchema,
  addNoteSchema,
  ticketFiltersSchema,
  createCategorySchema,
  updateCategorySchema,
} from "./validation";

describe("createTicketSchema", () => {
  const validInput = {
    subject: "Login issue",
    description: "Cannot log in to the dashboard",
    contactName: "Jane Doe",
    contactEmail: "jane@example.com",
    source: "manual" as const,
  };

  it("accepts valid input with defaults", () => {
    const result = createTicketSchema.parse(validInput);
    expect(result.priority).toBe("medium");
    expect(result.subject).toBe("Login issue");
  });

  it("accepts all optional fields", () => {
    const result = createTicketSchema.parse({
      ...validInput,
      contactPhone: "+1234567890",
      priority: "urgent",
      category: "technical",
    });
    expect(result.priority).toBe("urgent");
    expect(result.category).toBe("technical");
    expect(result.contactPhone).toBe("+1234567890");
  });

  it("rejects empty subject", () => {
    const result = createTicketSchema.safeParse({ ...validInput, subject: "" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only subject", () => {
    const result = createTicketSchema.safeParse({ ...validInput, subject: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects empty description", () => {
    const result = createTicketSchema.safeParse({ ...validInput, description: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty contactName", () => {
    const result = createTicketSchema.safeParse({ ...validInput, contactName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty contactEmail", () => {
    const result = createTicketSchema.safeParse({ ...validInput, contactEmail: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const result = createTicketSchema.safeParse({ ...validInput, contactEmail: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid source", () => {
    const result = createTicketSchema.safeParse({ ...validInput, source: "phone" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid priority", () => {
    const result = createTicketSchema.safeParse({ ...validInput, priority: "critical" });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from string fields", () => {
    const result = createTicketSchema.parse({
      ...validInput,
      subject: "  Login issue  ",
      contactName: "  Jane Doe  ",
    });
    expect(result.subject).toBe("Login issue");
    expect(result.contactName).toBe("Jane Doe");
  });
});

describe("publicTicketSchema", () => {
  const validInput = {
    subject: "Billing question",
    description: "I was charged twice",
    contactName: "John Smith",
    contactEmail: "john@example.com",
  };

  it("accepts valid input without source field", () => {
    const result = publicTicketSchema.parse(validInput);
    expect(result.priority).toBe("medium");
    expect(result).not.toHaveProperty("source");
  });

  it("rejects invalid email", () => {
    const result = publicTicketSchema.safeParse({ ...validInput, contactEmail: "bad" });
    expect(result.success).toBe(false);
  });

  it("rejects empty required fields", () => {
    expect(publicTicketSchema.safeParse({ ...validInput, subject: "" }).success).toBe(false);
    expect(publicTicketSchema.safeParse({ ...validInput, description: "" }).success).toBe(false);
    expect(publicTicketSchema.safeParse({ ...validInput, contactName: "" }).success).toBe(false);
  });
});

describe("transitionStatusSchema", () => {
  it("accepts valid status", () => {
    const result = transitionStatusSchema.parse({ newStatus: "assigned" });
    expect(result.newStatus).toBe("assigned");
    expect(result.assigneeId).toBeUndefined();
  });

  it("accepts status with assigneeId", () => {
    const result = transitionStatusSchema.parse({
      newStatus: "assigned",
      assigneeId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.assigneeId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects invalid status", () => {
    const result = transitionStatusSchema.safeParse({ newStatus: "pending" });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID assigneeId", () => {
    const result = transitionStatusSchema.safeParse({
      newStatus: "assigned",
      assigneeId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("assignTicketSchema", () => {
  it("accepts valid UUID", () => {
    const result = assignTicketSchema.parse({
      assigneeId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.assigneeId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects missing assigneeId", () => {
    const result = assignTicketSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID string", () => {
    const result = assignTicketSchema.safeParse({ assigneeId: "abc123" });
    expect(result.success).toBe(false);
  });
});

describe("addNoteSchema", () => {
  it("accepts valid content with default isInternal", () => {
    const result = addNoteSchema.parse({ content: "Contacted the customer" });
    expect(result.content).toBe("Contacted the customer");
    expect(result.isInternal).toBe(true);
  });

  it("accepts explicit isInternal false", () => {
    const result = addNoteSchema.parse({ content: "Public reply", isInternal: false });
    expect(result.isInternal).toBe(false);
  });

  it("rejects empty content", () => {
    const result = addNoteSchema.safeParse({ content: "" });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only content", () => {
    const result = addNoteSchema.safeParse({ content: "   " });
    expect(result.success).toBe(false);
  });

  it("trims content", () => {
    const result = addNoteSchema.parse({ content: "  some note  " });
    expect(result.content).toBe("some note");
  });
});

describe("ticketFiltersSchema", () => {
  it("accepts empty object with defaults", () => {
    const result = ticketFiltersSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("accepts all filter fields", () => {
    const result = ticketFiltersSchema.parse({
      status: "open",
      priority: "high",
      category: "billing",
      assigneeId: "550e8400-e29b-41d4-a716-446655440000",
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
      source: "api",
      search: "login",
      page: 2,
      pageSize: 50,
    });
    expect(result.status).toBe("open");
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
  });

  it("coerces string page/pageSize to numbers", () => {
    const result = ticketFiltersSchema.parse({ page: "3", pageSize: "10" });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
  });

  it("rejects invalid status", () => {
    const result = ticketFiltersSchema.safeParse({ status: "pending" });
    expect(result.success).toBe(false);
  });

  it("rejects page less than 1", () => {
    const result = ticketFiltersSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects pageSize greater than 100", () => {
    const result = ticketFiltersSchema.safeParse({ pageSize: 200 });
    expect(result.success).toBe(false);
  });
});

describe("createCategorySchema", () => {
  it("accepts valid input", () => {
    const result = createCategorySchema.parse({
      name: "billing",
      displayName: "Billing",
    });
    expect(result.name).toBe("billing");
    expect(result.displayName).toBe("Billing");
  });

  it("accepts optional description", () => {
    const result = createCategorySchema.parse({
      name: "technical",
      displayName: "Technical Support",
      description: "Hardware and software issues",
    });
    expect(result.description).toBe("Hardware and software issues");
  });

  it("rejects empty name", () => {
    const result = createCategorySchema.safeParse({ name: "", displayName: "Billing" });
    expect(result.success).toBe(false);
  });

  it("rejects empty displayName", () => {
    const result = createCategorySchema.safeParse({ name: "billing", displayName: "" });
    expect(result.success).toBe(false);
  });

  it("trims name and displayName", () => {
    const result = createCategorySchema.parse({
      name: "  billing  ",
      displayName: "  Billing  ",
    });
    expect(result.name).toBe("billing");
    expect(result.displayName).toBe("Billing");
  });
});

describe("updateCategorySchema", () => {
  it("accepts empty object (no updates)", () => {
    const result = updateCategorySchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts partial updates", () => {
    const result = updateCategorySchema.parse({ displayName: "New Name" });
    expect(result.displayName).toBe("New Name");
  });

  it("accepts isActive boolean", () => {
    const result = updateCategorySchema.parse({ isActive: false });
    expect(result.isActive).toBe(false);
  });

  it("rejects empty name when provided", () => {
    const result = updateCategorySchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty displayName when provided", () => {
    const result = updateCategorySchema.safeParse({ displayName: "   " });
    expect(result.success).toBe(false);
  });
});
