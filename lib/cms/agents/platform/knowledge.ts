// lib/cms/agents/platform/knowledge.ts
//
// The Platform_Brain — a curated, version-controlled body of knowledge ABOUT the
// DOE platform itself, plus a deterministic retrieval function the Home_Agent's
// `get_platform_knowledge` tool dispatches to (lib/cms/ai/tools/platform-capabilities.ts).
//
// WHY A CURATED MODULE, NOT RAG. The marketing/RAG knowledge base
// (`knowledge_documents` / `knowledge_embeddings`) answers questions about the
// real-estate PRODUCT (Bayn, ORA, units). This module answers questions about
// the PLATFORM as a piece of software — "what is DOE", "what can it do", "why
// build our own agentic core instead of buying a ready-made one", "what's next".
// These answers must be exact, honest, and not drift with an embedding model, so
// they live as reviewed source, retrieved by deterministic keyword scoring (no
// model, no embedding latency, fully testable). The agent NARRATES these
// sections; it never invents platform facts.
//
// HONESTY CONTRACT. Every claim here describes what is actually built and wired
// in this repository (verified against the agent runtime, the audited
// dispatcher, the metrics views, the Salesforce client, and the panel surfaces).
// The build-vs-buy sections deliberately state where ready-made vendors WIN, so
// the case survives an executive's scrutiny rather than reading as a sales
// pitch.
//
// [no I/O] This module is pure data + pure functions: it opens no database
// connection and calls no model. It is safe to import from any tier.

// ── Data model ────────────────────────────────────────────────────────────────

/** The thematic bucket a knowledge section belongs to. */
export type PlatformKnowledgeCategory =
  | "overview"
  | "capabilities"
  | "architecture"
  | "build-vs-buy"
  | "governance"
  | "future";

/** One reviewed, self-contained answer about the platform. */
export interface PlatformKnowledgeSection {
  /** Stable id (also the deterministic tie-break key). */
  id: string;
  /** Human title, surfaced to the agent and the reader. */
  title: string;
  /** The thematic bucket, usable as a retrieval filter. */
  category: PlatformKnowledgeCategory;
  /** Lower-cased retrieval keywords; the strongest match signal. */
  keywords: readonly string[];
  /** A one/two-sentence answer the agent can lead with. */
  summary: string;
  /** The full, factual body (markdown), narrated by the agent. */
  content: string;
}

/** A scored retrieval hit returned by {@link searchPlatformKnowledge}. */
export interface PlatformKnowledgeMatch {
  id: string;
  title: string;
  category: PlatformKnowledgeCategory;
  summary: string;
  content: string;
  /** Non-negative relevance score; higher is more relevant. */
  score: number;
}

// ── The curated knowledge ─────────────────────────────────────────────────────

/**
 * The Platform_Brain sections. Ordered roughly overview → capabilities →
 * architecture → build-vs-buy → governance → future, but retrieval is by score,
 * not order.
 */
