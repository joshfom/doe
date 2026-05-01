/**
 * Demo seeder for the ORA / Bayn presentation.
 *
 * Seeds: communities, projects, AI clients, AI units, tickets, AI appointments,
 * AI conversations (with multi-day message history for the memory demo),
 * and the curated ORA knowledge base.
 *
 * All demo records are tagged so that `resetDemo()` can remove only the
 * seeded data without touching anything created by real users.
 *
 * Tagging strategy:
 *   - communities.slug starts with `demo-bayn-`
 *   - projects.slug starts with `demo-`
 *   - aiClients.email = `demo-<n>@bayn-demo.local`
 *   - aiUnits.projectName starts with `[DEMO]` (rare legacy field) — we instead
 *     identify units via project FK
 *   - tickets.description starts with `[DEMO]`
 *   - aiAppointments.referenceNumber starts with `ORA-APT-DEMO-`
 *   - aiConversations.participantEmail follows the demo client pattern
 *   - knowledgeDocuments.sourceRefId starts with `demo:`
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import type { Database } from "../db";
import {
  aiAppointments,
  aiClients,
  aiConversations,
  aiMessages,
  aiUnits,
  communities,
  knowledgeDocuments,
  knowledgeEmbeddings,
  projects,
  tickets,
} from "../schema";
import { ORA_KNOWLEDGE_DOCS } from "./ora-knowledge";

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEMO_EMAIL_DOMAIN = "@bayn-demo.local";
const DEMO_TICKET_PREFIX = "[DEMO]";
const DEMO_APPOINTMENT_PREFIX = "ORA-APT-DEMO-";

function demoEmail(n: number) {
  return `demo-${String(n).padStart(2, "0")}${DEMO_EMAIL_DOMAIN}`;
}

function pad(n: number, width = 2) {
  return String(n).padStart(width, "0");
}

function daysFromNow(days: number, hour = 9, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function pickFrom<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

// ── Seed: communities + projects ────────────────────────────────────────────

interface SeededCommunity {
  id: string;
  slug: string;
  nameEn: string;
}

interface SeededProject {
  id: string;
  slug: string;
  communityId: string;
  nameEn: string;
}

const COMMUNITY_SEEDS = [
  {
    slug: "demo-bayn-coast",
    nameEn: "Bayn Coast",
    nameAr: "بيـن الساحل",
    descriptionEn:
      "Beachfront low-rise residences on the western edge of Bayn — direct sand-to-doorstep access and the most uninterrupted sea views in the masterplan.",
    descriptionAr: null,
  },
  {
    slug: "demo-bayn-marina",
    nameEn: "Bayn Marina",
    nameAr: "بيـن المرسى",
    descriptionEn:
      "Mixed-use marina district with apartments, retail promenade, F&B, and the community's five-star resort and spa.",
    descriptionAr: null,
  },
  {
    slug: "demo-bayn-hills",
    nameEn: "Bayn Hills",
    nameAr: "بيـن التلال",
    descriptionEn:
      "Inland villa enclave overlooking the parks, family-oriented with schools, healthcare, and the largest open-space allocation in the masterplan.",
    descriptionAr: null,
  },
] as const;

async function seedCommunities(db: Database): Promise<SeededCommunity[]> {
  const inserted = await db
    .insert(communities)
    .values(
      COMMUNITY_SEEDS.map((c) => ({
        slug: c.slug,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        descriptionEn: c.descriptionEn,
        descriptionAr: c.descriptionAr,
        region: "Bayn",
        country: "AE",
        status: "active" as const,
      }))
    )
    .returning({
      id: communities.id,
      slug: communities.slug,
      nameEn: communities.nameEn,
    });
  return inserted;
}

const PROJECT_SEEDS = [
  {
    slug: "demo-coastline-residences",
    communitySlug: "demo-bayn-coast",
    nameEn: "Coastline Residences",
    shortDescriptionEn:
      "180 beachfront apartments arranged in three low-rise wings with private cabanas and a 50m infinity pool.",
    status: "selling" as const,
    totalUnits: 180,
    availableUnits: 64,
  },
  {
    slug: "demo-marina-heights",
    communitySlug: "demo-bayn-marina",
    nameEn: "Marina Heights",
    shortDescriptionEn:
      "Twin marina-front towers — 1, 2, and 3-bedroom apartments above a public retail promenade.",
    status: "under_construction" as const,
    totalUnits: 240,
    availableUnits: 92,
  },
  {
    slug: "demo-marina-resort-suites",
    communitySlug: "demo-bayn-marina",
    nameEn: "Marina Resort Suites",
    shortDescriptionEn:
      "Branded resort residences offering hotel-serviced studios and 1-bedroom suites with full rental management.",
    status: "pre_launch" as const,
    totalUnits: 96,
    availableUnits: 96,
  },
  {
    slug: "demo-hillside-villas",
    communitySlug: "demo-bayn-hills",
    nameEn: "Hillside Villas",
    shortDescriptionEn:
      "84 detached 4 and 5-bedroom villas overlooking the central park, with private gardens and rooftop terraces.",
    status: "selling" as const,
    totalUnits: 84,
    availableUnits: 31,
  },
  {
    slug: "demo-hillside-townhomes",
    communitySlug: "demo-bayn-hills",
    nameEn: "Hillside Townhomes",
    shortDescriptionEn:
      "Family-first 3-bedroom townhomes with shared green spines and walkable access to schools and healthcare.",
    status: "handover" as const,
    totalUnits: 120,
    availableUnits: 8,
  },
] as const;

async function seedProjects(
  db: Database,
  communitiesByslug: Map<string, SeededCommunity>
): Promise<SeededProject[]> {
  const inserted = await db
    .insert(projects)
    .values(
      PROJECT_SEEDS.map((p) => {
        const community = communitiesByslug.get(p.communitySlug);
        if (!community) throw new Error(`Missing community ${p.communitySlug}`);
        return {
          slug: p.slug,
          communityId: community.id,
          nameEn: p.nameEn,
          shortDescriptionEn: p.shortDescriptionEn,
          status: p.status,
          totalUnits: p.totalUnits,
          availableUnits: p.availableUnits,
          developer: "ORA Developers",
          expectedHandoverDate: "2027-12-01",
        };
      })
    )
    .returning({
      id: projects.id,
      slug: projects.slug,
      communityId: projects.communityId,
      nameEn: projects.nameEn,
    });
  return inserted;
}

// ── Seed: clients ───────────────────────────────────────────────────────────

const CLIENT_FIRST_NAMES = [
  "Ahmed",
  "Sara",
  "Khalid",
  "Layla",
  "Omar",
  "Mariam",
  "Yousef",
  "Nour",
  "Hassan",
  "Aisha",
  "Tariq",
  "Hala",
  "Bilal",
  "Rania",
  "Karim",
  "Dina",
  "Faisal",
  "Maya",
  "Ziad",
  "Fatima",
];
const CLIENT_LAST_NAMES = [
  "Al Mansoori",
  "Al Hashimi",
  "Al Suwaidi",
  "Al Ahmadi",
  "Al Marri",
  "Al Falasi",
  "Al Ameri",
  "Al Hosani",
  "Al Shamsi",
  "Al Zaabi",
];

interface SeededClient {
  id: string;
  firstName: string;
  email: string;
  phone: string;
  preferredLanguage: "en" | "ar";
}

async function seedClients(db: Database): Promise<SeededClient[]> {
  const rows = CLIENT_FIRST_NAMES.map((firstName, i) => ({
    firstName,
    lastName: pickFrom(CLIENT_LAST_NAMES, i),
    email: demoEmail(i + 1),
    phone: `+97150${String(1000000 + i * 7).slice(0, 7)}`,
    nationality: "AE",
    preferredLanguage: (i % 4 === 0 ? "ar" : "en") as "en" | "ar",
    notes: "[DEMO] Seeded client",
  }));

  const inserted = await db.insert(aiClients).values(rows).returning({
    id: aiClients.id,
    firstName: aiClients.firstName,
    email: aiClients.email,
    phone: aiClients.phone,
    preferredLanguage: aiClients.preferredLanguage,
  });

  return inserted.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    email: c.email!,
    phone: c.phone!,
    preferredLanguage: (c.preferredLanguage ?? "en") as "en" | "ar",
  }));
}

// ── Seed: units ─────────────────────────────────────────────────────────────

async function seedUnits(
  db: Database,
  seededProjects: SeededProject[],
  seededClients: SeededClient[]
): Promise<void> {
  const unitTypes = ["apartment", "townhouse", "villa"] as const;
  const statuses = [
    "available",
    "sold",
    "reserved",
    "under_construction",
  ] as const;

  const rows: typeof aiUnits.$inferInsert[] = [];

  // ~6 units per project, randomly distributed to first 14 clients (so a few stay visitor-only)
  for (let p = 0; p < seededProjects.length; p++) {
    const proj = seededProjects[p];
    for (let u = 0; u < 6; u++) {
      const i = p * 6 + u;
      const status = pickFrom(statuses, i);
      const isOwned = status === "sold" || status === "reserved";
      const owner = isOwned ? seededClients[i % 14] : null;
      const unitType = pickFrom(unitTypes, i);
      rows.push({
        projectName: `[DEMO] ${proj.nameEn}`,
        projectId: proj.id,
        communityId: null,
        unitNumber: `${String.fromCharCode(65 + p)}-${pad(101 + u)}`,
        unitType,
        floorNumber: unitType === "villa" ? null : (i % 12) + 1,
        areaSqm: 80 + ((i * 17) % 220),
        status,
        constructionProgress:
          status === "under_construction" ? 30 + ((i * 13) % 60) : null,
        estimatedHandoverDate: status === "under_construction" ? "2027-06-30" : null,
        clientId: owner?.id ?? null,
      });
    }
  }

  await db.insert(aiUnits).values(rows);
}

// ── Seed: tickets ───────────────────────────────────────────────────────────

async function seedTickets(
  db: Database,
  seededProjects: SeededProject[],
  seededClients: SeededClient[]
): Promise<void> {
  const baseRows: Array<typeof tickets.$inferInsert> = [];

  const requests = [
    {
      requestType: "maintenance_request" as const,
      subject: "AC not cooling in master bedroom",
      priority: "high" as const,
      status: "in_progress" as const,
      requestData: {
        area: "bedroom" as const,
        severity: "major" as const,
        description: "AC unit blowing warm air despite thermostat at 19°C.",
        photos: [],
      },
      scheduleOffsetDays: 1,
    },
    {
      requestType: "move_in" as const,
      subject: "Move-in permit for unit B-103",
      priority: "medium" as const,
      status: "open" as const,
      requestData: {
        direction: "in" as const,
        moveDate: daysFromNow(4).toISOString().slice(0, 10),
        moverCompany: { name: "Al Maha Movers", phone: "+97150 9990001" },
        truckPlates: ["DXB-12345"],
        crewSize: 4,
        accessRoute: "Marina gate 2 → service road",
      },
      scheduleOffsetDays: 4,
    },
    {
      requestType: "construction_material_delivery" as const,
      subject: "Material delivery — porcelain tiles & adhesive",
      priority: "medium" as const,
      status: "assigned" as const,
      requestData: {
        vendor: { name: "Stone & Surface Trading", phone: "+97150 7777301" },
        materials: [
          { name: "Porcelain tile 60x60", quantity: 220, unit: "sqm" },
          { name: "Tile adhesive bag 25kg", quantity: 45, unit: "bag" },
        ],
        deliveryDate: daysFromNow(2).toISOString().slice(0, 10),
        deliveryWindow: { start: "09:00", end: "12:00" },
        vehicle: { plateNumber: "AUH-44210" },
        requiresLift: true,
      },
      scheduleOffsetDays: 2,
    },
    {
      requestType: "gate_pass" as const,
      subject: "Gate pass — family visit (3 days)",
      priority: "low" as const,
      status: "resolved" as const,
      requestData: {
        passType: "visitor" as const,
        visitor: { name: "Mr. & Mrs. Al Otaibi", phone: "+97150 1112233" },
        accompanyingPersons: 2,
        purpose: "Family stay",
        validFrom: daysFromNow(-2).toISOString().slice(0, 10),
        validUntil: daysFromNow(1).toISOString().slice(0, 10),
        multipleEntries: true,
      },
      scheduleOffsetDays: -2,
    },
    {
      requestType: "technician_visit" as const,
      subject: "Plumbing — kitchen sink slow drain",
      priority: "medium" as const,
      status: "in_progress" as const,
      requestData: {
        discipline: "plumbing" as const,
        issueSummary: "Kitchen sink draining slowly with intermittent gurgling.",
        preferredWindow: {
          start: daysFromNow(3, 9).toISOString(),
          end: daysFromNow(3, 12).toISOString(),
        },
      },
      scheduleOffsetDays: 3,
    },
    {
      requestType: "vendor_access" as const,
      subject: "Vendor access — landscaping team monthly",
      priority: "low" as const,
      status: "open" as const,
      requestData: {
        vendor: { name: "Greenleaf Landscaping", phone: "+97150 4445566" },
        purpose: "Monthly garden maintenance",
        crew: [{ name: "Crew Lead Rajan", phone: "+97150 4445567" }],
        vehicles: [{ plateNumber: "DXB-77881" }],
        accessFrom: daysFromNow(5).toISOString().slice(0, 10),
        accessUntil: daysFromNow(35).toISOString().slice(0, 10),
      },
      scheduleOffsetDays: 5,
    },
    {
      requestType: "noc" as const,
      subject: "NOC — kitchen renovation",
      priority: "medium" as const,
      status: "open" as const,
      requestData: {
        nocType: "renovation" as const,
        workDescription: "Replace cabinetry and worktops; no structural changes.",
        contractor: { name: "Crafted Interiors LLC", phone: "+97150 2223344" },
        plannedStartDate: daysFromNow(8).toISOString().slice(0, 10),
        plannedEndDate: daysFromNow(22).toISOString().slice(0, 10),
        estimatedCost: 38000,
        attachments: [],
      },
      scheduleOffsetDays: 8,
    },
    {
      requestType: "general_inquiry" as const,
      subject: "Question about handover schedule",
      priority: "low" as const,
      status: "resolved" as const,
      requestData: {
        notes: "Asking when the keys for B-205 will be ready.",
      },
      scheduleOffsetDays: null,
    },
    {
      requestType: "maintenance_request" as const,
      subject: "Bathroom leak — emergency",
      priority: "urgent" as const,
      status: "resolved" as const,
      requestData: {
        area: "bathroom" as const,
        severity: "emergency" as const,
        description: "Water leak under sink, soaked vanity floor.",
        photos: [],
      },
      scheduleOffsetDays: -1,
    },
    {
      requestType: "move_out" as const,
      subject: "Move-out permit",
      priority: "medium" as const,
      status: "closed" as const,
      requestData: {
        direction: "out" as const,
        moveDate: daysFromNow(-7).toISOString().slice(0, 10),
        moverCompany: { name: "EasyMove UAE" },
        truckPlates: ["AUH-22119"],
        crewSize: 3,
      },
      scheduleOffsetDays: -7,
    },
    {
      requestType: "gate_pass" as const,
      subject: "Gate pass — courier delivery (one-time)",
      priority: "low" as const,
      status: "resolved" as const,
      requestData: {
        passType: "delivery" as const,
        visitor: { name: "Aramex Courier", phone: "+97150 1234567" },
        accompanyingPersons: 0,
        purpose: "Furniture delivery",
        validFrom: daysFromNow(-1).toISOString().slice(0, 10),
        validUntil: daysFromNow(0).toISOString().slice(0, 10),
        multipleEntries: false,
      },
      scheduleOffsetDays: -1,
    },
    {
      requestType: "technician_visit" as const,
      subject: "Electrical — flickering lights in living room",
      priority: "medium" as const,
      status: "open" as const,
      requestData: {
        discipline: "electrical" as const,
        issueSummary: "Living room ceiling lights flicker intermittently in the evening.",
        preferredWindow: {
          start: daysFromNow(6, 10).toISOString(),
          end: daysFromNow(6, 13).toISOString(),
        },
      },
      scheduleOffsetDays: 6,
    },
  ];

  // Generate ticket numbers manually for the demo so they're predictable.
  // Format: TKT-DEMO-NNNN (avoids collision with the production sequence).
  for (let i = 0; i < requests.length; i++) {
    const r = requests[i];
    const client = seededClients[i % seededClients.length];
    const project = pickFrom(seededProjects, i);

    baseRows.push({
      ticketNumber: `TKT-DEMO-${pad(1001 + i, 4)}`,
      subject: r.subject,
      description: `${DEMO_TICKET_PREFIX} ${r.subject} (seeded for demo)`,
      status: r.status,
      priority: r.priority,
      requestType: r.requestType,
      communityId: null,
      projectId: project.id,
      unitNumber: `${String.fromCharCode(65 + (i % 5))}-${pad(101 + (i % 6))}`,
      requestData: r.requestData,
      scheduledStart:
        r.scheduleOffsetDays !== null ? daysFromNow(r.scheduleOffsetDays, 9 + (i % 6)) : null,
      scheduledEnd:
        r.scheduleOffsetDays !== null
          ? daysFromNow(r.scheduleOffsetDays, 11 + (i % 6))
          : null,
      contactName: client.firstName,
      contactEmail: client.email,
      contactPhone: client.phone,
      source: "api" as const,
      createdBy: null,
      assigneeId: null,
      resolvedAt: r.status === "resolved" || r.status === "closed" ? new Date() : null,
      closedAt: r.status === "closed" ? new Date() : null,
    });
  }

  await db.insert(tickets).values(baseRows);
}

// ── Seed: appointments ──────────────────────────────────────────────────────

async function seedAppointments(
  db: Database,
  seededClients: SeededClient[]
): Promise<void> {
  const types = [
    "site_visit",
    "consultation",
    "payment_discussion",
    "maintenance_request",
  ] as const;

  const rows = Array.from({ length: 8 }).map((_, i) => {
    const client = seededClients[i];
    const offset = (i % 6) - 1; // -1 .. 4 days
    const date = daysFromNow(offset);
    return {
      referenceNumber: `${DEMO_APPOINTMENT_PREFIX}${pad(1001 + i, 4)}`,
      contactName: client.firstName,
      contactEmail: client.email,
      contactPhone: client.phone,
      clientId: client.id,
      appointmentType: pickFrom(types, i),
      scheduledDate: date.toISOString().slice(0, 10),
      scheduledTime: `${pad(9 + (i % 7))}:${i % 2 === 0 ? "00" : "30"}`,
      status: (i % 5 === 0 ? "completed" : "confirmed") as
        | "confirmed"
        | "completed",
      notes: "[DEMO] Seeded appointment",
    } satisfies typeof aiAppointments.$inferInsert;
  });

  await db.insert(aiAppointments).values(rows);
}

// ── Seed: conversations with multi-day memory ───────────────────────────────

/**
 * Seeds 3 returning-client conversations with messages spanning multiple days.
 * This powers the "memory" demo — when the client returns, the AI sees the
 * prior context and can pick up the thread (e.g. "Did you get a response
 * from the team about your move-in permit?").
 */
