// packages/mnemosyne/src/index.ts
//
// Public API barrel for @orchester/mnemosyne.
// Multi-tenant memory architecture for AI agents.
// See docs/specs/2026-05-24-mnemosyne-design.md

export const MNEMOSYNE_VERSION = "1.6.0";

// Transaction wrapper — sets `app.workspace_id` GUC + downgrades to
// app_user role so RLS+FORCE Pattern A actually enforces. Host crons
// and agent-runtime callers use this to wrap any tenant-scoped DB
// access (see ADR-0010 for the role-downgrade rationale).
//
// v1.6 — `MnemoTxOptions` lets callers opt into per-actor isolation
// (sets `app.actor_id` + flips `app.enforce_actor_isolation`). The
// plain `withMnemoTx(workspaceId, fn)` form is preserved for every
// legacy caller via overload.
export { withMnemoTx, type Tx, type MnemoTxOptions } from "./tx";

// Memory Protocol v1 — frozen system-prompt artifact injected by the host
// agent runtime so every agent knows how/when to use mnemosyne_* tools.
// Bumping MEMORY_PROTOCOL_VERSION invalidates extractions tagged with the
// prior version (see §13 of the design spec).
//
// v1.6 — `MEMORY_PROTOCOL_V1` now aliases the v1.2 string (entity
// awareness + per-user privacy paragraphs appended). Explicit
// `MEMORY_PROTOCOL_V2` exported for callers that want the unambiguous
// name; `MEMORY_PROTOCOL_V1_1` keeps the verbatim v1.1 text for replay
// jobs.
export {
  MEMORY_PROTOCOL_V1,
  MEMORY_PROTOCOL_V2,
  MEMORY_PROTOCOL_V1_1,
  MEMORY_PROTOCOL_VERSION,
  MEMORY_PROTOCOL_V1_LEGACY,
  // v1.1 #28 — anti-pattern guidance for memory tool usage; separate
  // from the version-locked protocol so iteration doesn't invalidate
  // extraction metadata.
  MEMORY_RECALL_GUIDANCE,
} from "./protocol/v1";

// PII detection / redaction — regex-only layer (§5.4 of the design spec).
// NER + LLM layers are optional add-ons (Phase 5.2 / 5.3).
export { detectPII, type PIIDetectionResult } from "./pii/detect";
export { redactPII, redactPIIWithCategories, type RedactPIIResult } from "./pii/redact";
export { PII_PATTERNS, PII_SEVERITY, type PIICategory } from "./pii/patterns";

// Candidate-on-write for facts (v1.1 §7). Surfaces potential
// contradictions when a new fact is saved so the caller can run LLM
// judgment (Mode C) or queue for human review (Mode A/B).
export {
  saveFactWithCandidates,
  type FactCandidate,
  type SaveFactWithCandidatesInput,
  type SaveFactWithCandidatesOutput,
} from "./conflict/fact-candidate";

// §39 Operational Modes — Graceful Degradation. Pure-code resolver from a
// capability snapshot (has LLM / has embed) to one of A / B / C, plus a
// health-aware resolver that combines configured capabilities with live
// provider health for graceful degradation under outage (v1.1).
export {
  resolveModeFromCapabilities,
  resolveConfiguredMode,
  resolveActiveMode,
  type MnemoMode,
  type CapabilitySnapshot,
  type ActiveModeResult,
  type ResolveActiveModeInput,
  type PartialAvailability,
  type DegradationReason,
} from "./modes/detect";

// Provider health tracker (in-memory rolling-window). Feeds
// `resolveActiveMode`. See packages/mnemosyne/src/modes/health.ts for
// the window policy + HMR-safe stash details.
export {
  recordProviderResult,
  getProviderHealth,
  resetProviderHealth,
  type ProviderKind,
  type ProviderHealth,
  type ProviderHealthSample,
} from "./modes/health";

