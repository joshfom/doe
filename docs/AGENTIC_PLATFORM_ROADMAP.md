# DOE Agentic Platform — Discovery, Gap Analysis & Program Roadmap

> Status: Discovery / planning document. Not a spec.
> Purpose: capture where we are, the gap to the agent-first vision, what must be
> built, and what each of the six specs should cover — so specs can be picked up
> and worked in parallel by different people. The first spec (Agentic Foundation)
> should be authored before the others begin implementation, because everything
> else binds to it.

---

## 0. How to use this document

- **Section 1–2**: the vision and the guiding architectural decision. Read first.
- **Section 3**: current-state inventory with concrete file references — what we
  can reuse.
- **Section 4**: the gap analysis (capability-by-capability).
- **Section 5**: the six specs. Each has goal, scope (in/out), deliverables,
  dependencies, what to reuse, risks, and suggested correctness properties.
- **Section 6**: cross-cutting concerns every spec must honour.
- **Section 7**: sequencing & parallelization (what can start now vs blocked).
- **Section 8**: open decisions to resolve before/early in Spec 1.
- **Section 9**: glossary.

When you start a spec, create it under `.kiro/specs/<feature-name>/` and link
back to the relevant section here.

---

## 1. The vision (distilled)

DOE becomes an **agent-first platform**: nearly everything is doable through
intelligent agents, with the classic UI as a backup, not the primary surface.
Concretely:

- **Mastra is the orchestration core** for all agentic work. Everything we have
  today moves to (or behind) Mastra for planning, multi-step workflows, memory,
  handoffs, tracing, and evals.
- **A real lead engine.** Collect leads from many sources; an agent parses,
  deduplicates, checks Salesforce for an existing lead, enriches with history /
  "DNA" (anything that helps the human who will own the lead understand them),
  routes/distributes to the right rep, and proactively nudges. Lead management is
  agentic and proactive, not a passive inbox.
- **Broker management & onboarding** handled agentically.
- **Administrative tasks** handled agentically (the platform runs itself as much
  as possible).
- **Digital twins / sparring partners.** High-intelligence, human-like agents that
  work *alongside* sales reps and C-levels. They know internal data, pull records,
  analyse, and surface predictions so the human can understand and decide. A
  twin is shaped by the person's persona/role.
- **Agentic reporting.** C-levels chat *with* their report instead of reading a
  dashboard. The agent does graph analytics on the fly, and the output can be
  downloaded or emailed.
- **Briefing-first home screen.** The dashboard is the user's twin: a
  good-morning / -afternoon / -evening greeting; morning = "here's yesterday,
  here's today's stack, want to add anything?"; evening = wrap-up + combine tasks
  into daily/weekly reports. Users delegate tasks, check leads, and manage the
  platform by chatting.
- **Voice is a layer on top of the proven agentic text core** — added only after
  the text agents work well, then embedded on top.

Sequence the user wants: **text agentic core first, voice on top second.**

---

## 2. The guiding architectural decision (read before any spec)

The repo deliberately chose **deterministic intent dispatch** for the text
assistant (see `docs/ai-tool-calling-pattern.md`) for reliability and audit. The
agent-first vision needs the opposite: open-ended planning, multi-tool reasoning,
memory, and agent-to-agent handoff. Mastra is the right category of runtime for
that.

**Decision: Mastra is the brain; the existing typed dispatcher is the hands.**

- Mastra agents/workflows **reason and plan**, but they **never touch the
  database directly**. Every mutation flows through the existing
  audited tool dispatcher (`POST /api/tools/:toolName`, `lib/cms/ai/tools/dispatch.ts`),
  which enforces Zod validation, RBAC permission, OTP gating, and writes exactly
  one audit-log entry per call.
- This preserves the auditability the team values *and* gains real orchestration.
- The voice surface's typed tool registry (`lib/cms/ai/tools/registry.ts`) is the
  seed of the **one canonical, shared tool/skill catalog** that every agent (text,
  voice, lead, twin, reporting) will use. We unify the three current patterns
  (text intents, admin-agent intents, voice registry) into this single catalog.

Migration philosophy: **wrap, don't rip out.** Keep deterministic dispatch as a
fallback and migrate capability-by-capability onto Mastra. Re-base voice onto the
shared core last.

---

## 3. Current-state inventory (what we can reuse)

