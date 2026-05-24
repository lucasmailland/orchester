# Worker + Cron Health Pre-flight (pre-Brain-Core)

Audit of `apps/web/worker/`, `apps/web/lib/queue.ts`, and every registered handler before Brain Core sub-spec 2 lands `fact_extraction`, `fact_compaction`, `fact_decay`, `embed_backfill`, `recall_warm` on the same infrastructure. **Read-only.** pg-boss version pinned at **10.4.2** (`pnpm-lock.yaml:5936`).

## Inventory

| Job                       | Trigger                               | Handler file:lines                                             | Retry config                                              | Tenant context                              | Audit / logs                         |
| ------------------------- | ------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------- | ------------------------------------ |
| `flow:run`                | on-demand (enqueueFlowRun)            | `worker/index.ts:60-72` → `lib/flow-engine.ts:352-485`         | `retryLimit: 0` at enqueue (`flow-engine.ts:1216-1223`)   | per-workspace via `withFlowTx`              | reaper covers crashes                |
| `flow:reap`               | cron `*/5 * * * *`                    | `worker/index.ts:76-80` → `flow-engine.ts:1256`                | enqueue defaults (`retryLimit:3`, `expireInSeconds:3600`) | `withCrossTenantAdmin` + tx                 | only logs count when n>0             |
| `webhook:deliver`         | on-demand (dispatchEvent)             | `worker/index.ts:83-90` → `lib/webhooks-out.ts:123-241`        | enqueue defaults; **internal 3-attempt loop already**     | per-workspace tx optional                   | console.error only                   |
| `usage:aggregate`         | cron `0 3 * * *`                      | `worker/index.ts:95-103`                                       | enqueue defaults                                          | `withCrossTenantAdmin`                      | **no-op** today                      |
| `data:retention`          | cron `30 3 * * *`                     | `worker/index.ts:108-115` → `lib/retention.ts:63`              | enqueue defaults                                          | `withCrossTenantAdmin` + tx                 | per-table try/catch swallows         |
| `audit:verify_all_chains` | cron `0 3 * * *`                      | `worker/index.ts:122-126` → `lib/audit/verify-job.ts:34`       | enqueue defaults                                          | `withCrossTenantAdmin` + tx                 | `security_event` row + stderr        |
| `workspace:hard_delete`   | cron `0 4 * * *`                      | `worker/index.ts:131-135` → `lib/tenant/hard-delete-job.ts:19` | enqueue defaults                                          | `withCrossTenantAdmin` + tx + advisory lock | structured log                       |
| `gdpr:export`             | on-demand (`singletonKey: gdpr:<ws>`) | `worker/index.ts:141-143` → `lib/gdpr/export-job.ts:70`        | enqueue defaults; **own state machine**                   | `withCrossTenantAdmin` + tx                 | watchdog reaps stalls                |
| `gdpr:export:watchdog`    | cron `*/15 * * * *`                   | `worker/index.ts:149-152` → `lib/gdpr/watchdog.ts:36`          | enqueue defaults                                          | `withCrossTenantAdmin` + tx                 | per-row try/catch                    |
| `kb:ingest`, `kb:reindex` | **constants only**                    | `queue.ts:154-155`                                             | n/a                                                       | n/a                                         | **never registered, never enqueued** |

## Critical issues

### C1. pg-boss retries cron handlers up to 3× by default — every cron may run 2-4× per tick (CRITICAL)

`enqueue()` defaults to `retryLimit:3` + `retryBackoff:true` (`queue.ts:96`). pg-boss `schedule()` inherits those defaults. If `runHardDeleteCron`, `purgeOldData`, or `runVerifyAllChains` throws partway through, pg-boss will re-run the handler — but the handler is non-idempotent at the _batch_ level: `runHardDeleteCron` cascades workspace deletes (the advisory lock + status re-check at `hard-delete-job.ts:31-69` handles the per-row case, but a retry will re-iterate every still-due row), and `purgeOldData` will re-issue every successful DELETE (idempotent but doubles DB load).
**Fix:** every `schedule()` call must explicitly set `retryLimit:0` (or `retryLimit:1` with an explicit reason). Add this to `queue.ts:schedule()` as default-for-cron.