export const PLATFORM_KNOWLEDGE: readonly PlatformKnowledgeSection[] = [
  {
    id: "what-is-doe",
    title: "What is DOE?",
    category: "overview",
    keywords: [
      "what",
      "doe",
      "ora",
      "platform",
      "overview",
      "about",
      "introduction",
      "define",
      "definition",
      "summary",
    ],
    summary:
      "DOE is ORA's agent-first real-estate operations platform: one audited AI " +
      "core (Mastra) that lets every department get work done by conversation — " +
      "in text and voice, English and Arabic — instead of clicking through forms.",
    content: [
      "DOE is ORA's in-house agentic platform for real-estate operations. It is",
      "not a chatbot bolted onto a website — it is an agent runtime where the",
      "work of sales, marketing, finance, project/HSE/security and the executive",
      "team flows through ONE governed AI core.",
      "",
      "Three things make it 'agent-first' rather than 'a website with a chatbot':",
      "- A real orchestration core (Mastra) plans and runs multi-step work, keeps",
      "  per-entity memory, and is fully traceable.",
      "- Every action an agent takes runs through a single audited tool boundary —",
      "  validated, permission-checked, OTP-gated, and written to the audit log.",
      "- It speaks the business natively: bilingual (EN/AR, RTL), and modelled",
      "  around real ORA workflows (leads, bookings, oqood, NOC, snags, handover,",
      "  permits, brokers, RERA).",
      "",
      "The classic admin UI still exists as a fallback, but the intended primary",
      "surface is the agent: staff brief, delegate, query and act by talking to it.",
    ].join("\n"),
  },
  {
    id: "capabilities-today",
    title: "What can DOE do today?",
    category: "capabilities",
    keywords: [
      "capabilities",
      "features",
      "can",
      "do",
      "today",
      "now",
      "agents",
      "voice",
      "text",
      "leads",
      "reporting",
      "briefing",
      "salesforce",
      "current",
    ],
    summary:
      "Four live agents (text, admin, home/twin, voice), an audited tool catalog, " +
      "per-entity memory, live reasoning traces, a briefing-first home, two-way " +
      "Salesforce, and SQL-sourced analytics.",
    content: [
      "Built and wired today:",
      "",
      "- Four Mastra agents on one runtime: a public TEXT assistant, a staff ADMIN",
      "  agent (read-only reports + human-in-the-loop confirmation for destructive",
      "  actions), a HOME/twin agent that runs the agent-first home surface, and a",
      "  VOICE agent (LiveKit + Deepgram + ElevenLabs) that qualifies leads by phone.",
      "- One shared, audited tool catalog. Every tool call passes Zod validation →",
      "  RBAC permission → OTP gate → exactly one audit-log row → execute.",
      "- Per-entity agent memory (Postgres + pgvector) keyed to user/lead/rep/deal/",
      "  conversation, with raw phone numbers never persisted.",
      "- Live agent tracing streamed to the panel: you can watch the agent's",
      "  decisions, tool calls and latency in real time (the Voice Console).",
      "- A briefing-first home screen that greets the user, summarises yesterday/",
      "  today, and lets them manage the platform by chat (delegate tasks, check",
      "  leads, trigger reports).",
      "- Two-way Salesforce: outbound Cases (idempotent outbox + retry) and inbound",
      "  Lead polling with dedupe into a local mirror.",
      "- Analytics from SQL views (week-over-week, tier funnel, speed-to-lead, cost",
      "  per qualified lead, rep load) — figures come from SQL, the agent only",
      "  narrates them, so reported numbers can't be hallucinated.",
      "",
      "Honest current limits: the standalone reporting agent and the autonomous",
      "lead parse/distribution/enrichment agents are designed but not yet built",
      "(the home agent uses bound tools in their place); live external lead sources",
      "are scaffolded but idle until credentials are wired.",
    ].join("\n"),
  },
  {
    id: "capabilities-by-department",
    title: "How does DOE help each department?",
    category: "capabilities",
    keywords: [
      "department",
      "departments",
      "team",
      "teams",
      "sales",
      "marketing",
      "finance",
      "executive",
      "ceo",
      "project",
      "hse",
      "security",
      "who",
      "use",
      "users",
      "everyone",
    ],
    summary:
      "Sales qualifies and routes leads, marketing sees attribution and cost-per-" +
      "lead, finance gets audited approvals, project/HSE/security run permits and " +
      "gate passes, and the executive brainstorms with a data-grounded twin.",
    content: [
      "DOE is one platform, many roles — each sees what their permissions allow:",
      "",
      "- Sales: agents capture, qualify (HOT/WARM/NURTURE), and route leads to the",
      "  right rep by project × language × capacity; bookings and viewings are",
      "  agent-driven.",
      "- Marketing: attribution and cost-per-qualified-lead by channel, RSVP and",
      "  brochure flows, campaign spend tied to outcomes.",
      "- Finance: NOC/commission/invoice actions run behind a human-in-the-loop",
      "  confirmation and a full audit trail.",
      "- Project / HSE / Security: hot-works and work-at-height permits, gate passes,",
      "  snag lists, handover readiness — each with the right approver in the loop.",
      "- Executive (C-level): a data-grounded 'twin' to brainstorm with — compare",
      "  leads week-over-week or quarter-over-quarter, inspect the pipeline, ask for",
      "  predictions grounded in real figures, and email a report to the team.",
      "",
      "The common thread: the human decides; the agent does the heavy lifting and",
      "leaves an audit trail.",
    ].join("\n"),
  },
  {
    id: "architecture",
    title: "How is DOE built? (architecture)",
    category: "architecture",
    keywords: [
      "architecture",
      "how",
      "built",
      "stack",
      "mastra",
      "dispatcher",
      "audit",
      "design",
      "technical",
      "core",
      "brain",
      "hands",
      "tools",
      "catalog",
    ],
    summary:
      "Mastra is the brain (plans, remembers, reasons); a single audited dispatcher " +
      "is the hands (every mutation is validated, permission-checked, OTP-gated, " +
      "and audited). Agents never touch the database directly.",
    content: [
      "The guiding decision: 'Mastra is the brain; the typed dispatcher is the",
      "hands.'",
      "",
      "- The brain: Mastra agents and workflows plan, keep memory, and reason over",
      "  multiple steps. They run on the container tier (never serverless) and are",
      "  routed through one model gateway with cost/latency tiers.",
      "- The hands: every agent action is a catalog tool whose execute() flows",
      "  through ONE dispatcher — Zod validation, RBAC permission, OTP gate, exactly",
      "  one audit row, then execute. Agents hold a tool only by its catalog name,",
      "  so they can never call an off-catalog tool or write to the database",
      "  directly.",
      "- The data: PostgreSQL + Drizzle, pgvector for memory/RAG, SQL views as the",
      "  single source of every reported figure.",
      "- The surfaces: a Next.js panel and public site, an Elysia/Bun API and",
      "  long-lived workers for voice, the outbox drainer, and background jobs.",
      "",
      "Why it matters: this split is what lets the platform gain open-ended agent",
      "reasoning WITHOUT giving up the auditability, permissioning and privacy the",
      "business (and regulators like DLD/RERA) require.",
    ].join("\n"),
  },
  {
    id: "build-vs-buy-summary",
    title: "Why build DOE instead of buying a ready-made agent?",
    category: "build-vs-buy",
    keywords: [
      "why",
      "build",
      "buy",
      "instead",
      "ready-made",
      "readymade",
      "vendor",
      "agentforce",
      "copilot",
      "off-the-shelf",
      "case",
      "versus",
      "vs",
      "compare",
      "comparison",
      "own",
      "ownership",
    ],
    summary:
      "Buying is faster to start; building gives ownership of the reasoning core, " +
      "the audit semantics your infra team already governs, native Arabic + real-" +
      "estate depth, model-swap freedom, and no per-conversation tax. Build where " +
      "the work is core and differentiating; buy where it's commodity.",
    content: [
      "The honest case — no fluff:",
      "",
      "What you give up by buying a ready-made agent (Agentforce, Copilot,",
      "Agentspace and similar):",
      "- The reasoning core is a vendor black box. You configure it; you don't own",
      "  how it plans or what it can be made to do.",
      "- Pricing is typically per-conversation / per-seat and recurring — cost grows",
      "  with success, and multi-step agent loops are exactly the expensive case.",
      "- Audit, permission and privacy semantics are the vendor's model, not yours.",
      "  You adapt to their governance; you can't redefine the boundary your own",
      "  infra/security team already runs.",
      "- Arabic (RTL) and ORA's real-estate domain (oqood, NOC, snags, handover,",
      "  RERA, broker flows) are add-ons you build on top anyway.",
      "",
      "What owning DOE gives you:",
      "- You own the orchestration core. You can swap models, tune the loop, and",
      "  add a capability without waiting on a vendor roadmap or paying a per-call",
      "  tax.",
      "- The audited dispatch boundary IS your governance surface — the same one",
      "  your infra team secures, monitors and fine-tunes (see 'governance').",
      "- Native bilingual + domain fit, because the platform was modelled around",
      "  ORA's actual workflows, not retrofitted.",
      "- Full observability: every agent run is traceable, so your team can monitor",
      "  and improve behaviour with real evidence.",
      "",
      "Where ready-made genuinely wins (be honest about this):",
      "- Time-to-first-value: a vendor can demo a generic agent in days.",
      "- Breadth of pre-built connectors and a mature eval/guardrail toolchain.",
      "- Support SLAs and someone else's on-call for the core runtime.",
      "",
      "The decision rule: BUILD where the capability is core and differentiating to",
      "ORA and where you have the infra team to own it; BUY where it's commodity,",
      "non-differentiating, or where speed matters more than control. DOE is the",
      "build case precisely because lead intelligence, bilingual voice, and the",
      "audited domain workflows ARE the differentiation — and ORA already has the",
      "infra/security team to own, govern and fine-tune it.",
    ].join("\n"),
  },
  {
    id: "build-vs-buy-when-not",
    title: "When should we NOT build (and just buy)?",
    category: "build-vs-buy",
    keywords: [
      "when",
      "not",
      "avoid",
      "buy",
      "ready-made",
      "downside",
      "risk",
      "risks",
      "cost",
      "team",
      "maintain",
      "maintenance",
      "tradeoff",
      "tradeoffs",
      "commodity",
    ],
    summary:
      "Don't build for commodity workflows a vendor already covers, when there's " +
      "no infra/owner team to maintain it, or when time-to-market strictly trumps " +
      "control. Owning a core is a standing commitment, not a one-off project.",
    content: [
      "Building your own agentic core is the right call only under real conditions.",
      "Do NOT build when:",
      "",
      "- The workflow is commodity (generic email triage, calendar scheduling,",
      "  off-the-shelf helpdesk) and a vendor already does it well — owning it adds",
      "  cost without differentiation.",
      "- There is no team to own it. An agentic core is a standing commitment:",
      "  model drift, prompt/eval upkeep, cost monitoring, security patching. Without",
      "  an infra/owner team it becomes a liability.",
      "- Time-to-market strictly dominates. If a generic agent 'good enough' next",
      "  week beats a tailored one next quarter for a given use case, buy it for",
      "  that case.",
      "- The data or compliance surface is trivial. The audit/permission ownership",
      "  that justifies building matters most where data is sensitive and regulated.",
      "",
      "Note for ORA specifically: the usual blocker to building — 'who will own the",
      "security, data governance, audit trail and monitoring?' — is already",
      "answered. ORA has an infra team strong in exactly those areas. That removes",
      "the main reason most companies are forced to buy, and shifts DOE's value to",
      "fine-tuning and control rather than just feature parity.",
    ].join("\n"),
  },
  {
    id: "governance-infra-team",
    title: "Security, data governance, audit & the infra team",
    category: "governance",
    keywords: [
      "security",
      "governance",
      "data",
      "audit",
      "trail",
      "compliance",
      "infra",
      "infrastructure",
      "monitoring",
      "monitor",
      "fine-tune",
      "finetune",
      "tuning",
      "privacy",
      "rbac",
      "otp",
      "control",
    ],
    summary:
      "Because every agent action runs through one audited, permissioned, OTP-gated " +
      "dispatcher, ORA's infra team governs, monitors and fine-tunes the platform " +
      "with the same tools they already use — the boundary is owned, not rented.",
    content: [
      "DOE's governance is a property of its architecture, not an add-on:",
      "",
      "- One choke point. Every mutation and every personal-data read goes through",
      "  the single dispatcher. There is no side door — agents can't touch the DB",
      "  directly. That one boundary is where security, RBAC, OTP and audit live.",
      "- Audit by construction. Each tool call writes exactly one audit-log row",
      "  (actor, action, entity, summary) — for successes AND every failure mode",
      "  (denied, invalid, OTP-intercepted). The audit trail is complete by design.",
      "- Privacy by construction. Raw phone numbers are salted-hashed; event and",
      "  audit payloads carry ids/hashes only, never raw personal contact data.",
      "- Permission by construction. RBAC is checked on every call; OTP gates any",
      "  personal/account read; nothing bypasses it, not even an agent.",
      "",
      "Why this fits an infra-led org: the boundary is OWNED, so ORA's infra/security",
      "team can monitor it (the trace bus + audit log), set the model tiers and cost",
      "ceilings, tune the prompts/evals, and tighten any permission — with their own",
      "tooling, on their own terms. A ready-made vendor's equivalent boundary is",
      "rented: you accept their semantics and their telemetry. Here, fine-tuning and",
      "monitoring are first-class because the team controls the core.",
    ].join("\n"),
  },
  {
    id: "future-roadmap",
    title: "What is the future of DOE?",
    category: "future",
    keywords: [
      "future",
      "roadmap",
      "next",
      "plan",
      "plans",
      "coming",
      "vision",
      "later",
      "upcoming",
      "direction",
      "where",
      "going",
    ],
    summary:
      "Next: a dedicated reporting/twin agent and deeper CRM analytics (Opportunity/" +
      "quarter), autonomous lead parse/distribute/enrich/nudge agents, live lead " +
      "sources, and richer evals — all on the same audited core.",
    content: [
      "The platform is built to grow capability-by-capability on the same audited",
      "core. The near-term direction:",
      "",
      "- Executive reporting & twin: a dedicated reporting agent with deeper CRM",
      "  analytics — Opportunity/Contact data and quarter-over-quarter comparisons,",
      "  not just lead counts — so C-levels can brainstorm on real pipeline and",
      "  revenue, with predictions grounded in cited figures.",
      "- A real lead engine: autonomous agents that parse messy inbound leads,",
      "  dedupe against Salesforce, distribute to the right rep, enrich with history",
      "  ('lead DNA'), and proactively nudge stale leads — across web, WhatsApp,",
      "  email and portal sources.",
      "- Voice on top of the proven text core, activated on the public site behind a",
      "  toggle, with the live reasoning console for operators.",
      "- Stronger evals and tracing so behaviour can be measured and improved with",
      "  evidence as the agents take on more.",
      "",
      "The principle stays fixed: more autonomy, but every step still flows through",
      "the audited dispatcher — the platform gets smarter without getting less",
      "governable.",
    ].join("\n"),
  },
  {
    id: "vision-one-core",
    title: "The big idea: scattered data into one moving core",
    category: "future",
    keywords: [
      "vision",
      "scattered",
      "fragmented",
      "silos",
      "silo",
      "unify",
      "unified",
      "single",
      "source",
      "truth",
      "core",
      "consolidate",
      "spread",
      "everywhere",
      "follow-up",
      "followup",
      "administrative",
      "admin",
      "mega",
      "bayn",
      "project",
      "overhead",
      "manual",
    ],
    summary:
      "A mega project like Bayn scatters work across spreadsheets, inboxes, portals " +
      "and systems. DOE's direction is to turn that scattered data into one moving " +
      "core — the agent becomes the connective tissue that chases the follow-ups so " +
      "people don't have to.",
    content: [
      "On a mega development like Bayn, the hard part isn't any single system — it's",
      "that the work is SCATTERED: leads in one CRM, permits in a tracker, snags in",
      "spreadsheets, approvals in email threads, progress in someone's head. The",
      "administrative tax is the follow-up — chasing who owes what, where a request",
      "is stuck, which number is the latest.",
      "",
      "DOE's vision is to make the agent the connective tissue across those islands:",
      "- It pulls the scattered, mostly-administrative data into one moving core that",
      "  is always current, rather than a static dashboard that's stale by morning.",
      "- It does the chasing — the follow-ups, the nudges, the 'where is this' —",
      "  through the same audited tool boundary, so nothing it touches is ungoverned.",
      "- People stop being the integration layer between systems; the agent is.",
      "",
      "The pitch in one line: ORA generates a lot of scattered administrative work;",
      "a fully-developed DOE agent turns that scatter into one living core and takes",
      "the follow-up load off the team — without anyone losing the audit trail or",
      "control.",
    ].join("\n"),
  },
  {
    id: "vision-c-level-twin",
    title: "For the C-level: talk to your data like a friend",
    category: "capabilities",
    keywords: [
      "c-level",
      "clevel",
      "ceo",
      "executive",
      "exec",
      "twin",
      "decision",
      "decisions",
      "friend",
      "talk",
      "conversation",
      "tone",
      "brainstorm",
      "advisor",
      "strategic",
      "my",
      "data",
    ],
    summary:
      "For an executive, DOE is a twin you talk to like a trusted colleague: ask in " +
      "plain language, get answers grounded in real figures and shaped to your tone " +
      "and depth, so you can make the call faster.",
    content: [
      "The C-level surface is deliberately conversational, not another dashboard.",
      "The idea: talk to your business the way you'd talk to a sharp colleague who",
      "happens to have every figure at hand.",
      "",
      "- Ask in plain language — 'how are we tracking vs last quarter?', 'what's at",
      "  risk this week?', 'where should I push?' — and get an answer grounded in",
      "  real SQL-sourced figures, never invented.",
      "- The twin adapts to YOU: a strategic, summary tone for a quick read, or",
      "  operational detail when you want to dig — the persona shapes the wording,",
      "  never the numbers.",
      "- It's a thinking partner for decisions, not a report generator: compare",
      "  periods, pressure-test an assumption, then have it email the team the",
      "  follow-up — all audited.",
      "",
      "The goal is simple: less time assembling the picture, more time deciding —",
      "your data, in your language, processed for your judgement.",
    ].join("\n"),
  },
  {
    id: "future-telephony",
    title: "Where it can go: telephony & the contact channel",
    category: "future",
    keywords: [
      "telephony",
      "phone",
      "call",
      "calls",
      "calling",
      "outbound",
      "inbound",
      "ivr",
      "hotline",
      "callback",
      "voicemail",
      "sip",
      "contact",
      "channel",
      "whatsapp",
    ],
    summary:
      "The live voice agent extends naturally into full telephony: inbound hotline " +
      "and IVR replacement, outbound qualification and callbacks, and follow-ups " +
      "across phone, WhatsApp and email — all on the same audited core.",
    content: [
      "Voice is already live (LiveKit + Deepgram + ElevenLabs) for lead",
      "qualification. The same agent extends into the broader contact channel:",
      "",
      "- Inbound: a hotline / IVR replacement that understands the caller, answers",
      "  in EN/AR, books a viewing or routes to the right rep — no phone-tree maze.",
      "- Outbound: agent-initiated qualification calls, viewing reminders, and",
      "  callbacks scheduled off a stale-lead nudge.",
      "- Omnichannel follow-up: the same conversation can move between phone,",
      "  WhatsApp and email without the customer repeating themselves.",
      "",
      "Because every action still flows through the audited dispatcher, a call that",
      "books, updates or escalates leaves the same clean trail as a click would.",
    ].join("\n"),
  },
  {
    id: "future-community",
    title: "Where it can go: community management",
    category: "future",
    keywords: [
      "community",
      "communities",
      "resident",
      "residents",
      "owner",
      "owners",
      "tenant",
      "hoa",
      "amenity",
      "amenities",
      "service",
      "request",
      "requests",
      "complaint",
      "complaints",
      "announcement",
      "facilities",
      "maintenance",
    ],
    summary:
      "Post-handover, the same core can run community management: resident service " +
      "requests, amenity bookings, announcements and complaint triage — each routed " +
      "to the right team with an audit trail.",
    content: [
      "Once residents move in, the platform's reach extends from selling units to",
      "running the community:",
      "",
      "- Service requests & maintenance: a resident reports an issue by chat or",
      "  voice; the agent triages it, opens the ticket, routes it to facilities, and",
      "  follows up until it's closed.",
      "- Amenity bookings: pools, gyms, function rooms — booked conversationally,",
      "  with rules and capacity enforced by the same tool boundary.",
      "- Announcements & complaints: broadcast notices, capture and categorise",
      "  complaints, and surface recurring problems to management.",
      "",
      "It's the same audited core pointed at a new phase of the asset's life — no",
      "second platform to buy or govern.",
    ].join("\n"),
  },
  {
    id: "future-iot",
    title: "Where it can go: IoT in the community",
    category: "future",
    keywords: [
      "iot",
      "sensor",
      "sensors",
      "device",
      "devices",
      "smart",
      "access",
      "control",
      "metering",
      "utilities",
      "energy",
      "predictive",
      "telemetry",
      "alerts",
      "anomaly",
      "building",
    ],
    summary:
      "IoT telemetry (access control, metering, environmental and equipment " +
      "sensors) can feed the agent so it turns raw signals into action — anomaly " +
      "alerts, predictive maintenance tickets, and answers grounded in live data.",
    content: [
      "Communities and sites are increasingly instrumented. DOE can make that",
      "telemetry actionable rather than just charted:",
      "",
      "- Ingest signals: access control, utility/sub-metering, environmental and",
      "  equipment sensors stream into the platform.",
      "- Turn signals into action: an anomaly (a chiller drawing too much power, a",
      "  door forced, consumption spiking) becomes an agent-raised ticket routed to",
      "  the right team — predictive maintenance instead of reactive.",
      "- Answer from live data: 'which buildings are over their energy baseline this",
      "  week?' answered from real telemetry, with the figures cited.",
      "",
      "The governance model is unchanged: a device signal can inform the agent, but",
      "any action it triggers still passes RBAC, OTP (where relevant) and audit.",
    ].join("\n"),
  },
  {
    id: "future-construction-bayn",
    title: "Where it can go: Bayn construction-site operations",
    category: "future",
    keywords: [
      "construction",
      "site",
      "bayn",
      "permit",
      "permits",
      "approval",
      "approvals",
      "request",
      "requests",
      "progress",
      "inspection",
      "inspections",
      "snag",
      "snags",
      "contractor",
      "contractors",
      "hse",
      "safety",
      "handover",
      "milestone",
      "milestones",
    ],
    summary:
      "On the Bayn site, the agent can run the administrative spine: permit requests " +
      "and approvals, progress and milestone tracking, inspections and snags, and " +
      "the relentless follow-up between contractors, HSE and the project office.",
    content: [
      "Bayn is a mega project, and mega projects drown in coordination. The agent",
      "can own the administrative spine of the site:",
      "",
      "- Permits & approvals: contractors request hot-works / work-at-height / lift",
      "  permits by chat or voice; the agent checks prerequisites, routes to the HSE",
      "  approver, and chases the decision — with every step audited.",
      "- Progress & milestones: capture daily progress, roll it up against the",
      "  programme, and flag slippage before it becomes a surprise.",
      "- Inspections & snags: log inspections, track snag lists to closure, and tie",
      "  readiness to handover.",
      "- The follow-up engine: who owes what, what's blocked, what's overdue — the",
      "  agent does the chasing across contractors, consultants, HSE and the project",
      "  office so the team manages exceptions, not inboxes.",
      "",
      "This is where 'scattered data into one moving core' pays off most: a single,",
      "current, audited view of a site that today lives in a dozen places.",
    ].join("\n"),
  },
] as const;