### 3.1 Text assistant (deterministic) — `lib/cms/ai/`
- `agent.ts` — intent detection (keyword/regex) + typed dispatch (create ticket,
  create lead, register lead, booking, cancel/reschedule, OTP, handover, navigate).
- `chat.ts` — public chat orchestrator (`POST /ai/chat` via `routes/ai-chat.ts`).
- `admin-agent.ts` — staff agent: read-only reports + destructive ops behind a
  single-use confirmation token (human-in-the-loop). Seed of the C-level agent.
- `rag.ts` — retrieval over `knowledgeDocuments` / `knowledgeEmbeddings`.
- `gateway.ts` — single model transport (Cloudflare AI Gateway, OpenAI-compatible
  `fetch`). Supports native tool-calling when pointed at an OpenAI model.
- `identity.ts`, `otp.ts` — identity resolution + OTP gating.
- `actions.ts` — typed DB actions with audit (e.g. `bookAppointment`).
- `handoff.ts` / `handoff-state.ts`, `conversation-summary.ts`, `scope.ts`,
  `language.ts`, `content-sync.ts`, `email.ts` (Microsoft Graph mail), `seed.ts`.

### 3.2 Voice surface (new) — agentic execution layer
- `lib/cms/ai/tools/registry.ts` + `dispatch.ts` — **typed, Zod-validated,
  permission-checked, OTP-gated, audited tool catalog + dispatcher.** This is the
  most important reusable asset for the agentic program.
- `lib/cms/voice/` — `orchestrator.ts` (native tool-calling turn loop),
  `session.ts`, `prefetch.ts` (mirror-only `CallContext`), `livekit.ts`,
  `contracts.ts`, `identity.ts` (salted phone hashing).
- `lib/cms/realtime/` — `events.ts` (`publishEvent`, append-only `events` table +
  LISTEN/NOTIFY) and `subscribe.ts` (SSE fan-out). The live-update backbone.
- `lib/cms/outbox/` — async Salesforce outbox + drainer (idempotent by `jobKey`).
- `lib/cms/jobs/` — durable job runner spine + heavy jobs
  (`post-call-processing`, `compile-and-email-report`, `morning-briefing`,
  `send-whatsapp-brief`, `channel-adapter`, `register.ts`).
- `lib/cms/metrics/pipeline.ts` + `metrics_*` SQL views (migration `0030`) — the
  single source of analytics figures.
- `workers/` — `voice-agent.ts`, `outbox-drainer.ts`, `job-runner.ts`
  (container-only long-lived processes).
- `app/ora-panel/voice-console/` — SSE-driven live console (transcript, decisions,
  outbox, jobs, latency HUD, reset).
- `lib/cms/components/call-widget/` — embeddable call widget (NOTE: not yet mounted
  on any page; see Spec 6).
- API wiring: `lib/cms/api/index.ts` (single Elysia app, `type Api`), routes under
  `lib/cms/api/routes/` (`voice`, `tools`, `realtime`, `demo-admin`, `ai-chat`,
  `ai-admin`), Bun mount `lib/cms/api/server.ts`, Eden client `lib/cms/api/eden.ts`.

### 3.3 Data & platform
- Schema (`lib/cms/schema.ts`): `parties`, `party_identities`, `leads_mirror`,
  `reps`, `viewing_slots`, `events`, `sf_outbox`, `jobs`, `report_jobs`,
  `aiConversations`, `aiMessages`, `aiAppointments`, `aiClients`, `aiTenants`,
  `aiUnits`, `knowledgeDocuments`/`knowledgeEmbeddings`, `marketingSpend`,
  `brokerProfiles`, `brokerCompanies`, `auditLog`, `otpRecords`, `users`,
  `crmSyncLog`. Migrations: `0029` (voice schema), `0030` (metrics views), `0031`
  (`marketing_spend.demo`).
- RBAC: `lib/cms/rbac/` (engine, middleware incl. `requirePermission` /
  `requireAdmin`, seed). Audit: `lib/cms/audit.ts`. Analytics: PostHog server +
  UTM attribution (`ora_attribution` cookie).
- Salesforce: `lib/cms/tickets/crm/salesforce.ts` — **Case-oriented only**
  (`createCase`/`updateCase`/`getCaseStatus`, OAuth client-credentials). No
  Lead/Contact/Opportunity, no inbound read, no CDC. The outbox currently maps
  every kind onto a Case (demo shim).

