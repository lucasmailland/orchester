// v1.1 #25 — adaptive recall budget per tenant fact count.
//
// Unit tests cover the two pure surfaces:
//   - `tieredCap(requested, factCount)`: tier boundaries (0, 999, 1000,
//     9999, 10000, 99999, 100000) and the +Infinity escape hatch.
//   - `getCachedFactCount(workspaceId, tx)`: cache hit / miss / expiry /
//     error-swallow behaviour, with `tx.execute` mocked.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  factCountCache,
  getCachedFactCount,
  invalidateFactCountForWorkspace,
} from "../../src/recall/cache";
import { tieredCap } from "../../src/recall/search";

beforeEach(() => {
  factCountCache.clear();
});

describe("recall/search — tieredCap (#25)", () => {
  it("caps at 8 for tiny workspaces (< 1k facts)", () => {
    // Boundary: 0, mid, and one-below-1000 all stay in tier 1.
    expect(tieredCap(20, 0)).toBe(8);
    expect(tieredCap(20, 500)).toBe(8);
    expect(tieredCap(20, 999)).toBe(8);
    // Honors a smaller requested cap — tiered cap never inflates.
    expect(tieredCap(5, 999)).toBe(5);
    expect(tieredCap(3, 0)).toBe(3);
  });

  it("caps at 12 for small workspaces (1k–10k facts)", () => {
    expect(tieredCap(20, 1_000)).toBe(12);
    expect(tieredCap(20, 5_000)).toBe(12);
    expect(tieredCap(20, 9_999)).toBe(12);
    // Smaller requests still win.
    expect(tieredCap(10, 5_000)).toBe(10);
  });

  it("caps at 18 for medium workspaces (10k–100k facts)", () => {
    expect(tieredCap(20, 10_000)).toBe(18);
    expect(tieredCap(20, 50_000)).toBe(18);
    expect(tieredCap(20, 99_999)).toBe(18);
    expect(tieredCap(15, 50_000)).toBe(15);
  });

  it("caps at 20 for huge workspaces (>= 100k facts)", () => {
    expect(tieredCap(20, 100_000)).toBe(20);
    expect(tieredCap(20, 1_000_000)).toBe(20);
    expect(tieredCap(25, 100_000)).toBe(20);
  });

  it("uses the static-cap branch when fact count is +Infinity (count failed)", () => {
    // Documented escape hatch: getCachedFactCount returns +Infinity on
    // SQL failure so a transient outage never silently downgrades a
    // large tenant to the small-tenant cap.
    expect(tieredCap(20, Number.POSITIVE_INFINITY)).toBe(20);
    expect(tieredCap(7, Number.POSITIVE_INFINITY)).toBe(7);
  });
});

describe("recall/cache — getCachedFactCount (#25)", () => {
  it("runs the SQL on cache miss and caches the result", async () => {
    const execute = vi.fn().mockResolvedValue([{ n: 42 }]);
    const tx = { execute } as unknown as Parameters<typeof getCachedFactCount>[1];

    const first = await getCachedFactCount("ws_alpha", tx);
    expect(first).toBe(42);
    expect(execute).toHaveBeenCalledTimes(1);

    // Second call within TTL — must NOT run the SQL again.
    const second = await getCachedFactCount("ws_alpha", tx);
    expect(second).toBe(42);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("isolates cached counts per workspace", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ n: 7 }])
      .mockResolvedValueOnce([{ n: 13 }]);
    const tx = { execute } as unknown as Parameters<typeof getCachedFactCount>[1];

    expect(await getCachedFactCount("ws_a", tx)).toBe(7);
    expect(await getCachedFactCount("ws_b", tx)).toBe(13);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("re-fetches after the cached entry expires", async () => {
    // Force-expire the cached entry by setting a negative TTL on the
    // entry itself (lru-cache v11 supports per-`set` TTL overrides).
    // Same code path as a real 5-min eviction — lru-cache treats a
    // zero or negative TTL as already expired on the next get.
    factCountCache.set("ws_stale", { count: 100 }, { ttl: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const execute = vi.fn().mockResolvedValue([{ n: 200 }]);
    const tx = { execute } as unknown as Parameters<typeof getCachedFactCount>[1];

    const fresh = await getCachedFactCount("ws_stale", tx);
    expect(fresh).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("treats an empty result set as 0", async () => {
    // Defensive: drizzle returns [] when the row materialiser is wrong;
    // we coalesce to 0 so a misshapen response doesn't crash recall.
    const execute = vi.fn().mockResolvedValue([]);
    const tx = { execute } as unknown as Parameters<typeof getCachedFactCount>[1];

    expect(await getCachedFactCount("ws_empty", tx)).toBe(0);
  });

  it("returns +Infinity (NOT cached) on SQL failure so transient errors self-heal", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("rls misconfigured"))
      .mockResolvedValueOnce([{ n: 11 }]);
    const tx = { execute } as unknown as Parameters<typeof getCachedFactCount>[1];

    const failed = await getCachedFactCount("ws_flaky", tx);
    expect(failed).toBe(Number.POSITIVE_INFINITY);
    // Failure was NOT cached — next call retries the SQL and succeeds.
    const recovered = await getCachedFactCount("ws_flaky", tx);
    expect(recovered).toBe(11);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("invalidateFactCountForWorkspace drops the cached entry", async () => {
    factCountCache.set("ws_invalidate", { count: 99 });
    invalidateFactCountForWorkspace("ws_invalidate");
    const execute = vi.fn().mockResolvedValue([{ n: 1 }]);
    const tx = { execute } as unknown as Parameters<typeof getCachedFactCount>[1];

    expect(await getCachedFactCount("ws_invalidate", tx)).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
