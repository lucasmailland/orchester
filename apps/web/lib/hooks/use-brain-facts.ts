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

// v1.6 cognitive primitives (migration 0033/0035/0037/0039/0041).
export type FactMemoryType = "semantic" | "episodic" | "procedural" | "working";
export type FactAttribution = "user_stated" | "user_belief" | "objective_fact" | "inferred";
export type FactAttributedTo = "user" | "assistant" | "system";

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
  // v1.6 cognitive surface. Optional on the type because legacy
  // endpoints may not return them yet; the modern facts route does.
  memoryType?: FactMemoryType;
  attribution?: FactAttribution;
  attributedTo?: FactAttributedTo | null;
  actorId?: string | null;
  entityId?: string | null;
  protocolVersion?: string;
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
  /**
   * v1.6 G1-3: bitemporal time-travel. When set the route applies
   * `valid_from <= asOf AND (valid_to IS NULL OR valid_to > asOf)`
   * so the Inspector renders the memory snapshot at that instant.
   * Pass `null`/`undefined` for "now" (default).
   */
  asOf?: Date | null;
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

/**
 * The UI uses friendly sort keys (`updated`, `created`, `hits`) but
 * the `/api/mnemo/facts` route validates against the DB column names
 * (`updated_at`, `created_at`, `hit_count`). Mismatched values are
 * rejected with a 400, which surfaces in the Inspector as
 * "Something went wrong". Map here so both sides keep their natural
 * vocabulary.
 */
const SORT_KEY_TO_API: Record<SortBy, string> = {
  updated: "updated_at",
  created: "created_at",
  hits: "hit_count",
  relevance: "relevance",
};

function buildFactsQuery(filters: FactsFilters, cursor?: string | null): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.scopeRef) params.set("scopeRef", filters.scopeRef);
  if (typeof filters.pinned === "boolean") params.set("pinned", String(filters.pinned));
  if (filters.status) params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.sortBy) params.set("sortBy", SORT_KEY_TO_API[filters.sortBy]);
  if (filters.order) params.set("order", filters.order);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.asOf) params.set("asOf", filters.asOf.toISOString());
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
 * Single-fact fetch via the dedicated `/api/mnemo/facts/[id]` route.
 *
 * Pre-v1.6 this hook used the LIST route with `?id=…&limit=1`, which
 * the list handler silently ignored — it returned an arbitrary fact
 * (and 500'd on some edge cases). The dedicated GET endpoint always
 * returns the right row or 404, and includes the full v1.6 cognitive
 * surface (memory_type, attribution, actor_id, protocol_version).
 */
export function useBrainFact(factId: string | null) {
  const key = factId ? `/api/mnemo/facts/${encodeURIComponent(factId)}` : null;
  const { data, error, isLoading, mutate } = useSWR<Fact | null>(
    key,
    (url: string) => defensiveFetcher<Fact | null>(url, null),
    SWR_DEFAULTS
  );

  return { fact: data ?? null, error, isLoading, mutate };
}

/**
 * Citations for a fact. Lazy: pass `null` to skip until the user opens
 * the detail view.
 *
 * The route returns `{ citations: Citation[] }` (envelope shape), but
 * earlier versions of this hook treated the response as a bare array
 * and called `.map(...)` on the envelope object — which threw
 * `TypeError: citations.map is not a function` and surfaced as the
 * shell-level "Something went wrong" error boundary on every fact
 * detail page. We accept both shapes for forward/backward compat.
 */
type CitationsResponse = Citation[] | { citations: Citation[] };

export function useFactCitations(factId: string | null) {
  const key = factId ? `/api/mnemo/facts/${encodeURIComponent(factId)}/citations` : null;
  const { data, error, isLoading, mutate } = useSWR<CitationsResponse>(
    key,
    (url: string) => defensiveFetcher<CitationsResponse>(url, []),
    SWR_DEFAULTS
  );

  const citations = Array.isArray(data) ? data : (data?.citations ?? []);

  return {
    citations,
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
