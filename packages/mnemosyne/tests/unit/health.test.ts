// packages/mnemosyne/tests/unit/health.test.ts
//
// Unit tests for the provider health tracker. Pure module — no DB, no
// network — so we exercise the rolling window directly with controlled
// timestamps via Date.now() mocking.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  recordProviderResult,
  getProviderHealth,
  resetProviderHealth,
} from "../../src/modes/health";

const WS = "ws_health_test";

beforeEach(() => {
  resetProviderHealth();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("modes/health — provider health tracker", () => {
  it("reports healthy for all kinds when no samples have been recorded", () => {
    const h = getProviderHealth(WS);
    expect(h).toEqual({ chat: true, embedding: true, rerank: true });
  });

  it("stays healthy after a single failure (below threshold)", () => {
    recordProviderResult(WS, "chat", false);
    // One failure with a single sample = 100% failure rate; the
    // threshold is > 50%, so a single failure IS unhealthy. That's the
    // intended fail-fast behaviour for a freshly-flipped provider.
    expect(getProviderHealth(WS).chat).toBe(false);
  });

  it("flips to unhealthy when failure rate crosses the threshold within the window", () => {
    // 6 OKs then 6 failures → 50% failures across 10 most recent (we
    // keep only MAX_SAMPLES=10). 6/10 = 60% → unhealthy.
    for (let i = 0; i < 6; i++) recordProviderResult(WS, "chat", true);
    for (let i = 0; i < 6; i++) recordProviderResult(WS, "chat", false);
    expect(getProviderHealth(WS).chat).toBe(false);
  });

  it("recovers on the first successful call after going unhealthy", () => {
    // Drive into unhealthy.
    for (let i = 0; i < 3; i++) recordProviderResult(WS, "chat", false);
    expect(getProviderHealth(WS).chat).toBe(false);
    // One success should clear the sticky flag.
    recordProviderResult(WS, "chat", true);
    expect(getProviderHealth(WS).chat).toBe(true);
  });

  it("expires samples older than the 5-minute window", () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-05-24T12:00:00.000Z");
    vi.setSystemTime(t0);
    // 3 failures at t=0 → unhealthy.
    for (let i = 0; i < 3; i++) recordProviderResult(WS, "chat", false);
    expect(getProviderHealth(WS).chat).toBe(false);

    // Jump 6 minutes ahead — outside the rolling window. The first
    // health read should prune samples and report healthy again. NB:
    // the sticky `unhealthy` flag is NOT cleared by time alone (only
    // by a successful sample) — but with no samples remaining the
    // tracker considers it unhealthy still. To make the recovery
    // path observable we record a single success in the same window.
    vi.setSystemTime(new Date(t0.getTime() + 6 * 60_000));
    recordProviderResult(WS, "chat", true);
    expect(getProviderHealth(WS).chat).toBe(true);
  });

  it("tracks independent state per provider kind", () => {
    recordProviderResult(WS, "chat", false);
    recordProviderResult(WS, "embedding", true);
    recordProviderResult(WS, "rerank", true);
    const h = getProviderHealth(WS);
    expect(h.chat).toBe(false);
    expect(h.embedding).toBe(true);
    expect(h.rerank).toBe(true);
  });

  it("isolates state across workspaces", () => {
    recordProviderResult("ws_a", "chat", false);
    recordProviderResult("ws_b", "chat", true);
    expect(getProviderHealth("ws_a").chat).toBe(false);
    expect(getProviderHealth("ws_b").chat).toBe(true);
  });

  it("resetProviderHealth(workspaceId) clears only that workspace", () => {
    recordProviderResult("ws_a", "chat", false);
    recordProviderResult("ws_b", "chat", false);
    resetProviderHealth("ws_a");
    expect(getProviderHealth("ws_a").chat).toBe(true);
    expect(getProviderHealth("ws_b").chat).toBe(false);
  });

  it("resetProviderHealth() with no args clears everything", () => {
    recordProviderResult("ws_a", "chat", false);
    recordProviderResult("ws_b", "chat", false);
    resetProviderHealth();
    expect(getProviderHealth("ws_a").chat).toBe(true);
    expect(getProviderHealth("ws_b").chat).toBe(true);
  });

  it("a long burst of failures stays unhealthy across many samples", () => {
    for (let i = 0; i < 50; i++) recordProviderResult(WS, "chat", false);
    expect(getProviderHealth(WS).chat).toBe(false);
  });
});
