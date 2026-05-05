# Performance Playbook

> Why specific things are fast (or weren't), and what to do when adding new code.

## Baseline (May 2026)

Verified with Chrome DevTools performance trace on `/es` (dashboard):

| Metric | Baseline (with bug) | Now |
|---|---|---|
| LCP | 2481 ms | **388 ms** |
| TTFB | 2263 ms | **163 ms** |
| CLS | 0.04 | **0.01** |

API endpoints (warm):
- `/api/health`: 13 ms
- `/api/org-graph`: **24 ms** (was 50-300 ms)
- `/api/flows`: 14 ms
- `/api/agents`: 20 ms

## Rules

### 1. NEVER use `next dev --turbopack`
Next.js 15 turbopack adds **~250 ms per-request overhead** in dev.
Default `dev` script in `apps/web/package.json` uses webpack on purpose.

### 2. Index every `workspace_id` FK
We added 28 indices on hot FK columns. New tables MUST follow the same
pattern. See [`database.md`](./database.md).

To add: include in the schema file, then `pnpm --filter @orchester/db push`.

### 3. Cache heavy aggregates
Anything that:
- Fans out to ≥ 10 queries
- Joins 3+ tables
- Computes time-series

…goes through `unstable_cache` from `next/cache`:

```ts
import { unstable_cache } from "next/cache";

const getCachedDashboard = (workspaceId: string) =>
  unstable_cache(
    async () => getFullDashboardStats(workspaceId),
    ["dashboard", workspaceId],
    { revalidate: 30, tags: [`dashboard:${workspaceId}`] }
  )();
```

Invalidate after a meaningful mutation:
```ts
import { revalidateTag } from "next/cache";
revalidateTag(`dashboard:${wsId}`);
```

### 4. Per-request dedup with React `cache()`
`getCurrentSession` and `getCurrentWorkspace` are wrapped in React's `cache()`.
If 5 server components in a single request call them, it's still ONE
auth lookup + ONE workspace lookup. Don't bypass them.

### 5. Client polling: ≥ 10 s
Anything that polls a backend endpoint should use ≥ 10 s intervals.
The OrgCanvas polls every 15 s; FlowRunsPanel only fetches on open.

### 6. Optimize package imports
`next.config.ts` has `optimizePackageImports` for HeroUI, lucide, recharts,
framer-motion, xyflow, sonner, cmdk, etc. **Do not add a new heavy package
without adding it here too.**

### 7. Drizzle: prepared statements ON
`packages/db/src/client.ts` uses `prepare: true`. Was a `false` bug that
caused 3-10x slowdowns. Don't change.

### 8. DB client cached on globalThis
`getDb()` stashes the client on `globalThis.__orchesterDb` to survive
HMR in dev. Don't create a new pool per request.

## Measuring

```bash
# After making changes, measure warm:
curl -s -o /dev/null -w "%{time_total}\n" http://localhost:3333/api/<endpoint>

# Or full Chrome DevTools trace:
# 1. Open Chrome → Performance → Reload
# 2. LCP and TTFB show in the summary
```

## Adding new heavy queries
If your new endpoint:
- Filters by `workspace_id` → already indexed.
- Filters by another FK → check `database.md` for an index, add if missing.
- Joins 3+ tables → consider a materialized view.
- Aggregates over `messages.created_at` → must hit `idx_message_created_at`.

## Common pitfalls
- ❌ Not wrapping `getCurrentWorkspace` in `cache()` — duplicates queries.
- ❌ Forgetting to add an index when introducing a filter column.
- ❌ Using `EXPLAIN` to verify and seeing `Seq Scan` → fix immediately.
- ❌ Adding a heavy npm dep without checking `optimizePackageImports`.
