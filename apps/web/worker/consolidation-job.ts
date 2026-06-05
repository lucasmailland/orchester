// apps/web/worker/consolidation-job.ts
//
// Mnemosyne v1.4 — REM-style nightly consolidation cron.
//
// Once a week (Sunday 02:00 UTC, BEFORE the janitor's 03:00 dedup
// pass) we walk every workspace that has at least one embedded fact,
// cluster related facts (cosine >= 0.75, same subject + kind, size
// >= 4), and ask the workspace's cheap-tier LLM to write a one-
// sentence consolidated summary that supersedes them. Each member
// gets a `derived_from` edge pointing at the summary; the summary
// becomes the canonical recall hit going forward.
//
// Why before the janitor?
//   • Consolidation writes NEW facts.
//   • The janitor's dedup cron archives near-duplicates.
//   • If the janitor ran first, it could collapse a brand-new summary
//     with one of its members. Running consolidation FIRST means dedup
//     sees a stable graph: the summary stays distinct from members
//     because their statements diverge after summarisation, and the
//     `derived_from` edges document the relationship for audit.
//
// Spend cap + metering: this is a background AI dispatch but still
// counts against the workspace's AI budget. `assertWithinSpend` blocks
// before each LLM call; `recordAiUsage` is recorded after. The audit
// invariant in `scripts/audit-invariants.sh` enforces both checks
// adjacent to any file that names `llmCall(`.
//
// Graceful degradation: a workspace with no enabled LLM provider is
// skipped silently — extraction can't classify facts in that case
// either, so consolidation has nothing meaningful to summarise.
import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@orchester/db";
import {
  findConsolidationClusters,
  consolidateCluster,
  withMnemoTx,
  type ConsolidationCluster,
  type Tx,
} from "@mnemosyne/core";
import { llmCall } from "@/lib/llm-call";
import { assertWithinSpend } from "@/lib/cost-alerts";
import { recordAiUsage } from "@/lib/ai/run";
import { calculateChatCostUsd } from "@/lib/pricing";
import { safeLogError } from "@/lib/safe-log";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { resolveSmallTierModel } from "@/lib/brain/model-resolve";
import { CRON_JOBS, shouldRunForWorkspace, markRanForWorkspace } from "@/lib/mnemo/cron-policy";

/** Hard cap per run to keep the cron tick bounded even on a
 *  pathologically-large workspace catalogue. The next weekly tick
 *  picks up any workspace that didn't fit. */
const MAX_WORKSPACES_PER_RUN = 5000;

/** Per-workspace cap on clusters consolidated in one tick. Matches
 *  the default in `findConsolidationClusters`; the next tick picks
 *  up the long tail. Each cluster triggers ONE LLM call. */
const MAX_CLUSTERS_PER_WORKSPACE = 25;

interface ConsolidationStats {
  workspacesScanned: number;
  workspacesSkippedNoLlm: number;
  clustersConsolidated: number;
  factsLinked: number;
  workspacesFailed: number;
}

/**
 * Build a host-side `LlmCallFn` adapter that wraps `llmCall` with
 * spend-cap + metering. Each invocation:
 *   1. Asserts the workspace is still within budget.
 *   2. Calls the underlying LLM.
 *   3. Records the usage event (token count + costUsd).
 *
 * The audit invariant in `scripts/audit-invariants.sh` enforces both
 * `assertWithinSpend` AND `recordAiUsage` live in any file that names
 * `llmCall(`. This factory keeps both checks adjacent to the call.
 */
function makeMeteredLlm(workspaceId: string, model: string) {
  return async (args: { prompt: string; maxTokens?: number }): Promise<string> => {
    await assertWithinSpend(workspaceId);
    const result = await llmCall({
      workspaceId,
      model,
      systemPrompt: "You are a precise summariser of related memories.",
      messages: [{ role: "user", content: args.prompt }],
      temperature: 0.1,
      maxTokens: args.maxTokens ?? 200,
    });
    const tokensOut = result.tokensUsed ?? 0;
    const costUsd = calculateChatCostUsd(result.model, 0, tokensOut);
    await recordAiUsage({
      workspaceId,
      capability: "chat",
      model: result.model,
      tokensOut,
      tokensTotal: tokensOut,
      costUsd,
    });
    return result.content ?? "";
  };
}

/**
 * Consolidate one workspace inside a workspace-scoped transaction.
 * RLS+FORCE Pattern A applies because `withMnemoTx` sets the GUC +
 * downgrades the role.
 *
 * Returns the count of clusters consolidated + relations created, or
 * `null` only on hard failure (logged), so the cron loop can keep
 * going. A workspace without an LLM is reported via a sentinel value
 * so the caller can roll it into the `workspacesSkippedNoLlm` stat.
 */
