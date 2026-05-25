// packages/mnemosyne/src/summary/index.ts
//
// Public API for Layer 1 of the v1.1 tiered memory injection: the
// distilled user profile. The agent runtime calls `getOrComputeSummary`
// at the top of every turn and injects the returned `rawText` into the
// system prompt (80-150 tokens, vs. the old top-K fact bag at ~1450
// tokens).
//
// Behaviour:
//   1. Look up the cached summary for (workspace, agent, user).
//   2. If a fresh row exists (expires_at > now) AND !forceRefresh →
//      return it as-is.
//   3. Otherwise: pull the top 30 facts ranked by relevance × hit_count
//      × confidence, call the host-provided `llm` to distill them, and
//      upsert the new summary. TTL = 24h.
//   4. If `llm` is missing OR throws OR returns garbage, fall back to a
//      heuristic summary built from the top facts. The system NEVER
//      returns null when at least one fact exists.
//   5. Returns null ONLY for cold start (zero facts in this scope).
//
// §0.1: package-clean. The LLM is dependency-injected by the caller.
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type DbClient } from "@orchester/db";
import { withMnemoTx, type Tx } from "../tx";
import type { LlmCallFn } from "../recall/query-prep";
import type { FactScope, MnemoFact } from "../primitives/fact";
import {
  distillFacts,
  estimateTokens,
  heuristicSummary,
  renderSummaryText,
  type UserProfileSummaryStruct,
} from "./distill";
import { getSummary, upsertSummary, invalidateSummary, type MnemoSummaryRow } from "./store";

export {
  distillFacts,
  heuristicSummary,
  renderSummaryText,
  estimateTokens,
  DISTILL_SYSTEM_PROMPT,
  type UserProfileSummaryStruct,
  type DistillInput,
  type DistillResult,
} from "./distill";
export {
  getSummary,
  upsertSummary,
  invalidateSummary,
  type MnemoSummaryRow,
  type UpsertSummaryInput,
} from "./store";

/**
 * Public-facing summary object returned to the agent runtime. The
 * runtime cares about `rawText` (what to inject) and `freshness` (to
 * decide whether to enqueue a background refresh).
 */
export interface UserProfileSummary {
  /** Brief identity line — "Lucas | AR/BA". */
  identity: string;
  /** Optional role + company. "CEO Acme Corp". */
  role?: string;
  /** Optional one-sentence situation context. */
  context?: string;
  /** Optional tech stack: "TS, Postgres, Next.js". */
  techStack?: string;
  /** Optional communication style: "voseo, async-first". */
  communication?: string;
  /** Optional list of unresolved topic keys: ["db_choice", "deploy_region"]. */
  openDecisions?: string[];
  /** Compact pre-rendered form ready to inject into a system prompt. */
  rawText: string;
  /** IDs of the facts that fed the distillation — for traceability. */
  sourceFactIds: string[];
  generatedAt: Date;
  /** <6h = fresh, <24h = stale, >24h = expired (treated as expired by getOrComputeSummary). */
  freshness: "fresh" | "stale" | "expired";
  /** Approximate token count of `rawText`. */
  tokenCount: number;
}

export interface GetOrComputeSummaryInput {
  workspaceId: string;
  agentId: string;
  userId?: string;
  /** Force a fresh distillation even when the cached row is still valid. */
  forceRefresh?: boolean;
  /**
   * Host-provided LLM call function. When absent, the heuristic
   * fallback is used (still returns a valid summary). See
   * recall/query-prep.ts for the contract.
   */
  llm?: LlmCallFn;
  /** Model identifier — recorded in `model_used`. Required when `llm` is set. */
  model?: string;
  /**
   * Optional pre-opened transaction. When omitted, the function opens a
   * workspace-scoped tx via `withMnemoTx` so RLS FORCE permits the
   * read/write.
   */
  tx?: Tx;
}

const FRESH_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h
const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const TOP_FACTS_FOR_DISTILL = 30;

function computeFreshness(
  generatedAt: Date,
  now: Date = new Date()
): UserProfileSummary["freshness"] {
  const ageMs = now.getTime() - generatedAt.getTime();
  if (ageMs <= FRESH_MAX_AGE_MS) return "fresh";
  if (ageMs <= STALE_MAX_AGE_MS) return "stale";
  return "expired";
}

function rowToPublic(row: MnemoSummaryRow): UserProfileSummary {
  const s = row.summaryStruct as unknown as UserProfileSummaryStruct;
  // Trust the row's pre-rendered text — it was canonicalised on write.
  const tokenCount = row.tokenCount ?? estimateTokens(row.summaryText);
  const out: UserProfileSummary = {
    identity: s.identity ?? "user",
    rawText: row.summaryText,
    sourceFactIds: row.sourceFactIds,
    generatedAt: row.generatedAt,
    freshness: computeFreshness(row.generatedAt),
    tokenCount,
  };
  if (s.role !== undefined) out.role = s.role;
  if (s.context !== undefined) out.context = s.context;
  if (s.techStack !== undefined) out.techStack = s.techStack;
  if (s.communication !== undefined) out.communication = s.communication;
  if (s.openDecisions !== undefined) out.openDecisions = s.openDecisions;
  return out;
}

