# Marketing Analytics & Product Tracking — Ora Page Builder

> Status: **Proposal / Implementation Plan**
> Owner: Platform team
> Decision: **PostHog (EU) + Microsoft Clarity + first-party attribution**. Segment / RudderStack / Mixpanel rejected — see "Decisions" section.

---

## 1. Goals

Help Ora's marketing and product teams answer, in one place:

1. **Where do our visitors come from?** (channel, campaign, keyword, ad creative)
2. **What do they do on the site?** (pages, sections, scroll depth, clicks, form starts/abandons)
3. **What converts them?** (which page, section, CTA, AI-agent path led to a qualified lead or reservation)
4. **What did that conversion cost?** (true CAC and ROAS per project, per unit type, per channel, per campaign)
5. **How is the AI agent performing?** (drop-off, cost per converted lead, prompt quality)
6. **How do we beat Emaar's web understanding?** Per-project, per-unit-type funnels with replay tied to identified leads — capabilities GA4 alone can't deliver.

---

## 2. The Stack (final)

| Layer | Tool | Notes |
|---|---|---|
| Product analytics, funnels, retention, cohorts | **PostHog Cloud — EU (Frankfurt)** | Single SDK, single bill |
| Session replay (identified) | **PostHog Replay** | Tied to lead identity, used for sales / UX review |
| Heatmaps, dead-clicks, rage-clicks, scroll maps | **Microsoft Clarity** | Free, unlimited; also feeds Bing Ads signals |
| Feature flags & A/B experiments | **PostHog** | Same SDK |
| Surveys / NPS | **PostHog Surveys** | Same SDK |
| LLM / AI agent analytics | **PostHog LLM Analytics** | Wraps OpenAI / Anthropic / Azure OpenAI calls |
| Error tracking (frontend) | **PostHog Error Tracking** | Optional; can stay with App Insights if preferred |
| APM / infrastructure | **Azure Application Insights** | Stays as-is, complementary |
| First-party attribution | **Custom cookie + middleware** | ~1 day of work, owned by us |
| Ad spend ingestion | **Daily cron → Postgres `marketing_spend`** | Meta, Google, TikTok, Bing Ads APIs |
| Server-side conversions (CAPI) | **Next.js API route → ad platforms** | Recovers iOS/Safari signal loss |
| In-app dashboards | **PostHog Query API → `ora-panel/`** | Marketing sees data without leaving Ora |

**Estimated cost at year-1 scale (~5M events, ~10K replays, ~500K AI events): ~$200–400 / month.**

---

## 3. Decisions Log

| Question | Decision | Why |
|---|---|---|
| PostHog vs Mixpanel | **PostHog** | All-in-one (replay + flags + LLM + surveys); EU region; self-host escape hatch; ~3–5x cheaper TCO at our scale |
| RudderStack / Segment | **Rejected** | We're one team, few destinations, and PostHog Destinations covers the fan-out we need. CDP overhead not justified |
| Build our own analytics | **Rejected** | Months of work for what PostHog gives free. Use our engineering on the page builder + AI agent instead |
| Azure App Insights as analytics | **Rejected for product analytics**, kept for APM | App Insights has no funnels, retention, replay, or feature flags |
| Clarity vs PostHog Replay | **Both** | Clarity = free heatmaps + Bing Ads integration. PostHog Replay = identity-tied debugging of specific leads |

---

## 4. What needs to be added to the Page Builder

This is the focus of the team revisit. Three layers of configuration.

### 4.1 Site / tenant settings (one-time, in `ora-panel/settings/analytics`)

Build a single settings page exposing:

- [ ] **PostHog project key** (`NEXT_PUBLIC_POSTHOG_KEY`)
- [ ] **PostHog host** (default `https://eu.i.posthog.com`)
- [ ] **PostHog reverse-proxy path** (default `/ingest`) — so requests look first-party
- [ ] **Microsoft Clarity project ID**
- [ ] **GA4 measurement ID** (optional — for marketing parity / pixel parity)
- [ ] **Meta Pixel ID** + **Meta CAPI access token** (server-side, encrypted)
- [ ] **Google Ads conversion ID** + **conversion labels** + **Enhanced Conversions toggle**
- [ ] **TikTok Pixel ID** + **TikTok Events API token**
- [ ] **Bing UET tag ID** (Clarity-linked)
- [ ] **Cookie consent mode** (strict / balanced / off) — controls what fires before consent
- [ ] **Default attribution window** (e.g., 30 / 60 / 90 days)
- [ ] **PII redaction toggles** for replay (mask inputs, mask text)

> All values stored in tenant config table; injected once in `app/(en)/layout.tsx` and `app/ar/layout.tsx`.

### 4.2 Per-page configuration (in builder page editor)

