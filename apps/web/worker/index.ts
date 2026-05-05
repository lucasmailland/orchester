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
  JOB_WEBHOOK_DELIVER,
  JOB_USAGE_AGGREGATE,
} from "../lib/queue";
import { executeFlow } from "../lib/flow-engine";
import { dispatchEvent, type WebhookEvent } from "../lib/webhooks-out";

interface FlowRunJob {
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
      const { flowId, workspaceId, triggerSource, input } = job.data;
      console.log(`[worker] flow:run flow=${flowId} ws=${workspaceId}`);
      const result = await executeFlow({ flowId, workspaceId, triggerSource, input });
      console.log(`[worker] flow:run flow=${flowId} → ${result.status} run=${result.runId}`);
      if (result.status === "failed") {
        // Lanza para que pg-boss aplique retry exponencial.
        throw new Error(result.error ?? "flow failed");
      }
    },
    { teamSize: 4, teamConcurrency: 2 }
  );

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
