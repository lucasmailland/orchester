# Phase B — performance + telemetry verification

Phase B (silent backfill of tenant context) lands the middleware tenant-slug
forwarding, the `app.workspace_id` / `app.user_id` GUC setters inside
`getCurrentWorkspace()`, the cron `withCrossTenantAdmin` wrapper, and the
admin telemetry endpoint. RLS is **not yet FORCED** — that's Phase C.

## What this doc tracks

- The output gate Phase B must clear before Phase C starts.
- The manual steps needed to verify it (the dev server can't be run from
  an automated agent loop).
- Where to find the live telemetry counters once the smoke is running.

## Output gate (per the spec)

1. `tenant.context.missing_count / tenant.context.set_count < 1%`
   sustained over a representative sample window (the spec asks for 7
   days; for local pre-prod verification a 100-request sample is fine).
2. Median request latency within ±5% of the Phase 0 baseline captured
   pre-rollout (k6 against `/api/agents/[id]/test-chat`; see
   `scripts/loadtest-test-chat.js`).
3. Integration suite (`tests/integration/`) green against
   not-yet-FORCED RLS. (Already verified — 106 tests pass at
   tag `phase-b-complete`.)

## Manual verification flow

1. Start the stack:

   ```bash
   ADMIN_EMAILS=lucasmailland@gmail.com pnpm --filter web dev
   ```

   (Optional: `pnpm --filter web worker` if you want cron handlers to
   exercise the `withCrossTenantAdmin` log line.)

2. Sign in via the browser, then exercise the protected routes:
   `/en`, `/en/agents`, `/en/conversations`, `/en/flows`, `/en/employees`,
   `/en/knowledge`, `/en/channels`, `/en/integrations`, `/en/settings`.

3. Check the counters:

   ```bash
   curl --cookie "<session-cookie>" \
     http://localhost:3333/api/admin/tenant-telemetry
   ```

   Expected shape: `{ "set": <int>, "missing": <int>, "ratio": <float> }`.
   The Phase B gate is `ratio < 0.01`.

4. If `missing` grows on protected routes (not just public/auth/`_next`),
   inspect stdout — each miss is logged as JSON with the route reason
   (`no-session`, `no-membership`, `set-config-failed`). Patch the
   offending code path before tagging the gate as cleared.

## Perf baseline check

Re-run the latency probe (`pnpm loadtest:chat`, see
`scripts/loadtest-test-chat.js` for thresholds) and compare medians.
Document any regression > 5% here before promoting.

## Known Phase B trade-offs (documented inline)

- `set_config(..., false)` is connection-scoped. With pgbouncer/pooling
  the GUC can leak between requests. Acceptable here because RLS is NOT
  FORCED yet — Phase C will revisit pooling guarantees.
- `withCrossTenantAdmin` sets the GUC LOCAL to a wrapper transaction,
  but the wrapped handlers (`reapStaleRuns`, `purgeOldData`) still call
  `getDb()` and issue queries on a fresh connection where the LOCAL GUC
  doesn't apply. Logged as `TODO(phase-c)` in
  `apps/web/lib/tenant/cron.ts`.