### 3.4 Not present
- **Mastra** — zero references anywhere (code or `package.json`).
- A real lead ingestion pipeline (today "leads" are tickets with
  `requestType = lead_inquiry`; `leads_mirror` is demo-seed only and DOE→SF one-way).
- Digital-twin / persona agents; agent long-term memory per entity.
- Conversational reporting / on-the-fly chart generation.
- Agent-first home/briefing surface.
- Agent tracing / eval harness.

---

## 4. Gap analysis (capability by capability)

| # | Capability (vision) | Status today | Gap to close | Spec |
|---|---|---|---|---|
| 1 | Mastra as orchestration core | Absent | Add Mastra runtime; agents, workflows, memory, tracing; bind to dispatcher | S1 |
| 2 | One shared, audited tool/skill catalog | Partial (voice registry only) | Unify text + admin + voice tools into one typed, audited catalog | S1 |
| 3 | Agent memory (working + long-term, per entity) | Partial (convo summary + RAG) | Durable memory keyed to lead/rep/deal/user; retrieval policy | S1 |
| 4 | Agent observability / evals | Minimal (unit tests) | Tracing per agent run + eval harness | S1 |
| 5 | Salesforce depth (Lead/Contact/Opportunity/Task/Event, inbound read) | Weak (Case-only, outbound) | First-class objects; lead lookup/dedupe; replace Case shim | S2 |
| 6 | Multi-source lead ingestion → parse → dedupe → route | Weak (leads == tickets) | Ingestion adapters + agentic parse/dedupe/distribute | S3 |
| 7 | Lead "DNA"/history enrichment + proactive nudging | Missing | Enrichment assembly + proactive scheduler/workflows | S3 |
| 8 | Digital twins (rep + C-level sparring partner) | Missing | Persona model, per-user twin agent, predictions | S4 |
| 9 | Chat-with-report + on-the-fly graphs + export/email | Partial (`metrics_*` + report job) | Conversational analytics agent, dynamic charts, export | S4 |
| 10 | Agent-first briefing home (AM/PM, delegate, manage by chat) | Missing | New home surface driven by a briefing workflow | S5 |
| 11 | Broker onboarding + admin tasks agentic | Missing (data exists) | Onboarding + admin task agents/workflows | S5 |
| 12 | Voice re-based on the shared agentic core | Inverted (voice shipped standalone) | Re-point voice orchestrator/worker at Mastra core; mount widget | S6 |

---

## 5. The six specs

Each spec below is self-contained enough to be authored independently **after S1
exists**. S1 must be authored first (others reference its catalog/memory/runtime
contracts). Suggested feature-directory names are given for `.kiro/specs/`.

### S1 — Agentic Foundation (Mastra runtime + unified tool catalog + memory)
`feature-name: agentic-foundation` — KEYSTONE, author first.

- **Goal**: stand up Mastra as the orchestration core and give every future agent
  a single audited tool catalog, durable memory, and tracing.
- **In scope**:
  - Add Mastra; define how Mastra agents/workflows/tools are structured in this
    repo (module layout under `lib/cms/agents/` or similar).
  - **Unified tool/skill catalog**: promote `lib/cms/ai/tools/registry.ts` into the
    canonical catalog; every Mastra tool is a thin binding to a catalog entry that
    executes via the audited dispatcher (`dispatch.ts` / `POST /api/tools/:toolName`).
    Define the typed contract (Zod in/out), permission, OTP requirement, and audit
    actor for each tool.
  - **Dispatcher binding**: Mastra tools MUST call the dispatcher, never the DB.
  - **Agent memory**: a durable memory store (working + long-term) keyed by entity
    (user, lead, rep, deal, conversation). Decide store (Postgres + pgvector reuse
    of `knowledgeEmbeddings` pattern vs Mastra memory). Define retrieval policy.
  - **Model tiering**: which Mastra model providers map to which tiers via the
    Cloudflare AI Gateway; cost/latency guardrails.
  - **Tracing + evals**: per-run tracing surfaced to the SSE bus / console; a small
    eval harness for agent behaviours.
  - **Migration adapter**: a path to move existing deterministic text intents
    (`agent.ts`) onto Mastra one at a time, with the deterministic path as fallback.
- **Out of scope**: lead engine, twins, reporting UI, voice (those are S2–S6).
- **Reuse**: tools registry/dispatch, gateway, audit, RBAC, OTP, realtime events,
  jobs spine.
- **Key risks**: losing the audit boundary if Mastra calls the DB directly; model
  cost on multi-step loops; double-source-of-truth if the catalog isn't the only
  tool definition.