// ── Retrieval ─────────────────────────────────────────────────────────────────

/** Tokens ignored when scoring a query (common words carry no signal). */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "from", "how", "i", "in", "is", "it", "of", "on", "or", "our", "should", "so",
  "that", "the", "to", "us", "we", "what", "why", "with", "you", "your",
]);

/** Default number of sections returned by a search. */
export const PLATFORM_KNOWLEDGE_DEFAULT_TOP_K = 3;

/** Split a string into lower-cased, de-stopworded word tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Options for {@link searchPlatformKnowledge}. */
export interface SearchPlatformKnowledgeOptions {
  /** Max sections to return (default {@link PLATFORM_KNOWLEDGE_DEFAULT_TOP_K}). */
  topK?: number;
  /** Restrict the search to one category. */
  category?: PlatformKnowledgeCategory;
}

/**
 * Score and return the most relevant Platform_Brain sections for a query
 * (Design: deterministic, model-free retrieval over reviewed source).
 *
 * Scoring per query token: a keyword hit weighs 3, a title hit 2, and a body
 * substring hit 1. Sections are returned highest-score first; ties break by id
 * for stable, testable ordering. A query with no signal (only stopwords) yields
 * an empty result rather than an arbitrary section, so the agent can ask for a
 * clearer question instead of guessing.
 */