For each page the user builds, add:

- [ ] **Page type / template tag** (e.g., `project-landing`, `unit-detail`, `blog-post`, `lead-form`) — auto-attached as event property `page_template`
- [ ] **Project tag** (Marina, Creek, etc.) — auto-attached as `project_id`
- [ ] **Unit type / price band** (when applicable) — `unit_type`, `price_band`
- [ ] **Conversion goal** dropdown — pick the event that defines success for this page (e.g., `lead_form_submitted`, `viewing_booked`). Auto-creates the funnel in PostHog.
- [ ] **Funnel steps** (optional override) — pick 2–6 events that form this page's conversion funnel
- [ ] **Experiment / variant slot** — bind this page version to a PostHog feature flag for A/B
- [ ] **Survey trigger** — optionally fire a PostHog survey on exit / time-on-page / scroll-depth
- [ ] **Per-page consent override** (rarely needed, e.g., legal pages)

### 4.3 Per-section / per-element configuration (in section editor)

For every interactive section (CTA button, form, hero, gallery, pricing card, AI-chat trigger):

- [ ] **Track as event** toggle
- [ ] **Event name** (e.g., `cta_book_viewing_clicked`) — validated against a controlled vocabulary
- [ ] **Event properties** (key/value JSON, with autocomplete from page-level tags)
- [ ] **Element ID** auto-generated → emitted as `data-ph-capture-attribute-*` attributes (PostHog autocapture friendly)
- [ ] **Conversion value** (optional, in AED) — sent to ad platforms via CAPI for value-based bidding
- [ ] **Form-specific**: track `form_started`, `form_field_focused`, `form_field_abandoned`, `form_submitted` (auto-wired when the section is a form)
- [ ] **Visibility threshold** for `section_viewed` events (e.g., 50% in viewport for 1s)

---

## 5. AI Agent Tracking (customer-facing)

Wrap LLM calls in `lib/cms/ai/` with PostHog LLM Analytics SDK:

- [ ] Replace direct OpenAI/Azure OpenAI client with `@posthog/ai` wrapper
- [ ] Pass `distinctId`, `traceId`, `conversationId`, `pageContext` (project, unit type)
- [ ] Capture custom events:
  - `ai_conversation_started`
  - `ai_question_asked` (with intent classification)
  - `ai_handoff_to_human`
  - `ai_lead_qualified`
  - `ai_viewing_booked`
- [ ] Tag every AI session with attribution properties (so we know "Meta campaign X → AI chat → reservation")
- [ ] Cost & latency dashboards in `ora-panel/ai/analytics`

---

## 6. First-Party Attribution (the most important non-PostHog piece)

Implementation plan:

1. **Edge middleware** (`middleware.ts`) reads on every request:
   - UTM params: `utm_source/medium/campaign/term/content`
   - Click IDs: `gclid`, `fbclid`, `ttclid`, `msclkid`, `li_fat_id`
   - Referrer, landing path, locale, device class
2. **Sets cookie `ora_attribution`** (HTTPOnly: false so client SDKs can read; SameSite=Lax; 90-day TTL):
   ```jsonc
   {
     "first_touch": { "source": "...", "campaign": "...", "ts": "..." },
     "last_touch":  { ... },
     "touches":     [ /* up to 20 most recent */ ]
   }
   ```
3. **PostHog `register()`** attaches first/last-touch as super-properties on every event
4. **Server-side enrichment**: every `/api/lead`, `/api/booking` route reads the cookie and persists attribution to the lead row in Postgres → joinable with ad spend
5. **Consent-aware**: if user rejects marketing cookies, store only a session-scoped attribution and skip server persistence

---

## 7. Ad Spend Ingestion → ROAS

- [ ] Postgres tables: `marketing_spend(date, channel, campaign_id, ad_set_id, ad_id, spend, impressions, clicks, currency)`
- [ ] Daily cron in `scripts/ingest-ad-spend.ts`:
  - Meta Marketing API
  - Google Ads API
  - TikTok Ads API
  - Microsoft (Bing) Ads API
- [ ] Map `campaign_id` ↔ `utm_campaign` (require naming convention enforced by UTM builder, see 8.1)
- [ ] Materialised view: `roas_by_project_channel_day` joining spend with PostHog-exported conversions

---

## 8. Marketing Tooling (inside `ora-panel/`)

### 8.1 UTM Builder
A small tool so marketing generates consistent tagged URLs:
- Picks project, campaign, channel, ad set, creative
- Enforces naming convention (e.g., `{project}_{quarter}_{audience}`)
- Outputs the URL + a QR code for offline campaigns

