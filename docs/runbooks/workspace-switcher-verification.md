# Phase D — switcher launch + URL migration verification

Phase D moves the authenticated shell under `/[locale]/[workspaceSlug]/...`,
adds the workspace switcher to the sidebar, ships `POST /api/workspaces`

- the create-workspace modal, and 301-redirects legacy URLs to the
  caller's active workspace.

## What this doc tracks

- The Phase D output gate.
- Manual verification steps the dev server needs (multi-tab, legacy
  redirect, k6 latency).
- Pointers back to the automated tests covered by `pnpm vitest run`.

## Output gate (per the spec)

1. **Switcher p95 < 100ms over 30 days.**
   Measured against `GET /api/me/workspaces` (the hottest hop in the
   switcher) and the client-side switch transition.
2. **Zero `tenant_context_missing` errors for 7 days** in
   `/api/admin/tenant-telemetry`. Phase C made RLS FORCED, so any
   leak surfaces here.
3. **Multi-tab manually verified** — two tabs on two different
   workspaces stay independent.
4. **a11y pass via axe-core** on the switcher and create-workspace
   modal (keyboard focus, aria-haspopup, role="menu").

## Manual verification flow

### 1. Multi-tab independence

```bash
ADMIN_EMAILS=lucasmailland@gmail.com pnpm --filter web dev
```

- Tab A: open `/en/<wsA-slug>` (login if needed). Confirm sidebar
  switcher shows wsA.
- Tab B: open `/en/<wsB-slug>`. Confirm sidebar switcher shows wsB.
- In Tab A, open the switcher (`⌘K` or click the chip) and switch to
  wsB. URL becomes `/en/<wsB-slug>/<rest>`. The cookie
  `orch-active-workspace` now equals `<wsB-slug>`.
- Reload Tab B. URL is unchanged (`/en/<wsB-slug>`) and data is still
  wsB. The cookie change in Tab A must NOT yank Tab B into wsA — the
  URL is the source of truth, not the cookie.

Pass criteria: each tab keeps its URL and its data. The cookie is only
consulted for `/[locale]/workspaces` and the legacy 301 redirect.

### 2. Legacy 301

```bash
curl -i -b "better-auth.session_token=<token>; orch-active-workspace=<slug>" \
  http://localhost:3333/en/agents
```

Expected:

```
HTTP/1.1 301 Moved Permanently
Location: /en/<slug>/agents
```

Without the `orch-active-workspace` cookie:

```
HTTP/1.1 307 Temporary Redirect
Location: /en/workspaces
```

(307 because `NextResponse.redirect` defaults to 307 when no status is
passed — only the legacy→slug rewrite is a hard 301.)

### 3. Switcher latency (k6)

```bash
k6 run --vus 50 --duration 2m - <<'EOF'
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  thresholds: { http_req_duration: ['p(95)<100'] },
};

const cookie = __ENV.SESSION_COOKIE;

export default function () {
  const r = http.get('http://localhost:3333/api/me/workspaces', {
    headers: { cookie: `better-auth.session_token=${cookie}` },
  });
  check(r, { 'status 200': (x) => x.status === 200 });
}
EOF
```

Pass criteria: `http_req_duration p(95) < 100ms`.

### 4. Tenant-context telemetry

```bash
curl --cookie "<session-cookie>" \
  http://localhost:3333/api/admin/tenant-telemetry
```

Expected shape: `{ "set": <int>, "missing": <int>, "ratio": <float> }`.
The Phase D gate is `missing == 0` for the 7-day window — anything > 0
on protected routes is a leak under FORCED RLS.

## Automated coverage

The vitest suite that runs as part of CI covers:

- Isolation: `tests/isolation/db-scan.spec.ts` +
  `tests/isolation/injection-probes.spec.ts` — every tenant table
  rejects cross-tenant reads under the `app_user` role.
- Audit chain: `tests/integration/audit/{log,verify}.spec.ts`.
- Lifecycle: `tests/integration/tenant/lifecycle.spec.ts`.
- Feature flags: `tests/integration/feature-flags/check.spec.ts`.

URL-shape coverage is intentionally manual (route changes are hard to
unit-test without a full Next runtime). The manual steps above are the
gate.

## Known Phase D trade-offs

- `getCurrentWorkspaceBySlug` issues two GUC SETs on the connection
  (workspace_id + user_id) per request. Acceptable because the page
  already issues several queries; the cost is a few microseconds.
  Phase E might consolidate into a single `set_config(jsonb)` call if
  this shows up on the profiler.
- The switcher's `MyWorkspace[]` payload returns ALL of the user's
  workspaces with no pagination. Fine for the expected p99 of <20
  workspaces per user; will need a search-server cutover if/when
  someone hits 1000+.
- Legacy 301 only fires when a session is present. Anonymous traffic
  to `/en/agents` falls through to next-intl, which 404s. Good — we
  don't want to leak workspace existence via redirect status.
