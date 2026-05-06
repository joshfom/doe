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
 *   - aiClients.email = `<role>[n]@ora-demo.com` (e.g. `investor@ora-demo.com`,
 *     `broker@ora-demo.com`, `buyer@ora-demo.com`, `contractor@ora-demo.com`).
 *     The prefix tells the demo actor *which role they're playing* so they can
 *     just paste the email into Ora chat to be identified.
 *   - aiUnits.projectName starts with `[DEMO]` (rare legacy field) — we instead
 *     identify units via project FK
 *   - tickets.description starts with `[DEMO]`
 *   - aiAppointments.referenceNumber starts with `ORA-APT-DEMO-`
 *   - aiConversations.participantEmail follows the demo client pattern
 *   - knowledgeDocuments.sourceRefId starts with `demo:`
 */
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import type { Database } from "../db";
import {
  aiAppointments,
  aiClients,
  aiConversations,
  aiMessages,
  aiUnitInstallments,
  aiUnitPaymentPlans,
  aiUnits,
  communities,
  knowledgeDocuments,
  knowledgeEmbeddings,
  projects,
  tickets,
} from "../schema";
import { ORA_KNOWLEDGE_DOCS } from "./ora-knowledge";

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEMO_EMAIL_DOMAIN = "@ora-demo.com";
const DEMO_TICKET_PREFIX = "[DEMO]";
const DEMO_APPOINTMENT_PREFIX = "ORA-APT-DEMO-";

