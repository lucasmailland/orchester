/**
 * @vitest-environment jsdom
 *
 * Tests for the TermDef singleton controller.
 *
 * Each `it` resets module state via `_resetControllerForTests` so cases never
 * leak timers or listeners into one another. Timers are faked so the 120ms
 * intent debounce and 100ms close debounce can be exercised deterministically
 * without real-clock flake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetControllerForTests,
  cancelPending,
  getActiveId,
  requestClose,
  requestOpen,
  subscribe,
} from "@/lib/compass/term-def-controller";

beforeEach(() => {
  vi.useFakeTimers();
  _resetControllerForTests();
});

afterEach(() => {
  _resetControllerForTests();
  vi.useRealTimers();
});

describe("term-def-controller", () => {
  it("requestOpen fires the open callback after the default 120ms debounce", () => {
    const cb = vi.fn();
    requestOpen("brain", cb);

    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(119);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getActiveId()).toBe("brain");
  });

  it("requestClose fires the close callback after the default 100ms debounce", () => {
    const openCb = vi.fn();
    const closeCb = vi.fn();

    requestOpen("recall", openCb);
    vi.advanceTimersByTime(120);
    expect(openCb).toHaveBeenCalledTimes(1);

    requestClose("recall", closeCb);
    expect(closeCb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(closeCb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(closeCb).toHaveBeenCalledTimes(1);
    expect(getActiveId()).toBeNull();
  });

  it("requestOpen on a different id while one is active swaps activeId immediately", () => {
    const openA = vi.fn();
    const openB = vi.fn();
    const closeA = vi.fn();

    // Activate A first.
    requestOpen("a", openA);
    vi.advanceTimersByTime(120);
    expect(getActiveId()).toBe("a");
    expect(openA).toHaveBeenCalledTimes(1);

    // Schedule a close so we can verify the swap cancels it instead of double-firing.
    requestClose("a", closeA);

    // Move sideways to B — should swap synchronously, no extra tick required.
    requestOpen("b", openB);

    expect(openB).toHaveBeenCalledTimes(1);
    expect(getActiveId()).toBe("b");
    // The pending close on A was cancelled by the swap — even after enough
    // time would have elapsed, it must not fire.
    vi.advanceTimersByTime(500);
    expect(closeA).not.toHaveBeenCalled();
    // And A is not "re-opened" by any leftover timer.
    expect(openA).toHaveBeenCalledTimes(1);
  });

  it("cancelPending clears a scheduled open before its timer fires", () => {
    const cb = vi.fn();

    requestOpen("brain", cb);
    cancelPending("brain");

    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled();
    expect(getActiveId()).toBeNull();
  });

  it("subscribe receives true on activation and false on deactivation", () => {
    const listener = vi.fn();
    const unsub = subscribe("mnemosyne", listener);

    requestOpen("mnemosyne", () => {});
    vi.advanceTimersByTime(120);
    expect(listener).toHaveBeenCalledWith(true);

    requestClose("mnemosyne", () => {});
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledWith(false);

    // Calls: once true, once false.
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
  });

  it("_resetControllerForTests clears active id, scheduled timers, and listeners", () => {
    const listener = vi.fn();
    subscribe("brain", listener);

    requestOpen("brain", () => {});
    vi.advanceTimersByTime(120);
    expect(getActiveId()).toBe("brain");

    _resetControllerForTests();

    expect(getActiveId()).toBeNull();
    // After reset, the listener should be gone — no more callbacks for it.
    requestOpen("brain", () => {});
    vi.advanceTimersByTime(200);
    // Only the original `true` activation pre-reset. No post-reset call.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
