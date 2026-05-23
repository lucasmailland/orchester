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
} from "../lib/queue";
import { executeFlow, reapStaleRuns } from "../lib/flow-engine";
import { dispatchEvent, type WebhookEvent } from "../lib/webhooks-out";
import { purgeOldData } from "../lib/retention";

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
  await registerWorker(JOB_FLOW_REAP, async () => {
    const n = await reapStaleRuns();
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
  await registerWorker(JOB_USAGE_AGGREGATE, async () => {
    console.log("[worker] usage:aggregate tick");
    // Hook para futuras consolidaciones diarias (rollup de usage_events,
    // limpieza de runs antiguos, etc.). No-op por ahora.
  });
  await schedule(JOB_USAGE_AGGREGATE, "0 3 * * *"); // 03:00 UTC

  // ── Data retention sweeper (cron, diario 03:30 UTC) ─────────
  // G1-1: purga flow_runs/flow_run_steps y webhook_deliveries viejos.
  await registerWorker(JOB_RETENTION, async () => {
    const n = await purgeOldData();
    console.log(
      `[worker] data:retention → runs=${n.runsDeleted} deliveries=${n.deliveriesDeleted} ` +
        `audit=${n.auditLogsDeleted} usage=${n.usageEventsDeleted} ` +
        `messages=${n.messagesDeleted} flowVersions=${n.flowVersionsDeleted}`
    );
  });
  await schedule(JOB_RETENTION, "30 3 * * *"); // 03:30 UTC

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
