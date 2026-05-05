# Settings

**Route:** `/[locale]/settings`
**Files:**
- `apps/web/app/[locale]/(shell)/settings/page.tsx`
- `apps/web/components/settings/SettingsClient.tsx`
- `apps/web/components/settings/{AIProvidersSection,DevelopersSection,MembersSection,BillingSection}.tsx`

**Owner:** settings
**Status:** stable

## Purpose
Single Settings page with 6 sections: Workspace, AI Providers, Plan & Usage,
Members & Invites, Developers (API keys + Webhooks), API Keys (legacy/mock),
Notifications, Team.

## Planning (initial design)

### Goals
- One page, all settings — no nested routes for now.
- Each section is its own client component with its own state.
- Sensitive sections (Developers, AI Providers) explicitly mark when secrets
  are present.

### Sections
1. **Workspace** — name, slug, danger zone (delete).
2. **AI Providers** (`AIProvidersSection`) — paste API keys for Anthropic,
   OpenAI, Google, Azure. Test connection.
3. **Plan & Usage** (`BillingSection`) — current plan, monthly usage with
   progress bars, Stripe checkout / customer portal.
4. **Members** (`MembersSection`) — list pending invites, send new with role,
   copy invite URL.
5. **Developers** (`DevelopersSection`) — API keys (create/revoke), outbound
   webhooks (URL + events + enabled toggle).
6. **Notifications** — toggles for email digests, alerts, etc.
7. **API Keys (legacy)** — mock cards from earlier; superseded by Developers.
8. **Team Members** — read-only list of current workspace members.

### Decisions & trade-offs
- **Single page** instead of `/settings/<sub>` nested routes — cuts code
  scope, easier to keep all toggles consistent. Trade-off: longer page.
- **API key shown ONCE** at creation (`Revealed key` panel) — never stored
  decrypted, only SHA-256 hashed.

## Execution (changelog — newest first)

### 2026-05-04 — Phase 8 polish
- Added DevelopersSection (API keys + outbound webhooks).
- Added MembersSection (invite flow with email + copy URL).
- Added BillingSection (plan + usage + Stripe checkout button).
- Mounted under SettingsClient as 4 new SectionCards.

### 2026-04-28 — initial Settings + AI Providers
- AIProvidersSection: 4-card grid, password-input + test button + model list.
- API key encryption flows.

## Performance notes
- Each section fetches its own data on mount. AIProvidersSection loads
  provider rows; BillingSection loads `/api/billing/usage`.
- Member list size is bounded by plan limits (≤ 50).

## Open issues / TODO
- Move sections to URL hash for shareable deep links (#billing, #developers).
- Audit log viewer (data exists, no UI).
- 2FA enrollment (better-auth supports TOTP).
- Session management view (active devices).
- Notifications page is placeholder; needs real preferences.
