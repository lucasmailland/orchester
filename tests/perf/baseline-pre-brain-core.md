# Pre-Brain-Core Performance Baseline

Captured: 2026-05-24, branch: `sub-spec-1/tenant-hardening`, tag base `tenant-hardening-v1.2` +27 commits (HEAD `490a8d8`, v1.3 work-in-flight).
DB: PostgreSQL 16.14 + pgvector, dev container `localhost:5432/orchester`. Node 22.

Captured to detect regressions after Brain Core (sub-spec 2) lands. Read-only snapshot — no install / no dev server.

## DB topology

| Metric                                  | Value |
| --------------------------------------- | ----- |
| Tables (`public`)                       | 43    |
| Indexes (`public`)                      | 68    |
| RLS policies (`public`)                 | 143   |
| Tables with `relforcerowsecurity` (all) | 24    |
| pgvector / ANN indexes                  | 0     |
| DB size                                 | 12 MB |

Top tables by physical size (live tuples in parens):

| Table                 | Size   | Live tuples |
| --------------------- | ------ | ----------- |
| message               | 520 kB | 64          |
| conversation          | 88 kB  | 22          |
| flow                  | 72 kB  | 7           |
| agent                 | 24 kB  | 14          |
| webhook_delivery      | 8192 b | 1           |
| flow_run              | 8192 b | 0           |
| api_key               | 8192 b | 2           |
| knowledge_base        | 8192 b | 4           |
| session               | 8192 b | 4           |
| verification          | 8192 b | 1           |
| user                  | 8192 b | 2           |
| workspace_member      | 8192 b | 2           |
| team                  | 8192 b | 6           |
| channel               | 8192 b | 5           |
| employee              | 8192 b | 16          |
| account               | 8192 b | 2           |
| audit_log_legacy      | 8192 b | 12          |
| workspace             | 8192 b | 2           |
| audit_log             | 8192 b | 12          |
| workspace_integration | 8192 b | 1           |
| knowledge_doc         | 8192 b | 9           |
| outbound_webhook      | 8192 b | 2           |
| flow_run_step         | 8192 b | 0           |
| flow_version          | 0      | 0           |
| flow_template         | 0      | 0           |
| conversation_label    | 0      | 0           |
| flow_schedule         | 0      | 0           |
| flow_webhook          | 0      | 0           |
| agent_memory          | 0      | 0           |
| agent_eval            | 0      | 0           |

All non-message tables are still on-disk minimum (1 page). Dev seed is light — growth post-Brain-Core should be measured per workspace, not in absolute terms here.

## Schema complexity

| Metric                                                      | Value      |
| ----------------------------------------------------------- | ---------- |
| `pg_dump --schema-only \| wc -l`                            | 5053 lines |
| User-defined functions in `public` (extension deps removed) | 4          |
| pgvector indexes (ivfflat / hnsw / `USING vector%`)         | 0          |

Brain Core will land the first vector indexes (semantic recall) — track index count + size on these specifically.

## Test suite

`cd apps/web && pnpm exec vitest run`

| Metric                     | Value                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| Wall time                  | 17.0 s (vitest reports 14.76 s internal, 38.20 user, 312% CPU = parallel) |
| Test files                 | 35 collected (22 passed, 11 failed, 2 skipped)                            |
| Tests                      | 204 (147 passed, 0 failed assertions, 57 pending/skipped)                 |
| Typecheck (`tsc --noEmit`) | 10.1 s wall (12.6 user)                                                   |

Suite failures are infra-level (test setup races against tenant invariants — `cluster-cache.spec.ts`, `lifecycle.spec.ts`, `agent-handoff.test.ts` `vi.mock` hoist), not assertion failures. Pre-existing condition, not introduced by this baseline.

Slowest individual tests (none over 1 s — fast suite):

