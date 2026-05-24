// apps/web/tests/integration/gdpr/watchdog.spec.ts
//
// Integration test for the stalled-export reaper. The watchdog scans
// for `exporting` rows whose `startedAt` is older than the threshold
// (30 min) and flips them to `failed` with the deterministic sentinel
// `worker_crashed_or_stalled`.
//
// We seed rows by hand (no need to actually crash a worker — the row
// state is the only thing the watchdog inspects) and verify:
//   - stuck row → state=failed + error=sentinel + retryCount incremented
//   - fresh row → untouched (predicate excludes it)
//   - non-`exporting` row (e.g. `completed`) → untouched
//
// Same db fixture as the other GDPR integration suites; storage backend
// isn't touched (the watchdog never reads artefacts).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createId } from "@paralleldrive/cuid2";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let runExportWatchdog: typeof import("@/lib/gdpr/watchdog").runExportWatchdog;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();

  ({ runExportWatchdog } = await import("@/lib/gdpr/watchdog"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));
});

afterAll(async () => {
  await teardownTestWorkspaces();
});

async function insertJob(opts: {
  state: "pending" | "exporting" | "completed" | "failed";
  startedAt: Date | null;
  retryCount?: number;
}): Promise<string> {
  const db = getDb();
  const id = `exp_${createId()}`;
  await db.insert(schema.gdprExportJobs).values({
    id,
    workspaceId: wsA.id,
    requestedByUserId: wsA.ownerId,
    state: opts.state,
    progress: opts.state === "exporting" ? 50 : 0,
    startedAt: opts.startedAt,
    retryCount: opts.retryCount ?? 0,
  });
  return id;
}

async function getJob(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gdprExportJobs)
    .where(eq(schema.gdprExportJobs.id, id));
  return rows[0];
}

describe("runExportWatchdog", () => {
  it("flips a stuck `exporting` row to `failed` with the sentinel error", async () => {
    // 31 min ago — past the 30-min threshold.
    const stale = new Date(Date.now() - 31 * 60 * 1000);
    const stuckId = await insertJob({ state: "exporting", startedAt: stale, retryCount: 0 });

    await runExportWatchdog();

    const job = await getJob(stuckId);
    expect(job?.state).toBe("failed");
    expect(job?.error).toBe("worker_crashed_or_stalled");
    expect(job?.retryCount).toBe(1);
  });

  it("leaves a fresh `exporting` row alone (within threshold)", async () => {
    // 5 min ago — well inside the 30-min window.
    const fresh = new Date(Date.now() - 5 * 60 * 1000);
    const freshId = await insertJob({ state: "exporting", startedAt: fresh });

    await runExportWatchdog();

    const job = await getJob(freshId);
    expect(job?.state).toBe("exporting");
    expect(job?.error).toBeNull();
  });

  it("ignores rows in non-`exporting` states even if startedAt is old", async () => {
    // Old `completed` job — shouldn't be touched; the watchdog only
    // cares about rows whose state machine never advanced.
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    const completedId = await insertJob({ state: "completed", startedAt: stale });

    await runExportWatchdog();

    const job = await getJob(completedId);
    expect(job?.state).toBe("completed");
  });
});
