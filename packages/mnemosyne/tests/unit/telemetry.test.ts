// packages/mnemosyne/tests/unit/telemetry.test.ts
//
// Unit tests for recall telemetry helpers — exercise the timing wrapper
// + emit helper without spinning up a real search pipeline. Pipeline-
// integration coverage lives in the broader search.test suite.

import { describe, it, expect, vi } from "vitest";
import {
  emitMetric,
  withTiming,
  type OnRecallMetricFn,
  type RecallMetricEvent,
} from "../../src/recall/telemetry";

// ── emitMetric ────────────────────────────────────────────────────────────────

describe("emitMetric", () => {
  it("forwards the event verbatim to the sink", () => {
    const events: RecallMetricEvent[] = [];
    const sink: OnRecallMetricFn = (e) => void events.push(e);

    emitMetric(sink, {
      stage: "prune",
      workspaceId: "ws-1",
      count: 4,
      topScore: 0.87,
      extra: { dropped: 2, threshold: 0.88 },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stage: "prune",
      workspaceId: "ws-1",
      count: 4,
      topScore: 0.87,
    });
  });

  it("is a no-op when sink is undefined (no throw, no side effects)", () => {
    expect(() =>
      emitMetric(undefined, {
        stage: "total",
        workspaceId: "ws-1",
        durationMs: 12,
      })
    ).not.toThrow();
  });

  it("swallows sink exceptions — never breaks the caller path", () => {
    const sink = vi.fn(() => {
      throw new Error("metric-backend exploded");
    });
    expect(() => emitMetric(sink, { stage: "first_stage", workspaceId: "ws-1" })).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(1);
  });
});

// ── withTiming ────────────────────────────────────────────────────────────────

describe("withTiming", () => {
  it("returns the awaited result unchanged", async () => {
    const events: RecallMetricEvent[] = [];
    const sink: OnRecallMetricFn = (e) => void events.push(e);

    const result = await withTiming(sink, "first_stage", "ws-1", async () => "payload");

    expect(result).toBe("payload");
  });

  it("emits a single event with stage, workspaceId, and durationMs", async () => {
    const events: RecallMetricEvent[] = [];
    const sink: OnRecallMetricFn = (e) => void events.push(e);

    await withTiming(sink, "rerank", "ws-7", async () => {
      // tiny non-zero work so durationMs is measurable
      await new Promise((r) => setTimeout(r, 1));
      return [1, 2, 3];
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.stage).toBe("rerank");
    expect(events[0]?.workspaceId).toBe("ws-7");
    expect(events[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("merges attrs() output into the emitted event", async () => {
    const events: RecallMetricEvent[] = [];
    const sink: OnRecallMetricFn = (e) => void events.push(e);

    await withTiming(
      sink,
      "first_stage",
      "ws-1",
      async () => [{ score: 0.9 }, { score: 0.4 }],
      (hits) => ({ count: hits.length, topScore: hits[0]?.score, extra: { mode: "fts" } })
    );

    expect(events[0]).toMatchObject({
      stage: "first_stage",
      count: 2,
      topScore: 0.9,
      extra: { mode: "fts" },
    });
  });

  it("skips timing overhead entirely when sink is undefined", async () => {
    // We can't directly assert "no overhead" but we can assert no event
    // is materialized and the wrapped fn still runs.
    const inner = vi.fn(async () => "ok");
    const result = await withTiming(undefined, "total", "ws-1", inner);
    expect(result).toBe("ok");
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("preserves the original rejection when the wrapped fn throws", async () => {
    const events: RecallMetricEvent[] = [];
    const sink: OnRecallMetricFn = (e) => void events.push(e);

    await expect(
      withTiming(sink, "graph_expand", "ws-1", async () => {
        throw new Error("query failed");
      })
    ).rejects.toThrow("query failed");

    // No event emitted on rejection — only successful completions are
    // measured. This is intentional: a failed stage shouldn't pollute
    // the latency histogram with the failure path.
    expect(events).toHaveLength(0);
  });

  it("swallows a sink that throws during attrs()", async () => {
    const sink = vi.fn(() => {
      throw new Error("sink broke");
    });

    const result = await withTiming(sink, "total", "ws-1", async () => 42);
    expect(result).toBe(42);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
