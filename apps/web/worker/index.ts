/**
 * Orchester worker process — corre fuera del request loop de Next.js.
 *
 * Procesa la cola pg-boss (Postgres-native, sin Redis) para:
 *   - flow:run         → ejecuta flows async (HTTP triggers ya no bloquean)
 *   - webhook:deliver  → dispara webhooks salientes con retry
 *   - usage:aggregate  → cron diario para consolidar contadores
 *
 * Para encolar desde un request handler:
 *   import { enqueue, JOB_FLOW_RUN } from "@/lib/queue";
 *   await enqueue(JOB_FLOW_RUN, { flowId, workspaceId, triggerSource, input });
 *
 * Ejecutar:
 *   pnpm --filter web worker        (dev, vía tsx)
 *   docker compose up worker        (prod)
 */
/* eslint-disable no-console */

import {
  registerWorker,
  schedule,
  shutdownQueue,
  preCreateAllQueues,
  JOB_FLOW_RUN,
  JOB_FLOW_REAP,
  JOB_WEBHOOK_DELIVER,
  JOB_USAGE_AGGREGATE,
  JOB_RETENTION,
  JOB_AUDIT_VERIFY_ALL,
  JOB_WORKSPACE_HARD_DELETE,
  JOB_GDPR_EXPORT,
  JOB_GDPR_EXPORT_WATCHDOG,
  JOB_BRAIN_EXTRACT,
  JOB_BRAIN_COMPACTION,
  JOB_BRAIN_DECAY,
  JOB_MNEMO_EMBED_FACT,
  JOB_MNEMO_EMBED_BATCH,
  JOB_MNEMO_SUMMARY,
  JOB_MNEMO_HEALTH,
  JOB_MNEMO_DEDUP,
  JOB_MNEMO_PRUNE,
  JOB_MNEMO_REVIEW_SWEEP,
  JOB_MNEMO_AUTO_PIN,
  JOB_MNEMO_CONSOLIDATION,
  JOB_MNEMO_SWEEPER,
  JOB_MNEMO_EPISODE_BACKFILL,
  JOB_MNEMO_ORG_CONSOLIDATION,
} from "../lib/queue";
import { executeFlow, reapStaleRuns } from "../lib/flow-engine";
import { dispatchEvent, type WebhookEvent } from "../lib/webhooks-out";
import { purgeOldData } from "../lib/retention";
import { withCrossTenantAdmin } from "../lib/tenant/cron";
import { runVerifyAllChains } from "../lib/audit/verify-job";
import { runHardDeleteCron } from "../lib/tenant/hard-delete-job";
import { runExportJob } from "../lib/gdpr/export-job";
import { runExportWatchdog } from "../lib/gdpr/watchdog";
import { runBrainExtractJob, type BrainExtractPayload } from "../lib/brain/extract-job";
import { runBrainCompaction } from "../lib/brain/compaction";
import { runBrainDecay } from "../lib/brain/decay";
import { runEmbedFactJob, runEmbedBatchSweep, type EmbedFactPayload } from "./embed-batch-job";
import { summaryJobHandler, type SummaryJobPayload } from "./summary-job";
import { healthJobHandler, type HealthJobPayload } from "./health-job";
import { runDedupSweep } from "./dedup-job";
import { runPruneSweep } from "./prune-job";
import { runReviewSweep } from "./review-sweep-job";
import { runAutoPin } from "./auto-pin-job";
import { runConsolidationSweep } from "./consolidation-job";
import { backfillWorkspaceEpisodes } from "./episode-backfill-job";
import { runOrgConsolidation } from "./org-consolidation-job";
// v2 — episode-backfill cron enumerates active workspaces via a
// service-role tx, so we need both `getDb` (raw connection for the
// listing) and the `sql` tag for the SELECT.
import { getDb } from "@orchester/db";
import { sql } from "drizzle-orm";
import { safeLogError } from "../lib/safe-log";
import { runSweeperBatch, type SweeperPayload } from "./mnemo-sweeper-job";

interface FlowRunJob {
  runId: string;
  flowId: string;
  workspaceId: string;
  triggerSource: string;
  input: Record<string, unknown>;
}

interface WebhookDeliverJob {
  workspaceId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
}

