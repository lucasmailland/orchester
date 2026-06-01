// packages/mnemosyne/src/recall/stage-caps.ts
//
// v2 — Per-stage adaptive cap helpers.
//
// v1.1 #25 shipped a single `tieredCap()` that adapts the FINAL
// `maxResults` based on per-workspace fact count. That's one knob for
// the whole pipeline. v2 splits the cap per-stage so:
//
//   - drawer-grep gets a tighter cap (entity-filtered FTS is high-
//     precision; over-fetching wastes IO),
//   - first-stage gets a wider cap (the full pool is the recall floor),
//   - graph-expansion stays at `maxResults` so neighbours can still
//     promote past direct hits.
//
// Numbers below are PLACEHOLDERS. The v2 spec §7.4 explicitly defers
// calibration to "4 weeks of telemetry collection." Until then the
// caller path (`runSearchPipeline`) does NOT wire these helpers — they
// ship as a pure-function library so external dashboards and tests
// can reason about the proposed caps without code changes once the
// data arrives.

import type { TieredFactCountBucket } from "./cap-tiers";

/**
 * Per-stage cap tiered on the workspace's fact count. Numbers are the
 * v2 spec §7.2 proposal — to be re-calibrated against the v1.1
 * telemetry stream (`mnemo.recall.<stage>.count` distributions) once
 * a 4-week window is available.
 *
 * Frozen — callers MUST NOT mutate this map.
 */
export const STAGE_CAP_BY_TIER: Readonly<
  Record<TieredFactCountBucket, { drawerGrep: number; firstStage: number }>
> = Object.freeze({
  "<1k": { drawerGrep: 6, firstStage: 10 },
  "<10k": { drawerGrep: 10, firstStage: 15 },
  "<100k": { drawerGrep: 16, firstStage: 25 },
  ">=100k": { drawerGrep: 20, firstStage: 30 },
});

/**
 * Bucket a fact count into one of the four canonical tiers. Pure
 * function — same shape used by `tieredCap()` and the v1.1 `total`
 * telemetry event's `fact_count_tier` tag.
 */
export function factCountTier(factCount: number): TieredFactCountBucket {
  if (factCount < 1000) return "<1k";
  if (factCount < 10000) return "<10k";
  if (factCount < 100000) return "<100k";
  return ">=100k";
}

/**
 * Per-stage drawer-grep cap for a given workspace fact count.
 * Wraps `STAGE_CAP_BY_TIER` so callers don't have to know the
 * bucket mapping. The non-null assertion is safe: `factCountTier`
 * only returns values keyed in the frozen map.
 */
export function drawerGrepCapForFactCount(factCount: number): number {
  return STAGE_CAP_BY_TIER[factCountTier(factCount)]!.drawerGrep;
}

/**
 * Per-stage first-stage cap for a given workspace fact count.
 * Wraps `STAGE_CAP_BY_TIER`. Non-null assertion rationale matches
 * `drawerGrepCapForFactCount`.
 */
export function firstStageCapForFactCount(factCount: number): number {
  return STAGE_CAP_BY_TIER[factCountTier(factCount)]!.firstStage;
}