async function seedConversations(
  db: Database,
  seededClients: SeededClient[]
): Promise<void> {
  // Convo 1 — Ahmed (client #1), about a move-in permit, last touched 3 days ago.
  // Convo 2 — Sara (client #2), about handover timing, last touched 5 days ago.
  // Convo 3 — Khalid (client #3), Arabic-speaking, about an AC issue, last 2 days ago.

  const c1 = seededClients[0];
  const c2 = seededClients[1];
  const c3 = seededClients[2];

  const conv1 = await insertConversation(db, c1, "en", -3);
  await insertMessages(db, conv1, [
    [
      "user",
      "Hi, I'd like to request a move-in permit for unit B-103 next week.",
      -7,
    ],
    [
      "assistant",
      "Yalla — happy to help. Could you share the move date, the mover company name, the truck plate, and the crew size?",
      -7,
    ],
    [
      "user",
      "Move date is next Tuesday, mover is Al Maha Movers, plate DXB-12345, 4 crew.",
      -6,
    ],
    [
      "assistant",
      "Got it. I've opened ticket TKT-DEMO-1002 and routed it to the access team. You'll get an email once it's approved. Anything else I can help with?",
      -6,
    ],
    ["user", "Not for now, thanks.", -6],
  ]);

  const conv2 = await insertConversation(db, c2, "en", -5);
  await insertMessages(db, conv2, [
    [
      "user",
      "When is the handover for Hillside Townhomes expected?",
      -10,
    ],
    [
      "assistant",
      "Hillside Townhomes is currently in the handover phase — keys are being issued in waves. For your specific unit I'll need to verify your identity with an OTP first. Want me to send one to your registered email?",
      -10,
    ],
    ["user", "Yes please.", -9],
    [
      "assistant",
      "OTP sent. Once you share the 6-digit code I'll pull your unit details.",
      -9,
    ],
    [
      "user",
      "I'll do it later, busy now.",
      -5,
    ],
    [
      "assistant",
      "No problem — I'll be here whenever you're ready.",
      -5,
    ],
  ]);

  const conv3 = await insertConversation(db, c3, "ar", -2);
  await insertMessages(db, conv3, [
    ["user", "السلام عليكم، عندي مشكلة في التكييف بغرفة النوم.", -4],
    [
      "assistant",
      "وعليكم السلام. ممكن توصف المشكلة باختصار؟ هل التكييف ما يبرّد، أو يصدر صوت، أو لا يعمل أصلاً؟",
      -4,
    ],
    ["user", "ما يبرّد رغم أن المكيف على ١٩ درجة.", -3],
    [
      "assistant",
      "تمام، فتحت لك تذكرة TKT-DEMO-1001 وأرسلتها لفريق الصيانة. سيصلك موعد الزيارة على البريد الإلكتروني المسجل.",
      -3,
    ],
    ["user", "شكراً.", -2],
  ]);
}