// §5 Hybrid retrieval — recall search over `mnemo_fact`. Mode A falls
// back to FTS via the `text_lemmatized` GIN index; Mode B/C uses
// pgvector semantic + the blended hybrid score.
//
// v1.1 adds an opt-in post-retrieval pipeline: query contextualization
// + HyDE (hypothetical document embedding) → cross-encoder rerank →
// post-recall pruning of near-duplicates → hard cap (default 3). All
// new options are backward-compatible additions to `SearchMnemoInput`.
export {
  searchMnemo,
  // v1.1 #6 — co-location boost helpers (exported for host-side
  // diagnostics and unit tests that want to verify the boost magnitude
  // without spawning a full search pipeline).
  applyCoLocationBoost,
  CO_LOCATION_BOOST,
  // v1.1 #26+#27 — BFS verb priority + containment verb weights.
  // Exported so host UIs can display "why this neighbor ranked here."
  VERB_EXPAND_PRIORITY,
  // Scoring utility helpers (also used in apps/web/lib/brain/recall.ts).
  isSingleTermQuery,
  computeEntityDiversityCap,
  tieredCap,
  type SearchMnemoInput,
  type RecallHit,
  type RecallReasons,
} from "./recall/search";

// v1.1 — Per-stage recall telemetry callback contract. Host wires
// `SearchMnemoInput.onMetric` to its `recordMetric` infrastructure
// (Sentry distributions, OTel, Prometheus push). Stages are
// enumerable so dashboards can pre-declare panels — see
// `RecallStage` for the locked set of strings.
export {
  previewStatement,
  RECALL_SAMPLE_PREVIEW_MAX,
  type OnRecallMetricFn,
  type RecallMetricEvent,
  type RecallSample,
  type RecallStage,
} from "./recall/telemetry";

// v1.1 query preparation: paraphrase + HyDE to fix the query-fact
// embedding mismatch (questions vs. statements live in different
// vector-space regions). Both transforms are LLM-backed and opt-in.
export {
  prepareQuery,
  type LlmCallFn,
  type QueryPrepInput,
  type PreparedQuery,
} from "./recall/query-prep";

// v1.1 cross-encoder reranking. `noopRerank` is the safe identity
// default; `makeCohereRerank` is a turn-key adapter for hosts with a
// Cohere key. Charter §25: model is overridable per-call.
export {
  noopRerank,
  makeCohereRerank,
  type RerankFn,
  type RerankInput,
  type CohereRerankOptions,
} from "./recall/rerank";

// v1.1 compact rendering — groups facts by kind and condenses
// statements into k:v notation for prompt-budget-aware injection.
export { renderFactsCompact, type CompactRenderOptions } from "./recall/render";

// v1.1 cost optimization (async batch embedding). `createFactAsync`
// inserts the fact with `embedding = NULL` and queues a host job to
// fill in the vector later in batched API calls. FTS recall covers the
// gap. See `apps/web/worker/embed-batch-job.ts` for the host worker.
export {
  createFactAsync,
  EMBED_FACT_JOB_NAME,
  type CreateFactAsyncInput,
} from "./primitives/fact-async";

// Host adapter contracts (queue callback, etc.). Keep mnemosyne pure —
// the host supplies the concrete enqueue implementation.
//
// v1.4 — `Attribution` is the theory-of-mind discriminator surfaced
// on every fact (`MnemoFact.attribution`) and accepted by
// `searchMnemo({ attributionFilter })`. See migration 0035 +
// `src/types.ts` for the cognitive vocabulary.
export type { EnqueueFn, Attribution } from "./types";

// v1.1 Layer 2 trigger classifier — pure heuristic, no LLM/DB call.
// The agent runtime consults this on EVERY turn before deciding to
// perform a dynamic recall search; the goal is to skip recall on
// ~50% of turns that don't need it ("ok", "thanks") while staying
// generous on anything that looks like it references past context.
export {
  shouldTriggerRecall,
  type ShouldTriggerRecallInput,
  type TriggerDecision,
} from "./recall/triggering";

// v1.1 Layer 1 distilled user profile — pre-computed compact summary
// (80-150 tokens) cached in mnemo_summary and injected on EVERY turn.
// `getOrComputeSummary` is the entry point for the agent runtime;
// `distillFacts` + `renderSummaryText` + `heuristicSummary` are
// surfaced for testing and the daily cron worker.
export {
  getOrComputeSummary,
  distillFacts,
  heuristicSummary,
  renderSummaryText,
  estimateTokens,
  DISTILL_SYSTEM_PROMPT,
  getSummary,
  upsertSummary,
  invalidateSummary,
  type UserProfileSummary,
  type GetOrComputeSummaryInput,
  type UserProfileSummaryStruct,
  type DistillInput,
  type DistillResult,
  type MnemoSummaryRow,
  type UpsertSummaryInput,
} from "./summary";

