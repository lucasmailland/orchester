// packages/mnemosyne/src/consolidation/index.ts
//
// Mnemosyne v1.4 — REM-style consolidation. Two-phase nightly pass:
//
//   1. `findConsolidationClusters` (pure READ, no LLM): groups
//      active embedded facts by same subject + kind + cosine >=
//      `minCosine` (default 0.75 — looser than the janitor's 0.92
//      dedup threshold). Clusters with fewer than `minClusterSize`
//      (default 4) members are dropped.
//
//   2. `consolidateCluster` (LLM call + write): asks the workspace's
//      cheap-tier model for ONE consolidated sentence covering the
//      cluster, inserts the summary as a new `mnemo_fact` (kind
//      'event'), and stamps every member with a `derived_from` edge
//      pointing at the summary. Originals stay `status='active'` so
//      they remain findable; the summary becomes the canonical
//      recall hit by virtue of higher cohesion.
//
// The cron driver (`apps/web/worker/consolidation-job.ts`) wires
// these together with spend-cap + metering — required by the audit
// invariants enforced in `scripts/audit-invariants.sh`. This package
// stays free of host adapters; callers inject the LLM + embedder via
// the `consolidateCluster` input.
//
// See also: `src/janitor/dedup.ts` — the stricter cousin that
// archives near-duplicates instead of summarising. v1.4 deliberately
// runs consolidation BEFORE the janitor (Sunday 02:00 UTC vs. dedup's
// 03:00 UTC) so dedup doesn't accidentally collapse a freshly-created
// summary fact with one of its members.
export {
  findConsolidationClusters,
  type ConsolidationCluster,
  type FindConsolidationClustersInput,
} from "./cluster";

export {
  consolidateCluster,
  type ConsolidateClusterInput,
  type ConsolidateClusterOutput,
} from "./summarize";
