# NoProviderBanner

**File:** `apps/web/components/common/NoProviderBanner.tsx`
**Mounted on:** Agents list, Flows list, Knowledge list, Channels list.

**Owner:** UX / onboarding
**Status:** stable

## Purpose
Show a soft warning at the top of any screen that depends on AI providers
when none are configured. Click → goes to Settings → AI Providers.

## Planning (initial design)

### Goals
- Self-serve discovery for new users — they shouldn't get cryptic errors
  when test-chat fails because no key is set.
- Non-intrusive; dismissible per session via simple state in the component.

### Behavior
- On mount, GET `/api/providers`.
- If response is empty array → show the banner.
- Click banner → navigate to `/[locale]/settings`.

### Decisions & trade-offs
- **Per-mount fetch** (no caching) — accept the small overhead because the
  alternative (a global provider context) is more complex and the banner
  goes away as soon as a key is added.

## Execution (changelog — newest first)

### 2026-04-28 — initial banner

## Open issues / TODO
- Dismissible (LocalStorage flag — "I know, I'll set it up later").
- Specific tooling links: "Get an Anthropic key →".
