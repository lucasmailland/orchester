"use client";

import useSWR, { type SWRConfiguration } from "swr";
import type { HealthSnapshot } from "./use-brain-facts";

/**
 * Defensive fetcher for the Mnemosyne `/api/mnemo/health/*` surface.
 * Treats 404 as "not yet available" — the D1 sibling agent owns those
 * routes and they may not be merged when this UI ships.
 */
async function healthFetcher<T>(url: string, fallback: T): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    return fallback;
  }
  if (res.status === 404) return fallback;
  if (!res.ok) {
    throw new Error(`Health fetch failed (${res.status})`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

const SWR_DEFAULTS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 10_000,
  shouldRetryOnError: false,
};

const EMPTY_LATEST: HealthSnapshot | null = null;

/**
 * Latest health snapshot. `data` may be `null` while D1 hasn't produced
 * a snapshot yet — the UI should show "No data yet" tiles in that case.
 */
export function useBrainHealthLatest() {
  const { data, error, isLoading, mutate } = useSWR<HealthSnapshot | null>(
    "/api/mnemo/health/latest",
    (url: string) => healthFetcher<HealthSnapshot | null>(url, EMPTY_LATEST),
    SWR_DEFAULTS
  );

  return {
    snapshot: data ?? null,
    error,
    isLoading,
    mutate,
  };
}

/**
 * 30-day rolling history for the line charts.
 */
export function useBrainHealthHistory(days = 30) {
  const { data, error, isLoading, mutate } = useSWR<HealthSnapshot[]>(
    `/api/mnemo/health/history?days=${days}`,
    (url: string) => healthFetcher<HealthSnapshot[]>(url, []),
    SWR_DEFAULTS
  );

  return {
    history: data ?? [],
    error,
    isLoading,
    mutate,
  };
}