function demoEmail(prefix: string) {
  return `${prefix}${DEMO_EMAIL_DOMAIN}`;
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
    slug: "demo-bayn",
    nameEn: "Bayn",
    nameAr: "بيـن",
    descriptionEn:
      "ORA's flagship master community on the UAE coast — three connected districts (Coast, Marina, Hills) with villa, townhome, and apartment offerings, branded resort residences, and a marina retail promenade.",
    descriptionAr: null,
  },
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
  {
    slug: "demo-bayn-views-3",
    communitySlug: "demo-bayn",
    nameEn: "Bayn Views 3 Villas",
    shortDescriptionEn:
      "Signature villa cluster inside the Bayn masterplan — four to seven bedroom standalone villas with private gardens, rooftop decks, and panoramic community views. Handover targeted for December 2027.",
    status: "selling" as const,
    totalUnits: 60,
    availableUnits: 22,
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

/**
 * Demo personas. Each entry is a real person playing a role; the email prefix
 * IS the role label so demo actors can identify themselves to Ora AI by
 * pasting (or saying) the email and Ora resolves them via
 * `resolveIdentityByEmail`.
 *
 * Phones follow `+97150 <role-bucket><nn>` so the same lookup works on
 * WhatsApp / phone-based intake. Order is preserved so the existing
 * `seededClients[i % N]` rotations in tickets/units stay deterministic.
 */
const DEMO_PERSONAS = [
  // Buyer family (used by handover, mortgage NOC, oqood, snag scenarios)
  { prefix: "buyer",       firstName: "Hala",   lastName: "Al Mansoori", phone: "+971507711000", lang: "en" as const },
  { prefix: "cobuyer",     firstName: "Ahmed",  lastName: "Al Mansoori", phone: "+971507711001", lang: "en" as const },
  // Investors / prospective buyers
  { prefix: "investor",    firstName: "Sara",   lastName: "Mendes",      phone: "+971509002233", lang: "en" as const },
  { prefix: "investor2",   firstName: "Yousef", lastName: "Al Ahmadi",   phone: "+971509002234", lang: "ar" as const },
  { prefix: "prospect1",   firstName: "Layla",  lastName: "Hassan",      phone: "+971509100001", lang: "en" as const },
  { prefix: "prospect2",   firstName: "Nour",   lastName: "Al Marri",    phone: "+971509100002", lang: "ar" as const },
  { prefix: "prospect3",   firstName: "Rania",  lastName: "Al Zaabi",    phone: "+971509100003", lang: "en" as const },
  { prefix: "prospect4",   firstName: "Fatima", lastName: "Al Falasi",   phone: "+971509100004", lang: "ar" as const },
  // Brokers (chat side — separate from broker portal logins)
  { prefix: "broker",      firstName: "Khalid", lastName: "Al Rashid",   phone: "+971508001122", lang: "ar" as const },
  { prefix: "broker2",     firstName: "Tariq",  lastName: "Al Hosani",   phone: "+971508001123", lang: "en" as const },
  // Additional booked clients (units already reserved)
  { prefix: "buyer2",      firstName: "Omar",   lastName: "Al Hashimi",  phone: "+971507711002", lang: "en" as const },
  { prefix: "buyer3",      firstName: "Mariam", lastName: "Al Suwaidi",  phone: "+971507711003", lang: "ar" as const },
  { prefix: "buyer4",      firstName: "Bilal",  lastName: "Al Shamsi",   phone: "+971507711004", lang: "en" as const },
  // Future tenants (post-handover roadmap personas)
  { prefix: "tenant1",     firstName: "Hassan", lastName: "Al Ameri",    phone: "+971507822001", lang: "en" as const },
  { prefix: "tenant2",     firstName: "Aisha",  lastName: "Al Hashimi",  phone: "+971507822002", lang: "ar" as const },
  // Vendors + contractors + consultant (off-plan operations)
  { prefix: "vendor",      firstName: "Karim",  lastName: "Stone & Surface",   phone: "+971507777301", lang: "en" as const },
  { prefix: "vendor2",     firstName: "Dina",   lastName: "Greenleaf Landscape", phone: "+971504445566", lang: "en" as const },
  { prefix: "contractor",  firstName: "Faisal", lastName: "BuildRight",  phone: "+971506000044", lang: "en" as const },
  { prefix: "contractor2", firstName: "Maya",   lastName: "SkyLine Access",   phone: "+971506111188", lang: "en" as const },
  { prefix: "consultant",  firstName: "Ziad",   lastName: "Project Consultancy", phone: "+971507333101", lang: "en" as const },
] as const;

interface SeededClient {
  id: string;
  firstName: string;
  email: string;
  phone: string;
  preferredLanguage: "en" | "ar";
}

async function seedClients(db: Database): Promise<SeededClient[]> {
  const rows = DEMO_PERSONAS.map((p) => ({
    firstName: p.firstName,
    lastName: p.lastName,
    email: demoEmail(p.prefix),
    phone: p.phone,
    nationality: "AE",
    preferredLanguage: p.lang,
    notes: `[DEMO] Role: ${p.prefix}`,
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
    // ── Off-plan / pre-handover demo tickets ────────────────────────────────
    {
      requestType: "site_visit_booking" as const,
      subject: "Site visit — Bayn Marina sales gallery",
      priority: "medium" as const,
      status: "assigned" as const,
      requestData: {
        visitor: {
          name: "Khalid Al-Rashid",
          phone: "+971508001122",
          email: "broker@ora-demo.com",
          company: "Crown Properties",
        },
        party: "broker" as const,
        interestedProjects: ["demo-bayn-marina"],
        preferredDate: daysFromNow(3).toISOString().slice(0, 10),
        preferredWindow: { start: "10:00", end: "11:30" },
        partySize: 2,
        transport: "own_car" as const,
        language: "ar" as const,
        notes: "Client interested in 2BR sea view, AED 2.5–3M budget.",
      },
      scheduleOffsetDays: 3,
    },
    {
      requestType: "brochure_request" as const,
      subject: "Brochure + payment plan — Bayn Hills villas",
      priority: "low" as const,
      status: "resolved" as const,
      requestData: {
        requester: {
          name: "Sara Mendes",
          email: "investor@ora-demo.com",
          phone: "+971509002233",
        },
        documents: ["brochure", "floor_plan", "payment_plan"] as const,
        projectSlug: "demo-bayn-hills",
        unitType: "4BR villa",
        language: "en" as const,
        deliveryChannel: "email" as const,
      },
      scheduleOffsetDays: null,
    },
    {
      requestType: "payment_milestone" as const,
      subject: "Milestone 30% — structural completion due",
      priority: "high" as const,
      status: "open" as const,
      requestData: {
        milestoneLabel: "Structural completion (30%)",
        milestonePct: 30,
        dueDate: daysFromNow(14).toISOString().slice(0, 10),
        amount: 540000,
        currency: "AED",
        status: "due" as const,
        notes: "Reminder issued by Ora AI; awaiting bank transfer reference.",
      },
      scheduleOffsetDays: 14,
    },
    {
      requestType: "oqood_assistance" as const,
      subject: "Oqood registration — SPA BAYN-2025-0188",
      priority: "medium" as const,
      status: "in_progress" as const,
      requestData: {
        requestKind: "register" as const,
        spaReference: "BAYN-2025-0188",
        buyerName: "Hala Al-Mansoori",
        emiratesId: "784-1988-XXXXXXX-1",
        attachments: [],
        notes: "Buyer uploaded passport copy via Ora AI; needs DLD slot.",
      },
      scheduleOffsetDays: 7,
    },
    {
      requestType: "mortgage_noc" as const,
      subject: "Mortgage NOC — Emirates NBD pre-approval",
      priority: "high" as const,
      status: "open" as const,
      requestData: {
        bankName: "Emirates NBD",
        loanReference: "ENBD-MTG-77231",
        spaReference: "BAYN-2025-0188",
        buyerName: "Hala Al-Mansoori",
        requestedAmount: 1620000,
        currency: "AED",
        purpose: "pre_approval" as const,
        requiredBy: daysFromNow(10).toISOString().slice(0, 10),
        attachments: [],
      },
      scheduleOffsetDays: 10,
    },
    {
      requestType: "construction_progress_inquiry" as const,
      subject: "Progress update — Bayn Marina Tower B",
      priority: "low" as const,
      status: "resolved" as const,
      requestData: {
        projectSlug: "demo-bayn-marina",
        unitNumber: "B-1204",
        asOfMonth: "2026-04",
        requestedFormat: "photos" as const,
        notes: "Owner asked for photos of the unit floor and lobby progress.",
      },
      scheduleOffsetDays: null,
    },
    {
      requestType: "snag_submission" as const,
      subject: "Pre-handover snag list — unit M-0801",
      priority: "medium" as const,
      status: "assigned" as const,
      requestData: {
        walkthroughDate: daysFromNow(-2).toISOString().slice(0, 10),
        items: [
          {
            location: "Master bathroom",
            category: "tiling" as const,
            description: "Hairline crack on the wall tile next to vanity.",
            photos: [],
            severity: "medium" as const,
          },
          {
            location: "Living room",
            category: "paint" as const,
            description: "Roller marks visible on the south wall.",
            photos: [],
            severity: "low" as const,
          },
        ],
        accompaniedBy: "Project engineer Omar",
      },
      scheduleOffsetDays: -2,
    },
    {
      requestType: "handover_appointment" as const,
      subject: "Handover appointment — unit H-V14",
      priority: "high" as const,
      status: "open" as const,
      requestData: {
        appointmentDate: daysFromNow(21).toISOString().slice(0, 10),
        appointmentWindow: { start: "10:00", end: "12:00" },
        attendees: [
          { name: "Hala Al-Mansoori", phone: "+97150 7711000" },
          { name: "Ahmed Al-Mansoori", phone: "+97150 7711001" },
        ],
        documentsReady: {
          finalPaymentCleared: false,
          oqoodIssued: true,
          serviceChargeSettled: false,
          idVerified: true,
        },
        notes: "Final 20% pending; once cleared, schedule keys collection.",
      },
      scheduleOffsetDays: 21,
    },
    {
      requestType: "hot_works_permit" as const,
      subject: "Hot works permit — welding Tower B Level 14",
      priority: "high" as const,
      status: "open" as const,
      requestData: {
        contractor: {
          name: "BuildRight Contracting LLC",
          phone: "+97150 6000044",
          company: "BuildRight Contracting LLC",
        },
        workDescription: "MEP riser bracket welding, north shaft.",
        location: "Bayn Marina — Tower B — Level 14 north shaft",
        workTypes: ["welding", "grinding"] as const,
        validFrom: daysFromNow(2, 7).toISOString(),
        validUntil: daysFromNow(2, 17).toISOString(),
        fireWatchAssigned: true,
        nearbyHazards: "Cable trays below — covered with fire blanket.",
        extinguisherCount: 4,
        permitToWorkRef: "PTW-2026-0314",
      },
      scheduleOffsetDays: 2,
    },
    {
      requestType: "work_at_height_permit" as const,
      subject: "Work-at-height — facade cleaning Tower A",
      priority: "high" as const,
      status: "assigned" as const,
      requestData: {
        contractor: {
          name: "SkyLine Access Services",
          phone: "+97150 6111188",
          company: "SkyLine Access Services",
        },
        workDescription: "Final facade cleaning before handover inspection.",
        location: "Bayn Marina — Tower A — Levels 18 to 24",
        heightMeters: 78,
        accessMethod: "rope_access" as const,
        crewSize: 4,
        fallProtection: ["full body harness", "twin lanyard", "backup line"],
        validFrom: daysFromNow(5, 6).toISOString(),
        validUntil: daysFromNow(7, 17).toISOString(),
        rescuePlan: "Standby rescue team on Level 18 with descent kit.",
      },
      scheduleOffsetDays: 5,
    },
    {
      requestType: "lift_usage_booking" as const,
      subject: "Hoist booking — finishing materials Tower B",
      priority: "medium" as const,
      status: "open" as const,
      requestData: {
        requester: {
          name: "BuildRight Site Office",
          phone: "+97150 6000045",
          company: "BuildRight Contracting LLC",
        },
        purpose: "material_lift" as const,
        tower: "Tower B",
        floors: ["12", "13", "14"],
        startAt: daysFromNow(1, 6).toISOString(),
        endAt: daysFromNow(1, 18).toISOString(),
        weightKg: 1800,
        requiresProtection: true,
      },
      scheduleOffsetDays: 1,
    },
    {
      requestType: "inspection_request" as const,
      subject: "Civil Defence inspection — Tower A handover readiness",
      priority: "high" as const,
      status: "open" as const,
      requestData: {
        inspectionType: "civil_defence" as const,
        location: "Bayn Marina — Tower A — all common areas",
        requestedDate: daysFromNow(12).toISOString().slice(0, 10),
        requestedWindow: { start: "09:00", end: "13:00" },
        inspectorParty: {
          name: "Dubai Civil Defence inspector",
          phone: "+9714 0000000",
        },
        scope: "Fire alarm test, sprinkler flow test, smoke control verification.",
        attachments: [],
      },
      scheduleOffsetDays: 12,
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

// ── Seed: named villa clients with payment plans ────────────────────────────

/**
 * Five real-name clients owning villas in the `Bayn Views 3 Villas` cluster.
 *
 * Unlike the role-based personas above, these use real-looking emails and
 * model an actual contracted purchase. Each client has:
 *   - one villa (`aiUnits` row, status `sold`, with `cluster = "Views 3"` and
 *     a `purchasePrice`),
 *   - one signed `aiUnitPaymentPlan` (10/10/40/40 over 36 post-handover months),
 *   - a full installment ledger with paid history and computed
 *     paid/upcoming/overdue status relative to today, so the AI can answer
 *     "when is my next payment?" / "how much have I paid?" without hardcoding.
 *
 * Tagged with `[DEMO-NAMED]` in `notes` so `resetDemo()` removes them too.
 */
const NAMED_VILLA_CLIENTS = [
  {
    firstName: "Abanoub",
    lastName: "Adel",
    email: "aadel@ora-uae.com",
    phone: "+971586166310",
    nationality: "EG",
    lang: "en" as const,
    unitNumber: "Villa-279",
    areaSqm: 620,
    floors: null,
    purchasePrice: 10_000_000,
    bookingDate: "2026-03-15",
  },
  {
    firstName: "Mariam",
    lastName: "Al Suwaidi",
    email: "mariam.suwaidi@example.ae",
    phone: "+971501234567",
    nationality: "AE",
    lang: "ar" as const,
    unitNumber: "Villa-142",
    areaSqm: 540,
    floors: null,
    purchasePrice: 8_500_000,
    bookingDate: "2025-11-01",
  },
  {
    firstName: "Yousef",
    lastName: "Al Ahmadi",
    email: "yousef.ahmadi@example.ae",
    phone: "+971502345678",
    nationality: "AE",
    lang: "ar" as const,
    unitNumber: "Villa-188",
    areaSqm: 700,
    floors: null,
    purchasePrice: 12_000_000,
    bookingDate: "2026-01-20",
  },
  {
    firstName: "Layla",
    lastName: "Hassan",
    email: "layla.hassan@example.ae",
    phone: "+971503456789",
    nationality: "JO",
    lang: "en" as const,
    unitNumber: "Villa-211",
    areaSqm: 580,
    floors: null,
    purchasePrice: 9_200_000,
    bookingDate: "2025-08-10",
  },
  {
    firstName: "Khalid",
    lastName: "Al Rashid",
    email: "khalid.rashid@example.ae",
    phone: "+971504567890",
    nationality: "AE",
    lang: "en" as const,
    unitNumber: "Villa-305",
    areaSqm: 820,
    floors: null,
    purchasePrice: 15_500_000,
    bookingDate: "2026-04-05",
  },
] as const;

const NAMED_DEMO_NOTE_PREFIX = "[DEMO-NAMED]";
const HANDOVER_DATE = "2027-12-15";
const POST_HANDOVER_MONTHS = 36;

/** Add `months` calendar months to a YYYY-MM-DD date, keeping the day-of-month. */
function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  return date.toISOString().slice(0, 10);
}

/** Round to 2 decimal places (currency). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface PlannedInstallment {
  installmentNumber: number;
  labelEn: string;
  labelAr: string;
  dueDate: string;
  amountAed: number;
  paid: boolean;
}

/**
 * Build the full installment ledger for one named villa client.
 * 10% on booking, 10% +3 months later, 40% on handover, then `postHandoverMonths`
 * monthly installments starting one month after handover.
 *
 * Paid/upcoming/overdue status is derived at runtime in the seeder against
 * `new Date()` so the demo data stays meaningful as the real date drifts.
 */
function buildInstallmentPlan(
  totalPrice: number,
  bookingDate: string,
  handoverDate: string,
  postHandoverMonths: number
): PlannedInstallment[] {
  const dp1 = round2(totalPrice * 0.1);
  const dp2 = round2(totalPrice * 0.1);
  const handover = round2(totalPrice * 0.4);
  const postHandoverTotal = round2(totalPrice * 0.4);
  const monthly = round2(postHandoverTotal / postHandoverMonths);

  const items: PlannedInstallment[] = [
    {
      installmentNumber: 1,
      labelEn: "1st down payment (10%)",
      labelAr: "الدفعة الأولى (١٠٪)",
      dueDate: bookingDate,
      amountAed: dp1,
      paid: true,
    },
    {
      installmentNumber: 2,
      labelEn: "2nd down payment (10%)",
      labelAr: "الدفعة الثانية (١٠٪)",
      dueDate: addMonthsIso(bookingDate, 3),
      amountAed: dp2,
      paid: false, // status decided later vs today
    },
    {
      installmentNumber: 3,
      labelEn: "Handover payment (40%)",
      labelAr: "دفعة التسليم (٤٠٪)",
      dueDate: handoverDate,
      amountAed: handover,
      paid: false,
    },
  ];

  // Adjust last monthly installment to absorb rounding so totals match exactly.
  let runningPostTotal = 0;
  for (let i = 0; i < postHandoverMonths; i++) {
    const isLast = i === postHandoverMonths - 1;
    const amount = isLast ? round2(postHandoverTotal - runningPostTotal) : monthly;
    runningPostTotal = round2(runningPostTotal + amount);
    items.push({
      installmentNumber: 4 + i,
      labelEn: `Post-handover installment ${i + 1}/${postHandoverMonths}`,
      labelAr: `قسط بعد التسليم ${i + 1}/${postHandoverMonths}`,
      dueDate: addMonthsIso(handoverDate, i + 1),
      amountAed: amount,
      paid: false,
    });
  }

  return items;
}

interface SeededNamedClient {
  id: string;
  unitId: string;
  firstName: string;
  email: string;
  phone: string;
}

async function seedNamedVillaClients(
  db: Database,
  bayhViewsProjectId: string,
  bayhMasterCommunityId: string
): Promise<SeededNamedClient[]> {
  const today = new Date();
  const results: SeededNamedClient[] = [];

  for (const persona of NAMED_VILLA_CLIENTS) {
    // 1. Client
    const [client] = await db
      .insert(aiClients)
      .values({
        firstName: persona.firstName,
        lastName: persona.lastName,
        email: persona.email,
        phone: persona.phone,
        nationality: persona.nationality,
        preferredLanguage: persona.lang,
        notes: `${NAMED_DEMO_NOTE_PREFIX} Bayn Views 3 villa client`,
      })
      .returning({ id: aiClients.id });

    // 2. Unit
    const [unit] = await db
      .insert(aiUnits)
      .values({
        projectName: "[DEMO] Bayn Views 3 Villas",
        projectId: bayhViewsProjectId,
        communityId: bayhMasterCommunityId,
        unitNumber: persona.unitNumber,
        unitType: "villa",
        floorNumber: persona.floors,
        areaSqm: persona.areaSqm,
        status: "sold",
        constructionProgress: 55,
        estimatedHandoverDate: HANDOVER_DATE,
        cluster: "Views 3",
        purchasePrice: persona.purchasePrice,
        clientId: client.id,
      })
      .returning({ id: aiUnits.id });

    // 3. Payment plan
    const [plan] = await db
      .insert(aiUnitPaymentPlans)
      .values({
        clientId: client.id,
        unitId: unit.id,
        planName: "10/10/40/40 — Post-handover 36 months",
        totalPrice: persona.purchasePrice,
        bookingDate: persona.bookingDate,
        expectedHandoverDate: HANDOVER_DATE,
        downPaymentPct: 10,
        secondPaymentPct: 10,
        handoverPct: 40,
        postHandoverPct: 40,
        postHandoverMonths: POST_HANDOVER_MONTHS,
        notes: `${NAMED_DEMO_NOTE_PREFIX} Standard Bayn Views 3 plan`,
      })
      .returning({ id: aiUnitPaymentPlans.id });

    // 4. Installments — derive status from today
    const planned = buildInstallmentPlan(
      persona.purchasePrice,
      persona.bookingDate,
      HANDOVER_DATE,
      POST_HANDOVER_MONTHS
    );

    const rows = planned.map((it) => {
      const due = new Date(`${it.dueDate}T00:00:00Z`);
      const isPast = due.getTime() < today.getTime();
      // 1st DP is always paid (signing). 2nd DP and any other past-due
      // installments are paid for clients who have stayed current; for
      // Yousef Al Ahmadi we intentionally leave the 2nd DP overdue.
      let status: "paid" | "upcoming" | "overdue" = "upcoming";
      let paidAt: Date | null = null;
      let paymentReference: string | null = null;

      const allowOverdue = persona.email === "yousef.ahmadi@example.ae";

      if (it.installmentNumber === 1) {
        status = "paid";
        paidAt = new Date(`${it.dueDate}T10:00:00Z`);
        paymentReference = `PMT-${persona.unitNumber}-001`;
      } else if (isPast) {
        if (allowOverdue && it.installmentNumber === 2) {
          status = "overdue";
        } else {
          status = "paid";
          paidAt = new Date(`${it.dueDate}T10:00:00Z`);
          paymentReference = `PMT-${persona.unitNumber}-${pad(it.installmentNumber, 3)}`;
        }
      }

      return {
        planId: plan.id,
        installmentNumber: it.installmentNumber,
        labelEn: it.labelEn,
        labelAr: it.labelAr,
        dueDate: it.dueDate,
        amountAed: it.amountAed,
        status,
        paidAt,
        paymentReference,
      };
    });

    await db.insert(aiUnitInstallments).values(rows);

    results.push({
      id: client.id,
      unitId: unit.id,
      firstName: persona.firstName,
      email: persona.email,
      phone: persona.phone,
    });
  }

  return results;
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
  namedVillaClients: number;
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

  // 9. Named villa clients (Bayn Views 3) with payment plans
  const bayhMaster = bySlug.get("demo-bayn");
  const bayhViewsProject = seededProjects.find((p) => p.slug === "demo-bayn-views-3");
  let namedVillaClients = 0;
  if (bayhMaster && bayhViewsProject) {
    const named = await seedNamedVillaClients(db, bayhViewsProject.id, bayhMaster.id);
    namedVillaClients = named.length;
  }

  return {
    communities: seededCommunities.length,
    projects: seededProjects.length,
    clients: seededClients.length,
    units: seededProjects.length * 6,
    tickets: 12,
    appointments: 8,
    conversations: 3,
    knowledgeDocs: ORA_KNOWLEDGE_DOCS.length,
    namedVillaClients,
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

  // 4. Find demo clients by email pattern OR demo notes prefix
  //    (named villa clients use real-looking emails so notes is the only marker).
  const demoClients = await db
    .select({ id: aiClients.id })
    .from(aiClients)
    .where(
      or(
        like(aiClients.email, `%${DEMO_EMAIL_DOMAIN}`),
        like(aiClients.notes, `${NAMED_DEMO_NOTE_PREFIX}%`),
        like(aiClients.notes, `${DEMO_TICKET_PREFIX}%`)
      )
    );
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

      // Remove any appointments still referencing these conversations
      // (covers appointments whose referenceNumber doesn't match the demo prefix).
      await db
        .delete(aiAppointments)
        .where(inArray(aiAppointments.conversationId, demoConvIds));

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

  // 6. Clients (cascades to ai_unit_payment_plans and ai_unit_installments)
  const clientsRes = await db
    .delete(aiClients)
    .where(
      or(
        like(aiClients.email, `%${DEMO_EMAIL_DOMAIN}`),
        like(aiClients.notes, `${NAMED_DEMO_NOTE_PREFIX}%`),
        like(aiClients.notes, `${DEMO_TICKET_PREFIX}%`)
      )
    );

  // 7. Projects (cascade-safe: unique slug prefix)
  const projectsRes = await db
    .delete(projects)
    .where(like(projects.slug, "demo-%"));

  // 8. Communities — covers `demo-bayn` (master) and `demo-bayn-*` (subs)
  const communitiesRes = await db
    .delete(communities)
    .where(like(communities.slug, "demo-bayn%"));

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
