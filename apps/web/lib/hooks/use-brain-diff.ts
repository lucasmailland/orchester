"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { useMemo } from "react";
import type { Fact, FactsPage } from "./use-brain-facts";

/**
 * Hook for the Memory Diff route. Loads facts within a window and bucket
 * them into Added / Forgotten / Updated based on `createdAt` and
 * `updatedAt`. Forgotten = `status === 'forgotten'` and updatedAt inside
 * the window (since forgetting bumps updatedAt). Updated = updatedAt
 * inside the window AND createdAt before the window.
 *
 * Defensive: D1's surface returning 404/empty just shows zeros.
 */

export type DiffRange = "7d" | "30d" | "custom";

export interface DiffFilters {
  range: DiffRange;
  from?: string;
  to?: string;
}

export interface DiffWindow {
  start: Date;
  end: Date;
  durationMs: number;
}

export interface DiffBuckets {
  added: Fact[];
  forgotten: Fact[];
  updated: Fact[];
  /** Facts present in the prior window — used for the net delta KPI. */
  priorAdded: Fact[];
}

const SWR_DEFAULTS: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 5_000,
  shouldRetryOnError: false,
};

const PAGE_LIMIT = 200;
const DAY_MS = 86_400_000;

export function resolveWindow(filters: DiffFilters): DiffWindow {
  const now = new Date();
  if (filters.range === "7d") {
    return { start: new Date(now.getTime() - 7 * DAY_MS), end: now, durationMs: 7 * DAY_MS };
  }
  if (filters.range === "30d") {
    return { start: new Date(now.getTime() - 30 * DAY_MS), end: now, durationMs: 30 * DAY_MS };
  }
  const start = filters.from ? new Date(filters.from) : new Date(now.getTime() - 7 * DAY_MS);
  const end = filters.to ? new Date(filters.to) : now;
  return { start, end, durationMs: Math.max(end.getTime() - start.getTime(), DAY_MS) };
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
  if (!res.ok) throw new Error(`diff fetch failed (${res.status})`);
  try {
    return (await res.json()) as FactsPage;
  } catch {
    return empty;
  }
}

/**
 * Walk facts sorted by `updated_at desc` until we cross the prior window
 * (window.start - durationMs), then bucket client-side. This lets us
 * compute net delta vs prior period in a single pass.
 */
async function loadFacts(maxAgeMs: number, maxItems: number): Promise<Fact[]> {
  const cutoff = Date.now() - maxAgeMs;
  const items: Fact[] = [];
  let cursor: string | null = null;
  let guard = 0;
  while (items.length < maxItems && guard < 50) {
    const params = new URLSearchParams({
      sortBy: "updated",
      order: "desc",
      limit: String(PAGE_LIMIT),
      status: "all",
    });
    if (cursor) params.set("cursor", cursor);
    const page = await defensiveFetcher(`/api/mnemo/facts?${params.toString()}`);
    if (!page.items.length) break;
    for (const fact of page.items) {
      if (new Date(fact.updatedAt).getTime() < cutoff) {
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
}

export function useBrainDiff(filters: DiffFilters) {
  const window = useMemo(() => resolveWindow(filters), [filters]);
  // Load two windows back so we can compute prior-window comparisons.
  const lookbackMs = window.durationMs * 2;
  const key = `diff:${filters.range}:${window.start.toISOString()}:${window.end.toISOString()}`;

  const { data, error, isLoading, mutate } = useSWR<Fact[]>(
    key,
    () => loadFacts(lookbackMs, 2000),
    SWR_DEFAULTS
  );

  const buckets = useMemo<DiffBuckets>(() => {
    const added: Fact[] = [];
    const forgotten: Fact[] = [];
    const updated: Fact[] = [];
    const priorAdded: Fact[] = [];
    if (!data) return { added, forgotten, updated, priorAdded };
    const startMs = window.start.getTime();
    const endMs = window.end.getTime();
    const priorStartMs = startMs - window.durationMs;
    for (const fact of data) {
      const created = new Date(fact.createdAt).getTime();
      const updatedAt = new Date(fact.updatedAt).getTime();
      const inWindow = updatedAt >= startMs && updatedAt <= endMs;
      const createdInWindow = created >= startMs && created <= endMs;
      const createdInPrior = created >= priorStartMs && created < startMs;
      if (createdInWindow) added.push(fact);
      if (createdInPrior) priorAdded.push(fact);
      if (inWindow && fact.status === "forgotten") forgotten.push(fact);
      if (inWindow && !createdInWindow && fact.status === "active") updated.push(fact);
    }
    return { added, forgotten, updated, priorAdded };
  }, [data, window]);

  const summary = useMemo(() => {
    const net = buckets.added.length - buckets.forgotten.length;
    const kindCounts = new Map<string, number>();
    for (const f of buckets.added) kindCounts.set(f.kind, (kindCounts.get(f.kind) ?? 0) + 1);
    let topKind: { kind: string; count: number } | null = null;
    for (const [kind, count] of kindCounts) {
      if (!topKind || count > topKind.count) topKind = { kind, count };
    }
    const subjectCounts = new Map<string, number>();
    for (const f of buckets.added) {
      subjectCounts.set(f.subject, (subjectCounts.get(f.subject) ?? 0) + 1);
    }
    let topSubject: { subject: string; count: number } | null = null;
    for (const [subject, count] of subjectCounts) {
      if (!topSubject || count > topSubject.count) topSubject = { subject, count };
    }
    const priorNet = buckets.priorAdded.length;
    return { net, topKind, topSubject, priorNet };
  }, [buckets]);

  return {
    buckets,
    summary,
    window,
    error,
    isLoading,
    mutate,
  };
}
