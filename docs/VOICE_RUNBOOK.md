# Voice Container-Worker Runbook (S6)

This runbook covers operating the DOE voice surface after the S6 re-base:
the three container-tier workers, the live-call smoke test, and the two
operational toggles (the `voice_lead` Migration_Switch flag and the
`voice_call_widget_enabled` site setting).

> **Container-only.** The voice workers (`workers/voice-agent.ts`,
> `workers/outbox-drainer.ts`, `workers/job-runner.ts`) are long-running Bun
> processes that run on the **container tier only**. They are **never** deployed
> to Vercel serverless — serverless functions cannot hold the long-lived
> LiveKit/SSE connections these workers need.

---

## 1. Required environment / credentials

`loadVoiceWorkerConfig()` (in `workers/voice-agent.ts`) validates the following
at startup and **fails fast with a named error** if any is missing:

| Variable | Purpose |
|---|---|
| `LIVEKIT_URL` | LiveKit server URL the worker connects to |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |
| `LIVEKIT_AGENT_NAME` | Agent name the worker registers under for dispatch |
| `DEEPGRAM_API_KEY` | Deepgram streaming STT key |
| `ELEVENLABS_API_KEY` | ElevenLabs streaming TTS key |
| `ELEVENLABS_VOICE_ID` | Primary DOE persona voice id |
| `AGENT_SERVICE_TOKEN` | Service token for the HTTP tool transport (SEC-2) |
| `INTERNAL_API_URL` | Internal API base URL for the HTTP tool transport |

Optional (have safe fallbacks):

| Variable | Default | Purpose |
|---|---|---|
| `ELEVENLABS_VOICE_ID_AR` | falls back to `ELEVENLABS_VOICE_ID` | Arabic-capable voice |
| `DEEPGRAM_MODEL_EN` | `nova-2-phonecall` | English STT model |
| `DEEPGRAM_MODEL_AR` | `nova-2` | Arabic STT model |

If the creds or provider SDKs are absent, the worker logs exactly what is
missing and exits cleanly — it never crashes the platform.

### Provider SDKs

The live transport additionally requires these pinned packages to be installed
in the container image:

- `@livekit/agents`
- `@livekit/agents-plugin-deepgram`
- `@livekit/agents-plugin-elevenlabs`

These are loaded with a guarded dynamic import; when absent the worker logs the
missing package names and exits without connecting to LiveKit.

### How the agent is wired (architecture)

`bun workers/voice-agent.ts` validates config, confirms the SDKs are present,
then launches the LiveKit Agents worker via the dedicated entrypoint
`workers/voice-livekit-entry.ts` (imported dynamically so the session-core module
stays SDK-free for tests/build). The entrypoint registers under
`LIVEKIT_AGENT_NAME` for **explicit dispatch** and, per call, runs a high-level
`voice.AgentSession` (Deepgram STT + ElevenLabs TTS) whose **`llmNode` is
overridden to route every turn through DOE's audited orchestrator**
(`runVoiceTurnRouted` → `dispatchTool`: Zod → RBAC → OTP → audit → execute). So
LiveKit handles audio / VAD / barge-in, while DOE remains the brain — no vendor
LLM ever bypasses the audit boundary. The opening greeting is a template
(`buildGreeting`), never a free LLM call; on call close the entrypoint publishes
`call.ended` and enqueues `post_call_processing` (idempotent by jobKey).

> **This agent is self-hosted.** Do NOT create it in the LiveKit Cloud dashboard
> ("Deploy new agent" / Agent Builder / `lk agent create`) — that runs a
> LiveKit-hosted agent OUTSIDE DOE's audited dispatcher, agent memory, tool
> catalog, and Salesforce wiring. Your worker connects out to LiveKit Cloud
> using `LIVEKIT_API_KEY`/`SECRET`; LiveKit Cloud is only the audio transport +
> dispatch broker.

A successful start logs `registered worker` with a worker id and region (e.g.
`"msg":"registered worker" … "region":"UAE"`) and stays running.

---

## 2. Starting the three container workers

Run each as its own long-lived process (e.g. one container / supervised process
each):

```bash
# 1. Voice agent — LiveKit Agents pipeline (STT → LLM → TTS, barge-in).
bun workers/voice-agent.ts

# 2. Outbox drainer — flushes the Salesforce sf_outbox.
bun workers/outbox-drainer.ts

# 3. Job runner — runs durable background jobs (post_call_processing, etc.).
bun workers/job-runner.ts
```

All three depend on the shared `DATABASE_URL` and the platform env. The
`voice-agent` worker additionally needs the credentials in §1.

---

## 3. Transport split (Caddy)

The reverse proxy (`Caddyfile`) routes long-lived connections to the Bun
container process and everything else to Next.js:

- `/api/realtime/*` and `/ws/*` → Bun mount (`app:3001`) with
  `flush_interval -1` (no response buffering, so SSE/WebSocket bytes flush
  immediately).
- all other traffic → Next.js (`app:3000`).

Do not regress this split — the Demo Console's live SSE stream depends on it.

---

## 4. Live test call (end to end)

1. Ensure the three workers (§2) are running with valid creds (§1).
2. Enable the public widget (§6) **or** drive a session directly via
   `POST /api/voice/sessions`.
3. Open the public site; click the floating call widget; complete the pre-call
   form (consent required) and start the call.
4. Speak a qualification turn (e.g. *"I'm interested in a 2-bed at <project>"*).
   Confirm the agent responds within the latency budget and that:
   - the **Voice Console** (`/ora-panel/voice-console`) shows the turn, tool
     calls, and the latency HUD updating live;
   - each tool call produces exactly one `audit_log` row under actor
     `agent:voice-lead`.
5. End the call; confirm `call.ended` is published and a
   `post_call_processing` job is enqueued.

> Latency NFRs (voice-to-voice p50 ≤ 800 ms / p95 ≤ 1200 ms) are verified live
> via the latency HUD and rehearsal — they are not unit-tested.

---

## 5. Enabling / rolling back the Voice_Agent path (`voice_lead` flag)

The voice serving path defaults to the **proven lean orchestrator**. The Mastra
Voice_Agent is opt-in behind the `voice_lead` Migration_Switch flag and falls
back to the lean path on any agent error / budget breach, so enabling it can
never regress audit, OTP, parity, or latency.

The flag lives in the existing `agent_migration_flags` table (no new tables).

**Enable the agent path:**

```sql
INSERT INTO agent_migration_flags (capability, mode, enabled, updated_at)
VALUES ('voice_lead', 'agent', true, now())
ON CONFLICT (capability) DO UPDATE
  SET mode = 'agent', enabled = true, updated_at = now();
```

**Roll back to the lean path** (instant, safe default):

```sql
UPDATE agent_migration_flags
SET mode = 'deterministic', enabled = false, updated_at = now()
WHERE capability = 'voice_lead';
```

`selectVoiceServingPath()` reads this row each turn: it returns `"agent"` only
when `mode = 'agent'` AND `enabled = true`; every other state (including no row)
routes to the lean path. A diverging turn stamps `last_divergence_at`.

---

## 6. Public widget toggle (`voice_call_widget_enabled`)

The floating `CallWidget` is mounted in both locale layouts but is gated by a
site setting so it can be toggled without a redeploy. It is **off by default**
until the workers above are live.

- Set the site setting `voice_call_widget_enabled` to `"true"` to show the
  widget on the public site (both `en` and `ar`).
- Any other value (or absent) hides it.
