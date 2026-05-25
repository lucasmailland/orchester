// packages/mnemosyne/tests/integration/circuit-breaker.spec.ts
//
// Integration test for the v1.1 circuit-breaker reframing of Mode A.
//
// Two things are exercised against a real postgres container:
//
//  (1) `resolveActiveMode` ↔ `recordProviderResult`: after N failures the
//      tracker reports the configured-C workspace as DOWN, and a single
//      success restores it. Pure-code, but we mount it next to (2) so
//      the suite documents the round-trip.
//
//  (2) The `mnemo_extraction_job` table has the new
//      `'deferred_provider_outage'` state value + `defer_until` column
//      after migration 0027 has been applied. We INSERT a row with the
//      new state and assert it round-trips (migration verification).
//
// We deliberately do NOT import apps/web's extract-job.ts here — that
// file's behaviour is covered by apps/web's own integration suite and
// would couple this package to the Next.js app. The contract this test
// guards is: the SHAPE of mnemo_extraction_job + the health resolver
// produce the right signals for any worker to defer correctly.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { createId } from "@paralleldrive/cuid2";
import { sql, eq } from "drizzle-orm";
import { schema, type DbClient } from "@orchester/db";

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

import {
  recordProviderResult,
  getProviderHealth,
  resetProviderHealth,
} from "../../src/modes/health";
import { resolveActiveMode, resolveConfiguredMode } from "../../src/modes/detect";
// Belt-and-braces: also import via the public barrel and assert the
// barrel and direct-import paths return the same result. A future
// refactor that drops the export from index.ts would fail this test.
import {
  resolveActiveMode as resolveActiveModeBarrel,
  resolveConfiguredMode as resolveConfiguredModeBarrel,
} from "../../src/index";

let wsA: WsFixture;
let db: DbClient;
let convId: string;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  // Create a conversation row so we can FK against it from the
  // extraction-job insert below.
  const { getDb } = await import("@orchester/db");
  db = getDb();
  convId = createId();
  await db.insert(schema.conversations).values({
    id: convId,
    workspaceId: wsA.id,
    summary: "circuit-breaker test conv",
    agentId: wsA.agentIds[0]!,
  });
});

afterAll(() => teardownTestWorkspaces());

beforeEach(() => {
  resetProviderHealth();
});

describe("circuit breaker — provider health → active mode", () => {
  it("configured=C with healthy chat + embedding stays C", async () => {
    const configured = resolveConfiguredMode({ hasLLM: true, hasEmbed: true });
    const health = getProviderHealth(wsA.id);
    const r = await resolveActiveMode({ workspaceId: wsA.id, configured, health });
    expect(r.active).toBe("C");
    expect(r.degraded).toBe(false);
  });

  it("configured=C with chat DOWN drops to B-degraded with reason", async () => {
    // Drive chat unhealthy.
    for (let i = 0; i < 3; i++) recordProviderResult(wsA.id, "chat", false);
    const configured = resolveConfiguredMode({ hasLLM: true, hasEmbed: true });
    const health = getProviderHealth(wsA.id);
    const r = await resolveActiveMode({ workspaceId: wsA.id, configured, health });
    expect(r.active).toBe("B");
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe("chat_unavailable");
    expect(r.partial).toEqual({ extraction: false, semantic_search: true });
  });

  it("configured=C with chat + embedding DOWN collapses to A-degraded", async () => {
    for (let i = 0; i < 3; i++) recordProviderResult(wsA.id, "chat", false);
    for (let i = 0; i < 3; i++) recordProviderResult(wsA.id, "embedding", false);
    const configured = resolveConfiguredMode({ hasLLM: true, hasEmbed: true });
    const health = getProviderHealth(wsA.id);
    const r = await resolveActiveMode({ workspaceId: wsA.id, configured, health });
    expect(r.active).toBe("A");
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe("all_providers_unavailable");
  });

  it("a single recovery sample restores active mode to C", async () => {
    for (let i = 0; i < 3; i++) recordProviderResult(wsA.id, "chat", false);
    let r = await resolveActiveMode({
      workspaceId: wsA.id,
      configured: "C",
      health: getProviderHealth(wsA.id),
    });
    expect(r.active).toBe("B");

    recordProviderResult(wsA.id, "chat", true);
    r = await resolveActiveMode({
      workspaceId: wsA.id,
      configured: "C",
      health: getProviderHealth(wsA.id),
    });
    expect(r.active).toBe("C");
    expect(r.degraded).toBe(false);
  });

  it("direct-import resolveActiveMode matches barrel re-export shape", async () => {
    // The apps/web side imports via the package barrel. If we drop
    // the named export we want the test to catch it. Compare both
    // paths return the same result for the same inputs.
    const a = await resolveActiveMode({
      workspaceId: wsA.id,
      configured: "C",
      health: { chat: true, embedding: true, rerank: true },
    });
    const b = await resolveActiveModeBarrel({
      workspaceId: wsA.id,
      configured: resolveConfiguredModeBarrel({ hasLLM: true, hasEmbed: true }),
      health: { chat: true, embedding: true, rerank: true },
    });
    expect(a).toEqual(b);
  });
});

describe("circuit breaker — mnemo_extraction_job migration 0027", () => {
  it("accepts the new 'deferred_provider_outage' state + persists defer_until", async () => {
    const jobId = `mext_${createId()}`;
    const deferUntil = new Date(Date.now() + 5 * 60_000);
    // Test runs as superuser (BYPASSRLS) so we don't need
    // set_config('app.workspace_id', ...) — production code paths use
    // withMnemoTx (covered in tx.spec.ts). What we want to verify here
    // is that the CHECK constraint + column shape from migration 0027
    // accept the new state value and persist defer_until.
    await db.insert(schema.mnemoExtractionJobs).values({
      id: jobId,
      workspaceId: wsA.id,
      conversationId: convId,
      state: "deferred_provider_outage",
      skipReason: "chat_unavailable",
      messageCount: 5,
      deferUntil,
    });

    const rows = await db
      .select({
        state: schema.mnemoExtractionJobs.state,
        skipReason: schema.mnemoExtractionJobs.skipReason,
        deferUntil: schema.mnemoExtractionJobs.deferUntil,
      })
      .from(schema.mnemoExtractionJobs)
      .where(eq(schema.mnemoExtractionJobs.id, jobId));

    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.state).toBe("deferred_provider_outage");
    expect(r.skipReason).toBe("chat_unavailable");
    // Round-trip the timestamp — postgres TZ handling can shift millis.
    expect(r.deferUntil).not.toBeNull();
    expect(Math.abs(r.deferUntil!.getTime() - deferUntil.getTime())).toBeLessThan(1000);
  });

  it("partial index idx_mnemo_extraction_defer_until exists and is partial on the new state", async () => {
    const rows = await db.execute(
      sql`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'mnemo_extraction_job'
          AND indexname = 'idx_mnemo_extraction_defer_until'
      `
    );
    // postgres-js returns rows in an iterable; cast to any[] for the shape we need.
    const arr = rows as unknown as Array<{ indexname: string; indexdef: string }>;
    expect(arr.length).toBe(1);
    expect(arr[0]!.indexdef).toContain("deferred_provider_outage");
  });
});
