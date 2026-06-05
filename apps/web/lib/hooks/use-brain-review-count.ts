"use client";

import useSWR, { type SWRConfiguration } from "swr";

/**
 * SWR hook for `/api/mnemo/review/count` — surfaces the real depth of
 * the active-learning review queue for the Memory Inspector header.
 *
 * Designed to degrade gracefully: any HTTP/network error or non-JSON
 * body returns 0 (matching the "no badge" rendering path). We never
 * throw, so the surrounding KPIs keep working if the new endpoint
 * hasn't shipped yet.
 */

interface ReviewCountResponse {
  count: number;
}

async function fetchReviewCount(url: string): Promise<number> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    return 0;
  }
  if (!res.ok) return 0;
  try {
    const json = (await res.json()) as Partial<ReviewCountResponse>;
    return typeof json.count === "number" && json.count >= 0 ? json.count : 0;
  } catch {
    return 0;
  }
}

const SWR_DEFAULTS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 10_000,
  shouldRetryOnError: false,
};

/**
 * Returns the unresolved review-queue depth for the active workspace.
 * Falls back to 0 on any failure mode so the caller can render the
 * badge unconditionally.
 */
export function useBrainReviewCount(): { count: number; isLoading: boolean } {
  const { data, isLoading } = useSWR<number>(
    "/api/mnemo/review/count",
    fetchReviewCount,
    SWR_DEFAULTS
  );
  return {
    count: data ?? 0,
    isLoading,
  };
}
