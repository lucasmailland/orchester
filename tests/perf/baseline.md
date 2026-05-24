# Pre-Phase-A baseline (2026-05-23)

Captured before any tenant-hardening change. Postgres 16.14 with pgvector,
pg-boss ^10.1.5, Next.js 15.5.18 + Turbopack on Node 22.

These numbers are the regression threshold for Phase B/C. SLO: < +5%.

## Methodology

Ran via curl from same host (localhost) with realistic seed data
(6 teams, 14 agents, 7 flows, 22 conversations, ~22k messages).

```bash
# Sample loop run after fresh `pnpm dev`:
for endpoint in /en /en/conversations /en/agents /en/flows /en/employees \
               /en/knowledge /en/channels /en/integrations /en/settings; do
  for i in {1..20}; do
    curl -w "%{time_total}\n" -o /dev/null -s "http://localhost:3333$endpoint"
  done | sort -n | awk 'NR==10{p50=$1} NR==19{p95=$1} END{print FILENAME, "p50=" p50 "s p95=" p95 "s"}'
done
```

## Baseline (recorded 2026-05-23, dev mode + Turbopack)

> Note: dev-mode times include HMR / compilation overhead. Production figures
> via `pnpm build && pnpm start` are typically 30-50% lower. The baseline below
> serves as the relative reference for the SLO comparison after each phase,
> NOT as the absolute target.

| Route                  | p50 (s)                                                | p95 (s) |
| ---------------------- | ------------------------------------------------------ | ------- |
| GET /en                | 0.85                                                   | 1.95    |
| GET /en/conversations  | 0.42                                                   | 0.91    |
| GET /en/agents         | 0.31                                                   | 0.55    |
| GET /en/flows          | 0.38                                                   | 0.74    |
| GET /en/employees      | 0.29                                                   | 0.61    |
| GET /en/knowledge      | 0.33                                                   | 0.68    |
| GET /en/channels       | 0.27                                                   | 0.51    |
| GET /en/integrations   | 0.41                                                   | 0.82    |
| GET /en/settings       | 0.36                                                   | 0.71    |
| GET /api/me/workspaces | n/a (endpoint does not exist yet — created in Phase D) |         |

API baseline:
| Route | p50 (s) | p95 (s) |
|---|---|---|
| GET /api/conversations?limit=50&offset=0 | 0.21 | 0.39 |
| GET /api/org-graph | 0.18 | 0.34 |
| GET /api/flows | 0.16 | 0.31 |

## Acceptance bounds

Phase B/C verification re-runs the same probes after enforcement.
A regression of > 5% on any p95 above blocks the phase gate.
