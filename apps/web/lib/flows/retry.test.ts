import { describe, it, expect, vi } from "vitest";
import { parseRetryConfig, backoffDelay, runWithRetry, StepFailure, type RetryDeps } from "./retry";

const noSleep = { sleep: vi.fn(async () => {}), random: () => 1 };

describe("parseRetryConfig", () => {
  it("returns null when absent or malformed", () => {
    expect(parseRetryConfig(undefined)).toBeNull();
    expect(parseRetryConfig("x")).toBeNull();
  });
  it("clamps attempts to 1..5 and fills defaults", () => {
    expect(parseRetryConfig({ attempts: 9 })).toEqual({
      attempts: 5,
      backoffMs: 1000,
      maxBackoffMs: 30000,
    });
    expect(parseRetryConfig({ attempts: 0, backoffMs: 10, maxBackoffMs: 20 })).toEqual({
      attempts: 1,
      backoffMs: 10,
      maxBackoffMs: 20,
    });
  });
  it("accepts the JSON text the editor's json field stores", () => {
    expect(parseRetryConfig('{ "attempts": 3 }')).toEqual({
      attempts: 3,
      backoffMs: 1000,
      maxBackoffMs: 30000,
    });
    expect(parseRetryConfig("")).toBeNull();
    expect(parseRetryConfig("[1]")).toBeNull();
  });
});

describe("backoffDelay", () => {
  const cfg = { attempts: 5, backoffMs: 1000, maxBackoffMs: 3000 };
  it("doubles and caps, with jitter between 50% and 100%", () => {
    expect(backoffDelay(cfg, 1, () => 1)).toBe(1000);
    expect(backoffDelay(cfg, 2, () => 1)).toBe(2000);
    expect(backoffDelay(cfg, 3, () => 1)).toBe(3000);
    expect(backoffDelay(cfg, 3, () => 0)).toBe(1500);
  });
});

describe("runWithRetry", () => {
  const cfg = { attempts: 3, backoffMs: 100, maxBackoffMs: 1000 };
  it("stops at the first done outcome", async () => {
    const fn = vi.fn(async () => ({ kind: "done" as const, value: 7 }));
    const r = await runWithRetry(cfg, fn, noSleep);
    expect(r).toMatchObject({ ok: true, value: 7 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.attempts).toEqual([{ attempt: 1, ok: true }]);
  });
  it("retries until the budget runs out and records every attempt", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => ({
      kind: "retry" as const,
      error: new Error("boom"),
      status: 503,
    }));
    const r = await runWithRetry(cfg, fn, { sleep, random: () => 1 });
    expect(r.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
    expect(r.attempts).toEqual([
      { attempt: 1, ok: false, status: 503, error: "boom", delayMs: 100 },
      { attempt: 2, ok: false, status: 503, error: "boom", delayMs: 200 },
      { attempt: 3, ok: false, status: 503, error: "boom" },
    ]);
  });
  it("succeeds on a later attempt", async () => {
    let n = 0;
    const r = await runWithRetry(
      cfg,
      async () =>
        ++n < 2 ? { kind: "retry", error: new Error("x") } : { kind: "done", value: "ok" },
      noSleep
    );
    expect(r).toMatchObject({ ok: true, value: "ok" });
    expect(r.attempts).toHaveLength(2);
  });
});

describe("StepFailure", () => {
  it("carries the step output", () => {
    const e = new StepFailure("failed", { attempts: [] });
    expect(e).toBeInstanceOf(Error);
    expect(e.output).toEqual({ attempts: [] });
  });
});

describe("retry cancellation", () => {
  it("aborts during backoff without waiting or making another attempt", async () => {
    const controller = new AbortController();
    let startedSleep!: () => void;
    const sleeping = new Promise<void>((resolve) => {
      startedSleep = resolve;
    });
    const deps: Partial<RetryDeps> & { signal: AbortSignal } = {
      signal: controller.signal,
      sleep: () => {
        startedSleep();
        return new Promise<void>(() => {});
      },
    };
    const attempt = vi.fn(async () => ({ kind: "retry" as const, error: new Error("down") }));
    const result = runWithRetry({ attempts: 3, backoffMs: 100, maxBackoffMs: 100 }, attempt, deps);
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await sleeping;
    controller.abort("cancelled by caller");
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  it("does not start an attempt when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const attempt = vi.fn(async () => ({ kind: "done" as const, value: 1 }));
    const deps: Partial<RetryDeps> & { signal: AbortSignal } = { signal: controller.signal };
    await expect(
      runWithRetry({ attempts: 1, backoffMs: 0, maxBackoffMs: 0 }, attempt, deps)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(attempt).not.toHaveBeenCalled();
  });
});
