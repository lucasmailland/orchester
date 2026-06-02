"use client";

// apps/web/lib/hooks/use-recall-debug.ts
//
// Mutation-style hook for /api/mnemo/recall-debug. Not an SWR fetcher —
// each "Run recall" click is an explicit fire, not a cached query.

import { useCallback, useState } from "react";
import type { RecallMetricEvent, UnifiedRecallHit } from "@orchester/mnemosyne";

export interface RecallDebugInput {
  query: string;
  agentId?: string;
  topK?: number;
  options?: {
    enableHyDE?: boolean;
    enableContextualize?: boolean;
    expandGraph?: boolean;
  };
}

export interface RecallDebugResult {
  /** Server-side `ok` discriminator — false when the pipeline threw. */
  ok: boolean;
  /** Result hits (empty array when ok=false). */
  items: UnifiedRecallHit[];
  /** Per-stage events captured during the run. Partial on error. */
  events: RecallMetricEvent[];
  /** Server-reported error message when ok=false. */
  errorMessage?: string;
  /** Round-trip latency from click → response, in ms. */
  clientLatencyMs: number;
  /** v2.1 — cuid2 traceId stashed on the audit row so callers can
   *  fetch a Decision BOM via /api/mnemo/decisions/{traceId}. */
  traceId?: string;
}

export interface UseRecallDebug {
  result: RecallDebugResult | null;
  isLoading: boolean;
  /** Fires a new debug call. Returns the same result that's also pushed
   *  to `result`, for callers that want to chain (e.g. analytics). */
  run: (input: RecallDebugInput) => Promise<RecallDebugResult>;
  /** Drops the current result so the funnel clears between runs. */
  reset: () => void;
}

export function useRecallDebug(): UseRecallDebug {
  const [result, setResult] = useState<RecallDebugResult | null>(null);
  const [isLoading, setLoading] = useState(false);

  const run = useCallback(async (input: RecallDebugInput): Promise<RecallDebugResult> => {
    setLoading(true);
    const t0 =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    try {
      const res = await fetch("/api/mnemo/recall-debug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });

      const json = (await res.json()) as {
        ok: boolean;
        items?: UnifiedRecallHit[];
        trace?: { events: RecallMetricEvent[] };
        error?: string;
        traceId?: string;
      };

      const t1 =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      const next: RecallDebugResult = {
        ok: json.ok === true,
        items: json.items ?? [],
        events: json.trace?.events ?? [],
        clientLatencyMs: t1 - t0,
        ...(json.error ? { errorMessage: json.error } : {}),
        ...(json.traceId ? { traceId: json.traceId } : {}),
      };
      setResult(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => setResult(null), []);

  return { result, isLoading, run, reset };
}
