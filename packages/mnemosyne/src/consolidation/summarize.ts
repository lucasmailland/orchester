// packages/mnemosyne/src/consolidation/summarize.ts
//
// Mnemosyne v1.4 — REM-style consolidation: summarisation phase.
//
// Given one `ConsolidationCluster` (N >= 4 related facts about the
// same subject + kind), call the workspace's cheap-tier LLM to produce
// a single one-sentence consolidated statement, insert it as a new
// `mnemo_fact` via the canonical `createFact` path (so PII redaction +
// embedding flow apply), and stamp every member with a `derived_from`
// edge pointing at the new summary.
//
// The summary is the CANONICAL recall hit going forward — the
// originals stay `status='active'` so they remain findable, but the
// summary's higher cohesion (built from a larger evidence set) wins on
// hybrid score. v1.4 §1 graph traversal expansion can also walk the
// `derived_from` edges back to the originals when the caller opts in.
//
// Charter §25: LLM is injected via `LlmCallFn` — the host wires the
// workspace's resolved small-tier model into this entry point. We never
// fall back to a hardcoded provider/model.
//
// §0.1: package-clean — no `server-only`. Spend cap + metering are the
// host's responsibility (the worker file `consolidation-job.ts`); this
// helper just invokes the supplied LLM callback.
import type { Tx } from "../tx";
import { createFact, type MnemoFact, type FactKind } from "../primitives/fact";
import { createRelation } from "../graph/relation";
import type { ConsolidationCluster } from "./cluster";
import type { EmbedFn, EmbeddingProvider } from "../recall/embed";
import type { LlmCallFn } from "../recall/query-prep";

/**
 * One consolidation produces ONE summary fact + N `derived_from`
 * edges. Caller cares about both: the new fact id (so it can be
 * surfaced to the operator UI) and the relation count (so the cron
 * tick can log progress for observability).
 */
export interface ConsolidateClusterOutput {
  newFactId: string;
  relationCount: number;
}

export interface ConsolidateClusterInput {
  workspaceId: string;
  cluster: ConsolidationCluster;
  /** Host-supplied LLM callback. Mirrors the contract used by
   *  `prepareQuery` and `summary.distill` — the host attaches spend
   *  cap + metering wrappers BEFORE calling into this helper. */
  llm: LlmCallFn;
  /** Model id passed to the LLM call. Resolved per-workspace by the
   *  host via `resolveSmallTierModel`. The summary fact metadata
   *  captures the model used so future re-runs can detect a stale
   *  summary if the workspace bumps its small-tier model. */
  model: string;
  /** Optional embedding provider for the new summary fact. When
   *  omitted, the summary lands without an embedding (Mode A) and the
   *  async embed worker fills it later — same graceful path as every
   *  other write site. */
  embeddingProvider?: EmbeddingProvider;
  embeddingModel?: string;
  embedFn?: EmbedFn;
  tx: Tx;
}

/** Hard cap on member statements concatenated into the prompt — at
 *  ~50 tokens each, 20 members ≈ 1000 prompt tokens which is well
 *  inside the cheap-tier budget. Larger clusters are summarised over
 *  the first N members; the rest still get `derived_from` edges so
 *  expansion still surfaces them. */
const MAX_MEMBERS_IN_PROMPT = 20;

const SUMMARIZER_PROMPT = `You write ONE durable, one-sentence consolidated statement that captures the SHARED truth across the inputs.

Rules:
- Output ONLY the consolidated sentence. No prose, no markdown, no fence, no quotes.
- Keep it under 200 characters.
- Past-tense OK if the inputs describe events; otherwise present-tense.
- Preserve the subject the inputs were written about.
- If the inputs disagree, prefer the most recent agreement; do NOT manufacture compromise.
- The summary will be SAVED as a new memory; the originals stay accessible.`;

/**
 * Build the user prompt from the cluster members. Inputs are
 * numbered so the model can refer back if it produces a meta
 * sentence; we never log the order back to the user-facing surface
 * — it's purely an LLM nudge.
 */
function buildPrompt(cluster: ConsolidationCluster): string {
  const sampled = cluster.members.slice(0, MAX_MEMBERS_IN_PROMPT);
  const numbered = sampled.map((m, i) => `${i + 1}. ${m.statement}`).join("\n");
  return [
    `Subject: ${cluster.subject}`,
    `Kind: ${cluster.kind}`,
    "Inputs (all about the same subject):",
    numbered,
    "",
    "Consolidated sentence:",
  ].join("\n");
}

