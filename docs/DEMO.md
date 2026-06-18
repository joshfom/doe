# DOE — Agentic Platform Demo Guide

> One-page runbook for demoing DOE as an **agent-first** platform: the C-level
> twin, the platform brain (build-vs-buy), live Salesforce CRM brainstorming, the
> lead engine, and voice. Every action below is real and wired in this repo —
> figures come from SQL/Salesforce, every agent action is audited.

---

## 0. The one-line pitch

> *"This isn't a chatbot on our website. It's an agent runtime where every
> department's work flows through one audited, observable AI core (Mastra) — and
> unlike a ready-made agent, we own it, it speaks Arabic natively, every action
> is logged and reversible, and our infra team can fine-tune and monitor it."*

---

## 1. Pre-demo checklist (do these once)

| # | Step | Command / action |
|---|---|---|
| 1 | Salesforce connection is live | `bun run --env-file=.env scripts/test-salesforce-auth.ts` → expect ✅✅ |
| 2 | App is running | `bun dev` (Next on :3000) + the API/workers as needed |
| 3 | A CEO user exists | Have someone **sign up** in the panel, then elevate them (step 4) |
| 4 | Elevate to C-level | `bun run --env-file=.env scripts/grant-c-level.ts <email>` |
| 5 | (Optional) richer numbers | Seed/ensure a few Salesforce Opportunities exist in the sandbox |
| 6 | (Optional) voice on site | Set site setting `voice_call_widget_enabled = "true"` |

`grant-c-level.ts` is idempotent: it seeds the RBAC roles, assigns the `c_level`
role, and seeds the strategic exec twin persona. Re-running is safe.

---

## 2. The four demo moments (run in this order)

### Moment 1 — The agent-first home / twin (the strongest visual)
**Where:** log in as the CEO → panel home (`/ora-panel`).

The home screen **is** the user's twin: a time-aware briefing + a chat box that
manages the platform. It greets a C-level user in a **strategic, summary** tone
(persona-shaped), and every turn streams the agent's live reasoning.

**Say:** *"Good morning — what changed since yesterday?"* and *"What's on my
stack today?"*

> Under the hood: `POST /api/home/chat` → `runHomeAgentTurn` (Mastra home agent),
> figures read from SQL views, narrated verbatim. Audit row per tool call.

---

### Moment 2 — Brainstorm on LIVE Salesforce data (C-level twin)
**Where:** same home chat, as the CEO.

Ask the twin to compare and analyse real CRM figures. It calls the audited
`get_crm_analytics` tool; **Salesforce computes the numbers**, the twin narrates.

**Talk track (ask these live):**
- *"Compare opportunities created this quarter vs last quarter."*
- *"How many leads did we get this week vs last week?"*
- *"Show me the open pipeline by stage."*
- *"How many opportunities did we win this quarter, and for how much?"*

**What proves the wow:** the numbers are pulled live from Salesforce aggregate
SOQL (`THIS_QUARTER` / `LAST_QUARTER` date literals) — the agent never invents a
figure, and if the CRM is unreachable it says so rather than guessing.

> Tool: `get_crm_analytics` (granularity = week / month / quarter). Source:
> [lib/cms/tickets/crm/salesforce-analytics.ts](../lib/cms/tickets/crm/salesforce-analytics.ts).
> Injection-safe: the agent only picks a whitelisted period token, never writes SOQL.

---

### Moment 3 — The platform brain (answer the CEO's "why build this?")
**Where:** same home chat.

When the CEO challenges the strategy, the twin answers from a **curated,
reviewed** knowledge base about the platform itself — honest, no fluff.

**Talk track:**
- *"What is DOE, in one paragraph?"*
- *"Why should we build our own agentic platform instead of buying a ready-made one?"*
- *"When should we NOT build, and just buy?"*
- *"How do security, audit and data governance work — and how does our infra team fit in?"*
- *"What's the future / roadmap?"*

**What proves the wow:** the answer **names where ready-made vendors win**
(time-to-value, connectors, support SLAs) and where building wins (ownership of
the core, no per-conversation tax, native Arabic + real-estate depth, the audited
boundary your infra team already governs and can fine-tune). It survives scrutiny
because it isn't a sales pitch.

> Tool: `get_platform_knowledge`. Source:
> [lib/cms/agents/platform/knowledge.ts](../lib/cms/agents/platform/knowledge.ts).
> Deterministic retrieval (no embeddings) over reviewed sections, so answers never drift.

---

### Moment 4 — Watch the agent think + the audit guardrail
**Where:** the Voice Console (`/ora-panel/voice-console`).

Split-screen: on one side someone talks/types to an agent; on the other, the
console streams **decisions, tool calls, the outbox, and a latency HUD** in real
time. Then deliberately ask for personal/contract data without verification — the
agent demands an OTP, and you show the `audit_log` row.

**Say:** *"Governance is the differentiator. A ready-made agent gives you
autonomy; we give you autonomy you can defend in an audit (DLD/RERA)."*

---

