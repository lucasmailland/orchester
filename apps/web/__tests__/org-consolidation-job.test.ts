// apps/web/__tests__/org-consolidation-job.test.ts
//
// v2 — Cross-workspace consolidation cron scaffold. Validates the
// kill-switch contract: the job is OFF by default and ONLY runs when
// the explicit `MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION=true` env
// var is set. This guards against an accidental flip in deploy
// config from running cross-workspace data paths before migration
// 0050 + legal/security signoff are in place.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Pin the observability layer so we can assert log emissions without
// hitting Sentry or stdout noise in test output.
vi.mock("@/lib/observability", () => ({
  logWithContext: vi.fn(),
  // Required exports — empty stubs are fine.
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
    expect(result).toEqual({
      status: "disabled",
      orgsProcessed: 0,
      reason: "kill_switch_off",
    });
  });

  it("returns disabled when the env var is anything other than the literal 'true'", async () => {
    const { runOrgConsolidation } = await import("../worker/org-consolidation-job");
    for (const truthyAdjacent of ["1", "yes", "TRUE", "on", "enabled"]) {
      process.env[ENV_KEY] = truthyAdjacent;
      const result = await runOrgConsolidation();
      expect(result.status).toBe("disabled");
      expect(result.reason).toBe("kill_switch_off");
    }
  });

  it("falls through to the placeholder body when env var is the literal 'true'", async () => {
    process.env[ENV_KEY] = "true";
    const { runOrgConsolidation } = await import("../worker/org-consolidation-job");
    const result = await runOrgConsolidation();
    // Today the placeholder body returns ran/0/pending-migration. When
    // migration 0050 lands, the implementation will fill the body and
    // this assertion gets updated to expect orgsProcessed > 0 in the
    // happy path.
    expect(result.status).toBe("ran");
    expect(result.orgsProcessed).toBe(0);
    expect(result.reason).toBe("scaffold_only_pending_migration_0050");
  });
});