/**
 * Run the LLM, insert the summary fact, and stamp every original
 * with a `derived_from` edge. All work happens inside the supplied
 * `tx`, so a mid-flight error rolls back atomically — no orphan
 * summary fact, no orphan edges.
 *
 * Returns the new fact id + edge count. The caller (consolidation-
 * job worker) records spend + metering OUTSIDE this helper because
 * mnemosyne the package must stay free of host-only adapters.
 */
export async function consolidateCluster(
  input: ConsolidateClusterInput
): Promise<ConsolidateClusterOutput> {
  // `LlmCallFn` (defined in `recall/query-prep`) takes a single
  // `prompt` string + optional `maxTokens`. The host wraps the
  // system prompt + workspace model + spend cap around the call;
  // here we just stuff the system prompt at the top of the user
  // message — identical to how `prepareQuery` shapes its inputs.
  const prompt = `${SUMMARIZER_PROMPT}\n\n${buildPrompt(input.cluster)}`;
  const raw = await input.llm({
    prompt,
    maxTokens: 200,
  });

  // Strip whitespace + a leading bullet/number the LLM might emit
  // despite instructions. We also drop a trailing period if the
  // sentence is otherwise empty after trim — the summary should be
  // substantive, not a comma.
  const statement = (raw ?? "")
    .trim()
    .replace(/^[-*\d.)\s]+/, "")
    .replace(/^["'`]/, "")
    .replace(/["'`]$/, "")
    .trim();

  if (statement.length < 10) {
    // Defensive: the LLM returned something unusable. We don't throw
    // — the cron is best-effort. The caller logs a no-op and moves
    // on to the next cluster.
    return { newFactId: "", relationCount: 0 };
  }

  // The summary fact captures provenance in metadata so a future
  // operator can audit WHERE the row came from. `consolidated_from`
  // is the canonical key — `expandGraph` traversal walks the
  // `derived_from` edges, but the metadata pointer is the
  // human-readable trail and survives even if an edge is later
  // dismissed.
  const memberIds = input.cluster.members.map((m) => m.id);
  const summary = await createFact({
    workspaceId: input.workspaceId,
    scope: input.cluster.members[0]!.scope,
    scopeRef: input.cluster.members[0]!.scopeRef ?? null,
    // 'event' is the canonical kind for a consolidated record — it
    // describes WHAT HAPPENED (the consolidation event), not a
    // preference/trait/etc. The brief calls this out explicitly.
    kind: "event" as FactKind,
    subject: input.cluster.subject,
    statement,
    confidence: 0.85,
    attribution: "inferred",
    metadata: {
      consolidated_from: memberIds,
      consolidation: {
        model_used: input.model,
        cluster_size: input.cluster.members.length,
        cosine_min: input.cluster.cosineMin,
        generated_at: new Date().toISOString(),
      },
    },
    ...(input.embeddingProvider ? { embeddingProvider: input.embeddingProvider } : {}),
    ...(input.embeddingModel ? { embeddingModel: input.embeddingModel } : {}),
    ...(input.embedFn ? { embedFn: input.embedFn } : {}),
    tx: input.tx,
  });

  // ── derived_from edges (one per member) ──────────────────────────
  // Each member fact gets a `derived_from` edge pointing at the
  // summary. Recall expansion in v1.4 §1 walks this edge type, so
  // when the consolidated summary is a top hit the originals surface
  // automatically — and vice versa.
  //
  // Multi-actor disagreement isn't a concern here (the cron is the
  // single actor); `judgmentStatus='judged'` so the row doesn't
  // clutter the human review queue.
  let relationCount = 0;
  for (const member of input.cluster.members) {
    await createRelation({
      workspaceId: input.workspaceId,
      sourceKind: "fact",
      sourceId: member.id,
      targetKind: "fact",
      targetId: summary.id,
      relation: "derived_from",
      judgmentStatus: "judged",
      reason: "consolidated by REM-style cron",
      confidence: 0.85,
      markedByKind: "system",
      markedByModel: input.model,
      tx: input.tx,
    });
    relationCount += 1;
  }

  return { newFactId: summary.id, relationCount };
}

// Re-export the public LLM contract so the host adapter has a single
// import surface — `import { type LlmCallFn } from "@orchester/mnemosyne"`
// would otherwise force the host to dig into `recall/query-prep`.
export type { LlmCallFn } from "../recall/query-prep";

// Test seam — kept private (not re-exported from `./index.ts`).
// Exposed here so the unit test can pin the prompt structure without
// reaching into the module's internals.
export const __testing__ = {
  buildPrompt,
  SUMMARIZER_PROMPT,
  MAX_MEMBERS_IN_PROMPT,
};

/**
 * Mnemosyne v1.4 — single MnemoFact reference re-exported so callers
 * importing `consolidateCluster` get the canonical fact shape from
 * the same module.
 */
export type { MnemoFact } from "../primitives/fact";
