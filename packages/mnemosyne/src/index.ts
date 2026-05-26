// packages/mnemosyne/src/index.ts
//
// Public API barrel for @orchester/mnemosyne.
// Multi-tenant memory architecture for AI agents.
// See docs/specs/2026-05-24-mnemosyne-design.md

export const MNEMOSYNE_VERSION = "0.1.0";

// Transaction wrapper — sets `app.workspace_id` GUC + downgrades to
// app_user role so RLS+FORCE Pattern A actually enforces. Host crons
// and agent-runtime callers use this to wrap any tenant-scoped DB
// access (see ADR-0010 for the role-downgrade rationale).
export { withMnemoTx, type Tx } from "./tx";

// Memory Protocol v1 — frozen system-prompt artifact injected by the host
// agent runtime so every agent knows how/when to use mnemosyne_* tools.
// Bumping MEMORY_PROTOCOL_VERSION invalidates extractions tagged with the
// prior version (see §13 of the design spec).
export {
  MEMORY_PROTOCOL_V1,
  MEMORY_PROTOCOL_VERSION,
  MEMORY_PROTOCOL_V1_LEGACY,
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
  type SearchMnemoInput,
  type RecallHit,
  type RecallReasons,
} from "./recall/search";

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
export type { EnqueueFn } from "./types";

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
