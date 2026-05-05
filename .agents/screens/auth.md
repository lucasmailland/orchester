# Auth (Login / Signup / Invite Accept)

**Routes:**
- `/[locale]/login`
- `/[locale]/signup`
- `/[locale]/invite/[token]` (accept workspace invite)
- `/api/auth/[...all]` (better-auth catch-all)

**Files:**
- `apps/web/app/[locale]/(auth)/{login,signup}/page.tsx`
- `apps/web/components/auth/{LoginForm,SignupForm,InviteAcceptClient}.tsx`
- `apps/web/lib/auth.ts` (better-auth config)
- `apps/web/lib/auth-client.ts` (client SDK)
- `apps/web/middleware.ts` (auth gate)

**Owner:** auth
**Status:** stable (email/password + Google OAuth)

## Purpose
User accounts, sessions, and workspace membership. All other routes require
a session.

## Planning (initial design)

### Goals
- Email/password sign-up with optional Google OAuth.
- Sessions stored in DB (`session` table), not JWT — easier to revoke.
- Workspace invite flow: owner invites by email → email link → user signs in
  → accepts → joins as a member with assigned role.

### User flows

**Login**
1. `/login` → email + password → POST `/api/auth/sign-in/email`.
2. On success, `better-auth.session_token` cookie set.
3. Redirect to callbackUrl or `/`.

**Signup**
1. `/signup` → email + password + name → POST `/api/auth/sign-up/email`.
2. New user has `onboardingCompleted: false` → middleware redirects to `/onboarding`.
3. After onboarding: workspace created, user becomes `owner`.

**Invite accept**
1. User clicks invite URL `/invite/<token>` (received by email).
2. If not logged in, redirected to `/login?callbackUrl=/invite/<token>`.
3. Once logged in, lands on `InviteAcceptClient`.
4. Click "Aceptar" → POST `/api/invites/accept` → adds `workspace_member`
   row with the role from the invite.

### Decisions & trade-offs
- **`requireEmailVerification: false`** in dev. **MUST flip to true** before
  production. Tracked in `CLAUDE.md`.
- **Sessions are DB-backed** — easier revocation, slightly slower than JWT.
- **Soft email check on invite accept** — we let users accept invites even
  if their account email differs from the invite address. Trade-off:
  flexibility vs. strict identity.

## Execution (changelog — newest first)

### 2026-04-28 — Invite accept page
- /invite/[token] + InviteAcceptClient.
- POST /api/invites/accept idempotent on existing membership.

### 2026-04-26 — better-auth integration
- Drizzle adapter for `user`, `session`, `account`, `verification`.
- Google OAuth (gated by env vars).
- Middleware checks session cookie for protected paths.

## Performance notes
- `getCurrentSession()` does a DB lookup on every server-rendered page.
  Wrapped in React `cache()` for per-request dedup.
- `session` table has indices on `user_id` and `token` (Phase 6).

## Open issues / TODO
- Password reset UI (better-auth API exists, no page).
- Email verification UI + flag flip.
- 2FA / TOTP enrollment (better-auth supports it).
- Session management view in Settings (`active devices`).
- Magic link as alternative to password.
