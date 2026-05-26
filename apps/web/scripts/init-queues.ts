/**
 * v1.6 G1-1: Manual escape hatch for pg-boss queue pre-creation.
 *
 * The worker boot calls `preCreateAllQueues()` automatically; this
 * script exists for operators to call it OUT-OF-BAND — e.g. after a
 * pg-boss schema migration when the worker process is paused, or
 * when running the web app without a long-lived worker (single-pod
 * dev mode where enqueues happen before the worker is up).
 *
 * Usage:
 *   pnpm --filter @orchester/web queue:init
 *
 * Safe to re-run: `ensureQueue` swallows duplicates.
 */
/* eslint-disable no-console */

import { preCreateAllQueues, shutdownQueue, ALL_QUEUES } from "../lib/queue";

async function main(): Promise<void> {
  console.log(`[init-queues] pre-creating ${ALL_QUEUES.length} queues…`);
  await preCreateAllQueues();
  console.log(`[init-queues] done`);
  await shutdownQueue();
}

main().catch((e) => {
  console.error("[init-queues] fatal:", e);
  process.exit(1);
});
