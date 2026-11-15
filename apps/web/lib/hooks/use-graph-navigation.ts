"use client";
// lib/hooks/use-graph-navigation.ts
// Client-only UI state for Wave-2 graph navigation: focus depth, find-path mode
// + its two-node selection, and the as-of timestamp. Pure React state — no
// server calls (those live in use-brain-graph / use-graph-path).

import { useCallback, useState } from "react";

export interface GraphNavigationState {
  /** Hop radius for focus mode, 1..3. */
  depth: number;
  setDepth: (d: number) => void;
  /** Whether "Find path" mode is armed (clicks pick endpoints, not select). */
  findPathMode: boolean;
  toggleFindPath: () => void;
  /** Chosen path endpoints (entity ids), in pick order. */
  pathFrom: string | null;
  pathTo: string | null;
  /** Record a click while in find-path mode. Fills `from` then `to`. */
  pickPathNode: (id: string) => void;
  clearPath: () => void;
  /** ISO 8601 instant for as-of reconstruction (null = live/now). */
  asOf: string | null;
  setAsOf: (iso: string | null) => void;
}

export function useGraphNavigation(): GraphNavigationState {
  const [depth, setDepthState] = useState(1);
  const [findPathMode, setFindPathMode] = useState(false);
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const [pathTo, setPathTo] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);

  const setDepth = useCallback((d: number) => {
    setDepthState(Math.min(3, Math.max(1, Math.trunc(d))));
  }, []);

  const clearPath = useCallback(() => {
    setPathFrom(null);
    setPathTo(null);
  }, []);

  const toggleFindPath = useCallback(() => {
    setFindPathMode((prev) => {
      // Leaving find-path mode clears any half-made selection.
      if (prev) {
        setPathFrom(null);
        setPathTo(null);
      }
      return !prev;
    });
  }, []);

  const pickPathNode = useCallback((id: string) => {
    // The authoritative updater: reads current `from`, sets `to` if `from` is
    // already set and differs, or sets `from` if not yet set.
    setPathFrom((curFrom) => {
      if (curFrom && curFrom !== id) {
        setPathTo(id);
        return curFrom;
      }
      if (!curFrom) return id;
      return curFrom;
    });
  }, []);

  return {
    depth,
    setDepth,
    findPathMode,
    toggleFindPath,
    pathFrom,
    pathTo,
    pickPathNode,
    clearPath,
    asOf,
    setAsOf,
  };
}
