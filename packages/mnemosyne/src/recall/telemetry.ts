// packages/mnemosyne/src/recall/telemetry.ts
//
// v1.1 — Recall pipeline telemetry callback.
//
// Mnemosyne is a pure package — it can't import from `apps/web` and
// must stay free of any concrete metrics backend (Sentry, OTel,
// StatsD). This module defines the callback contract that callers in
// the host wire to their `recordMetric` infrastructure.
//
// Contract:
//   - `onMetric` is invoked SYNCHRONOUSLY from the pipeline. It MUST
//     NOT throw — the caller's metric backend is downstream of the
//     critical recall path. Internal `withTiming` wraps every call in
//     try/catch to defend against host bugs.
//   - Each pipeline stage emits exactly ONE event with `stage` set to
//     the stage name plus optional duration / count / score fields.
//   - A final `stage: "total"` event carries the wall-clock duration
//     of `runSearchPipeline` and the final result count.
//
// The set of stages is intentionally enumerable — host-side dashboards
// can pre-declare panels by name and won't lose data when new optional
// stages are added (they show up as missing series rather than
// breaking the schema).

/**
 * Pipeline stages that can emit telemetry events.
 *
 * Keep this set stable — host dashboards key on these strings.
 * If a new stage is added, append to the end; do NOT rename existing
 * entries (callers grep on these in their metric backend).
 */
export type RecallStage =
  | "query_prep"
  | "pointer_lookup"
  | "first_stage"
  | "drawer_grep"
  | "co_location_boost"
  | "single_term_dampener"
  | "rerank"
  | "rerank_early_exit"
  | "prune"
  | "diversity"
  | "graph_expand"
  | "total";

/**
 * A single telemetry event emitted by the recall pipeline.
 *
 * All fields except `stage` and `workspaceId` are optional — different
 * stages report different signals (e.g. `pointer_lookup` reports
 * `count` of drawers found but no `topScore`; `rerank_early_exit`
 * reports `topScore` only).
 */
export interface RecallMetricEvent {
  /** Pipeline stage that emitted this event. */
  stage: RecallStage;
  /** Workspace scope of the recall call. */
  workspaceId: string;
  /**
   * Wall-clock duration of the stage in milliseconds.
   * `| undefined` is explicit so callers under exactOptionalPropertyTypes
   * can pass through optional values from upstream computations.
   */
  durationMs?: number | undefined;
  /** Number of items in / out of the stage. */
  count?: number | undefined;
  /** Top score after the stage (post-stage scores, descending order). */
  topScore?: number | undefined;
  /**
   * Optional stage-specific data. Host emitters fold this into metric
   * tags. Keep keys short and snake_case (compatible with StatsD /
   * Prometheus label conventions).
   */
  extra?: Record<string, string | number | boolean> | undefined;
}

/** Callback shape — passed via `SearchMnemoInput.onMetric`. */
export type OnRecallMetricFn = (event: RecallMetricEvent) => void;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns a high-resolution clock when available, otherwise falls back
 * to `Date.now()`. Pulled out so the search.ts hot path doesn't have
 * to deal with `performance` being absent in some test runtimes.
 */
function nowMs(): number {
  // `performance` is a Node 16+ global and a browser global. The guard
  // exists for non-standard runtimes (e.g. legacy edge workers) where
  // `performance` might not be defined.
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * Run `fn` and emit a `RecallMetricEvent` after it completes. Never
 * throws — a buggy `onMetric` callback cannot break the caller's
 * recall path. The original promise rejection (if any) is preserved.
 *
 * @param onMetric  Caller-provided sink. Pass `undefined` to no-op.
 * @param stage     Pipeline stage label.
 * @param workspaceId  Workspace scope of the recall call.
 * @param fn        Async work to time.
 * @param attrs     Optional factory for stage-specific fields. Receives
 *                  the awaited result so it can summarize counts / top
 *                  scores without re-computing them.
 */
export async function withTiming<T>(
  onMetric: OnRecallMetricFn | undefined,
  stage: RecallStage,
  workspaceId: string,
  fn: () => Promise<T>,
  attrs?: (result: T) => Omit<RecallMetricEvent, "stage" | "workspaceId" | "durationMs">
): Promise<T> {
  if (!onMetric) return fn();
  const t0 = nowMs();
  const result = await fn();
  const durationMs = nowMs() - t0;
  try {
    const extra = attrs ? attrs(result) : {};
    onMetric({ stage, workspaceId, durationMs, ...extra });
  } catch {
    /* never break the caller path for a metric */
  }
  return result;
}

/**
 * Emit a one-shot event with no timing (e.g. a stage that ran
 * synchronously inside the calling block).
 */
export function emitMetric(onMetric: OnRecallMetricFn | undefined, event: RecallMetricEvent): void {
  if (!onMetric) return;
  try {
    onMetric(event);
  } catch {
    /* never break the caller path for a metric */
  }
}
