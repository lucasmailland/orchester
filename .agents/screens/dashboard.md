# Dashboard (Command Center)

**Route:** `/[locale]` (e.g. `/es`)
**File(s):**
- `apps/web/app/[locale]/(shell)/page.tsx` (server)
- `apps/web/components/dashboard/DashboardClient.tsx` (client)
- `apps/web/components/dashboard/{KpiCard,ConversationChart}.tsx`
- `apps/web/lib/db-queries.ts → getFullDashboardStats()`

**Owner:** observability / home
**Status:** stable

## Purpose
First screen after login. Shows the workspace's operational pulse: active
agents, conversations, tokens, cost, top agents, channels.

## Planning (initial design)

### Goals
- Single screen that answers: "is my AI workforce working?"
- Density without clutter — KPI cards on top, charts below.
- Always reflect last-month vs current comparisons.

### User flows
1. User logs in → lands here.
2. Glances at KPIs (8 cards) and 30-day activity chart.
3. Optionally drills into Top Agents / Channel distribution.
4. Clicks LIVE to refresh.

### Data
**22 parallel queries** computed by `getFullDashboardStats(workspaceId)`:
- Active / total agents
- Conversations today / yesterday / month / last month
- Tokens this month / last month + 30-day timeseries
- Conversations 30-day timeseries
- Top 12 agents by tokens
- Channel distribution (30d)
- Status distribution (30d)
- Top 8 employees (30d)
- Team stats (30d)
- Hourly activity
- Recent conversations
- Average duration
- Open + escalated counts

### Components
- Server: `DashboardPage` calls `getCachedDashboard(workspaceId)`.
- Client: `DashboardClient` renders KPI cards + recharts charts.

### Decisions & trade-offs
- All 22 queries fired in parallel (`Promise.all`) instead of sequential. Fan-out
  is fine because we hit indexed columns; the slowest dominates.
- Stats are read-only / approximated; no transactions needed.

## Execution (changelog — newest first)

### 2026-05-05 — perf: cached + indexed
- Wrapped `getFullDashboardStats` in `unstable_cache` with `revalidate: 30`,
  per-workspace cache key.
- Added 28 indices on hot FK columns (`workspace_id`, `agent_id`, etc.).
- Result: TTFB **2263 ms → 163 ms** (14x), full page **4-5 s → 252 ms warm**.
- Trade-off: dashboard data is up to 30 s stale. Acceptable for ops view.

### 2026-04-25 — initial implementation
- 22-query payload, KpiCard + ConversationChart + recharts integrations.
- Mock data when workspace has no events.

## Performance notes
- All queries scoped by `workspace_id` and indexed.
- Cached for 30 s via `unstable_cache`. Tag: `dashboard:<wsId>`.
- To force-bust the cache after a major mutation:
  `import { revalidateTag } from "next/cache"; revalidateTag(\`dashboard:\${wsId}\`);`
- Recharts is heavy in dev; in prod it's tree-shaken via `optimizePackageImports`.

## Open issues / TODO
- Add filters by date range (today / 7d / 30d / 90d).
- Replace mock data on empty state with helpful onboarding CTAs.