async function main(): Promise<void> {
  console.log("[worker] booting…");

  // ── @mnemosyne/core DI wiring ─────────────────────────────────
  // The library no longer owns its DB connection; every entrypoint
  // must register Orchester's pool via setDb() before any
  // withMnemoTx / searchMnemo / recallUnified call. The Next.js
  // process does this in instrumentation-node.ts; the worker
  // process is a separate Node bundle (worker/.dist/worker.mjs)
  // that never loads that hook, so we must wire here too.
  // Missing this call crashes every mnemo cron + the brain-extract
  // job on first tick with "No DB client registered".
  const { wireMnemoDb } = await import("../lib/mnemo/wire-di");
  if (await wireMnemoDb()) console.log("[worker] @mnemosyne/core DI wiring complete");

  // ── v1.6 G1-1: pre-create every queue row BEFORE any handler ────
  // Without this, the first admin enqueue (e.g. POST
  // /api/mnemo/admin/run-consolidation) races pg-boss's lazy
  // createQueue + send and deadlocks on the `pgboss.queue` row
  // (SQLSTATE 40P01). Idempotent — duplicates are swallowed inside
  // ensureQueue.
  await preCreateAllQueues();
  console.log("[worker] queues pre-created");

  // ── Flow runner ────────────────────────────────────────────
  await registerWorker<FlowRunJob>(
    JOB_FLOW_RUN,
    async (job) => {
      const { runId, flowId, workspaceId, triggerSource, input } = job.data;
      console.log(`[worker] flow:run flow=${flowId} ws=${workspaceId} run=${runId}`);
      // El estado del run (succeeded/failed) es la fuente de verdad y se persiste
      // dentro de executeFlow. No relanzamos: el job se encola con retryLimit 0
      // para no re-disparar side-effects. El reaper cubre crashes.
      const result = await executeFlow({ runId, flowId, workspaceId, triggerSource, input });
      console.log(`[worker] flow:run flow=${flowId} → ${result.status} run=${result.runId}`);
    },
    { teamSize: 4, teamConcurrency: 2 }
  );

  // ── Orphan-run reaper (cron, cada 5 min) ────────────────────
  // Scans flow_run across all workspaces → cross-tenant by design.
  await registerWorker(JOB_FLOW_REAP, async () => {
    const n = await withCrossTenantAdmin("flow-reaper", (tx) => reapStaleRuns(undefined, tx));
    if (n > 0) console.log(`[worker] flow:reap → marcó ${n} run(s) colgados como failed`);
  });
  await schedule(JOB_FLOW_REAP, "*/5 * * * *");

  // ── Webhook dispatch ────────────────────────────────────────
  await registerWorker<WebhookDeliverJob>(
    JOB_WEBHOOK_DELIVER,
    async (job) => {
      const { workspaceId, event, payload } = job.data;
      await dispatchEvent(workspaceId, event, payload);
    },
    { teamSize: 8, teamConcurrency: 4 }
  );

  // ── Usage aggregator (cron) ─────────────────────────────────
  // Designed for cross-workspace rollups → wrap defensively even though
  // it's a no-op today.
  await registerWorker(JOB_USAGE_AGGREGATE, async () => {
    await withCrossTenantAdmin("usage-aggregate", async (_tx) => {
      console.log("[worker] usage:aggregate tick");
      // Hook para futuras consolidaciones diarias (rollup de usage_events,
      // limpieza de runs antiguos, etc.). No-op por ahora — cuando se
      // implemente, usar `_tx` (no getDb()) para que la bypass GUC aplique.
    });
  });
  await schedule(JOB_USAGE_AGGREGATE, "0 3 * * *"); // 03:00 UTC

  // ── Data retention sweeper (cron, diario 03:30 UTC) ─────────
  // G1-1: purga flow_runs/flow_run_steps y webhook_deliveries viejos.
  // Sweeps across all workspaces by date cutoffs → cross-tenant by design.
  await registerWorker(JOB_RETENTION, async () => {
    const n = await withCrossTenantAdmin("data-retention", (tx) => purgeOldData({ db: tx }));
    console.log(
      `[worker] data:retention → runs=${n.runsDeleted} deliveries=${n.deliveriesDeleted} ` +
        `audit=${n.auditLogsDeleted} usage=${n.usageEventsDeleted} ` +
        `messages=${n.messagesDeleted} flowVersions=${n.flowVersionsDeleted}`
    );
  });
  await schedule(JOB_RETENTION, "30 3 * * *"); // 03:30 UTC

  // ── Audit chain verifier (cron, diario 03:00 UTC) ───────────
  // Phase E.4: walks every active workspace's audit_log and emits a
  // critical security_event for any tampered chain. The bypass is
  // applied inside runVerifyAllChains via withCrossTenantAdmin.
  await registerWorker(JOB_AUDIT_VERIFY_ALL, async () => {
    await runVerifyAllChains();
    console.log("[worker] audit:verify_all_chains tick");
  });
  await schedule(JOB_AUDIT_VERIFY_ALL, "0 3 * * *"); // 03:00 UTC

  // ── Workspace hard-deleter (cron, diario 04:00 UTC) ─────────
  // Phase E.5: hard-deletes workspaces whose 30-day soft-delete window
  // has expired. Cascade FKs clean up every dependent row.
  await registerWorker(JOB_WORKSPACE_HARD_DELETE, async () => {
    await runHardDeleteCron();
    console.log("[worker] workspace:hard_delete tick");
  });
  await schedule(JOB_WORKSPACE_HARD_DELETE, "0 4 * * *"); // 04:00 UTC

  // ── GDPR export worker (on-demand) ──────────────────────────
  // Phase E.6: drives gdpr_export_job rows through the pending →
  // exporting → completed state machine. No cron — request-handler
  // enqueues by jobId.
  await registerWorker<{ jobId: string }>(JOB_GDPR_EXPORT, async (job) => {
    await runExportJob(job.data.jobId);
  });

  // ── GDPR export watchdog (cron, cada 15 min) ────────────────
  // Reaps `exporting` rows abandoned by a crashed worker (the row would
  // otherwise stay `exporting` forever — pg-boss retries the job but
  // the state machine doesn't reset). Cross-tenant by design.
  await registerWorker(JOB_GDPR_EXPORT_WATCHDOG, async () => {
    await runExportWatchdog();
  });
  await schedule(JOB_GDPR_EXPORT_WATCHDOG, "*/15 * * * *");

  // ─── Brain Core extraction (sub-spec 2). One handler per pod;
  // pg-boss singletonKey collapses concurrent enqueues for the same
  // conversation. retryLimit=1 set at enqueue site.
  await registerWorker<BrainExtractPayload>(JOB_BRAIN_EXTRACT, async (job) => {
    await runBrainExtractJob(job.data);
  });

  // ─── Brain Core daily compaction (dedup + hard-delete 30d-old
  // forgotten facts). Runs at 03:30 UTC to stagger from GDPR + audit.
  await registerWorker(JOB_BRAIN_COMPACTION, async () => {
    await runBrainCompaction();
  });
  await schedule(JOB_BRAIN_COMPACTION, "30 3 * * *");

  // ─── Brain Core daily decay (exponential relevance decay, half-life
  // 30 days). Runs at 04:00 UTC, single SQL UPDATE across all
  // workspaces (cross-tenant via cron_admin BYPASSRLS).
  await registerWorker(JOB_BRAIN_DECAY, async () => {
    await runBrainDecay();
  });
  await schedule(JOB_BRAIN_DECAY, "0 4 * * *");

  // ─── Mnemosyne async batch embedding (v1.1 cost optimization) ──────
  // `mnemo.embed.fact` is the per-fact eager handler — pg-boss picks
  // these up as they're enqueued by `createFactAsync`. The handler
  // immediately drains pending fact embeddings for the workspace in a
  // single batched API call (BATCH_SIZE=100), so a single enqueue
  // typically embeds many co-pending facts in one shot.
  //
  // `mnemo.embed.batch` is the periodic safety net (every minute):
  // scans for unembedded facts across all workspaces and flushes them
  // in batches. Covers facts whose `createFactAsync` enqueue failed
  // (orphan), or that landed during a worker outage. Recall via FTS
  // continues to work in the interim — no user-visible degradation.
  await registerWorker<EmbedFactPayload>(JOB_MNEMO_EMBED_FACT, async (job) => {
    await runEmbedFactJob(job.data);
  });
  await registerWorker(JOB_MNEMO_EMBED_BATCH, async () => {
    await runEmbedBatchSweep();
  });
  await schedule(JOB_MNEMO_EMBED_BATCH, "*/1 * * * *");

  // ─── Mnemosyne v1.1 Layer 1 summary refresh (daily cron) ──────────
  // Walks every workspace that produced facts in the last 7 days,
  // pre-distills a fresh per-(workspace,agent,user) summary, and
  // caches it in `mnemo_summary` with a 24h TTL. The foreground turn
  // hits the cache instead of paying for an LLM round-trip.
  //
  // Idempotent and degrades gracefully — workspaces without an LLM
  // configured get a heuristic summary written (still saves the
  // foreground turn from doing the heuristic work itself).
  //
  // 05:00 UTC stagger keeps it away from compaction/decay/audit.
  await registerWorker<SummaryJobPayload>(JOB_MNEMO_SUMMARY, async (job) => {
    await summaryJobHandler(job);
  });
  await schedule(JOB_MNEMO_SUMMARY, "0 5 * * *");

  // ─── Mnemosyne v1.2 health snapshot (daily drift detection) ─────────
  // Walks every workspace with at least one fact and computes a
  // `mnemo_health` row — fact counts, embedding coverage, recall
  // hit-rate, contradictions, extraction backlog. Pure SQL aggregates,
  // no LLM calls. Snapshot is the data source for the future Memory
  // Inspector dashboard (v1.3).
  //
  // 06:00 UTC stagger keeps it after summary refresh (05:00) so the
  // snapshot captures the freshest summary state.
  await registerWorker<HealthJobPayload>(JOB_MNEMO_HEALTH, async (job) => {
    await healthJobHandler(job);
  });
  await schedule(JOB_MNEMO_HEALTH, "0 6 * * *");

  // ─── Mnemosyne v1.2 janitor: weekly memory self-maintenance ─────────
  // dedup (Sunday 03:00 UTC): semantic merge of near-duplicate facts.
  //   Walks workspaces with embedded facts, clusters by cosine >= 0.92,
  //   archives duplicates into mnemo_fact_archive with archive_reason
  //   = 'merged'. Folds hit_count + source_message_ids into the primary.
  // prune (Sunday 03:30 UTC): archive inactive low-relevance facts.
  //   Walks workspaces, finds active facts where hit_count = 0,
  //   age > 90 days, relevance < 0.1, NOT pinned. Archives with
  //   archive_reason = 'pruned_inactive'.
  // Both are idempotent — re-runs find nothing to do. Stagger keeps
  // dedup before prune so dedup doesn't accidentally re-archive a row
  // prune has already moved.
  await registerWorker(JOB_MNEMO_DEDUP, async () => {
    await runDedupSweep();
  });
  await schedule(JOB_MNEMO_DEDUP, "0 3 * * 0");

  await registerWorker(JOB_MNEMO_PRUNE, async () => {
    await runPruneSweep();
  });
  await schedule(JOB_MNEMO_PRUNE, "30 3 * * 0");

  // ─── Mnemosyne v1.3 active-learning crons (daily) ──────────────────
  // review.sweep (04:00 UTC): scans for low-confidence (< 0.5)
  // unpinned facts not already in the queue and enqueues them with
  // reason='low_confidence'. Cap 50/workspace/run. Dedup against
  // 'contradiction' rows is handled inside enqueueReview.
  await registerWorker(JOB_MNEMO_REVIEW_SWEEP, async () => {
    await runReviewSweep();
  });
  await schedule(JOB_MNEMO_REVIEW_SWEEP, "0 4 * * *");

  // auto-pin (04:30 UTC): evaluates the pure rule set in
  // `decideAutoPin` and pins matching rows, stamping
  // metadata.auto_pinned = { rule, at }. Skips rows where the user
  // previously unpinned (metadata.auto_pinned_overridden = true).
  // Stagger after review.sweep so the queued low-confidence rows
  // aren't competing with the auto-pin pass.
  await registerWorker(JOB_MNEMO_AUTO_PIN, async () => {
    await runAutoPin();
  });
  await schedule(JOB_MNEMO_AUTO_PIN, "30 4 * * *");

  // ─── Mnemosyne v1.4 REM-style consolidation (weekly cron) ──────────
  // Sunday 02:00 UTC — BEFORE the janitor's dedup pass at 03:00. Walks
  // every workspace with embedded facts, clusters related facts (same
  // subject + kind, cosine >= 0.75, size >= 4), asks the cheap-tier
  // LLM to write a one-sentence summary that supersedes them, and
  // stamps `derived_from` edges from members to the summary. The
  // originals stay `status='active'` (findable); the summary becomes
  // the canonical recall hit. Graceful: workspaces without an LLM
  // configured are skipped silently.
  //
  // Stagger before dedup so dedup doesn't accidentally collapse a
  // freshly-created summary with one of its members.
  await registerWorker(JOB_MNEMO_CONSOLIDATION, async () => {
    await runConsolidationSweep();
  });
  await schedule(JOB_MNEMO_CONSOLIDATION, "0 2 * * 0");

  // ─── Mnemosyne v2 — Cross-workspace (org-level) consolidation ────────
  // Sunday 02:30 UTC — AFTER the per-workspace pass at 02:00 (so each
  // workspace's local clusters have settled) and BEFORE the janitor's
  // dedup at 03:00. Gated by MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION
  // env var; the cron logs "disabled" and returns when the flag isn't
  // literally "true" so the wire is always exercised in production.
  await registerWorker(JOB_MNEMO_ORG_CONSOLIDATION, async () => {
    await runOrgConsolidation();
  });
  await schedule(JOB_MNEMO_ORG_CONSOLIDATION, "30 2 * * 0");

  // ─── Mnemosyne v2 — Episode-id backfill (migrations 0048 + 0051) ────
  // Daily 04:15 UTC — well outside the consolidation/janitor windows.
  // Stamps every mnemo_fact row where episode_id IS NULL with a
  // deterministic synthetic episode id. With the post-K migration
  // 0051 NOT-NULL flip already in place, the live extraction path
  // never produces NULLs anymore — this cron exists for safety net
  // against any edge case (raw INSERTs in tests, manual SQL, etc.)
  // and to clean up legacy rows post-migration on freshly-deployed
  // instances.
  await registerWorker(JOB_MNEMO_EPISODE_BACKFILL, async () => {
    // Pull every active workspace and run the backfill per-workspace.
    // The handler self-throttles via the per-workspace cap so a large
    // tenant doesn't dominate the run.
    const wsRows = (await getDb().execute(
      sql`SELECT id FROM workspace WHERE status = 'active' ORDER BY id`
    )) as unknown as Array<{ id: string }>;
    for (const ws of wsRows) {
      try {
        await backfillWorkspaceEpisodes(ws.id);
      } catch (e) {
        safeLogError(`[episode-backfill] workspace ${ws.id} failed:`, e);
      }
    }
  });
  await schedule(JOB_MNEMO_EPISODE_BACKFILL, "15 4 * * *");

  // ─── Mnemosyne v1.1 #20 — message-grain backfill sweeper ────────────
  // Sunday 01:00 UTC — BEFORE the consolidation pass at 02:00. Walks
  // brain_extraction_job rows whose state='skipped' and skip_reason is
  // a prefilter-class reason (no_indicator, no_content_tokens, …). For
  // each such conversation it re-runs `shouldExtractBackfill()` — a
  // more permissive variant that drops the POSITIVE_INDICATORS gate —
  // and re-enqueues qualifying conversations for a fresh LLM extraction.
  //
  // Cursor-resumable: the handler self-re-enqueues with an updated
  // cursor after each BATCH_SIZE=100 batch so large workspaces are
  // swept incrementally without hitting the job timeout.
  await registerWorker<SweeperPayload>(JOB_MNEMO_SWEEPER, async (job) => {
    const stats = await runSweeperBatch(job.data);
    if (stats.conversationsScanned > 0) {
      console.log(
        `[worker] mnemo.sweeper ` +
          `scanned=${stats.conversationsScanned} ` +
          `reenqueued=${stats.conversationsReenqueued} ` +
          `skipped=${stats.conversationsSkipped} ` +
          `hasMore=${stats.hasMore}`
      );
    }
  });
  // Weekly cron kick-starts the sweep (cursor=null = scan from beginning).
  await schedule(JOB_MNEMO_SWEEPER, "0 1 * * 0", { cursor: null } satisfies SweeperPayload);

  console.log("[worker] ready, waiting for jobs…");
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}, shutting down…`);
  await shutdownQueue();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  console.error("[worker] unhandledRejection:", reason);
});

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
