// apps/web/lib/dead-mnemo-stubs.ts
//
// Transitional stubs for symbols that used to come from @mnemosyne/core.
// Phase 3 of the service-extraction plan removed the in-process library
// from orchester's runtime; everything memory-related now goes over HTTP
// to the @mnemosyne/server stack at MNEMO_URL.
//
// This file exports the SAME identifiers the legacy `@mnemosyne/core`
// did so the TypeScript compiler stays happy while we migrate each
// callsite. Functions throw `MnemoCoreRemovedError` at runtime — the
// error message names the symbol and points at the SDK or service
// alternative. Types degrade to `unknown` so structural checks
// continue to compile.
//
// As each callsite is rewired to the SDK (`getMnemoClient()` from
// `@/lib/mnemo/client`) or to a Postgres query against orchester's
// host tables, its `import "@/lib/dead-mnemo-stubs"` line gets
// removed. When the last import is gone, this file is deleted.

import "server-only";

export class MnemoCoreRemovedError extends Error {
  constructor(symbol: string) {
    super(
      `[mnemo] '${symbol}' from @mnemosyne/core is no longer in orchester's runtime. ` +
        `Use the HTTP SDK (apps/web/lib/mnemo/client → getMnemoClient()) or ` +
        `move this code into @mnemosyne/server. See ` +
        `docs/superpowers/plans/2026-06-05-mnemosyne-service-extraction.md`
    );
    this.name = "MnemoCoreRemovedError";
  }
}

// Returns `any` so downstream `.map()` / `.length` calls compile (the
// legacy code paths that called these symbols still type-check); the
// runtime branch is unreachable because the wrapper throws immediately.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dead = (sym: string): any => {
  return (..._args: unknown[]) => {
    throw new MnemoCoreRemovedError(sym);
  };
};