### C2. `flow:run` swallows the dead-letter signal (CRITICAL)

Enqueued with `retryLimit:0` (`flow-engine.ts:1219`) precisely to avoid re-running side-effects. The handler in `worker/index.ts:60-72` lets `executeFlow` resolve and **never rethrows** — even if `executeFlow` returns `{status:"failed"}`, pg-boss marks the job complete. That's actually intended ("el estado del run es la fuente de verdad"), but it means a worker that crashes _after_ DB commit but _before_ job ack will get the job retried (pg-boss default), and `runId` collision is the only thing protecting state. Today `singletonKey: runId` blocks the duplicate. Once Brain Core pipelines fan out (one `fact_extract` per message in a run), there's no equivalent `runId` and the same crash window will produce ghost duplicate jobs.
**Fix:** document the contract explicitly in `queue.ts`. For Brain Core jobs, every enqueue MUST pass a `singletonKey` derived from the input payload hash.

### C3. No watchdog covers `flow:run`, `webhook:deliver`, `data:retention`, `usage:aggregate`, `audit:verify_all_chains`, `workspace:hard_delete` (CRITICAL)

Only `gdpr:export` has a stalled-state reaper (`watchdog.ts`). For everything else, a worker SIGKILL mid-handler leaves: (a) `flow_runs` rows stuck `running` — caught by `flow:reap` after 15 min (`flow-engine.ts:1256`); (b) `webhook_deliveries` rows stuck `pending` — **no reaper**; (c) hard-delete rows stuck mid-cascade — **no reaper**; (d) retention DELETEs partially applied — re-runs next day. For Brain Core, `fact_extraction` is the high-volume case and needs an equivalent of `flow:reap`.

### C4. `expireInSeconds: 60 * 60` on every job (HIGH→CRITICAL for slow jobs) (CRITICAL)

`queue.ts:97` sets default `expireInSeconds: 3600`. A GDPR export of a multi-GB tenant or a `data:retention` sweep against a year of audit logs can blow past 1h. pg-boss will mark the job expired and pg-boss v10 then re-enqueues per retry policy → handler runs again concurrently with the original. With `gdpr:export`'s in-memory archiver (`export-job.ts:98`), that means two Node processes both allocating the same multi-GB buffer. Combined with C1, this is a memory-OOM trap.
**Fix:** per-job `expireInSeconds` override at registration time. GDPR/retention need >24h. Brain Core compaction needs a generous ceiling too.

## High-priority issues

### H1. `boss.work` array-mode loses jobs on partial failure (HIGH)

`queue.ts:119-131` iterates `for (const j of jobs)` and throws the first error encountered. pg-boss treats the whole BATCH as failed when any item throws — so a single bad payload poisons up to `fetchSize` siblings, each retried per policy, amplifying load. With `teamSize: 8, teamConcurrency: 4` (webhook:deliver), one bad URL can yank 31 healthy deliveries into retry storm.
**Fix:** wrap each item in its own try/catch, collect errors, throw an `AggregateError` only if ALL failed; otherwise log per-item failures and ack the batch.

### H2. Webhook deliver handler has no idempotency key (HIGH)

`webhooks-out.ts:131-138` INSERTs a fresh `webhookDeliveries` row keyed on `createId()` _inside_ the handler. A pg-boss retry re-enters and writes a second delivery row + re-POSTs to the customer. Customer endpoints see duplicate events.
**Fix:** derive `deliveryId` from `(jobId, webhookId, event, payload-hash)` or store `jobId` on the delivery row and `ON CONFLICT DO NOTHING`.

### H3. `runVerifyAllChains` loops without a per-iteration try/catch (HIGH)

