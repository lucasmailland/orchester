// apps/web/tests/integration/tenant/cluster-cache.spec.ts
//
// Drives the cluster-cache LISTEN/NOTIFY pipeline against a real
// postgres (testcontainer). Verifies:
//   1. invalidateCache() on resolve.ts triggers a NOTIFY observable by
//      a second listener (simulating a second pod).
//   2. Multiple listeners on the same channel all receive the same
//      payload.
//   3. The dispatched handler is called with the parsed payload.
//
// We deliberately do NOT mock cluster-cache: the whole point is to
// verify the real LISTEN/NOTIFY plumbing.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

// vitest.setup.ts stubs @orchester/db; integration tests need the real
// module so the listener can also issue notifications via app code.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { setupTestDb, teardownTestDb, getTestDbUrl } from "../../fixtures/db";

let clusterCache: typeof import("@/lib/tenant/cluster-cache");
let resolve: typeof import("@/lib/tenant/resolve");
let membership: typeof import("@/lib/tenant/membership");
let flagCache: typeof import("@/lib/feature-flags/cache");

beforeAll(async () => {
  await setupTestDb();
  // Import after DATABASE_URL is set by setupTestDb so startListener()
  // actually opens a connection.
  clusterCache = await import("@/lib/tenant/cluster-cache");
  resolve = await import("@/lib/tenant/resolve");
  membership = await import("@/lib/tenant/membership");
  flagCache = await import("@/lib/feature-flags/cache");
  // Force-boot listener (resolve.ts already called it at import time,
  // but re-call is a no-op and documents intent).
  clusterCache.startListener();
});

afterAll(async () => {
  await clusterCache.stopListener();
  await teardownTestDb();
});

/**
 * Wait until `pred()` returns true OR the timeout elapses. We poll
 * rather than rely on a promise the handler resolves because the
 * handler is fire-and-forget by design.
 */
async function waitFor(pred: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!pred()) {
    throw new Error(`waitFor timed out after ${timeoutMs}ms`);
  }
}

describe("cluster cache invalidation", () => {
  it("broadcasts a NOTIFY when invalidateCache is called", async () => {
    const received: import("@/lib/tenant/cluster-cache").Invalidation[] = [];
    const unsub = clusterCache.onInvalidation((msg) => received.push(msg));
    try {
      resolve.invalidateCache("ws_test_123");
      await waitFor(() => received.some((m) => m.kind === "workspace" && m.key === "ws_test_123"));
      expect(received.find((m) => m.kind === "workspace" && m.key === "ws_test_123")).toBeDefined();
    } finally {
      unsub();
    }
  });

  it("two listeners both receive the same invalidation", async () => {
    // Stand up a *second*, fully independent listener client to the
    // same DB — simulates a second pod.
    const url = getTestDbUrl();
    expect(url).toBeTruthy();
    const otherSql = postgres(url!, { max: 1, idle_timeout: 0, connect_timeout: 10 });

    const fromPodB: string[] = [];
    const listenReady = otherSql.listen("tenant_cache_invalidation", (payload) => {
      try {
        const parsed = JSON.parse(payload) as { kind: string; key?: string };
        if (parsed.kind === "workspace" && parsed.key) fromPodB.push(parsed.key);
      } catch {
        /* ignore */
      }
    });
    await listenReady;

    const fromPodA: string[] = [];
    const unsub = clusterCache.onInvalidation((msg) => {
      if (msg.kind === "workspace") fromPodA.push(msg.key);
    });

    try {
      resolve.invalidateCache("ws_test_two_pods");
      await waitFor(
        () => fromPodA.includes("ws_test_two_pods") && fromPodB.includes("ws_test_two_pods")
      );
      expect(fromPodA).toContain("ws_test_two_pods");
      expect(fromPodB).toContain("ws_test_two_pods");
    } finally {
      unsub();
      await otherSql.end({ timeout: 5 });
    }
  });

  it("dispatches membership invalidations to subscribed handlers", async () => {
    const received: Array<{ userId: string; workspaceId: string }> = [];
    const unsub = clusterCache.onInvalidation((msg) => {
      if (msg.kind === "membership") {
        received.push({ userId: msg.userId, workspaceId: msg.workspaceId });
      }
    });
    try {
      membership.invalidateMembership("user_abc", "ws_def");
      await waitFor(() =>
        received.some((m) => m.userId === "user_abc" && m.workspaceId === "ws_def")
      );
      expect(received).toContainEqual({ userId: "user_abc", workspaceId: "ws_def" });
    } finally {
      unsub();
    }
  });

  it("dispatches feature-flag invalidations to subscribed handlers", async () => {
    const received: Array<{ workspaceId: string; flagKey: string }> = [];
    const unsub = clusterCache.onInvalidation((msg) => {
      if (msg.kind === "feature-flag") {
        received.push({ workspaceId: msg.workspaceId, flagKey: msg.flagKey });
      }
    });
    try {
      flagCache.invalidateFlag("ws_xyz", "new_dashboard");
      await waitFor(() =>
        received.some((m) => m.workspaceId === "ws_xyz" && m.flagKey === "new_dashboard")
      );
      expect(received).toContainEqual({ workspaceId: "ws_xyz", flagKey: "new_dashboard" });
    } finally {
      unsub();
    }
  });

  it("ignores invalid payloads without crashing the listener", async () => {
    const url = getTestDbUrl();
    expect(url).toBeTruthy();
    // Issue a malformed NOTIFY directly. The listener catches the JSON
    // parse error in safeLogError; subsequent valid broadcasts should
    // still be delivered.
    const probe = postgres(url!, { max: 1 });
    await probe.notify("tenant_cache_invalidation", "{not-json");
    await probe.end({ timeout: 5 });

    const received: string[] = [];
    const unsub = clusterCache.onInvalidation((msg) => {
      if (msg.kind === "workspace") received.push(msg.key);
    });
    try {
      resolve.invalidateCache("ws_after_bad_payload");
      await waitFor(() => received.includes("ws_after_bad_payload"));
      expect(received).toContain("ws_after_bad_payload");
    } finally {
      unsub();
    }
  });
});
