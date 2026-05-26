// apps/web/tests/unit/brain/consolidation-job.spec.ts
//
// Contract test for the v1.4 REM-style consolidation worker. The full
// LLM-mocked cluster + summarise flow lives in
// `packages/mnemosyne/tests/integration/consolidation-cluster.spec.ts`;
// this spec catches the structural drift that always hurts most: the
// queue-name constant + the worker entry point.
//
//   1. `JOB_MNEMO_CONSOLIDATION` is exported from `@/lib/queue` (so
//      mnemosyne callers can enqueue) and lines up with the worker
//      registration in `worker/index.ts`.
//
//   2. `runConsolidationSweep` is exported from
//      `worker/consolidation-job.ts` so the cron driver can invoke it
//      directly (and tests can too, against a seeded workspace).

import { describe, it, expect } from "vitest";

describe("mnemo.consolidation queue contract", () => {
  it("JOB_MNEMO_CONSOLIDATION is exported with the expected name", async () => {
    const { JOB_MNEMO_CONSOLIDATION } = await import("@/lib/queue");
    expect(JOB_MNEMO_CONSOLIDATION).toBe("mnemo.consolidation");
  });

  it("runConsolidationSweep is exported from the worker module", async () => {
    const mod = await import("@/worker/consolidation-job");
    expect(typeof mod.runConsolidationSweep).toBe("function");
  });
});
