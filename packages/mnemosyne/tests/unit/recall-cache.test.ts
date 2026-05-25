import { describe, it, expect, beforeEach } from "vitest";
import {
  recallCache,
  invalidateRecallCacheForWorkspace,
  recallCacheKey,
} from "../../src/recall/cache";

beforeEach(() => {
  recallCache.clear();
});

describe("recall/cache (A7 L1)", () => {
  it("stores and retrieves a recall result", () => {
    const key = recallCacheKey({
      workspaceId: "ws1",
      queryHash: "abc",
      scope: null,
      scopeRef: null,
      topK: 5,
    });
    recallCache.set(key, [{ id: "x" }] as never);
    expect(recallCache.get(key)).toEqual([{ id: "x" }]);
  });

  it("invalidates entries for a workspace", () => {
    const k1 = recallCacheKey({
      workspaceId: "ws1",
      queryHash: "a",
      scope: null,
      scopeRef: null,
      topK: 5,
    });
    const k2 = recallCacheKey({
      workspaceId: "ws2",
      queryHash: "a",
      scope: null,
      scopeRef: null,
      topK: 5,
    });
    recallCache.set(k1, [{ id: "1" }] as never);
    recallCache.set(k2, [{ id: "2" }] as never);
    invalidateRecallCacheForWorkspace("ws1");
    expect(recallCache.get(k1)).toBeUndefined();
    expect(recallCache.get(k2)).toEqual([{ id: "2" }]);
  });
});
