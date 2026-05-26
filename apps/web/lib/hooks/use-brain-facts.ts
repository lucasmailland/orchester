"use client";

import useSWR, { type SWRConfiguration } from "swr";
import useSWRInfinite from "swr/infinite";
import { useMemo } from "react";

/**
 * Hooks for the Memory Inspector — wraps the D1-owned `/api/mnemo/facts*`
 * surface. Designed to be defensive: D1's routes may not exist yet, so a
 * 404/500 falls back to an "empty list" / "no data" state rather than
 * blowing up the page.
 */

export type FactScope = "global" | "conversation" | "employee" | "team";
export type FactKind =
  | "preference"
  | "trait"
  | "event"
  | "relationship"
  | "skill"
  | "concern"
  | "other";
export type FactStatus = "active" | "forgotten" | "merged";

export interface Fact {
  id: string;
  workspaceId: string;
  agentId: string | null;
  scope: FactScope;
  scopeRef: string | null;
  kind: FactKind;
  subject: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  relevance: number;
  hitCount: number;
  lastRecalledAt: string | null;
  sourceMessageIds: string[];
  metadata: Record<string, unknown>;
  status: FactStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FactsPage {
  items: Fact[];
  nextCursor: string | null;
  total: number;
}

export interface Citation {
  id: string;
  role: string;
  content: string;
  conversationId: string;
  createdAt: string;
}

export interface HealthSnapshot {
  capturedAt: string;
  factCountActive: number;
  factCountPinned: number;
  factCountForgotten: number;
  factCountEmbedded: number;
  factCountTotal: number;
  recallHitRate30d: number;
  // Allow extra unknown fields without breaking the UI.
  [extra: string]: unknown;
}

export type SortBy = "updated" | "created" | "relevance" | "hits";
export type SortOrder = "asc" | "desc";

export interface FactsFilters {
  kind?: FactKind | "";
  scope?: FactScope | "";
  scopeRef?: string;
  pinned?: boolean;
  status?: FactStatus;
  q?: string;
  sortBy?: SortBy;
  order?: SortOrder;
  limit?: number;
}

/**
 * Defensive JSON fetcher. Treats 404 as "empty page" so the Inspector
 * renders gracefully before D1's routes ship. Other non-2xx responses
 * still throw so SWR surfaces `error`.
 */
async function defensiveFetcher<T>(url: string, emptyValue: T): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    // Network error → treat like "not available yet".
    return emptyValue;
  }
  if (res.status === 404) return emptyValue;
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body?.error ?? body?.message ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    return emptyValue;
  }
}

function buildFactsQuery(filters: FactsFilters, cursor?: string | null): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.scopeRef) params.set("scopeRef", filters.scopeRef);
  if (typeof filters.pinned === "boolean") params.set("pinned", String(filters.pinned));
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.order) params.set("order", filters.order);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return `/api/mnemo/facts${qs ? `?${qs}` : ""}`;
}

const SWR_DEFAULTS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 5_000,
  shouldRetryOnError: false,
};

/**
 * Paginated facts list with "load more" semantics.
 */
export function useBrainFacts(filters: FactsFilters) {
  const getKey = (pageIndex: number, prev: FactsPage | null) => {
    if (prev && !prev.nextCursor && pageIndex > 0) return null;
    const cursor = pageIndex === 0 ? undefined : (prev?.nextCursor ?? undefined);
    return buildFactsQuery(filters, cursor);
  };

  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<FactsPage>(
    getKey,
    (url: string) => defensiveFetcher<FactsPage>(url, { items: [], nextCursor: null, total: 0 }),
    SWR_DEFAULTS
  );

  const items = useMemo(() => (data ? data.flatMap((p) => p.items) : []), [data]);
  const total = data?.[0]?.total ?? 0;
  const last = data?.[data.length - 1];
  const hasMore = !!last?.nextCursor;
  const loadingMore = isValidating && size > 1;

  return {
    items,
    total,
    error,
    isLoading,
    isValidating,
    hasMore,
    loadingMore,
    loadMore: () => setSize(size + 1),
    mutate,
  };
}

/**
 * Single-fact fetch via the same list endpoint (best-effort for detail).
 * The detail page also uses this hook to load the row before rendering.
 */
export function useBrainFact(factId: string | null) {
  const key = factId ? `/api/mnemo/facts?id=${encodeURIComponent(factId)}&limit=1` : null;
  const { data, error, isLoading, mutate } = useSWR<FactsPage>(
    key,
    (url: string) => defensiveFetcher<FactsPage>(url, { items: [], nextCursor: null, total: 0 }),
    SWR_DEFAULTS
  );

  const fact = data?.items[0] ?? null;
  return { fact, error, isLoading, mutate };
}

/**
 * Citations for a fact. Lazy: pass `null` to skip until the user opens
 * the detail view.
 */
export function useFactCitations(factId: string | null) {
  const key = factId ? `/api/mnemo/facts/${encodeURIComponent(factId)}/citations` : null;
  const { data, error, isLoading, mutate } = useSWR<Citation[]>(
    key,
    (url: string) => defensiveFetcher<Citation[]>(url, []),
    SWR_DEFAULTS
  );

  return {
    citations: data ?? [],
    error,
    isLoading,
    mutate,
  };
}

/**
 * Mutations. Each returns a promise — callers should handle errors with
 * their own toast/notify wrapper. We don't auto-revalidate here; the
 * caller should `mutate()` the list afterwards.
 */
export async function patchFact(
  id: string,
  patch: Partial<
    Pick<Fact, "subject" | "statement" | "confidence" | "pinned" | "kind" | "scope" | "metadata">
  >
) {
  const res = await fetch(`/api/mnemo/facts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
  return (await res.json()) as Fact;
}

async function postAction(id: string, action: "pin" | "unpin" | "forget" | "restore") {
  const res = await fetch(`/api/mnemo/facts/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`${action} failed (${res.status})`);
  return (await res.json()) as { ok: true };
}

export const pinFact = (id: string) => postAction(id, "pin");
export const unpinFact = (id: string) => postAction(id, "unpin");
export const forgetFact = (id: string) => postAction(id, "forget");
export const restoreFact = (id: string) => postAction(id, "restore");
