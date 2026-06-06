// apps/web/worker/summary-job.ts
//
// Daily distillation cron for Mnemosyne v1.1 Layer 1 (the pre-computed
// user-profile summary). Runs once per (workspace, agent, user)
// triplet that has had recent fact activity, calls the LLM through
// the workspace's small-tier chat model, and persists a fresh
// `mnemo_summary` row.
//
// Why this exists: the per-turn `getOrComputeSummary()` path already
// recomputes lazily on cache miss. The cron is purely an OPTIMISATION
// — it refreshes hot triplets before the cache expires so the
// foreground request never has to wait for an LLM round-trip. The job
// is idempotent and degrades gracefully when no LLM is configured
// (skips silently — the foreground heuristic fallback still works).
//
// Spend cap + metering: this is a background AI dispatch but still
// counts against the workspace's AI budget. `assertWithinSpend` blocks
// before the call; `recordAiUsage` is recorded after. The audit
// invariant in `scripts/audit-invariants.sh` requires both calls in
// the same file as `llmCall(`.
import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@orchester/db";
import { getOrComputeSummary, type UserProfileSummary } from "@/lib/dead-mnemo-stubs";
import { llmCall } from "@/lib/llm-call";
import { assertWithinSpend } from "@/lib/cost-alerts";
import { recordAiUsage } from "@/lib/ai/run";
import { calculateChatCostUsd } from "@/lib/pricing";
import { safeLogError } from "@/lib/safe-log";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { resolveSmallTierModel } from "@/lib/brain/model-resolve";
import { CRON_JOBS, shouldRunForWorkspace, markRanForWorkspace } from "@/lib/mnemo/cron-policy";

/** Look back this many days for "recent fact activity" gating. */
const RECENT_FACT_WINDOW_DAYS = 7;

/** Hard cap on triplets per run — protects against runaway costs on huge workspaces. */
const MAX_TRIPLETS_PER_RUN = 500;

/**
 * Per-invocation payload (cron path passes `{}`; the manual on-demand
 * enqueue path can target a single triplet by passing the full set).
 */
export interface SummaryJobPayload {
  /** Single-triplet mode — refresh just this one summary. */
  workspaceId?: string;
  agentId?: string;
  userId?: string | null;
}

interface JobLike {
  data: SummaryJobPayload;
}

/**
 * Build a host-side `LlmCallFn` adapter that wraps `llmCall` with
 * spend-cap + metering. Each invocation:
 *   1. Asserts the workspace is still within budget.
 *   2. Calls the underlying LLM.
 *   3. Records the usage event (token count + costUsd).
 *
 * The audit invariant in `scripts/audit-invariants.sh` enforces that
 * any file naming `llmCall(` also calls `assertWithinSpend` and
 * `recordAiUsage` in the same file. This factory keeps both checks
 * adjacent to the call site.
 */