## 3. Bonus — the proactive lead engine (Postman harness)

Show leads arriving from **any source** (web form, email, WhatsApp, Meta lead
ads, portal) flowing through the same audited intake spine — deduped, hashed,
attributed.

**Setup:** import [docs/postman/DOE-Lead-Engine.postman_collection.json](postman/DOE-Lead-Engine.postman_collection.json),
set `baseUrl` (e.g. `http://localhost:3000`) and `simulationToken` (the
`LEAD_SIMULATION_TOKEN`; blank is fine in local dev).

| Request | What it shows |
|---|---|
| `GET /api/leads/sources` | Valid sources + which have a live adapter |
| `POST /api/leads/simulate` (Meta / Email / Web / Portal) | A lead lands and is recorded |
| `POST /api/leads/simulate` (Dedupe — fixed `idempotencyKey`) | **Send twice** → same id, `deduped: true` |
| `GET /api/leads/inbound?limit=20` | The intake ledger with statuses |
| `GET /api/leads/inbound/:id` | One lead's detail — **never** returns a raw phone |

**Talk track:** *"A lead just arrived from WhatsApp → the engine parsed,
deduped, and recorded it idempotently, with attribution, and never stored the
raw phone — only a salted hash."*

> Notes: phone leads require `PHONE_HASH_SALT` on the server (else 422); leads
> without a phone work without it. The harness is token-guarded and writes to the
> real `inbound_leads` ledger via the same `recordInbound` the production worker uses.

---

## 4. What's real vs. what's roadmap (be honest if asked)

**Live and demo-able today:**
- Four Mastra agents (text, admin, home/twin, voice) on one audited runtime.
- C-level role + exec twin persona; persona-shaped narration.
- Live Salesforce CRM analytics (lead/opportunity period comparisons, pipeline).
- Platform brain (what is DOE / build-vs-buy / governance / roadmap).
- Two-way Salesforce (outbound Cases + inbound Lead polling with dedupe).
- Lead intake from any source via the simulation harness; SQL-sourced figures.
- Live agent tracing → Voice Console; OTP + audit on every tool call.