- **Suggested correctness properties**:
  - Every agent-initiated mutation produces exactly one audit entry (reuse P3 style).
  - No agent tool can return gated personal data without OTP/permission (reuse P5).
  - Catalog is the single tool source: every Mastra tool maps 1:1 to a catalog entry.

### S2 — Salesforce Lead Core (deepen the CRM integration)
`feature-name: salesforce-lead-core`

- **Goal**: replace the Case-only shim with first-class CRM objects and inbound
  read, so the lead engine can look up, dedupe, and enrich.
- **In scope**:
  - Extend `lib/cms/tickets/crm/salesforce.ts` (or a new `crm/salesforce-lead.ts`)
    with Lead/Contact/Opportunity/Task/Event read+write.
  - Lead **lookup + dedupe** (by phone hash / email / SF id), mapping to `parties`
    + `party_identities` + `leads_mirror`.
  - Replace the outbox's Case mapping (`lib/cms/outbox/index.ts` `buildCaseInput`)
    with correct object routing per `OutboxKind`.
  - Decide inbound strategy: polling vs CDC (CDC was explicitly out of scope for the
    voice demo — revisit here). Keep DOE→SF idempotent by `jobKey`.
- **Out of scope**: the ingestion sources themselves (S3), agent reasoning (S1/S3).
- **Reuse**: outbox + drainer, `leads_mirror`, identity hashing, audit.
- **Risks**: sandbox vs prod object/field differences; dedupe false-merges;
  rate limits.
- **Suggested properties**: at-most-one SF record per `jobKey` (reuse P1); dedupe is
  idempotent; no raw phone in events/audit (reuse P9).

### S3 — Lead Engine (ingest → parse → dedupe → route → enrich → nudge)
`feature-name: lead-engine` — depends on S1 + S2.

- **Goal**: agentic, proactive lead management across sources.
- **In scope**:
  - **Ingestion adapters** for multiple sources (web form (exists via tickets),
    email, WhatsApp, Meta/lead-ads, portals like Bayut/PropertyFinder). Normalise to
    a canonical inbound-lead shape.
  - **Agentic parse**: extract structured fields from messy inbound payloads.
  - **Dedupe + SF lookup** (via S2): existing lead? merge/attach vs create.
  - **Distribution/routing**: reuse/extend the voice `assign_rep` rules
    (project × language × capacity) as a catalog tool; agent decides + records
    rationale to the event bus / console.
  - **Enrichment / "DNA"**: assemble history and signals (prior interactions,
    comparable leads, attribution) into a brief for the human owner; store in
    agent memory (S1).
  - **Proactive nudging**: scheduled workflows (reuse `jobs` spine) that follow up,
    surface stale leads, and notify owners.
- **Out of scope**: the C-level reporting view (S4); UI home (S5).
- **Reuse**: `leads_mirror`, `reps`, `viewing_slots`, outbox, jobs, realtime,
  attribution, the catalog tools `update_qualification`/`score_lead`/`assign_rep`.
- **Risks**: source auth/creds; parsing accuracy (needs evals from S1); duplicate
  routing; proactive nudges becoming spam (guardrails).
- **Suggested properties**: every inbound lead is parsed-or-queued (never dropped);
  one owner per lead at a time; enrichment never leaks one lead's PII into another's
  brief.

### S4 — C-Level Twin & Agentic Reporting
`feature-name: agentic-reporting-twin` — depends on S1 (+ reads S2/S3 data).