| ms  | File                                             |
| --- | ------------------------------------------------ |
| 177 | `__tests__/encryption.test.ts`                   |
| 160 | `tests/integration/tenant/cluster-cache.spec.ts` |
| 88  | `__tests__/presentation-mode.test.tsx`           |
| 58  | `tests/unit/rbac-system-admin.spec.ts`           |
| 50  | `tests/unit/cost-alerts-fail-closed.spec.ts`     |
| 45  | `tests/unit/cookies.spec.ts`                     |
| 33  | `lib/flows/spreadsheet.test.ts`                  |
| 13  | `tests/unit/audit/chain.spec.ts`                 |
| 13  | `lib/flows/validate.test.ts`                     |
| 12  | `lib/ai/catalog/catalog.test.ts`                 |

## Bundle / dep state

| Metric                                               | Value         |
| ---------------------------------------------------- | ------------- |
| `apps/web/.next` (stale build artifact, if relevant) | 201 MB        |
| `apps/web` direct dependencies                       | 36            |
| `node_modules/.pnpm` total entries                   | (full mirror) |

Top 10 largest packages in `node_modules/.pnpm/` (KB on disk):

| Size (KB) | Package                             |
| --------- | ----------------------------------- |
| 155 940   | next@15.5.18 (\_react-19.2.5)       |
| 155 768   | next@15.5.15 (\_react-19.2.5)       |
| 127 260   | @next/swc-darwin-arm64@15.5.15      |
| 127 064   | @next/swc-darwin-arm64@15.5.18      |
| 38 288    | @adobe/react-spectrum@3.47.0        |
| 37 076    | lucide-react@0.469.0                |
| 36 856    | pdfjs-dist@5.4.296                  |
| 35 172    | react-aria@3.48.0                   |
| 28 016    | @turbo/darwin-arm64@2.9.6           |
| 23 896    | @napi-rs/canvas-darwin-arm64@0.1.80 |

Two parallel `next` versions present (15.5.15 + 15.5.18) — about 280 MB redundant. Cleanup is separate work, but worth flagging: bundle-size targets for Brain Core should compare against a single Next install.

## Migration trail

| Metric                               | Value |
| ------------------------------------ | ----- |
| `packages/db/migrations/*.sql` files | 34    |
| Total SQL lines                      | 979   |

Brain Core sub-spec 2 will add migrations for fact storage, embeddings, retention. Tracking both file count and SQL LOC.

## Codebase size

| Path                           | LOC    |
| ------------------------------ | ------ |
| `apps/web/lib/**/*.ts`         | 17 542 |
| `apps/web/app/api/**/*.ts`     | 8 278  |
| `apps/web/components/**/*.tsx` | 19 086 |

## Repo history

| Metric                                | Value                 |
| ------------------------------------- | --------------------- |
| Total commits on `HEAD`               | 312                   |
| Commits since `tenant-hardening-v1`   | 50                    |
| Commits since `tenant-hardening-v1.2` | 27 (v1.3 in progress) |

## Targets for Brain Core regression detection

- **Test suite wall time** should grow **< 30%** vs 17.0 s → cap ≈ 22.1 s.
- **Typecheck time** should grow **< 50%** vs 10.1 s → cap ≈ 15.2 s.
- **DB size** growth tracked **per workspace** as facts accumulate (current absolute 12 MB on near-empty seed is not a useful global cap).
- **Bundle size** should grow **< 100 KB gzipped** for new brain modules (measure via Next build analyzer once enabled, not from `.next` directory total).
- **Recall latency p95 SLO** defined in Brain Core design doc — measure post-launch with `tests/perf/recall-bench.ts` once it exists.
- **Vector index count** baseline 0 → expect 1–3 after Brain Core (per tenant fact / embedding table).
- **RLS policy count** baseline 143 → new tables must keep `policies / table` ratio ≥ current `143 / 24 forced ≈ 6`.
- **Migration LOC** baseline 979 → Brain Core delta should land in a clear DDL bundle; > 500 LOC added warrants review.

Anything outside these bounds in the post-Brain-Core measurement re-run is a regression to investigate before tagging `brain-core-v1`.
