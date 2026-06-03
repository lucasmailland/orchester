"use client";

/**
 * useHasTour — reactive boolean: is there a registered tour for this id?
 *
 * A "tour" here is any TourSpot whose `id` either equals `tourId` or is
 * prefixed `${tourId}:` (the convention for multi-step tours grouped under a
 * single page-level tour id, e.g. `memory-ops:recall`, `memory-ops:dedup`).
 *
 * Why this exists
 * ---------------
 * `PageHero` used to always render a "Take a tour" button whenever a `tourId`
 * prop was passed. The button dispatched a `compass:tour` window event with
 * no listener anywhere — a UX lie: we promised pedagogy that didn't exist.
 *
 * This hook subscribes to the `TourSpot` registry so the button can render
 * only when at least one matching spot is mounted. As spots mount/unmount on
 * the current page (route transitions, drawers opening, etc.) the value
 * recomputes.
 *
 * SSR
 * ---
 * The registry lives in module scope and is empty on the server, so this
 * hook returns `false` during SSR. Subscriptions only attach in `useEffect`,
 * so there's no `window`/`document` access in the render path.
 */

import { useEffect, useState } from "react";

import {
  getTourSpots,
  subscribeTourSpots,
  type TourSpotEntry,
} from "@/components/compass/TourSpot";

function matchesTour(entry: TourSpotEntry, tourId: string): boolean {
  return entry.id === tourId || entry.id.startsWith(`${tourId}:`);
}

function hasTourFor(tourId: string, entries: ReadonlyArray<TourSpotEntry>): boolean {
  for (const entry of entries) {
    if (matchesTour(entry, tourId)) return true;
  }
  return false;
}

/**
 * Returns `true` when at least one `TourSpot` matching `tourId` is currently
 * registered. Pass `null`/`undefined` to opt out (always returns `false`).
 */
export function useHasTour(tourId: string | null | undefined): boolean {
  const [present, setPresent] = useState<boolean>(false);

  useEffect(() => {
    if (typeof tourId !== "string" || tourId.length === 0) {
      setPresent(false);
      return;
    }

    // Seed: subscribeTourSpots doesn't fire on subscribe, so read current state.
    setPresent(hasTourFor(tourId, getTourSpots()));

    const unsubscribe = subscribeTourSpots((entries) => {
      setPresent(hasTourFor(tourId, entries));
    });

    return unsubscribe;
  }, [tourId]);

  return present;
}