function makeMeteredLlm(workspaceId: string, model: string) {
  return async (args: { prompt: string; maxTokens?: number }): Promise<string> => {
    await assertWithinSpend(workspaceId);
    const result = await llmCall({
      workspaceId,
      model,
      systemPrompt: "You are a precise JSON-only assistant.",
      messages: [{ role: "user", content: args.prompt }],
      temperature: 0.1,
      maxTokens: args.maxTokens ?? 400,
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
 * Refresh a single triplet's summary. Wraps every fault path so an
 * individual failure can't take down the rest of the cron run.
 */
async function refreshTriplet(
  workspaceId: string,
  agentId: string,
  userId: string | null
): Promise<UserProfileSummary | null> {
  try {
    // Spend-cap gate at the triplet boundary as well — a workspace
    // that exhausted its budget mid-run skips the rest of its
    // refreshes (rather than failing the LLM call deep inside
    // distill). assertWithinSpend throws on cap-exceeded.
    await assertWithinSpend(workspaceId);

    // Resolve the workspace's cheap-tier chat model. Pass null when
    // the workspace has no LLM configured — getOrComputeSummary will
    // produce a heuristic summary in that case (still useful to
    // refresh the cache so the foreground turn doesn't pay for it).
    const resolved = await getDb().transaction(async (tx) => {
      return resolveSmallTierModel(workspaceId, tx);
    });

    const llmCallFn = resolved ? makeMeteredLlm(workspaceId, resolved.modelId) : undefined;

    // forceRefresh=true so we always produce a fresh summary even if
    // the cached row hasn't expired yet — the cron's job IS to
    // pre-warm the cache.
    const summary = await getOrComputeSummary({
      workspaceId,
      agentId,
      ...(userId !== null ? { userId } : {}),
      forceRefresh: true,
      ...(llmCallFn && resolved ? { llm: llmCallFn, model: resolved.modelId } : {}),
    });
    return summary;
  } catch (err) {
    safeLogError(
      `[summary-job] refresh failed (ws=${workspaceId} agent=${agentId} user=${userId ?? "_global"}):`,
      err
    );
    return null;
  }
}

/**
 * Cron entry point — scans for (workspace, agent, user) triplets with
 * at least one fact created in the last RECENT_FACT_WINDOW_DAYS days
 * and refreshes each one's distilled summary.
 *
 * Cross-tenant by design (sweeps every active workspace). Uses
 * `withCrossTenantAdmin` to discover the triplets, then refreshes each
 * inside a workspace-scoped tx (the underlying `getOrComputeSummary`
 * handles `withMnemoTx` itself).
 */
export async function runSummaryRefreshCron(): Promise<{
  workspacesScanned: number;
  tripletsRefreshed: number;
  tripletsSkipped: number;
}> {
  const stats = { workspacesScanned: 0, tripletsRefreshed: 0, tripletsSkipped: 0 };

  // 1. Enumerate hot triplets — workspaces that produced facts
  //    recently. Cross-tenant read via cron_admin (BYPASSRLS).
  const triplets = await withCrossTenantAdmin("summary.refresh.enumerate", async (tx) => {
    const rows = await tx.execute(sql`
      SELECT DISTINCT
        f.workspace_id   AS workspace_id,
        f.agent_id       AS agent_id,
        COALESCE(NULLIF(f.scope_ref, ''), '') AS scope_ref,
        f.scope          AS scope
      FROM mnemo_fact f
      WHERE f.status = 'active'
        AND f.agent_id IS NOT NULL
        AND f.created_at > now() - (${RECENT_FACT_WINDOW_DAYS}::int * interval '1 day')
      LIMIT ${MAX_TRIPLETS_PER_RUN}
    `);
    return rows as unknown as Array<{
      workspace_id: string;
      agent_id: string;
      scope_ref: string;
      scope: string;
    }>;
  });

  const seenWorkspaces = new Set<string>();
  // Per-workspace periodicity gate cache. We hit `shouldRunForWorkspace`
  // at most once per workspace per tick (not once per triplet) so a
  // big workspace doesn't pay the cost N times. See
  // apps/web/lib/mnemo/cron-policy.ts.
  const allowedCache = new Map<string, boolean>();
  for (const t of triplets) {
    seenWorkspaces.add(t.workspace_id);

    let allowed = allowedCache.get(t.workspace_id);
    if (allowed === undefined) {
      allowed = await shouldRunForWorkspace(t.workspace_id, CRON_JOBS.summaryRefresh);
      allowedCache.set(t.workspace_id, allowed);
    }
    if (!allowed) {
      stats.tripletsSkipped += 1;
      continue;
    }

    // user_id for the summary maps to scope_ref ONLY for employee/team
    // scoped facts — for global/conversation scope, we treat user as
    // null (workspace-level summary).
    const userId =
      (t.scope === "employee" || t.scope === "team") && t.scope_ref.length > 0 ? t.scope_ref : null;
    const summary = await refreshTriplet(t.workspace_id, t.agent_id, userId);
    if (summary) {
      stats.tripletsRefreshed += 1;
    } else {
      stats.tripletsSkipped += 1;
    }
  }
  // Mark `last_run_at` once per workspace whose triplets we processed
  // — not in the loop, so a long catalogue doesn't spam writes.
  for (const wsId of seenWorkspaces) {
    if (allowedCache.get(wsId)) {
      await markRanForWorkspace(wsId, CRON_JOBS.summaryRefresh);
    }
  }
  stats.workspacesScanned = seenWorkspaces.size;

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "summary.refresh.done", ...stats }));
  return stats;
}

/**
 * pg-boss handler — invoked per scheduled tick and per ad-hoc enqueue.
 * Routes single-triplet payloads to `refreshTriplet`; treats empty
 * payloads as the cron-wide sweep.
 */
export async function summaryJobHandler(job: JobLike): Promise<void> {
  const { workspaceId, agentId, userId } = job.data ?? {};
  if (workspaceId && agentId) {
    await refreshTriplet(workspaceId, agentId, userId ?? null);
    return;
  }
  await runSummaryRefreshCron();
}