**Designed, not yet built (don't over-promise):**
- A standalone reporting agent and autonomous lead parse/distribute/enrich agents
  (the home twin uses bound tools in their place today).
- Live external lead-source transports (the simulation harness stands in).
- Quarter buckets in the internal `metrics_*` views (the **Salesforce**
  quarter-over-quarter comparison via `get_crm_analytics` works today).

---

## 5. Capability → tool → source map (for Q&A)

| Capability | Audited tool | Source file |
|---|---|---|
| Brainstorm on live CRM | `get_crm_analytics` | [lib/cms/ai/tools/crm-analytics-capability.ts](../lib/cms/ai/tools/crm-analytics-capability.ts) |
| CRM aggregate queries | — | [lib/cms/tickets/crm/salesforce-analytics.ts](../lib/cms/tickets/crm/salesforce-analytics.ts) |
| Platform "why build" brain | `get_platform_knowledge` | [lib/cms/agents/platform/knowledge.ts](../lib/cms/agents/platform/knowledge.ts) |
| Pipeline figures | `get_pipeline_summary` | [lib/cms/ai/tools/reporting-capabilities.ts](../lib/cms/ai/tools/reporting-capabilities.ts) |
| C-level role + persona | — | [lib/cms/rbac/seed.ts](../lib/cms/rbac/seed.ts), [scripts/grant-c-level.ts](../scripts/grant-c-level.ts) |
| Home twin agent | (binds all home tools) | [lib/cms/agents/home-agent.ts](../lib/cms/agents/home-agent.ts) |
| Lead intake harness | — | [lib/cms/api/routes/leads.ts](../lib/cms/api/routes/leads.ts) |
| Audited dispatch boundary | (all tools) | [lib/cms/ai/tools/dispatch.ts](../lib/cms/ai/tools/dispatch.ts) |

---

## 6. If something breaks mid-demo

- **CRM analytics says "unavailable":** check `SF_CLIENT_ID` / `SF_CLIENT_SECRET`
  in `.env`; re-run the connection test (step 1).
- **Twin sounds generic, not executive:** confirm the user has the `c_level`
  role (`grant-c-level.ts`) — the exec persona derives from `report:scope:exec`.
- **Lead simulate returns 401:** set/clear `LEAD_SIMULATION_TOKEN` and send it as
  `Authorization: Bearer <token>`.
- **Lead simulate returns 422 on a phone lead:** set `PHONE_HASH_SALT`, or use a
  no-phone lead (Meta / Email).

---

## 7. Full command & script reference (everything you can run)

> Bun auto-loads `.env`. The examples pass `--env-file=.env` explicitly so they
> work the same way regardless of shell/cwd. Run from the repo root.

### 7.1 One-time setup

```bash
bun install                                   # install dependencies
bun run db:migrate                            # apply Drizzle migrations
bun run db:seed                               # seed base content + RBAC roles
bun run db:seed:demo                          # (optional) seed demo data
bun run db:seed:demo:reset                    # (optional) wipe + reseed demo data
```

### 7.2 Run the app

```bash
bun dev                                       # Next.js site + mounted API (:3000)
bun run api:dev                               # (alt) standalone Elysia API w/ watch
```

### 7.3 Run the workers (container tier — never Vercel serverless)

**One command starts them all** (each runs as an isolated subprocess; Ctrl-C
stops them all). They fail safe — a worker whose credentials are absent logs
what's missing and idles/exits without affecting the others.

```bash
bun run workers            # start ALL workers (incl. voice)
bun run workers:core       # infra only: outbox, sf-inbound, jobs, lead, nudge (no voice)
```

Need a custom subset, or one in its own terminal for focused logs:

```bash
bun run --env-file=.env scripts/start-workers.ts outbox sf   # pick by name
# or run a single worker directly:
bun --env-file=.env workers/outbox-drainer.ts     # DOE → Salesforce (Lead/Task/Event), idempotent
bun --env-file=.env workers/sf-inbound-sync.ts    # Salesforce → leads_mirror (polls changed Leads)
bun --env-file=.env workers/job-runner.ts         # post-call, reports, briefings (durable jobs)
bun --env-file=.env workers/lead-ingestion.ts     # multi-source inbound capture (idle until sources wired)
bun --env-file=.env workers/lead-nudge.ts         # proactive follow-ups on stale leads
bun --env-file=.env workers/voice-agent.ts        # LiveKit voice pipeline (needs voice creds + SDKs)
```

Launcher worker names: `outbox`, `sf`, `jobs`, `lead`, `nudge`, `voice`
(or `core` for all-but-voice, or no args for all).

### 7.4 Helper scripts

| Purpose | Command |
|---|---|
| Test Salesforce connection (auth + API read) | `bun run --env-file=.env scripts/test-salesforce-auth.ts` |
| Grant a user C-level (RBAC role + exec twin persona) | `bun run --env-file=.env scripts/grant-c-level.ts <email>` |
| Show current voice widget setting | `bun run --env-file=.env scripts/set-voice-widget.ts` |
| Enable the public voice widget (en + ar) | `bun run --env-file=.env scripts/set-voice-widget.ts on` |
| Disable the public voice widget | `bun run --env-file=.env scripts/set-voice-widget.ts off` |

`grant-c-level.ts` and `set-voice-widget.ts` are idempotent — re-running is safe.

---

## 8. Environment variables by capability

Only the columns for the capabilities you're demoing need values. Missing creds
disable that capability cleanly; they don't break the rest.

| Capability | Required env | Notes |
|---|---|---|
| Core app + DB | `DATABASE_URL`, `BETTER_AUTH_SECRET` | always required |
| AI / agents (the brain) | `CF_AI_GATEWAY_URL`, `CF_AI_API_TOKEN`, `CF_CHAT_MODEL`, `CF_CHAT_MODEL_PREMIUM` | ✅ configured |
| Salesforce sync + CRM analytics | `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_LOGIN_URL` | ✅ connected (sandbox My Domain) |
| Lead intake (phone hashing) | `PHONE_HASH_SALT` | stable & secret; phone leads 422 without it |
| Lead simulate harness | `LEAD_SIMULATION_TOKEN` | Bearer token for `POST /api/leads/simulate` |
| Email reports / briefings | `AZURE_COMMUNICATION_*` | Microsoft Graph mailer |
| Voice — transport | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_AGENT_NAME` | server/container only |
| Voice — STT | `DEEPGRAM_API_KEY` (+ optional `DEEPGRAM_MODEL_EN/AR`) | or ElevenLabs Scribe (code swap) |
| Voice — TTS | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (+ optional `ELEVENLABS_VOICE_ID_AR`) | multilingual voice for EN/AR |
| Voice — worker wiring | `AGENT_SERVICE_TOKEN`, `INTERNAL_API_URL` | worker → tool API auth + base URL |

---

## 9. Enabling voice end-to-end (the extra steps)

Voice needs three things beyond env vars, in order:

```
1. Add voice env vars (§8) to .env
2. Install the creds-gated SDKs (not bundled by default):
     bun add @livekit/agents @livekit/agents-plugin-deepgram @livekit/agents-plugin-elevenlabs
3. Run the worker:
     bun --env-file=.env workers/voice-agent.ts
   Expect: "configuration validated; registering agent 'doe-voice-agent' ..."
4. Flip the public widget on:
     bun run --env-file=.env scripts/set-voice-widget.ts on
```

Readiness signals from the worker:

```
missing creds   → "[voice-agent] missing required configuration: LIVEKIT_URL, ..."
creds, no SDKs  → "[voice-agent] provider SDK(s) not installed: ..."
ready ✅         → "[voice-agent] configuration validated; registering agent ..."
```

> Deploy note: the web app runs on Vercel; the **workers run on a container tier**
> (LiveKit Cloud Agents, Fly.io, Railway, Render, ECS, or a VM) — they cannot run
> on Vercel serverless. Local dev works for a single-machine demo.