- **Goal**: chat-with-your-report, on-the-fly analytics, and a sparring-partner twin.
- **In scope**:
  - A **reporting agent** that queries `metrics_*` views (and S3 lead data)
    conversationally — numbers come from SQL, the agent narrates (preserve the
    voice-surface Property 8 consistency rule).
  - **On-the-fly chart generation** + **export** (download / email via Graph;
    reuse `compile-and-email-report` job + PDF renderer).
  - **Persona/twin model**: per-user role/persona shaping; predictions that pull
    records and explain, never fabricate figures.
  - Conversational delegate/ask flows ("show me HOT leads stuck > 48h", "email this
    to the team").
- **Out of scope**: the home/briefing surface shell (S5) — this spec provides the
  agent + tools it consumes.
- **Reuse**: `metrics/pipeline.ts`, `metrics_*` views, report jobs, RBAC, memory.
- **Risks**: hallucinated numbers (mitigate: SQL-only figures + evals); chart
  generation cost/latency; data-access scope per role.
- **Suggested properties**: spoken/printed figure == SQL figure for a given
  scope/period (reuse P8); a user only sees data their role permits.

### S5 — Agent-First Home / Briefing Surface
`feature-name: agentic-home` — depends on S1, consumes S3 + S4 agents.

- **Goal**: the home screen IS the user's twin; manage the platform by chat; UI is
  backup.
- **In scope**:
  - **Briefing workflow**: AM ("yesterday + today's stack, want to add?"),
    midday/PM wrap-up; combine tasks into daily/weekly reports (reuse jobs).
  - **Chat-driven platform management**: delegate tasks, check leads, trigger
    reports, run admin actions — all through the catalog (audited).
  - The agent-first **UI shell** that renders the briefing + chat, with the classic
    panel as fallback navigation.
- **Out of scope**: the reporting agent internals (S4); lead engine internals (S3).
- **Reuse**: realtime SSE for live updates, jobs for scheduled briefings, RBAC,
  the `ora-panel` shell.
- **Risks**: scope creep (this can absorb the whole panel); latency on home load
  (cache briefings); permission surface.
- **Suggested properties**: briefing only includes data the user may see; delegated
  actions are audited; home degrades to the classic panel if the agent is down.

### S6 — Voice Re-base + Surface Activation
`feature-name: voice-rebase` — depends on S1 (and ideally S3/S4 for tools).

- **Goal**: put voice *on top of* the proven agentic text core, and actually
  activate the surfaces that were built but never wired.
- **In scope**:
  - Re-point the voice orchestrator (`lib/cms/voice/orchestrator.ts`) and worker
    (`workers/voice-agent.ts`) to call Mastra agents / the unified catalog instead
    of the standalone registry path.
  - **Mount the call widget** (`lib/cms/components/call-widget/`) on the public
    site, and **add the Demo Console to the panel nav** (`app/ora-panel/layout.tsx`
    `navItems`) — both are built but not surfaced today.
  - Live-credentials wiring (LiveKit/Deepgram/ElevenLabs) + a runbook to start the
    container workers.
- **Out of scope**: new voice features beyond parity; the agentic core (S1).
- **Reuse**: essentially all of the voice surface; this is integration, not rebuild.
- **Risks**: regressing the audited dispatch path during the re-base; creds/runtime
  setup; latency budget under the Mastra loop.
- **Suggested properties**: voice tool calls remain audited/OTP-gated (reuse P3/P5);
  voice figures match report figures (reuse P8).

---

## 6. Cross-cutting concerns (every spec must honour)

- **Audit/permission/OTP boundary is non-negotiable.** All mutations and all
  personal-data reads go through the dispatcher. No agent touches the DB directly.
- **Privacy.** No raw phone numbers in `events` payloads or the audit log; phones
  are salted-hashed in `party_identities` (reuse the voice-surface invariant / P9).
- **Idempotency.** Outbox and jobs are idempotent by `jobKey`; agent-triggered
  side effects must reuse this so retries never double-act (P1/P7).
- **Figures come from SQL, agents narrate.** Never let a model compute reported
  numbers (P8).
- **Cost/latency.** Model tiering + caching from day one; multi-step agent loops
  are expensive — budget and measure them.
- **Observability.** Every agent run is traceable (S1 provides the mechanism);
  reuse the SSE event bus + console to make agent reasoning visible.
- **Synthetic data only** in demo/seed paths; real PII only through the audited
  paths.
- **Next.js 16 caution** (per `AGENTS.md`): read `node_modules/next/dist/docs/`
  before touching routes/pages; never regress `app/api/[...slugs]/route.ts`
  (`runtime = "nodejs"`, `dynamic = "force-dynamic"`).

---

## 7. Sequencing & parallelization

```
S1 Agentic Foundation  ──┬─────────────────────────────► (keystone, author first)
                         │
   S2 Salesforce Lead Core  ──► can be authored in parallel with S1
                         │      (implementation lands before/with S3)
                         │
   ├─► S3 Lead Engine            (needs S1 + S2)
   ├─► S4 Twin & Reporting       (needs S1; reads S2/S3 data)
   ├─► S5 Agent-First Home       (needs S1; consumes S3 + S4)
   └─► S6 Voice Re-base          (needs S1; ideally S3/S4 tools)
```

What can start **now**, before S1 implementation finishes:
- **S2 (Salesforce)** authoring + much of its implementation — it's mostly an
  integration deepening and doesn't depend on Mastra.
- **S6's "surface activation" slice** (mount the widget, add console to nav) is a
  tiny, safe change that can ship independently to make the current build visible.

What is **blocked on S1**: S3, S4, S5, and S6's re-base — they bind to the Mastra
runtime, the unified catalog, and agent memory.

Recommended order to *complete*: S1 → S2 → S3 → S4 → S5 → S6, validating the text
agents at each layer before voice goes on top (per the stated text-first sequence).

---

## 8. Open decisions to resolve (before / early in S1)

1. **Is Mastra a firm commitment?** vs. keeping native tool-calling and adding a
   lighter orchestration layer. The whole foundation hinges on this.
2. **Where do agents/tools live?** Proposed `lib/cms/agents/` for Mastra agents +
   workflows; the tool catalog stays in `lib/cms/ai/tools/`. Confirm layout.
3. **Memory store.** Reuse Postgres + pgvector (`knowledgeEmbeddings` pattern) for
   agent memory, or adopt Mastra's memory backend? Define entity keys
   (user/lead/rep/deal/conversation) and retention.
4. **Model tiering & budget.** Which models per tier through the Cloudflare AI
   Gateway; per-run cost ceilings; where caching applies (briefings, report chat).
5. **Deterministic-path retirement policy.** Which text intents migrate first;
   when the deterministic fallback is removed.
6. **Salesforce inbound.** Polling vs CDC for "is this an existing lead?" — decide
   in S2.
7. **Human-in-the-loop scope.** The admin agent's confirmation-token pattern —
   reuse it for which agent actions (anything destructive / external-facing)?
8. **Twin persona source.** What defines a user's persona (role + RBAC + explicit
   profile)? Where is it stored?

