"use client";

import useSWR, { mutate as globalMutate, type SWRConfiguration, type KeyedMutator } from "swr";

/**
 * useApi — thin SWR wrapper for client-side GET data fetching (audit finding K1).
 *
 * Replaces the repeated `useState(null) + useEffect + fetch + loadAll()` pattern
 * scattered across ~32 client components. Benefits over manual fetch:
 *  - request dedup + caching across components sharing the same URL key
 *  - exposes `error` (manual pattern often did `if (!r.ok) return`, leaving the
 *    component stuck on a "loading forever" spinner when a request failed)
 *  - `mutate` for revalidation / optimistic updates instead of re-running loadAll()
 *
 * MIGRATION PATTERN (how to convert an existing component):
 *
 *   // before
 *   const [items, setItems] = useState<Item[] | null>(null);
 *   useEffect(() => { void load(); }, []);
 *   async function load() {
 *     const r = await fetch("/api/items");
 *     if (!r.ok) return;            // <-- spinner-forever bug on error
 *     setItems((await r.json()).items);
 *   }
 *
 *   // after
 *   const { data, error, isLoading, mutate } = useApi<{ items: Item[] }>("/api/items");
 *   const items = data?.items ?? null;
 *   // render: isLoading -> spinner, error -> error state, else list
 *   // after a mutation: void mutate();  (re-fetches and updates cache)
 *
 * Pass `null` as the key to conditionally skip fetching (standard SWR behavior).
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Default fetcher: GET JSON, throw a typed ApiError on non-2xx so SWR surfaces `error`. */
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error ?? body?.message ?? detail;
    } catch {
      /* non-JSON error body — keep statusText */
    }
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface UseApiResult<T> {
  data: T | undefined;
  error: ApiError | undefined;
  isLoading: boolean;
  /** True during background revalidation (data already present). */
  isValidating: boolean;
  mutate: KeyedMutator<T>;
}

/**
 * Fetch + cache a JSON GET endpoint.
 * @param key   The request URL, or `null` to skip fetching (conditional fetch).
 * @param config Optional SWR overrides (merged over the defaults below).
 */
export function useApi<T>(
  key: string | null,
  config?: SWRConfiguration<T, ApiError>
): UseApiResult<T> {
  const { data, error, isLoading, isValidating, mutate } = useSWR<T, ApiError>(
    key,
    fetcher,
    {
      // Settings tab / list views don't change second-to-second; avoid hammering
      // the API on every window focus while still keeping reconnect revalidation.
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      // De-dupe identical requests fired within this window (e.g. multiple
      // mounts of the same section) into a single network call.
      dedupingInterval: 5_000,
      ...config,
    }
  );

  return { data, error, isLoading, isValidating, mutate };
}

/**
 * Global cache mutation helper for optimistic updates from outside a component
 * that holds the `useApi` handle (e.g. after a POST elsewhere).
 *
 *   // optimistic add then revalidate
 *   await mutateApi<{ items: Item[] }>(
 *     "/api/items",
 *     (cur) => cur ? { items: [newItem, ...cur.items] } : cur,
 *     { revalidate: true }
 *   );
 */
export function mutateApi<T>(
  key: string,
  data?: T | Promise<T> | ((current: T | undefined) => T | undefined),
  opts?: { revalidate?: boolean },
) {
  return globalMutate<T>(key, data, opts);
}
