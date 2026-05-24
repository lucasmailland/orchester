// apps/web/lib/brain/recall.ts
//
// searchBrain — hybrid recall over `brain_fact`. Scoring:
//   score = 0.50 * semantic    (pgvector cosine)
//         + 0.15 * recency     (true half-life: exp(-ln(2) * age_days / 30))
//         + 0.10 * frequency   (log(1 + hitCount) / log(100))
//         + 0.20 * relevance   (decay-adjusted, true half-life — see decay.ts)
//         + 0.05 * pin_bonus
//
// Recency and `relevance` MUST share the same decay model so they live on
// the same numeric scale when blended. Both use true half-life with H=30d:
// e-folding (exp(-t/H)) would give recency=0.368 at t=H while relevance
// (from decay.ts) gives 0.5 at the same age — and the linear blend above
// silently distorts.
//
// Cache: in-process LRU keyed by (workspaceId, agentId, scope, scopeRef,
// queryHash) with 60s TTL. Invalidated on create/forget/merge via
// cluster-cache.
import "server-only";
import { LRUCache } from "lru-cache";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { type DbClient } from "@orchester/db";
import { embedBrain } from "./embed";
import { markRecalled, withBrainTx } from "./store";
import type { BrainFact, FactScope, RecallHit } from "./types";

const RECALL_CACHE_MAX = 5_000;
const RECALL_CACHE_TTL_MS = 60_000;

const recallCache = new LRUCache<string, RecallHit[]>({
  max: RECALL_CACHE_MAX,
  ttl: RECALL_CACHE_TTL_MS,
});

function recallKey(parts: {
  workspaceId: string;
  agentId?: string | null;
  scope?: FactScope;
  scopeRef?: string | null;
  topK: number;
  query: string;
}): string {
  const q = createHash("sha256").update(parts.query).digest("hex").slice(0, 16);
  return [
    parts.workspaceId,
    parts.agentId ?? "*",
    parts.scope ?? "*",
    parts.scopeRef ?? "*",
    parts.topK,
    q,
  ].join("|");
}

export interface SearchBrainInput {
  workspaceId: string;
  query: string;
  agentId?: string;
  scope?: FactScope;
  scopeRef?: string;
  topK?: number;
  tx?: DbClient;
}

/**
 * Hybrid recall query. Returns ranked facts; updates hit_count + last_recalled_at
 * on the returned set (fire-and-forget, doesn't block the response).
 */
export async function searchBrain(input: SearchBrainInput): Promise<RecallHit[]> {
  const topK = Math.min(input.topK ?? 5, 20);
  const cacheK = recallKey({
    workspaceId: input.workspaceId,
    agentId: input.agentId ?? null,
    ...(input.scope ? { scope: input.scope } : {}),
    scopeRef: input.scopeRef ?? null,
    topK,
    query: input.query,
  });

  const cached = recallCache.get(cacheK);
  if (cached) return cached;

  // Embed query (workspace-keyed cache inside embedBrain).
  const [queryVec] = await embedBrain({
    workspaceId: input.workspaceId,
    texts: [input.query],
    ...(input.tx ? { tx: input.tx } : {}),
  });

  if (!queryVec) return [];
  const vecLiteral = `[${queryVec.join(",")}]`;

  // Run search inside a workspace-scoped txn so RLS FORCE allows the SELECT.
  const hits = await withBrainTx(input.workspaceId, async (tx) => {
    // Hybrid score expressed in SQL. Recency uses true half-life
    // (exp(-ln(2) * Δt / H)) so it stays on the same scale as the
    // `relevance` column, which is decayed by the cron via the same
    // formula. Frequency uses ln(1 + hit_count) / ln(100).
    const result = await tx.execute(sql`
      SELECT
        id, workspace_id, agent_id, scope, scope_ref, kind, subject,
        statement, confidence, pinned, relevance, hit_count,
        last_recalled_at, source_message_ids, metadata, status,
        merged_into_id, created_at, updated_at,
        (1.0 - (embedding <=> ${vecLiteral}::vector)) AS semantic,
        exp(-LN(2.0) * EXTRACT(EPOCH FROM (now() - created_at)) / (30.0 * 86400.0)) AS recency,
        (ln(1.0 + hit_count) / ln(100.0)) AS frequency,
        CASE WHEN pinned THEN 1.0 ELSE 0.0 END AS pin_bonus
      FROM brain_fact
      WHERE workspace_id = ${input.workspaceId}
        AND status = 'active'
        AND embedding IS NOT NULL
        ${input.agentId ? sql`AND (agent_id = ${input.agentId} OR agent_id IS NULL)` : sql``}
        ${input.scope ? sql`AND scope = ${input.scope}` : sql``}
        ${input.scopeRef ? sql`AND scope_ref = ${input.scopeRef}` : sql``}
      ORDER BY embedding <=> ${vecLiteral}::vector
      LIMIT ${topK * 3}
    `);

    type Row = {
      id: string;
      workspace_id: string;
      agent_id: string | null;
      scope: FactScope;
      scope_ref: string | null;
      kind: BrainFact["kind"];
      subject: string;
      statement: string;
      confidence: number;
      pinned: boolean;
      relevance: number;
      hit_count: number;
      last_recalled_at: string | null;
      source_message_ids: string[];
      metadata: Record<string, unknown>;
      status: BrainFact["status"];
      merged_into_id: string | null;
      created_at: string;
      updated_at: string;
      semantic: number;
      recency: number;
      frequency: number;
      pin_bonus: number;
    };

    // postgres-js exposes the rows directly via the result iterator
    const rows = result as unknown as Row[];

    const scored: RecallHit[] = rows.map((r) => {
      const semantic = Number(r.semantic);
      const recency = Number(r.recency);
      const frequency = Number(r.frequency);
      const relevance = Number(r.relevance);
      const pin = Number(r.pin_bonus);
      const score =
        0.5 * semantic + 0.15 * recency + 0.1 * frequency + 0.2 * relevance + 0.05 * pin;
      return {
        fact: {
          id: r.id,
          workspaceId: r.workspace_id,
          agentId: r.agent_id,
          scope: r.scope,
          scopeRef: r.scope_ref,
          kind: r.kind,
          subject: r.subject,
          statement: r.statement,
          confidence: Number(r.confidence),
          pinned: r.pinned,
          relevance: Number(r.relevance),
          hitCount: Number(r.hit_count),
          lastRecalledAt: r.last_recalled_at ? new Date(r.last_recalled_at) : null,
          sourceMessageIds: r.source_message_ids ?? [],
          embedding: null,
          metadata: r.metadata,
          status: r.status,
          mergedIntoId: r.merged_into_id,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
        },
        score,
        reasons: { semantic, recency, frequency, relevance, pin },
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  });

  recallCache.set(cacheK, hits);

  // Fire-and-forget bump for usage telemetry. Errors don't surface (next
  // recall tick will retry naturally if it fails).
  if (hits.length > 0) {
    const ids = hits.map((h) => h.fact.id);
    void withBrainTx(input.workspaceId, (tx) => markRecalled(input.workspaceId, ids, tx)).catch(
      () => {}
    );
  }

  return hits;
}

/** Drop the recall cache for a workspace. Called on create/forget/merge. */
export function invalidateRecallCache(workspaceId: string): void {
  for (const k of recallCache.keys()) {
    if (k.startsWith(`${workspaceId}|`)) recallCache.delete(k);
  }
}
