// ── ChannelAdapter — provider-agnostic outbound messaging (Design §11; Req 9.7)
//
// The `send_whatsapp_brief` job composes a rep brief and sends it through THIS
// interface. The job code depends only on `ChannelAdapter`, never on a concrete
// provider, so swapping WhatsApp for another transport (SMS, Teams, a different
// WhatsApp BSP) needs no change to the job handler — only a different adapter
// instance passed in (Req 9.7 / FR-T4).
//
// CREDS: the live WhatsApp adapter talks to the WhatsApp Cloud (Graph) API and
// is configured from env. In tests we inject a fake `ChannelAdapter` (no live
// credentials), exactly as the job spine's idempotency tests do.
//
// PRIVACY (Req 14.5): the brief is addressed to the REP and describes the lead
// by qualification facts (name, tier, project, budget) — never the lead's raw
// phone number. The adapter does not persist message bodies to the event bus or
// audit log.

/** A composed outbound message handed to a {@link ChannelAdapter}. */
export interface ChannelMessage {
  /**
   * Provider-addressable recipient. For WhatsApp this is the rep's phone in
   * E.164 form; for another provider it might be a user id or channel handle.
   * The adapter is responsible for interpreting it.
   */
  to: string;
  /** The fully composed, human-readable brief body. */
  body: string;
}

/** The result of a successful send. */
export interface ChannelSendResult {
  /** Provider-assigned message id, for traceability. */
  messageId: string;
  /** The provider that handled the send (e.g. "whatsapp"). */
  provider: string;
}

/**
 * Provider-agnostic outbound message channel. Implementations encapsulate ALL
 * provider specifics (auth, endpoint, payload shape). Job code depends only on
 * this contract (Req 9.7).
 */
export interface ChannelAdapter {
  /** Stable provider identifier, surfaced on the send result. */
  readonly provider: string;
  /** Send a single message. Throws on failure so the job can mark itself failed. */
  send(message: ChannelMessage): Promise<ChannelSendResult>;
}

/** Configuration for the default WhatsApp adapter, read from env. */
export interface WhatsAppAdapterConfig {
  /** WhatsApp Cloud API base URL (e.g. https://graph.facebook.com/v21.0). */
  apiBaseUrl: string;
  /** The sender phone-number id registered with the WhatsApp Business account. */
  phoneNumberId: string;
  /** Bearer access token for the WhatsApp Business account. */
  accessToken: string;
}

/**
 * Read the WhatsApp adapter configuration from the environment. Returns `null`
 * when any required value is missing so callers can degrade gracefully rather
 * than constructing a half-configured adapter.
 */
export function whatsAppConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): WhatsAppAdapterConfig | null {
  const apiBaseUrl = env.WHATSAPP_API_BASE_URL;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;
  if (!apiBaseUrl || !phoneNumberId || !accessToken) return null;
  return { apiBaseUrl, phoneNumberId, accessToken };
}

/**
 * Default WhatsApp implementation of {@link ChannelAdapter}, backed by the
 * WhatsApp Cloud (Graph) API. Constructed from explicit config so it is fully
 * deterministic and (with an injected `fetch`) unit-testable; production code
 * builds it via {@link whatsAppConfigFromEnv}.
 *
 * Swapping providers is a matter of supplying a different `ChannelAdapter` to
 * the job handler — this class is never referenced by name from the job code.
 */
export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly provider = "whatsapp";

  constructor(
    private readonly config: WhatsAppAdapterConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async send(message: ChannelMessage): Promise<ChannelSendResult> {
    const url = `${this.config.apiBaseUrl.replace(/\/+$/, "")}/${this.config.phoneNumberId}/messages`;

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: message.to,
        type: "text",
        text: { body: message.body },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `WhatsApp send failed (${res.status} ${res.statusText})${detail ? `: ${detail}` : ""}`
      );
    }

    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
    };
    const messageId = json.messages?.[0]?.id ?? "";
    return { messageId, provider: this.provider };
  }
}

/**
 * An adapter that always throws — the safe default when no provider is
 * configured. Keeps the job handler's dependency on `ChannelAdapter` total
 * while ensuring an unconfigured environment fails loudly (and the job stays
 * re-runnable) rather than silently dropping the brief.
 */
export class UnconfiguredChannelAdapter implements ChannelAdapter {
  readonly provider = "unconfigured";
  async send(): Promise<ChannelSendResult> {
    throw new Error(
      "No messaging channel is configured. Set WHATSAPP_API_BASE_URL, " +
        "WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN, or inject a ChannelAdapter."
    );
  }
}

/**
 * Resolve the default channel adapter from the environment: a real
 * {@link WhatsAppChannelAdapter} when WhatsApp is configured, otherwise an
 * {@link UnconfiguredChannelAdapter} that throws on send.
 */
export function defaultChannelAdapter(
  env: NodeJS.ProcessEnv = process.env
): ChannelAdapter {
  const config = whatsAppConfigFromEnv(env);
  return config ? new WhatsAppChannelAdapter(config) : new UnconfiguredChannelAdapter();
}