async function insertConversation(
  db: Database,
  client: SeededClient,
  language: "en" | "ar",
  lastTouchedDays: number
): Promise<string> {
  const ts = daysFromNow(lastTouchedDays);
  const [row] = await db
    .insert(aiConversations)
    .values({
      participantName: client.firstName,
      participantPhone: client.phone,
      participantEmail: client.email,
      participantType: "client",
      clientId: client.id,
      channel: "web",
      language,
      status: "active",
      otpVerificationState: "verified",
      createdAt: daysFromNow(lastTouchedDays - 7),
      updatedAt: ts,
    })
    .returning({ id: aiConversations.id });
  return row.id;
}

async function insertMessages(
  db: Database,
  conversationId: string,
  msgs: ReadonlyArray<readonly [role: "user" | "assistant", content: string, dayOffset: number]>
): Promise<void> {
  const rows = msgs.map(([role, content, dayOffset], i) => ({
    conversationId,
    role,
    content,
    createdAt: (() => {
      const d = daysFromNow(dayOffset);
      d.setMinutes(d.getMinutes() + i); // preserve ordering within the same day
      return d;
    })(),
  }));
  await db.insert(aiMessages).values(rows);
}

// ── Seed: knowledge base ────────────────────────────────────────────────────

async function seedKnowledgeBase(db: Database): Promise<void> {
  await db.insert(knowledgeDocuments).values(
    ORA_KNOWLEDGE_DOCS.map((d) => ({
      title: d.title,
      content: d.content,
      sourceType: d.sourceType,
      category: d.category,
      locale: d.locale,
      sourceRefId: d.sourceRefId,
      // lastIndexedAt is left null — embeddings are generated by the
      // "Re-embed All" admin action once CF_AI_GATEWAY_URL is configured.
      lastIndexedAt: null,
    }))
  );
}