// ─── Types ──────────────────────────────────────────────────────────
//
// These mirror the legacy @mnemosyne/core exports loosely — wide
// enough that the legacy consumers compile (RecallMetricEvent's
// shape varies stage-by-stage, AgentMemoryPolicy is a discriminated
// union, etc) and so the structural-type errors that pinpointed
// "still calling the removed library" don't fire on every legacy
// callsite. The runtime stubs still throw if anything actually
// touches them.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentMemoryPolicy = any;
export type AutoPinFactInput = Record<string, unknown>;
export type ConsolidationCluster = Record<string, unknown>;
export type CreateFactAsyncInput = Record<string, unknown>;
export type CrossWorkspaceFactInput = Record<string, unknown>;
export type DedupCandidate = Record<string, unknown>;
export type EntityCandidate = Record<string, unknown>;
export type EntityKind = "person" | "organization" | "project" | "concept" | "place" | "other";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EntityLlmCallFn = any;
export type HealthSnapshot = Record<string, unknown>;
export type KbChunk = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KbChunkProvider = any;
export type MnemoEntity = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RecallMetricEvent = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RecallSample = any;
export type RecallStage = string;
export type RecallUnifiedInput = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RerankFn = any;
export type TriggerDecision = { shouldRecall: boolean; reason?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnifiedRecallHit = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UserProfileSummary = any;

// ─── Constants (safe defaults) ──────────────────────────────────────

/** Stable empty default — code that reads `.workspace`, `.agent` etc.
 *  off this used to receive a populated object; now they get
 *  `undefined` and need to fall through to their own defaults. */
export const DEFAULT_AGENT_MEMORY_POLICY: AgentMemoryPolicy = {};

/** Documentation string. Inert. */
export const MEMORY_PROTOCOL_V1 = "v1";
export const MEMORY_RECALL_GUIDANCE = "";

// ─── Functions (all throw at runtime) ───────────────────────────────
export const applyPolicyToRecall = dead("applyPolicyToRecall");
export const applyPolicyToWrite = dead("applyPolicyToWrite");
export const buildAutoPinStamp = dead("buildAutoPinStamp");
export const clusterCrossWorkspace = dead("clusterCrossWorkspace");
export const completenessScore = dead("completenessScore");
export const composeBOM = dead("composeBOM");
export const computeHealthSnapshot = dead("computeHealthSnapshot");
export const consolidateCluster = dead("consolidateCluster");
export const createEpisode = dead("createEpisode");
export const createFactAsync = dead("createFactAsync");
export const decideAutoPin = dead("decideAutoPin");
export const deriveSyntheticEpisodeId = dead("deriveSyntheticEpisodeId");
export const detectPII = dead("detectPII");
export const enqueueReview = dead("enqueueReview");
export const extractEntities = dead("extractEntities");
export const findConsolidationClusters = dead("findConsolidationClusters");
export const findDedupCandidates = dead("findDedupCandidates");
export const findLowConfidenceCandidates = dead("findLowConfidenceCandidates");
export const findOrCreate = dead("findOrCreate");
export const findPruneCandidates = dead("findPruneCandidates");
export const getHealthSnapshot = dead("getHealthSnapshot");
export const getOrComputeSummary = dead("getOrComputeSummary");
export const getProviderHealth = dead("getProviderHealth");
export const linkFactToEpisode = dead("linkFactToEpisode");
export const makeCohereRerank = dead("makeCohereRerank");
export const makeLocalLexicalRerank = dead("makeLocalLexicalRerank");
export const mergeCluster = dead("mergeCluster");
export const parseAgentMemoryPolicy = (input: unknown): AgentMemoryPolicy => {
  // Pure function that the policy route used to call to validate input
  // JSON. We accept anything; the route's zod schema handles real
  // validation. Returning the input unchanged keeps callers compiling.
  return (input as AgentMemoryPolicy) ?? {};
};
export const persistHealthSnapshot = dead("persistHealthSnapshot");
export const pruneFacts = dead("pruneFacts");
export const recallUnified = dead("recallUnified");
export const recordProviderResult = dead("recordProviderResult");
export const redactPIIWithCategories = dead("redactPIIWithCategories");
export const renderFactsCompact = dead("renderFactsCompact");
export const resolveActiveMode = dead("resolveActiveMode");
export const resolveConfiguredMode = dead("resolveConfiguredMode");
export const saveFactWithCandidates = dead("saveFactWithCandidates");
export const searchMnemo = dead("searchMnemo");
export const shouldExtract = dead("shouldExtract");
export const shouldExtractBackfill = dead("shouldExtractBackfill");
export const shouldTriggerRecall = dead("shouldTriggerRecall");
export const syntheticEpisodeIdForDay = dead("syntheticEpisodeIdForDay");
export const syntheticEpisodeIdForDocument = dead("syntheticEpisodeIdForDocument");
export const syntheticEpisodeIdForMessageTurn = dead("syntheticEpisodeIdForMessageTurn");

// ─── withMnemoTx ─────────────────────────────────────────────────────
//
// Special case: many host-side workers + the dev seed wrap their
// orchester-DB writes in `withMnemoTx(workspaceId, async tx => …)`.
// The library version did three things: open a postgres tx, SET LOCAL
// the `app.workspace_id` GUC, downgrade the role to `app_user`.
//
// After Phase 3, mnemo_* tables no longer live in orchester's DB, so
// the workspace_id GUC has nothing to scope and the app_user role
// doesn't exist on the host DB. We expose a `withMnemoTx` here that
// throws — every legacy callsite needs to be either:
//   (a) routed through the HTTP SDK (the right answer for mnemo ops), or
//   (b) rewritten to use orchester's own getDb() (for host-table ops
//       that were incidentally batched into a mnemo tx).
export const withMnemoTx = async <T>(
  _workspaceId: string,
  _fn: (tx: Tx) => Promise<T>
): Promise<T> => {
  throw new MnemoCoreRemovedError("withMnemoTx");
};