`verify-job.ts:34-97` walks every active workspace inside one `withCrossTenantAdmin` transaction. A single broken chain that throws (network blip on the security-alert fetch is wrapped, but `verifyChain()` itself isn't) aborts the entire txn → no chains verified that night, no `security_event` recorded, and pg-boss retries (per C1) re-running the whole walk N times. For a tenant fleet >1000 workspaces this is also a single long-running txn — connection pinned for the entire duration.
**Fix:** per-workspace try/catch + per-workspace `withCrossTenantAdmin` so one bad row doesn't poison the sweep.

### H4. Worker process has no graceful drain timeout discipline (HIGH)

`worker/index.ts:157-161` calls `shutdownQueue` then `process.exit(0)` immediately. `shutdownQueue` uses `boss.stop({graceful:true, timeout:30_000})` (`queue.ts:146`) — fine in isolation, but the SIGTERM handler doesn't propagate the worker-pid PID back to the orchestrator; Kubernetes' default 30s `terminationGracePeriodSeconds` plus the 30s pg-boss timeout means in-flight jobs can be SIGKILL'd at 30s exactly while pg-boss is still trying to flush. Long-running handlers (GDPR export, retention) have **no chance** to drain.
**Fix:** lower `boss.stop` timeout to 25s, and document that the deployment needs `terminationGracePeriodSeconds >= 60`.

### H5. `instrumentation-node.ts` calls `startListener()` at top-level await (HIGH)

`instrumentation-node.ts:36-39` is the _web_ runtime init — not the worker — but the LISTEN connection is opened on every dyno boot. The worker bundle imports `flow-engine` → `cluster-cache` indirectly through tenant resolution; **second LISTEN socket** per worker pod. With `max:1, idle_timeout:0` per process this is OK for one worker, but Brain Core's recall-warming will likely pull `cluster-cache` from yet another module → no double-init guard catches cross-bundle re-entry. The `listenerStarted` flag is per module instance.
**Verify:** confirm the worker bundle does NOT re-import `cluster-cache` (current evidence: `worker/index.ts` imports `withCrossTenantAdmin` from `lib/tenant/cron.ts`, which does NOT pull `cluster-cache`). Brain Core handlers that touch `tenant/resolve` or `tenant/membership` WILL open a listener inside the worker. Decide now whether worker should listen.

## Medium-priority issues

### M1. No metrics/observability on worker queue depth, age, or success rate (MEDIUM)

`recordMetric()` exists (`observability.ts:101`) and is called only from `flow-engine.ts`. There's no `metric: queue.depth`, `queue.lag_seconds`, `job.duration_ms` for any job other than `flow.run.duration_ms`. Ops cannot answer "is the worker keeping up?" without psql against `pgboss.job`.
**Fix:** emit `queue.depth` per registered queue every 60s; emit `job.duration_ms{job}` from inside `registerWorker`.

### M2. `safeLogError` is the only failure signal — no Sentry on handler failures (MEDIUM)

The `boss.on("error", ...)` listener (`queue.ts:41-44`) only logs. Handler exceptions from `registerWorker` are `safeLogError`'d and rethrown (`queue.ts:125-128`) — `captureException()` is **never called** from the worker path. The `unhandledRejection` handler at `worker/index.ts:165-167` only `console.error`s. Compare to `instrumentation-node.ts:54-66` which routes to Sentry.
**Fix:** mirror the `instrumentation-node` crash hooks into `worker/index.ts`.

### M3. Cron schedules collide at 03:00 UTC (MEDIUM)

`usage:aggregate` and `audit:verify_all_chains` both fire at `0 3 * * *` (`worker/index.ts:103, 126`). Today `usage:aggregate` is a no-op so no contention; once it does real work it'll race the verifier for the cross-tenant transaction and DB pool.
**Fix:** stagger crons (e.g. `0 3`, `15 3`, `30 3`, `45 3`, `0 4`). Pre-Brain-Core, allocate the next 5 cron slots now.

### M4. `data:retention` masks DELETE failures per-table (MEDIUM)

`retention.ts:104-197` wraps each DELETE in try/`safeLogError`. The PurgeResult is returned with 0 for the failed table, then `worker/index.ts:111-114` logs the _successful_ counts. A persistently failing audit-log delete is invisible unless someone greps logs for "purge audit_logs failed".
**Fix:** add a `failures: string[]` field to `PurgeResult`, alert if non-empty.

### M5. `JOB_KB_INGEST` / `JOB_KB_REINDEX` constants exist but are dead code (MEDIUM)

`queue.ts:154-155` defines them; no `registerWorker`, no `enqueue`. Either remove them or land the handlers. Dead constants are a "ghost API" risk — a future caller will enqueue and the message will sit unprocessed forever (pg-boss creates the queue lazily via `createQueue` on enqueue → the job sits until `expireInSeconds:3600` archives it).
**Fix:** add a startup assertion that every `JOB_*` constant has a `boss.work` registration.

### M6. `pg-boss` typed as `any` (MEDIUM)

`queue.ts:24` opts out of type safety with a comment about lazy-load. Real types ship in `pg-boss` package. Without them, `boss.work` signature drift between v10.x.x versions will go undetected.

### M7. Cron timezone OK; daylight savings n/a (LOW)

`schedule()` pins `tz: "UTC"` (`queue.ts:140`). Clean. No drift.

## Brain Core implications

For each upcoming job, infrastructure gaps below MUST be addressed before launch:

| Job               | Volume profile                    | Patterns required                                                                                              | Today's gap                             |
| ----------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `fact_extraction` | 1 per message (high)              | Per-workspace tx; idempotent on `messageId`; `retryLimit:2` with backoff; singletonKey=`facts:<messageId>`     | C3 watchdog missing; H1 batch poisoning |
| `fact_compaction` | 1 per workspace per day (cron)    | `withCrossTenantAdmin` per workspace (NOT one giant txn — see H3); `retryLimit:0`; advisory lock per workspace | H3 pattern needs to be the default      |
| `fact_decay`      | cron daily                        | same as compaction; per-workspace iteration with own watchdog                                                  | C1 cron-retry blast radius              |
| `embed_backfill`  | bulk (1×/workspace, long-running) | `expireInSeconds: 6h`; chunked checkpoints in DB; resumable                                                    | C4 1h expiry will trip                  |
| `recall_warm`     | on-demand per conversation        | low latency; `singletonKey:<convId>`; `retryLimit:1`; cheap fallback when stale                                | M1 no observability                     |

**Recommended watchdog timeouts:** `fact_extraction` 5 min, `fact_compaction` 30 min/workspace, `fact_decay` 30 min/workspace, `embed_backfill` 6h with checkpoint, `recall_warm` 30s.

## Recommended pre-Brain-Core hardening

Order matters — each unlocks the next.

1. **C1 + C4** — Add `cronRetryLimit:0`, `cronExpireInSeconds` defaults in `queue.ts`; require explicit override per call.
2. **H1** — Fix `registerWorker` per-item error handling (no more batch poison).
3. **H3 pattern** — Extract `forEachWorkspace(reason, fn)` helper that does per-workspace `withCrossTenantAdmin` + try/catch. Refactor `runVerifyAllChains`, `runHardDeleteCron`, `runExportWatchdog` onto it. Reuse for every Brain Core cron.
4. **C3** — Generalise the `gdpr/watchdog.ts` pattern into `lib/queue/watchdog.ts` taking `(table, stateColumn, stuckValue, staleAfterMs)`. Register watchdogs for `webhook_deliveries:pending`, `flow_runs:running` (already covered by reaper but unify), every Brain Core state table.
5. **M2** — Wire `captureException` into `registerWorker` catch path and into the worker's `unhandledRejection` handler.
6. **M1** — Emit `queue.depth{queue}` and `job.duration_ms{queue,status}` from `registerWorker`. Required to alert on Brain Core ramp.
7. **H2** — Make `webhook:deliver` idempotent via job-id-keyed delivery rows.
8. **M3** — Re-stagger cron slots; reserve slots for the 4 new Brain Core crons.
9. **M5** — Add startup assertion: every `JOB_*` const has a worker. Drop or implement `kb:ingest` / `kb:reindex`.
10. **H4** — Tune `boss.stop` timeout + document deployment `terminationGracePeriodSeconds`.
11. **H5** — Decide whether worker process opens `cluster-cache` listener; guard explicitly either way.

Once 1-6 are in, Brain Core jobs can be added safely. 7-11 are non-blocking but cheap and prevent future incidents.
