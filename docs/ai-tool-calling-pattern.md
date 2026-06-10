# AI Tool Calling — Reference Pattern

A guide for replicating the AI agent / "tool calling" approach used in this project
in other codebases. Hand this to any team that needs reliable, auditable AI-driven
actions (e.g. "create appointment", "cancel booking", "change ticket status").

---

## TL;DR

- **We do NOT use the model's native function/tool-calling.** No `tools`, `tool_calls`,
  or `function_call` anywhere. (Confirmed: zero occurrences in the codebase.)
- Actions are dispatched by **deterministic intent detection** (keyword/regex) in our
  own code, with **regex-based argument extraction**, then a **typed service call** to
  the DB, plus an **audit log** entry.
- The LLM is used **only for free-form replies** (RAG answers), never to decide or
  execute an action.
- All model calls go through **Cloudflare AI Gateway** using its **OpenAI-compatible
  REST API** via plain `fetch`. No Vercel AI SDK, no OpenAI/Anthropic SDK.
- Destructive actions are gated behind a **single-use confirmation token** (human in
  the loop).

This is why it works reliably: the model never has to emit correct tool JSON. We
removed the LLM from the decision path for anything that mutates data.

---

## Why this approach (and when to use it)

| Need | Use this deterministic pattern? |
| --- | --- |
| Predictable, narrow set of actions (book / cancel / reschedule / status change) | ✅ Yes — ideal |
| Auditable, must never "hallucinate" an action | ✅ Yes |
| Open-ended, dozens of tools, dynamic agentic planning | ❌ No — you need real native tool-calling |

If the goal is a small, well-defined set of operations, hand-coded intent dispatch is
more reliable and easier to audit than native tool-calling. If you truly need
open-ended multi-tool agentic behavior, this pattern does not scale (every intent is
hand-written) and you must get native tool-calling working at the model/gateway layer
instead.

---

## 1. Provider transport: Cloudflare AI Gateway (OpenAI-compatible)

Single integration point. All model traffic is plain `fetch` against the gateway's
OpenAI-compatible endpoints — no SDK.

- Chat:       `POST {CF_AI_GATEWAY_URL}/chat/completions`
- Embeddings: `POST {CF_AI_GATEWAY_URL}/embeddings`
- Auth:       `Authorization: Bearer ${CF_AI_API_TOKEN}`
- Gateway URL shape: `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai`

### Environment variables

```bash
# ---- Cloudflare AI Gateway (OpenAI-compatible) ----
CF_AI_GATEWAY_URL=        # https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai
CF_AI_API_TOKEN=
CF_CHAT_MODEL="openai/gpt-4o-mini"        # default chat model
CF_CHAT_MODEL_PREMIUM="openai/gpt-4.1"    # used for high-stakes turns
CF_EMBEDDING_MODEL="@cf/baai/bge-base-en-v1.5"
ORA_AI_TEMPERATURE="0.6"
ORA_AI_MAX_TOKENS="600"
```

### Models in use
- Chat (default): `openai/gpt-4o-mini`
- Chat (premium): `openai/gpt-4.1`
- Embeddings: `@cf/baai/bge-base-en-v1.5` (Cloudflare Workers AI BGE, 768-dim)

> ⚠️ Gotcha for the other team: OpenAI models (`openai/...`) routed through the
> gateway support native tool-calling because the gateway forwards the request to
> OpenAI. Cloudflare **Workers AI** models (`@cf/...`) have inconsistent tool-calling
> support. If native tool-calling is failing elsewhere, first check that the model
> string points at a provider that actually supports tools — not a `@cf/...` model.

### Reference: the completion call (raw fetch, OpenAI-compatible body)

```ts
// lib/cms/ai/gateway.ts
export async function generateCompletion(
  messages: ChatMessage[],
  options?: CompletionOptions
): Promise<string> {
  const gatewayUrl = getGatewayUrl();      // CF_AI_GATEWAY_URL (trailing slash trimmed)
  const token = getApiToken();             // CF_AI_API_TOKEN
  const model = getChatModel(options?.premium === true);

  const body = {
    model,
    messages,
    temperature: options?.temperature ?? 0.6,
    max_tokens: options?.maxTokens ?? 600,
  };

  const response = await fetch(`${gatewayUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(
      `Cloudflare AI Gateway chat completion failed (${response.status}): ${errorBody}`
    );
  }

  const data = await response.json();
  // OpenAI-compatible response: { choices: [{ message: { content } }] }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Unexpected chat completion response format.");
  }
  return content;
}
```

Embeddings follow the same shape: `POST {gateway}/embeddings` with `{ model, input }`,
reading back `data.data[0].embedding`.

---

## 2. The tool-calling pattern: deterministic intent dispatch

Instead of asking the model "which tool should I call with what args", we do it in code:

```
user message
   │
   ▼
detectIntent(message)        ← keyword / regex match → enum
   │
   ▼
switch (intent) { ... }      ← route to a hand-written executor
   │
   ▼
executeX(message)            ← extract args via regex, ask for missing fields
   │
   ▼
service call (typed)         ← real DB write (bookAppointment, cancelAppointment…)
   │
   ▼
