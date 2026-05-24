# 0011. Active workspace via cookie

- Status: Accepted
- Date: 2026-05-23

## Context

ADR-0008 puts the workspace slug in every URL, but the user can still land on URLs that lack one: the bare login redirect, marketing links to `/`, or a legacy `/api/me/...` endpoint. We need a deterministic way for the middleware and the no-context server actions to know "which workspace are you currently in?".

The options: server-side session state (one row per session, requires a DB read on every request), or a client-managed cookie.

See `docs/specs/2026-05-23-tenant-hardening-design.md` §3.5.

## Decision

A long-lived cookie `orch-active-workspace=<slug>` stores the user's most recently chosen workspace. The middleware reads it on slug-less paths and 301-redirects to `/[locale]/[slug]/...`; the switcher writes it on every switch; the create-workspace flow writes it on success.

The cookie is `SameSite=Lax`, 30-day max-age, signed by Better-Auth's session secret (transitively — it sits inside our authenticated origin).

## Consequences

**Positive:** zero DB reads in the middleware fast path; multi-tab UX works (each tab can be in a different workspace because the URL is authoritative; the cookie only matters when there is no URL).
**Negative:** cross-device first-time UX shows the workspaces landing page (not the last-used workspace) — acceptable.
**Revisit when:** we offer mobile native apps without cookies (then move to a `/api/me/active-workspace` server resource).