---

## 9. Glossary

- **Catalog / skill catalog** — the single typed, audited set of tools every agent
  may call (evolved from `lib/cms/ai/tools/registry.ts`).
- **Dispatcher** — `POST /api/tools/:toolName` (`lib/cms/ai/tools/dispatch.ts`); the
  audited execution boundary. Agents call this, never the DB.
- **Twin** — a per-user agent shaped by that user's persona/role that works
  alongside them (rep assistant, C-level sparring partner).
- **DNA** — the enriched, assembled context about a lead (history, comparables,
  attribution) that helps the human owner understand them.
- **Mirror** — local Postgres cache of CRM data (`leads_mirror`) used for fast,
  Salesforce-free reads in the hot path.
- **Outbox** — `sf_outbox` + drainer; async, idempotent Salesforce-bound writes.
- **Job runner** — durable, idempotent background tasks (`lib/cms/jobs/`).
- **Event bus** — append-only `events` table + LISTEN/NOTIFY + SSE; the live-update
  and agent-observability backbone.

---

## 10. Reference: key files (navigation)

- Tool catalog + dispatcher: `lib/cms/ai/tools/registry.ts`, `lib/cms/ai/tools/dispatch.ts`
- Model transport: `lib/cms/ai/gateway.ts`
- Text agents: `lib/cms/ai/agent.ts`, `chat.ts`, `admin-agent.ts`, `rag.ts`
- Voice: `lib/cms/voice/*`, `workers/voice-agent.ts`
- Realtime: `lib/cms/realtime/{events,subscribe}.ts`
- Async work: `lib/cms/outbox/index.ts`, `lib/cms/jobs/*`, `workers/{outbox-drainer,job-runner}.ts`
- Metrics: `lib/cms/metrics/pipeline.ts`, migration `drizzle/0030_metrics_views.sql`
- Salesforce: `lib/cms/tickets/crm/salesforce.ts`, `lib/cms/tickets/crm/adapter.ts`
- API: `lib/cms/api/index.ts`, `lib/cms/api/server.ts`, `lib/cms/api/routes/*`, `lib/cms/api/eden.ts`
- Platform: `lib/cms/rbac/*`, `lib/cms/audit.ts`, `lib/cms/schema.ts`
- Surfaces (built, mostly unwired): `lib/cms/components/call-widget/*`, `app/ora-panel/voice-console/*`
- Prior context: `.kiro/specs/doe-voice-surface/{requirements,design,tasks}.md`, `scratch/DOE_VOICE_DEMO_SPEC.md`, `docs/ai-tool-calling-pattern.md`