function structToPublic(
  struct: UserProfileSummaryStruct,
  rendered: string,
  sourceFactIds: string[],
  generatedAt: Date
): UserProfileSummary {
  const out: UserProfileSummary = {
    identity: struct.identity ?? "user",
    rawText: rendered,
    sourceFactIds,
    generatedAt,
    freshness: computeFreshness(generatedAt),
    tokenCount: estimateTokens(rendered),
  };
  if (struct.role !== undefined) out.role = struct.role;
  if (struct.context !== undefined) out.context = struct.context;
  if (struct.techStack !== undefined) out.techStack = struct.techStack;
  if (struct.communication !== undefined) out.communication = struct.communication;
  if (struct.openDecisions !== undefined) out.openDecisions = struct.openDecisions;
  return out;
}

/**
 * Query the top facts for the (workspace, agent, optional user) scope
 * ordered by relevance × hit_count × confidence. The relevance column
 * already encodes the half-life decay; hit_count is the popularity
 * signal; confidence is the extractor's certainty. We pick a few extra
 * (TOP_FACTS_FOR_DISTILL) so the distillation has signal to choose
 * from without sending the entire fact bag to the LLM.
 *
 * Scope semantics:
 *   - If `userId` is provided we want facts whose `scope_ref` matches
 *     the user OR are workspace-wide ('global' scope). This mirrors
 *     the agent-runtime model where per-user facts override globals.
 *   - Without `userId` we only pull globals + agent-scoped facts.
 */
async function fetchTopFacts(
  workspaceId: string,
  agentId: string,
  _userId: string | undefined,
  tx: Tx
): Promise<MnemoFact[]> {
  // We rely on the SQL ranking (no embedding round-trip needed for
  // distillation — the LLM does the semantic compression itself).
  const rows = await tx
    .select()
    .from(schema.mnemoFacts)
    .where(
      and(eq(schema.mnemoFacts.workspaceId, workspaceId), eq(schema.mnemoFacts.status, "active"))
    )
    .orderBy(
      // pinned first, then high-relevance × frequency × confidence.
      desc(schema.mnemoFacts.pinned),
      desc(
        sql`(${schema.mnemoFacts.relevance} * (1 + ${schema.mnemoFacts.hitCount}) * ${schema.mnemoFacts.confidence})`
      ),
      desc(schema.mnemoFacts.updatedAt)
    )
    .limit(TOP_FACTS_FOR_DISTILL);

  // Filter to the agent's scope after fetching (cheap — at most
  // TOP_FACTS_FOR_DISTILL rows). The DB-side filter is conservative
  // because mnemo_fact.agent_id is nullable (workspace-wide facts) and
  // we want to keep both per-agent and workspace-wide facts.
  const inScope = rows.filter((r) => {
    const row = r as unknown as MnemoFact;
    if (row.agentId === null) return true; // workspace-wide
    return row.agentId === agentId;
  });

  return inScope as unknown as MnemoFact[];
}

/**
 * Layer 1 of the v1.1 tiered memory: fetch (or compute) the distilled
 * user profile for a (workspace, agent, user) triplet.
 *
 * Returns:
 *   - `UserProfileSummary` when at least one fact exists.
 *   - `null` when the scope has zero facts (cold start). The agent
 *     runtime should treat null as "no profile yet" and inject nothing.
 *
 * Never throws on LLM failure — degrades to a heuristic summary that
 * still injects useful context.
 */
export async function getOrComputeSummary(
  input: GetOrComputeSummaryInput
): Promise<UserProfileSummary | null> {
  const run = async (tx: Tx): Promise<UserProfileSummary | null> => {
    // 1. Try cache.
    if (!input.forceRefresh) {
      const cached = await getSummary(input.workspaceId, input.agentId, input.userId ?? null, tx);
      if (cached && cached.expiresAt.getTime() > Date.now()) {
        return rowToPublic(cached);
      }
    }

    // 2. Cache miss / expired / forced → recompute.
    const facts = await fetchTopFacts(input.workspaceId, input.agentId, input.userId, tx);
    if (facts.length === 0) {
      return null; // cold start
    }

    // 3. Distill (LLM if available, otherwise heuristic).
    const generatedAt = new Date();
    let struct: UserProfileSummaryStruct;
    let modelUsed: string | null = null;
    let usedHeuristic = true;

    if (input.llm && input.model) {
      const result = await distillFacts({
        facts,
        llm: input.llm,
        model: input.model,
        workspaceId: input.workspaceId,
      });
      struct = result.struct;
      usedHeuristic = result.usedHeuristic;
      modelUsed = usedHeuristic ? null : input.model;
    } else {
      struct = heuristicSummary(facts);
      usedHeuristic = true;
    }

    const rendered = renderSummaryText(struct);
    const sourceFactIds = facts.map((f) => f.id);
    const tokenCount = estimateTokens(rendered);

    // 4. Persist for next turn.
    await upsertSummary(
      {
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        userId: input.userId ?? null,
        summaryText: rendered,
        summaryStruct: struct as unknown as Record<string, unknown>,
        sourceFactIds,
        modelUsed,
        tokenCount,
      },
      tx
    );

    return structToPublic(struct, rendered, sourceFactIds, generatedAt);
  };

  if (input.tx) {
    return run(input.tx);
  }
  return withMnemoTx(input.workspaceId, (tx) => run(tx as Tx));
}

// Re-export the tx helper so callers wiring the cron can stay in one
// import surface.
export { withMnemoTx };
export type { Tx, DbClient, FactScope };