// v1.2 Memory drift detection — periodic per-workspace snapshot of
// fact counts, recall hit-rate, contradiction surface, extraction
// backlog and embedding coverage. Computed by the daily cron in
// `apps/web/worker/health-job.ts` and surfaced via `GET /api/mnemo/health`.
// Pure cache — `computeHealthSnapshot` re-derives every metric from
// the existing mnemo_* tables in a handful of small queries.
export {
  computeHealthSnapshot,
  getHealthSnapshot,
  persistHealthSnapshot,
  type HealthSnapshot,
  type GetHealthSnapshotInput,
  type ComputeHealthSnapshotInput,
  type PersistHealthSnapshotInput,
} from "./health";

// Mnemosyne v1.2 — Janitor: memory self-maintenance.
// Semantic dedup and inactive-pruning crons keep storage from
// growing junky over time. Both write to `mnemo_fact_archive`
// (migration 0029) for traceability.
export {
  findDedupCandidates,
  mergeCluster,
  findPruneCandidates,
  pruneFacts,
  type DedupCandidate,
  type FindDedupCandidatesInput,
  type MergeClusterInput,
  type FindPruneCandidatesInput,
  type PruneFactsInput,
} from "./janitor";

// Mnemosyne v1.3 — active-learning review queue + auto-pin rules.
// `mnemo_review_queue` (migration 0032) is the persistent queue of
// facts that need human attention: contradictions surfaced when no
// LLM judge is available, or low-confidence facts swept by the daily
// `review-sweep` cron. Consumed by the Inspector UI via the
// `/api/mnemo/review` routes. The pure `decideAutoPin` rule set is
// what the auto-pin cron evaluates per-fact (no LLM, no DB inside
// the helper).
export {
  enqueueReview,
  listReview,
  resolveReview,
  findLowConfidenceCandidates,
  decideAutoPin,
  buildAutoPinStamp,
  type EnqueueReviewInput,
  type EnqueueReviewResult,
  type ListReviewInput,
  type ReviewQueueRow,
  type ReviewResolution,
  type ResolveReviewInput,
  type ResolveReviewResult,
  type ReviewReason,
  type SweepCandidate,
  type FindLowConfidenceCandidatesInput,
  type AutoPinRuleId,
  type AutoPinFactInput,
  type AutoPinDecision,
} from "./review";

// Mnemosyne v1.4 — "The Cognitive Leap".
//
// `MemoryType` separates facts the way human cognition does:
//   • semantic    — durable factual knowledge ('Lucas prefers TS').
//   • episodic    — events tied to a specific moment, linked to
//                   `mnemo_episode`.
//   • procedural  — how-to ('when X happens, do Y').
//   • working     — current conversation only; ephemeral.
//
// The `mnemo_episode` table (migration 0034) carries rich timeline
// events (meetings, decisions, milestones) — distinct from
// `mnemo_fact` because an episode has duration + multiple linked
// facts + a narrative arc. See `episode/index.ts` for the CRUD +
// timeline-query surface.
export {
  createEpisode,
  getEpisode,
  listEpisodes,
  linkFactToEpisode,
  type MemoryType,
  type MnemoEpisode,
  type CreateEpisodeInput,
  type ListEpisodesInput,
  type LinkFactToEpisodeInput,
} from "./episode";

// Mnemosyne v1.4 — per-agent memory policy. The `AgentMemoryPolicy`
// type lives on `agent.memory_policy` (migration 0036) and is applied
// to recall + write paths via `applyPolicyToRecall` and
// `applyPolicyToWrite`. `parseAgentMemoryPolicy` validates an
// untrusted shape (e.g. from a PATCH request body) before persisting.
export {
  DEFAULT_AGENT_MEMORY_POLICY,
  parseAgentMemoryPolicy,
  applyPolicyToRecall,
  applyPolicyToWrite,
  type AgentMemoryPolicy,
  type PolicyScope,
} from "./policy";

// Mnemosyne v1.4 — unified recall (KB + Memory in one endpoint).
// The host injects a `KbChunkProvider` against its own knowledge_chunk
// table; mnemosyne stays KB-agnostic. The blended score lives in
// [0, 1] across both source types so downstream code (citation,
// rendering) doesn't have to branch.
export {
  recallUnified,
  type KbChunkProvider,
  type KbChunk,
  type KbChunkSource,
  type UnifiedRecallSource,
  type UnifiedRecallHit,
  type RecallUnifiedInput,
} from "./recall/unified";