### 8.2 Live attribution dashboard tile
- Top sources / campaigns last 7/30 days
- Conversion rate per campaign
- **CAC and ROAS per project per channel** (the headline metric)
- AI agent contribution to conversion

### 8.3 Embedded PostHog insights
Use PostHog Query API (HogQL) to render selected charts inline in `ora-panel/` so marketing rarely needs to leave the app.

---

## 9. Privacy, Consent & Compliance

- [ ] Cookie consent banner with granular categories (necessary / analytics / marketing)
- [ ] PostHog `opt_in_capturing()` / `opt_out_capturing()` wired to consent state
- [ ] Replay masking defaults: mask all text inputs, allow opt-in unmasking per section
- [ ] Data residency: PostHog **EU region** mandatory
- [ ] DSAR endpoint: `/api/privacy/export` and `/api/privacy/delete` calling PostHog's person-delete API
- [ ] Document retention: 1 year free / 7 years paid (PostHog), 6 months replays — confirm with legal

---

## 10. Standard Event Vocabulary (initial)

To prevent event-name sprawl, lock these in before instrumentation:

| Event | When |
|---|---|
| `page_viewed` | Auto (PostHog) |
| `section_viewed` | Section enters viewport ≥1s |
| `cta_clicked` | Any CTA element click |
| `form_started` | First field focus |
| `form_field_abandoned` | Field blur with value, no submit within session |
| `form_submitted` | Successful submit |
| `lead_qualified` | Server-side, after backend qualification |
| `viewing_requested` | Booking form submit |
| `viewing_confirmed` | Confirmed by sales |
| `reservation_started` | EOI / token payment initiated |
| `reservation_completed` | Payment success |
| `ai_conversation_started` | First user message to AI agent |
| `ai_handoff_to_human` | AI escalates |
| `download_brochure` | Brochure download |
| `floorplan_viewed` | Floorplan modal opened |

Every event carries: `project_id`, `unit_type`, `page_template`, `locale`, `device_class`, plus attribution super-properties.

---

## 11. Implementation Phases

### Phase 1 — Foundation (1 sprint)
- [ ] PostHog EU project provisioned
- [ ] Env vars added to `.env.example`
- [ ] PostHog provider in both `app/(en)/layout.tsx` and `app/ar/layout.tsx`
- [ ] Reverse proxy via Next.js rewrite (`/ingest/*` → PostHog)
- [ ] Clarity script tag
- [ ] Cookie consent banner + consent-gated capture
- [ ] First-party attribution middleware + cookie

### Phase 2 — Page builder integration (1 sprint)
- [ ] Site settings page (4.1)
- [ ] Per-page configuration fields (4.2)
- [ ] Per-section "Track as event" controls (4.3)
- [ ] Server-side lead persistence with attribution

### Phase 3 — AI + marketing tooling (1 sprint)
- [ ] PostHog LLM Analytics wrapping `lib/cms/ai/`
- [ ] UTM builder in `ora-panel/`
- [ ] Ad spend ingestion cron + Postgres tables
- [ ] ROAS dashboard tile

### Phase 4 — Server-side conversions (when ad spend > ~$5K/mo)
- [ ] Meta CAPI integration
- [ ] Google Enhanced Conversions
- [ ] TikTok Events API
- [ ] Bing UET server events

---

## 12. Open Questions for the Team Revisit

1. **Tenant model**: do all Ora sub-brands share one PostHog project (with project tags) or separate projects per sub-brand?
2. **Consent**: do we need a CMP vendor (OneTrust, Cookiebot) or is a custom banner acceptable for UAE/EU traffic?
3. **PII policy**: which fields are allowed in event properties? (name? email hash only?)
4. **Sales CRM**: where do qualified leads land (Salesforce / HubSpot / custom)? — needed to close the loop on "viewing → reservation"
5. **Ownership**: who maintains the event vocabulary and reviews new event names added via the builder?
6. **Self-host trigger**: at what point (data volume / Emaar IT directive) do we migrate from PostHog Cloud to self-hosted?
7. **Replay sampling**: 100% or sample (e.g., 25%) to stay within free tier longer?
8. **A/B framework**: do we want guardrail metrics enforced on every experiment created via the builder?

---

## 13. Why this beats Emaar's current web stack

- Per-project + per-unit-type **funnels** (Marina 2BR vs Creek studio) — GA4 can't do this cleanly
- **Replay tied to identified leads** — sales sees what the lead browsed before the call
- **AI agent conversion tracking** — no regional competitor has this today
- **First-party attribution** that survives Safari/iOS — most competitors are losing 30%+ of signal
- **In-app dashboards** so marketing doesn't context-switch between 5 tools
- **One bill, one SDK, one mental model** — we ship faster than teams juggling Mixpanel + LaunchDarkly + Hotjar + Langfuse