audit log + structured reply
```

### Intent detection (keyword/regex, ordered by priority)

```ts
// lib/cms/ai/agent.ts
export function detectIntent(message: string): AgentIntent {
  if (containsAny(message, HANDOVER_KEYWORDS))   return "request_handover";
  if (containsAny(message, OTP_REQUEST_KEYWORDS)) return "request_otp";
  if (containsAny(message, CANCEL_KEYWORDS))      return "cancel_appointment";
  if (containsAny(message, RESCHEDULE_KEYWORDS))  return "reschedule_appointment";
  if (containsAny(message, REGISTER_LEAD_KEYWORDS)) return "register_lead";
  if (containsAny(message, LEAD_KEYWORDS))        return "create_lead";
  if (containsAny(message, BOOKING_KEYWORDS))     return "create_booking";
  if (containsAny(message, TICKET_KEYWORDS))      return "create_ticket";
  if (containsAny(message, NAVIGATE_KEYWORDS))    return "navigate";
  if (extractEmail(message) || extractPhone(message)) return "provide_contact";
  return "none";
}
```

Order matters — more specific / higher-priority intents are checked first so an
ambiguous message resolves predictably.

### Argument extraction (regex, not the LLM)

```ts
// Pull a structured reference out of free text, e.g. "ORA-APT-AB12CD"
export function extractAppointmentReference(message: string): string | null {
  const m = message.match(/\bORA-APT-[A-Z0-9]{6}\b/i);
  return m ? m[0].toUpperCase() : null;
}
```

If a required field is missing, the executor returns a reply asking for it rather than
guessing. The conversation carries pending state forward across turns.

### The typed action (real DB write + audit log)

```ts
// lib/cms/ai/actions.ts
export async function bookAppointment(db, input): Promise<AppointmentResult> {
  // 1. validate required fields
  // 2. check slot conflict
  // 3. insert row
  // 4. logAudit(...)  ← every AI-initiated mutation is audited
  // 5. return structured result
}
```

Every mutating action goes through the existing service layer so audit logging and
lifecycle validation are honoured — the AI path is not a backdoor around your normal
business rules.

---

## 3. Human-in-the-loop for destructive actions (admin agent)

For staff-facing destructive ops (bulk cancel, bulk close, status change) the agent
does **not** execute immediately. It returns a `pendingAction` carrying an opaque,
single-use, short-TTL **confirmation token**:

1. Agent detects a destructive intent → issues a `pendingAction` with a `token`
   (in-memory store, 5-min TTL, single-use, bound to the requesting user).
2. UI renders a confirmation card with a summary + affected count.
3. On confirm, the client posts the `token` back.
4. The agent validates/consumes the token and only then runs the action through the
   service layer.

```ts
// lib/cms/ai/admin-agent.ts  (shape)
if (input.confirmationToken) {
  const rec = consumePendingToken(input.confirmationToken, input.userId);
  if (!rec) return { response: "That confirmation expired or wasn't yours — re-run the request." };
  switch (rec.kind) {
    case "cancel_appointment":  return executeCancelAppointmentAction(db, input.userId, rec.args);
    case "change_ticket_status": return executeChangeTicketStatusAction(db, input.userId, rec.args);
    // ...
  }
}

const intent = detectAdminIntent(input.message);
switch (intent) {
  case "report_overview":     return { response: await reportOverview(db) };       // read-only: run now
  case "cancel_appointment":  return proposeCancelAppointment(db, userId, message); // destructive: propose + token
  // ...
}
```

---

## 4. File map (what to copy / mirror)

| Concern | File in this repo |
| --- | --- |
| Gateway transport (chat + embeddings, raw fetch) | `lib/cms/ai/gateway.ts` |
| Visitor agent: intent detection + dispatch | `lib/cms/ai/agent.ts` |
| Typed DB actions + audit logging | `lib/cms/ai/actions.ts` |
| Admin agent: intents + confirmation-token flow | `lib/cms/ai/admin-agent.ts` |
| RAG pipeline (free-form replies) | `lib/cms/ai/rag.ts` |
| Public chat orchestrator | `lib/cms/ai/chat.ts` |
| Public API route (`POST /ai/chat`) | `lib/cms/api/routes/ai-chat.ts` |
| Admin API route (`POST /ai/admin/chat`, auth-guarded) | `lib/cms/api/routes/ai-admin.ts` |

---

## 5. Checklist for the other team

1. **Decide the strategy.** Narrow, fixed action set → use this deterministic pattern.
   Open-ended multi-tool agent → fix native tool-calling instead (see below).
2. **Point the gateway at a tool-capable model** if you do want native tools. OpenAI
   models via the OpenAI-compatible endpoint support tools; `@cf/...` Workers AI models
   may not. This is the most common reason "tool calling doesn't work."
3. **If adopting the deterministic pattern:**
   - Write an `detectIntent()` with ordered keyword/regex checks.
   - Extract arguments with regex; ask for missing fields, never guess.
   - Route each intent to a typed service function that does the DB write + audit log.
   - Gate destructive actions behind a single-use confirmation token.
   - Keep the LLM only for free-form replies.
4. **Keep one transport module** (`gateway.ts` equivalent) so model/provider/endpoint
   are configured in exactly one place.

> Note: this codebase does **not** demonstrate native tool-calling through the gateway —
> it deliberately avoids it. So it proves the gateway transport works and that
> deterministic dispatch works; it does not, by itself, prove the other team's native
> tool-calling will work once routed through the gateway.