// Mnemosyne v1.4 — REM-style consolidation. Nightly cron clusters
// related facts (same subject + kind, cosine >= 0.75) and asks the
// workspace's cheap-tier LLM to write a one-sentence summary that
// supersedes them via `derived_from` edges. The summary becomes the
// canonical recall hit; originals stay active and reachable through
// `expandGraph` traversal of the same edges. See
// `apps/web/worker/consolidation-job.ts` for the cron driver.
export {
  findConsolidationClusters,
  consolidateCluster,
  type ConsolidationCluster,
  type FindConsolidationClustersInput,
  type ConsolidateClusterInput,
  type ConsolidateClusterOutput,
} from "./consolidation";

// Mnemosyne v1.6 "True 10/10" — additive type exports.
//
// `EmbeddingTier` is the discriminator surfaced on `CreateFactInput`
// (and `CreateFactAsyncInput`) so the host can pre-classify each fact
// before insertion. The batch worker reads `metadata.embedding_tier`
// to group pending facts and issue one API call per (workspace, tier).
// See `apps/web/lib/ai/embedding-tier.ts` for the classifier.
export type { EmbeddingTier } from "./primitives/fact";

// ─────────────────────────────────────────────────────────────────────
// Mnemosyne v1.6 G2 — Entity primitive exports (additive block).
//
// The 4th cognitive primitive alongside fact, decision, episode. A
// canonical "thing" (person / organization / project / concept /
// place / other) that facts reference via `mnemo_fact.entity_id`.
// Migration 0039 ships the table + the `entity_id` column; the
// extraction pipeline (apps/web/lib/brain/extract-job.ts) calls
// `findOrCreate` to dedupe mentions per turn. See
// packages/mnemosyne/src/entity/ for the module layout.
// ─────────────────────────────────────────────────────────────────────
export {
  createEntity,
  getEntity,
  updateEntity,
  findByAlias,
  findOrCreate,
  listEntities,
  listFactsForEntity,
  extractEntities,
  // v1.1 #22 — Unresolved-mention queue.
  queueUnresolvedMention,
  resolveUnresolvedMention,
  dismissUnresolvedMention,
  listUnresolvedMentions,
  getUnresolvedMention,
  type EntityKind,
  type MnemoEntity,
  type CreateEntityInput,
  type UpdateEntityInput,
  type FindOrCreateInput,
  type ListEntitiesInput,
  type ListFactsForEntityInput,
  type EntityCandidate,
  type ExtractEntitiesInput,
  type EntityLlmCallFn,
  type MnemoUnresolvedMention,
  type UnresolvedMentionStatus,
  type QueueUnresolvedMentionInput,
  type ResolveUnresolvedMentionInput,
  type DismissUnresolvedMentionInput,
  type ListUnresolvedMentionsInput,
  type GetUnresolvedMentionInput,
} from "./entity";

// A1 — Heuristic extraction pre-filter. Pure code, zero cost. Wired
// into extract-job to skip ~80% of LLM extraction calls on turns with
// no durable-fact signal (greetings, smalltalk, pure ACKs). Saves the
// majority of the per-turn extraction spend on noisy workspaces.
// See packages/mnemosyne/src/extraction/prefilter.ts for the rule set.
export {
  shouldExtract,
  shouldExtractBackfill,
  type PrefilterMessage,
  type PrefilterResult,
} from "./extraction/prefilter";

// v1.1 #29 — LongMemEval benchmark harness (metrics + fixtures).
// Imported by the benchmark spec and by host-side evaluation scripts.
export {
  evaluateQuestion,
  computeCategoryMetrics,
  aggregateResults,
  formatBenchmarkReport,
  BENCHMARK_QUESTIONS,
  getFixture,
  fixturesByCategory,
  type GroundTruth,
  type EvalHit,
  type QuestionResult,
  type BenchmarkResult,
  type CategoryMetrics,
  type BenchmarkQuestion,
  type BenchmarkFact,
} from "./benchmark";

// v1.1 #1+2 — Pointer index + drawer-grep.
// See packages/mnemosyne/src/index/pointer.ts for the architecture.
export {
  extractPointerTerms,
  upsertPointerTerms,
  lookupPointer,
  rebuildPointerIndex,
  type UpsertPointerInput,
  type LookupPointerInput,
  type PointerHit,
  type RebuildPointerInput,
} from "./index/pointer";
