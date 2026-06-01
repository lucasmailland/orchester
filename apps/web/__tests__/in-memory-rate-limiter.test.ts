// apps/web/__tests__/in-memory-rate-limiter.test.ts
//
// Unit tests for the in-memory sliding-window rate limiter used by
// `/api/mnemo/recall-debug` (Inspector UI v2). Clock is injected so
// every boundary is deterministic — no real timers, no flakes.

import { describe, it, expect } from "vitest";
import { makeInMemoryRateLimiter } from "@/lib/rate-limit/in-memory-bucket";

// Test clock helper — produces a closure with a settable "current time"
// that the limiter reads via opts.now.
function makeClock(start = 1_000_000_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("makeInMemoryRateLimiter", () => {
  it("admits up to maxCalls within the window", () => {
    const clock = makeClock();
    const rl = makeInMemoryRateLimiter({ windowMs: 1000, maxCalls: 3, now: clock.now });

    expect(rl.tryAcquire("u1").allowed).toBe(true);
    expect(rl.tryAcquire("u1").allowed).toBe(true);
    expect(rl.tryAcquire("u1").allowed).toBe(true);
  });

  it("denies the (maxCalls + 1)-th call and returns retryAfterMs", () => {
    const clock = makeClock();
    const rl = makeInMemoryRateLimiter({ windowMs: 1000, maxCalls: 2, now: clock.now });

    rl.tryAcquire("u1");
    clock.advance(100);
    rl.tryAcquire("u1");

    const denied = rl.tryAcquire("u1");
    expect(denied.allowed).toBe(false);
    // First call was at t=0 (relative), so the next admission is at
    // t=1000 — i.e. 1000 ms after the first call. We've advanced 100ms
    // since then, so retryAfterMs == 900.
    expect(denied.retryAfterMs).toBe(900);
  });

  it("admits a new call after the oldest one falls outside the window", () => {
    const clock = makeClock();
    const rl = makeInMemoryRateLimiter({ windowMs: 1000, maxCalls: 1, now: clock.now });

    expect(rl.tryAcquire("u1").allowed).toBe(true);
    clock.advance(999);
    expect(rl.tryAcquire("u1").allowed).toBe(false);
    clock.advance(2);
    expect(rl.tryAcquire("u1").allowed).toBe(true);
  });

  it("scopes state per key (one user's overflow doesn't block another)", () => {
    const clock = makeClock();
    const rl = makeInMemoryRateLimiter({ windowMs: 1000, maxCalls: 1, now: clock.now });

    expect(rl.tryAcquire("u1").allowed).toBe(true);
    expect(rl.tryAcquire("u1").allowed).toBe(false);
    expect(rl.tryAcquire("u2").allowed).toBe(true);
  });

  it("reset() clears all per-key history", () => {
    const clock = makeClock();
    const rl = makeInMemoryRateLimiter({ windowMs: 1000, maxCalls: 1, now: clock.now });

    rl.tryAcquire("u1");
    expect(rl.tryAcquire("u1").allowed).toBe(false);

    rl.reset();
    expect(rl.tryAcquire("u1").allowed).toBe(true);
  });

  it("never returns a negative retryAfterMs (clock-skew defense)", () => {
    const clock = makeClock();
    const rl = makeInMemoryRateLimiter({ windowMs: 1000, maxCalls: 1, now: clock.now });

    rl.tryAcquire("u1");
    // Jump back in time (clock-skew or system-time correction).
    clock.advance(-500);

    const denied = rl.tryAcquire("u1");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThanOrEqual(0);
  });

  it("compacts the history at every call so memory stays bounded by the window", () => {
    const clock = makeClock();
    const rl = makeInMemoryRateLimiter({ windowMs: 1000, maxCalls: 100, now: clock.now });

    // Fill in burst.
    for (let i = 0; i < 50; i++) rl.tryAcquire("u1");
    // Wait past the window so all 50 entries are stale.
    clock.advance(2000);

    // After this single call only the new timestamp survives — the
    // 50 old ones are compacted out. We can't directly read internal
    // state, but the next 99 calls in the new window should all
    // succeed (proving maxCalls headroom was restored).
    rl.tryAcquire("u1");
    for (let i = 0; i < 99; i++) {
      expect(rl.tryAcquire("u1").allowed).toBe(true);
    }
    // Now we've used 100 in the new window — the 101st is denied.
    expect(rl.tryAcquire("u1").allowed).toBe(false);
  });
});
