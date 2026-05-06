# feat: admin AI copilot + sequential approval chain + draft/pending page preview

**Branch:** `feat/admin-ai-copilot` → `main`

---

## Summary

Adds the admin AI copilot (reports, agentic actions, audit log) and a sequential approval chain for page edits with separate live/pending preview routes. Includes accompanying schema migrations, a substantial property-test suite for the approval module, and a fix to the demo seed reset.

## Changes

### Admin AI Copilot
- New `/ora-panel/ai` page with chat + agentic actions
- New `/ora-panel/ai/audit` page (admin chat history audit)
- Admin agent (`lib/cms/ai/admin-agent.ts`) with reports, RAG, action tools
- API routes: `lib/cms/api/routes/ai-admin.ts`
- Tests: `lib/cms/ai/admin-agent.test.ts`

### Sequential Approval Chain
- Position-based sequential approval (`lib/cms/approval/positions.ts`)
- Commit-on-approval semantics with rejection cleanup
- Decision reset, any-employee authorization, save routing
- Updated `ApprovalActions` UI + `use-approvals` hook
- Expanded approval gate, service, audit, notifications, dashboard logic
- Property-based test suite (15+ new test files) covering invariants

### Page Draft / Pending Preview
- New routes: `/ora-panel/pages/[id]/preview-live` and `/preview-pending`
- Pages list / detail / edit pages updated to surface pending draft state
- Pages API (`lib/cms/api/routes/pages.ts`) routes saves to draft vs live based on approval state
- Publish flow: send empty body + handle 202 response when approval required

### Page Builder UX
- Sidebar tooltips on collapsed admin nav
- Page editor: hooks-order fix (`useMemo` above early returns)
- Clone-to-locale: ensures unique slug + copies all SEO fields

### Database / Migrations
- `0014_serious_zodiak.sql`
- `0015_admin_chat_history.sql`
- `0016_sudden_bullseye.sql`
- `0017_payment_plans.sql`
- `0018_ambiguous_tana_nile.sql`

Run `bun run db:migrate` to apply.

### Demo Seed
- Fix: `resetDemo` now deletes appointments referencing demo conversations before deleting the conversations themselves (resolves FK error on `ai_appointments_conversation_id_ai_conversations_id_fk`)
- Additional demo data extensions

### Specs (design docs)
- `.kiro/specs/sequential-approval-chain/`
- `.kiro/specs/pages-approval-draft-preview/`

## Testing

- [x] `npx tsc --noEmit` passes
- [x] `npx vitest run` passes (approval property suite included)
- [x] Manually verified in `next dev`:
  - Admin AI copilot chat + audit log
  - Page edit → save → routes to pending draft when approval required
  - Live vs pending preview routes render correct snapshot
  - `bun run db:seed:demo:reset` completes without FK errors

## Database / Migrations

- [x] Includes new migrations: `drizzle/0014`–`drizzle/0018`

Apply with:
```sh
bun run db:migrate
```

## Risk & Rollout

- Approval chain changes touch the page save path — verify any in-flight pending pages migrate cleanly. Backfill `position` if existing approval rows exist in production.
- AI copilot is admin-panel only and gated by existing RBAC.
- Schema changes are additive; no destructive migrations.

## Commits

- `ca005a2` feat: sequential approval chain + draft/pending preview + AI audit
- `e7de863` fix: publish page error toast — send empty body + handle approval 202
- `836abdd` fix: clone-locale ensures unique slug and copies all SEO fields
- `2e0aae2` fix: move useMemo above early returns in PageEditorPage (hooks order)
- `a408efd` feat(ora-panel): admin AI copilot with reports + agentic actions

## Linked Issues

<!-- Closes #___ -->
