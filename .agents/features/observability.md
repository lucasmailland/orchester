# Observability

**Files:**
- `apps/web/lib/observability.ts` — Sentry envelope sender
- `apps/web/lib/audit.ts` — audit log helper
- `apps/web/lib/rate-limit.ts` — in-memory token bucket
- `apps/web/app/api/audit-logs/route.ts` — read endpoint
- `apps/web/app/api/health/route.ts` — health check
- Schema: `audit_log` (in `production.ts`)

**Owner:** production / SRE
**Status:** Sentry + audit + rate limit functional; product analytics not yet wired

## Purpose
Three pillars of observability for production:
1. **Errors** → Sentry (envelope POST, no SDK).
2. **Audit trail** → DB rows for compliance.
3. **Abuse protection** → rate limit on hot endpoints.

## Planning (initial design)

### Sentry sender
- `captureException(err, ctx?)` — POSTs to Sentry's envelope endpoint
  directly. No `@sentry/nextjs` to keep cold-start fast.
- DSN in `SENTRY_DSN` env var. If unset, falls back to `console.error`.
- Stack frames parsed best-effort.

### Audit log
- `logAudit({ workspaceId, userId, action, resource, resourceId, before?, after?, ip?, userAgent? })`.
- Fire-and-forget: errors swallowed.
- Read via `GET /api/audit-logs` (workspace-scoped, last 500).

### Rate limit
- `rateLimit(key, { capacity, refillPerSec })` → `{ ok: true } | { ok: false, retryAfterMs }`.
- In-memory token bucket on `globalThis.__orchesterRateBuckets`.
- Auto-cleanup every 5 min, drops idle buckets > 10 min.
- Single-node only.

### Health check
- `GET /api/health` → `{ db: "ok"|"fail", dbLatencyMs, uptime }` — Vercel
  / Railway probes.

### Decisions & trade-offs
- **No SDK for Sentry** — saves ~150 KB cold start. Trade-off: features
  missed (transactions, sourcemaps upload). Phase 8+ may switch.
- **In-memory rate limit** is fine for single-node. Multi-node needs Redis.
- **Audit is async/best-effort** — losing an audit row on crash is acceptable
  given the workload; for SOC2 we'd switch to a transactional log.

## Execution (changelog — newest first)

### 2026-04-28 — Phase 6
- Sentry envelope sender (no SDK).
- Audit log table + helper + read endpoint.
- Rate limit util.
- Health check endpoint.

## Performance notes
- `captureException` is fire-and-forget; never blocks.
- `logAudit` is fire-and-forget; never blocks.
- Health check is 1 indexed query.

## Open issues / TODO
- Wire `captureException` into:
  - All `/api/*` route handlers (top-level try/catch).
  - `lib/flow-engine.ts` failure paths.
  - `lib/channels/router.ts` LLM failures.
- Audit log UI in Settings → Audit (data exists).
- Move rate limit to Upstash for multi-node.
- Product analytics: PostHog event tracking.
- Metrics endpoint: `/api/metrics` Prometheus format.