async function consolidateWorkspace(
  workspaceId: string
): Promise<{ clusters: number; relations: number; skippedNoLlm: boolean } | null> {
  try {
    // Resolve the workspace's cheap-tier chat model OUTSIDE the
    // mnemo tx — `resolveSmallTierModel` reads from `ai_providers`
    // which lives outside the mnemo namespace and doesn't need the
    // GUC. Skip the workspace entirely if no LLM is configured.
    const resolved = await getDb().transaction(async (tx) =>
      resolveSmallTierModel(workspaceId, tx)
    );
    if (!resolved) {
      return { clusters: 0, relations: 0, skippedNoLlm: true };
    }

    const llm = makeMeteredLlm(workspaceId, resolved.modelId);

    return await withMnemoTx(workspaceId, async (tx: Tx) => {
      const clusters: ConsolidationCluster[] = await findConsolidationClusters({
        workspaceId,
        tx,
        maxClusters: MAX_CLUSTERS_PER_WORKSPACE,
      });
      if (clusters.length === 0) return { clusters: 0, relations: 0, skippedNoLlm: false };

      let consolidated = 0;
      let totalRelations = 0;
      for (const cluster of clusters) {
        try {
          // Per-cluster spend gate — a workspace that exhausts its
          // budget mid-run skips the rest of its clusters (rather
          // than failing the LLM call deep inside `consolidateCluster`).
          // The makeMeteredLlm wrapper also asserts on every call, but
          // we gate up-front so the cron logs are precise about WHY
          // a cluster was skipped.
          await assertWithinSpend(workspaceId);

          const out = await consolidateCluster({
            workspaceId,
            cluster,
            llm,
            model: resolved.modelId,
            tx,
          });
          // `consolidateCluster` returns an empty id when the LLM
          // produced an unusable response. We count those as
          // skipped (no relations created) and move on.
          if (out.newFactId) {
            consolidated += 1;
            totalRelations += out.relationCount;
          }
        } catch (err) {
          // A single cluster's failure shouldn't take down the
          // workspace's whole consolidation pass. Log and continue.
          safeLogError(
            `[consolidation-job] cluster failed (ws=${workspaceId}, subject=${cluster.subject}):`,
            err
          );
        }
      }
      return { clusters: consolidated, relations: totalRelations, skippedNoLlm: false };
    });
  } catch (err) {
    safeLogError(`[consolidation-job] failed (ws=${workspaceId}):`, err);
    return null;
  }
}

/**
 * Cron entry point — enumerate workspaces that have at least one
 * embedded mnemo_fact (Mode A workspaces don't participate; they
 * have no embeddings to cluster on), then consolidate each one
 * inside its own tx.
 *
 * Enumeration uses `withCrossTenantAdmin` (cron_admin BYPASSRLS) so
 * we can see across tenants for the catalogue read. The per-workspace
 * consolidate re-enters the tenant context inside `consolidateWorkspace`.
 */
export async function runConsolidationSweep(): Promise<ConsolidationStats> {
  const stats: ConsolidationStats = {
    workspacesScanned: 0,
    workspacesSkippedNoLlm: 0,
    clustersConsolidated: 0,
    factsLinked: 0,
    workspacesFailed: 0,
  };

  const workspaceRows = await withCrossTenantAdmin("mnemo.consolidation.enumerate", async (tx) => {
    const rows = await tx.execute(sql`
        SELECT DISTINCT workspace_id
        FROM mnemo_fact
        WHERE status = 'active' AND embedding IS NOT NULL
        LIMIT ${MAX_WORKSPACES_PER_RUN}
      `);
    return rows as unknown as Array<{ workspace_id: string }>;
  });

  stats.workspacesScanned = workspaceRows.length;
  for (const row of workspaceRows) {
    // Per-workspace periodicity gate. See lib/mnemo/cron-policy.ts.
    const allowed = await shouldRunForWorkspace(row.workspace_id, CRON_JOBS.remConsolidation);
    if (!allowed) {
      stats.workspacesSkippedNoLlm += 1;
      continue;
    }
    const result = await consolidateWorkspace(row.workspace_id);
    if (result === null) {
      stats.workspacesFailed += 1;
      continue;
    }
    if (result.skippedNoLlm) {
      stats.workspacesSkippedNoLlm += 1;
      continue;
    }
    stats.clustersConsolidated += result.clusters;
    stats.factsLinked += result.relations;
    await markRanForWorkspace(row.workspace_id, CRON_JOBS.remConsolidation);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "mnemo.consolidation.done", ...stats }));
  return stats;
}