export function searchPlatformKnowledge(
  query: string,
  opts: SearchPlatformKnowledgeOptions = {},
): PlatformKnowledgeMatch[] {
  const topK = Math.max(1, opts.topK ?? PLATFORM_KNOWLEDGE_DEFAULT_TOP_K);
  const tokens = tokenize(query);

  const pool = opts.category
    ? PLATFORM_KNOWLEDGE.filter((s) => s.category === opts.category)
    : PLATFORM_KNOWLEDGE;

  if (tokens.length === 0) return [];

  const scored = pool.map((section) => {
    const keywordSet = new Set(section.keywords);
    const titleTokens = new Set(tokenize(section.title));
    const body = section.content.toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (keywordSet.has(token)) score += 3;
      if (titleTokens.has(token)) score += 2;
      if (body.includes(token)) score += 1;
    }
    return { section, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : a.section.id.localeCompare(b.section.id),
    )
    .slice(0, topK)
    .map(({ section, score }) => ({
      id: section.id,
      title: section.title,
      category: section.category,
      summary: section.summary,
      content: section.content,
      score,
    }));
}

/**
 * The list of every platform topic (id, title, category, summary) — used by the
 * agent to enumerate what it can explain ("what can you tell me about the
 * platform?") without retrieving full bodies.
 */
export function listPlatformTopics(): Array<
  Pick<PlatformKnowledgeSection, "id" | "title" | "category" | "summary">
> {
  return PLATFORM_KNOWLEDGE.map(({ id, title, category, summary }) => ({
    id,
    title,
    category,
    summary,
  }));
}
