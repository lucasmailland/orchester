// packages/mnemosyne/src/janitor/index.ts
//
// Mnemosyne v1.2 — "The Janitor": memory self-maintenance.
//
// The janitor is two weekly crons that keep `mnemo_fact` small and
// recall fast over the long run:
//
//   1. `dedup` — semantic near-duplicate collapse. Walks each
//      workspace, clusters facts whose embeddings are within
//      cosine 0.92, picks a "primary" per cluster (composite score
//      of relevance + confidence + log hit_count, with pinned
//      always winning), archives the rest into mnemo_fact_archive
//      with `archive_reason = 'merged'`, and folds their hit_count
//      / source_message_ids into the primary. Mode A facts (no
//      embedding) are skipped — FTS dedup would generate too many
//      false positives.
//
//   2. `prune` — inactive-fact archival. Walks each workspace,
//      finds active facts that are old (> 90 days), have never
//      been recalled (hit_count = 0), and whose relevance has
//      decayed below 0.1. Archives them with
//      `archive_reason = 'pruned_inactive'`. Pinned facts are
//      always exempt.
//
// Both crons operate inside `withMnemoTx(workspaceId, ...)`, so
// RLS+FORCE Pattern A applies and the role is downgraded to
// app_user. No LLM calls anywhere on this path — every operation
// is pure SQL against the existing mnemo_fact + pgvector setup,
// so the spend-cap / metering invariants in
// `scripts/audit-invariants.sh` don't apply.
//
// Both are idempotent: re-running on the same workspace after
// completion is a no-op (the second pass finds nothing).
//
// See migration 0029 for the archive table and
// `apps/web/worker/{dedup,prune}-job.ts` for the cron entry points.
export {
  findDedupCandidates,
  mergeCluster,
  pickPrimary,
  UnionFind,
  type DedupCandidate,
  type FindDedupCandidatesInput,
  type MergeClusterInput,
} from "./dedup";

export {
  findPruneCandidates,
  pruneFacts,
  type FindPruneCandidatesInput,
  type PruneFactsInput,
} from "./prune";
