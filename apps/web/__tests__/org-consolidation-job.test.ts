// apps/web/__tests__/org-consolidation-job.test.ts
//
// v2 — Cross-workspace consolidation cron. Pins the KILL-SWITCH
// contract: the job NEVER runs the cross-workspace data path when
// `MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION` is not literally
// "true". This is the only line of defense between an accidental
// deploy-config flip and cross-org data leakage; it must be
// regression-proof.
//
// The "enabled" path is not unit-tested here because it requires
// a real DB (migrations 0049 + 0050 applied, org rows, fact rows).
// Integration coverage lives in apps/web/tests/integration when
// the testcontainer fixture for the cron lands.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/observability", () => ({
  logWithContext: vi.fn(),
  captureException: vi.fn(),
  recordMetric: vi.fn(),
  newCorrelationId: vi.fn(() => "test"),
  __resetSentryCacheForTests: vi.fn(),
}));

const ENV_KEY = "MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION";

describe("runOrgConsolidation — kill switch", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  it("returns disabled when the env var is unset (default)", async () => {
    const { runOrgConsolidation } = await import("../worker/org-consolidation-job");
    const result = await runOrgConsolidation();
    expect(result.status).toBe("disabled");
    expect(result.reason).toBe("kill_switch_off");
    expect(result.orgsScanned).toBe(0);
    expect(result.orgsProcessed).toBe(0);
    expect(result.clustersFound).toBe(0);
    expect(result.rowsInserted).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns disabled when the env var is anything other than the literal 'true'", async () => {
    const { runOrgConsolidation } = await import("../worker/org-consolidation-job");
    for (const truthyAdjacent of ["1", "yes", "TRUE", "on", "enabled"]) {
      process.env[ENV_KEY] = truthyAdjacent;
      const result = await runOrgConsolidation();
      expect(result.status).toBe("disabled");
      expect(result.reason).toBe("kill_switch_off");
      // None of the data-path counters should ever be touched.
      expect(result.orgsScanned).toBe(0);
      expect(result.orgsProcessed).toBe(0);
      expect(result.rowsInserted).toBe(0);
    }
  });
});
