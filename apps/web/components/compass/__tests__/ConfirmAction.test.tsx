/**
 * @vitest-environment jsdom
 *
 * Tests for the ConfirmAction "don't ask me again" escape hatch.
 *
 * The component owns two concerns we verify here:
 *   1. When a fresh skip record exists for the rememberKey, onConfirm is
 *      invoked on a microtask and the modal never renders.
 *   2. When the skip record is older than CONFIRM_ACTION_TTL_MS, the modal IS
 *      rendered — muscle memory must not outlive the TTL.
 *
 * We do not need next-intl here: ConfirmAction takes every user-visible string
 * via props, so it imports zero translation hooks.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONFIRM_ACTION_STORAGE_PREFIX,
  CONFIRM_ACTION_TTL_MS,
  ConfirmAction,
} from "@/components/compass/ConfirmAction";

const REMEMBER_KEY = "test:op";
const STORAGE_KEY = `${CONFIRM_ACTION_STORAGE_PREFIX}${REMEMBER_KEY}`;

// JSDOM in this repo's vitest config does not always install a fully spec'd
// localStorage on `window`. We install a minimal in-memory shim so each test
// owns its own storage and no real-clock state leaks across cases.
function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: shim,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  installMemoryLocalStorage();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
});

function seedSkipRecord(ageMs: number): void {
  // Negative ageMs would mean "in the future" which the impl treats as stale —
  // we deliberately use only positive values here.
  const ts = Date.now() - ageMs;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ts, key: REMEMBER_KEY }));
}

describe("ConfirmAction rememberKey skip path", () => {
  it("auto-confirms without rendering the modal when a fresh skip record exists", () => {
    seedSkipRecord(60_000); // one minute old — well within TTL

    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const onAutoConfirm = vi.fn();

    const { rerender } = render(
      <ConfirmAction
        open={false}
        onClose={onClose}
        title="Combinar duplicados"
        action="Combinar"
        onConfirm={onConfirm}
        rememberKey={REMEMBER_KEY}
        rememberLabels={{
          dontAskAgain: "No volver a preguntar",
          resetConfirmations: "Restablecer confirmaciones",
        }}
        onAutoConfirm={onAutoConfirm}
      />
    );

    // Closed, nothing should have fired yet.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText("Combinar duplicados")).toBeNull();

    // Open with the same key — the effect schedules a microtask via setTimeout(0).
    rerender(
      <ConfirmAction
        open={true}
        onClose={onClose}
        title="Combinar duplicados"
        action="Combinar"
        onConfirm={onConfirm}
        rememberKey={REMEMBER_KEY}
        rememberLabels={{
          dontAskAgain: "No volver a preguntar",
          resetConfirmations: "Restablecer confirmaciones",
        }}
        onAutoConfirm={onAutoConfirm}
      />
    );

    // The component returns null before the modal can mount — confirm the
    // dialog title is absent in the DOM.
    expect(screen.queryByText("Combinar duplicados")).toBeNull();

    // Flush the setTimeout(0) microtask that fires the auto-confirm.
    vi.advanceTimersByTime(0);

    expect(onAutoConfirm).toHaveBeenCalledWith(REMEMBER_KEY);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders the modal when the skip record is older than the TTL", () => {
    // One ms past the TTL — must be treated as expired.
    seedSkipRecord(CONFIRM_ACTION_TTL_MS + 1);

    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const onAutoConfirm = vi.fn();

    render(
      <ConfirmAction
        open={true}
        onClose={onClose}
        title="Combinar duplicados"
        action="Combinar"
        onConfirm={onConfirm}
        rememberKey={REMEMBER_KEY}
        rememberLabels={{
          dontAskAgain: "No volver a preguntar",
          resetConfirmations: "Restablecer confirmaciones",
        }}
        onAutoConfirm={onAutoConfirm}
      />
    );

    // The TTL expired, so the auto-confirm path is skipped and the modal must
    // mount. Title and "don't ask again" affordance should both be present.
    expect(screen.getByText("Combinar duplicados")).toBeTruthy();
    expect(screen.getByText("No volver a preguntar")).toBeTruthy();

    // Even after flushing timers, onConfirm/onAutoConfirm must NOT fire — the
    // user has to click confirm explicitly.
    vi.advanceTimersByTime(50);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onAutoConfirm).not.toHaveBeenCalled();
  });
});
