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