// ── Public entry points ─────────────────────────────────────────────────────

export interface SeedDemoSummary {
  communities: number;
  projects: number;
  clients: number;
  units: number;
  tickets: number;
  appointments: number;
  conversations: number;
  knowledgeDocs: number;
}

/**
 * Seed all demo data. Idempotent — automatically removes any existing demo
 * rows (matched by their `demo-*` / `[DEMO]` markers) before re-seeding so it's
 * safe to run repeatedly without unique-constraint failures.
 */
export async function seedDemo(db: Database): Promise<SeedDemoSummary> {
  // 0. Clear any prior demo rows so re-runs are idempotent.
  await resetDemo(db);

  // 1. Communities
  const seededCommunities = await seedCommunities(db);
  const bySlug = new Map(seededCommunities.map((c) => [c.slug, c]));

  // 2. Projects
  const seededProjects = await seedProjects(db, bySlug);

  // 3. Clients
  const seededClients = await seedClients(db);

  // 4. Units
  await seedUnits(db, seededProjects, seededClients);

  // 5. Tickets
  await seedTickets(db, seededProjects, seededClients);

  // 6. Appointments
  await seedAppointments(db, seededClients);

  // 7. Conversations + messages (memory demo)
  await seedConversations(db, seededClients);

  // 8. Knowledge base
  await seedKnowledgeBase(db);

  return {
    communities: seededCommunities.length,
    projects: seededProjects.length,
    clients: seededClients.length,
    units: seededProjects.length * 6,
    tickets: 12,
    appointments: 8,
    conversations: 3,
    knowledgeDocs: ORA_KNOWLEDGE_DOCS.length,
  };
}

