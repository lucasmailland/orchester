"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { useMemo } from "react";
import type { Fact, FactsPage } from "./use-brain-facts";

/**
 * Hook for the Memory Timeline route. Loads facts ordered by `created_at`
 * descending, optionally paging via D1's cursor until either the cursor
 * exhausts or we cross the requested date cutoff.
 *
 * Like `use-brain-facts`, this is defensive against the D1 surface not
 * being merged yet: a 404 / network error becomes an empty timeline so
 * the page still renders.
 */

export type TimelineRange = "7d" | "30d" | "90d" | "all" | "custom";

export interface TimelineFilters {
  range: TimelineRange;
  /** ISO strings; used only when `range === "custom"`. */
  from?: string;
  to?: string;
  /** Soft cap on facts to walk. Defaults to 1000. */
  maxItems?: number;
}

const SWR_DEFAULTS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 5_000,
  shouldRetryOnError: false,
};

const PAGE_LIMIT = 200;
const DEFAULT_MAX = 1000;
const DAY_MS = 86_400_000;

/**
 * Resolve the absolute cutoff `Date` for a given range. Returns `null`
 * when the user asked for "all time" or a custom range that has no lower
 * bound.
 */
export function resolveCutoff(filters: TimelineFilters): Date | null {
  const now = Date.now();
  if (filters.range === "7d") return new Date(now - 7 * DAY_MS);
  if (filters.range === "30d") return new Date(now - 30 * DAY_MS);
  if (filters.range === "90d") return new Date(now - 90 * DAY_MS);
  if (filters.range === "custom" && filters.from) return new Date(filters.from);
  return null;
}

async function defensiveFetcher(url: string): Promise<FactsPage> {
  const empty: FactsPage = { items: [], nextCursor: null, total: 0 };
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    return empty;
  }
  if (res.status === 404) return empty;
  if (!res.ok) throw new Error(`timeline fetch failed (${res.status})`);
  try {
    return (await res.json()) as FactsPage;
  } catch {
    return empty;
  }
}

/**
 * Returns all facts inside the requested window. Uses SWR with a fixed
 * cache key per filter set, then internally paginates cursor-by-cursor
 * inside the fetcher. We stop walking once we cross the cutoff to avoid
 * loading the entire history.
 */
export function useBrainTimeline(filters: TimelineFilters) {
  const cutoff = useMemo(() => resolveCutoff(filters), [filters]);
  const maxItems = filters.maxItems ?? DEFAULT_MAX;
  const key = `timeline:${filters.range}:${filters.from ?? ""}:${filters.to ?? ""}:${maxItems}`;

  const { data, error, isLoading, isValidating, mutate } = useSWR<Fact[]>(
    key,
    async () => {
      const items: Fact[] = [];
      let cursor: string | null = null;
      let guard = 0;
      while (items.length < maxItems && guard < 50) {
        const params = new URLSearchParams({
          sortBy: "created",
          order: "desc",
          limit: String(PAGE_LIMIT),
          status: "all",
        });
        if (cursor) params.set("cursor", cursor);
        const page = await defensiveFetcher(`/api/mnemo/facts?${params.toString()}`);
        if (!page.items.length) break;
        for (const fact of page.items) {
          // Stop early if we crossed the cutoff. We use createdAt as the
          // anchor — the timeline groups by the moment a fact entered
          // memory. The list is ordered desc so once we see one older
          // than the cutoff we can bail.
          if (cutoff && new Date(fact.createdAt).getTime() < cutoff.getTime()) {
            return items;
          }
          items.push(fact);
          if (items.length >= maxItems) break;
        }
        cursor = page.nextCursor;
        guard += 1;
        if (!cursor) break;
      }
      return items;
    },
    SWR_DEFAULTS
  );

  // Optional `to` upper bound (custom range only) — applied client-side
  // since the API doesn't accept it directly.
  const filtered = useMemo(() => {
    if (!data) return [];
    if (filters.range !== "custom" || !filters.to) return data;
    const toMs = new Date(filters.to).getTime();
    return data.filter((f) => new Date(f.createdAt).getTime() <= toMs);
  }, [data, filters.range, filters.to]);

  return {
    facts: filtered,
    error,
    isLoading,
    isValidating,
    mutate,
  };
}
