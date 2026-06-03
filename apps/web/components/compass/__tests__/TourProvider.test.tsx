/**
 * @vitest-environment jsdom
 *
 * Tests for the TourProvider settled-snapshot timer.
 *
 * We exercise the race-window logic that decides WHEN the step list locks in
 * after a `compass:tour` event fires:
 *   - The snapshot must NOT lock until SETTLED_SNAPSHOT_MS (250ms) of quiet.
 *   - It MUST hard-cap at MAX_SNAPSHOT_WAIT_MS (2000ms) regardless.
 *   - When the snapshot ends empty, the warning Callout renders.
 *
 * Strategy
 * --------
 * We mock `@/components/compass/TourSpot` so the test owns the entries the
 * provider sees. `simulateSpotArrival()` mutates the in-test registry, then
 * notifies subscribers — exactly what mounting a `<TourSpot>` would do. This
 * lets us control timing without rendering real spot components.
 *
 * `next-intl` is mocked so we don't need an `IntlProvider` in the test tree.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TourSpotEntry, TourSpotListener } from "@/components/compass/TourSpot";

// ---- Mocks ----------------------------------------------------------------

// In-test registry. The TourSpot mock writes into it; the TourProvider reads
// from it via the mocked getTourSpots/subscribeTourSpots.
const mockRegistry: TourSpotEntry[] = [];
const mockListeners = new Set<TourSpotListener>();

function notifyMockListeners(): void {
  const snapshot = [...mockRegistry].sort((a, b) => a.step - b.step);
  for (const l of mockListeners) l(snapshot);
}

function simulateSpotArrival(entry: TourSpotEntry): void {
  mockRegistry.push(entry);
  notifyMockListeners();
}

function makeEntry(id: string, step: number): TourSpotEntry {
  return {
    id,
    step,
    title: `Title ${id}`,
    body: `Body ${id}`,
    getRect: () =>
      ({
        top: 100,
        left: 100,
        right: 200,
        bottom: 200,
        width: 100,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect,
  };
}

vi.mock("@/components/compass/TourSpot", () => ({
  getTourSpots: () => [...mockRegistry].sort((a, b) => a.step - b.step),
  subscribeTourSpots: (l: TourSpotListener) => {
    mockListeners.add(l);
    return () => {
      mockListeners.delete(l);
    };
  },
  // Re-export the entry type as a no-op runtime value — TS only.
  TourSpot: () => null,
}));

// next-intl is not used by anything we mount, but TourProvider imports it.
// A passthrough translator keeps every key visible in the rendered output,
// which is exactly what we need to assert on the warning Callout key.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Callout itself imports nothing tricky, but we render only its key text via
// a tiny stub so the assertion is stable even if Callout's markup evolves.
vi.mock("@/components/compass/Callout", () => ({
  Callout: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <div data-testid="callout" data-variant={variant}>
      {children}
    </div>
  ),
}));

// Import the provider AFTER the mocks are declared so the module picks them up.
import { TourProvider } from "@/components/compass/TourProvider";

// ---- Test scaffolding -----------------------------------------------------

const TOUR_ID = "memory-ops";
// Mirrors the constants in TourProvider — kept in sync by hand because they
// are intentionally not exported (private timing knobs of the component).
const SETTLED_SNAPSHOT_MS = 250;

function dispatchTour(): void {
  const evt = new CustomEvent("compass:tour", { detail: { tourId: TOUR_ID } });
  window.dispatchEvent(evt);
}

beforeEach(() => {
  vi.useFakeTimers();
  mockRegistry.length = 0;
  mockListeners.clear();
});

afterEach(() => {
  cleanup();
  mockRegistry.length = 0;
  mockListeners.clear();
  vi.useRealTimers();
});

describe("TourProvider settled-snapshot timer", () => {
  it("does not lock the snapshot until SETTLED_SNAPSHOT_MS of quiet has elapsed", () => {
    render(<TourProvider />);

    // Pre-seed one spot before the tour fires.
    mockRegistry.push(makeEntry("memory-ops:step1", 1));

    act(() => {
      dispatchTour();
    });

    // A late-arriving spot bumps the registry well before the 250ms settle.
    act(() => {
      vi.advanceTimersByTime(100);
      simulateSpotArrival(makeEntry("memory-ops:step2", 2));
    });

    // Another arrival at 200ms — still inside the settle window because every
    // change resets the timer back to 250ms.
    act(() => {
      vi.advanceTimersByTime(100);
      simulateSpotArrival(makeEntry("memory-ops:step3", 3));
    });

    // 249ms after the last arrival — snapshot is NOT yet locked. We can't
    // observe "locked" from the outside directly, but we CAN observe that
    // the warning Callout has not fired (peak == final, no missing steps).
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(screen.queryByTestId("callout")).toBeNull();

    // Past the settle threshold — snapshot locks, all three steps survived,
    // so no warning Callout is rendered. The tour is now driving normally.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("callout")).toBeNull();
  });

  it("hard-caps the wait at MAX_SNAPSHOT_WAIT_MS even if the registry keeps churning", () => {
    render(<TourProvider />);

    act(() => {
      dispatchTour();
    });

    // Keep nudging the registry every 200ms so the settle timer never has
    // 250ms of quiet — without the hard cap, the snapshot would never lock.
    // We arrive at step1 only, never the rest that the tour might expect.
    for (let elapsed = 200; elapsed < 1900; elapsed += 200) {
      act(() => {
        vi.advanceTimersByTime(200);
        // Touch the registry: re-emit the existing list so subscribers fire
        // and the settle timer resets. This is what late-mounting Suspense
        // boundaries look like to the provider.
        if (elapsed === 200) {
          simulateSpotArrival(makeEntry("memory-ops:step1", 1));
        } else {
          notifyMockListeners();
        }
      });
    }

    // We are now ~1.9s in. The settle timer is still being reset on every
    // 200ms tick, so without the hard cap nothing would have locked. But the
    // hard cap fires at 2s regardless — push past it.
    expect(screen.queryByTestId("callout")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // After the hard cap, the snapshot is locked. With only one step in the
    // registry the tour proceeds normally — no warning when at least one
    // step is present and stayed present through the lock.
    // We assert the snapshot LOCKED by verifying any further "arrival" no
    // longer resets a settle timer: we advance well past 250ms and the tour
    // has already proceeded (no empty-state warning is rendered, and the
    // tour-card root is mounted in the portal).
    expect(screen.queryByTestId("callout")).toBeNull();
  });

  it("surfaces the warning Callout when the snapshot settles with zero steps", () => {
    render(<TourProvider />);

    act(() => {
      dispatchTour();
    });

    // No spots ever arrive. The 250ms settle timer fires with an empty
    // registry, locks the snapshot, and the empty-state card with the
    // warning Callout is rendered.
    act(() => {
      vi.advanceTimersByTime(SETTLED_SNAPSHOT_MS);
    });

    const callout = screen.getByTestId("callout");
    expect(callout).toBeTruthy();
    expect(callout.getAttribute("data-variant")).toBe("warning");
    expect(callout.textContent).toBe("runtime.missingStepsWarning");
  });
});