/**
 * Remove ALL demo records identified by their tagging strategy.
 * Production user data is left untouched.
 */
export async function resetDemo(db: Database): Promise<{
  knowledgeDocs: number;
  tickets: number;
  appointments: number;
  messages: number;
  conversations: number;
  units: number;
  clients: number;
  projects: number;
  communities: number;
}> {
  // 1. Knowledge embeddings + documents
  const demoDocIds = (
    await db
      .select({ id: knowledgeDocuments.id })
      .from(knowledgeDocuments)
      .where(like(knowledgeDocuments.sourceRefId, "demo:%"))
  ).map((r) => r.id);

  let knowledgeDocsRemoved = 0;
  if (demoDocIds.length > 0) {
    await db
      .delete(knowledgeEmbeddings)
      .where(inArray(knowledgeEmbeddings.documentId, demoDocIds));
    const res = await db
      .delete(knowledgeDocuments)
      .where(inArray(knowledgeDocuments.id, demoDocIds));
    knowledgeDocsRemoved = res.rowCount ?? demoDocIds.length;
  }

  // 2. Tickets
  const ticketsRes = await db
    .delete(tickets)
    .where(like(tickets.ticketNumber, "TKT-DEMO-%"));

  // 3. Appointments
  const apptsRes = await db
    .delete(aiAppointments)
    .where(like(aiAppointments.referenceNumber, `${DEMO_APPOINTMENT_PREFIX}%`));

  // 4. Find demo clients by email pattern (used to scope conversations + units)
  const demoClients = await db
    .select({ id: aiClients.id })
    .from(aiClients)
    .where(like(aiClients.email, `%${DEMO_EMAIL_DOMAIN}`));
  const demoClientIds = demoClients.map((c) => c.id);

  let messagesRemoved = 0;
  let conversationsRemoved = 0;
  if (demoClientIds.length > 0) {
    // Conversations linked to demo clients — and the messages they contain.
    const demoConvs = await db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(inArray(aiConversations.clientId, demoClientIds));
    const demoConvIds = demoConvs.map((c) => c.id);

    if (demoConvIds.length > 0) {
      const msgRes = await db
        .delete(aiMessages)
        .where(inArray(aiMessages.conversationId, demoConvIds));
      messagesRemoved = msgRes.rowCount ?? 0;

      const convRes = await db
        .delete(aiConversations)
        .where(inArray(aiConversations.id, demoConvIds));
      conversationsRemoved = convRes.rowCount ?? demoConvIds.length;
    }
  }

  // 5. Units — identified by demo project_name marker
  const unitsRes = await db
    .delete(aiUnits)
    .where(like(aiUnits.projectName, `${DEMO_TICKET_PREFIX}%`));

  // 6. Clients
  const clientsRes = await db
    .delete(aiClients)
    .where(like(aiClients.email, `%${DEMO_EMAIL_DOMAIN}`));

  // 7. Projects (cascade-safe: unique slug prefix)
  const projectsRes = await db
    .delete(projects)
    .where(like(projects.slug, "demo-%"));

  // 8. Communities
  const communitiesRes = await db
    .delete(communities)
    .where(like(communities.slug, "demo-bayn-%"));

  return {
    knowledgeDocs: knowledgeDocsRemoved,
    tickets: ticketsRes.rowCount ?? 0,
    appointments: apptsRes.rowCount ?? 0,
    messages: messagesRemoved,
    conversations: conversationsRemoved,
    units: unitsRes.rowCount ?? 0,
    clients: clientsRes.rowCount ?? 0,
    projects: projectsRes.rowCount ?? 0,
    communities: communitiesRes.rowCount ?? 0,
  };
}

// `and`, `eq`, `sql` re-exports kept available for downstream extensions.
void and;
void eq;
void sql;
