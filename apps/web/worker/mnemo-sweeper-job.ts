// apps/web/worker/mnemo-sweeper-job.ts
//
// Mnemosyne v1.1 #20 — message-grain backfill sweeper.
//
// MOTIVATION
// ----------
// `shouldExtract()` is a strict heuristic prefilter tuned for low
// false-positive rate (saves ~80% of extraction LLM calls). Its flip side:
// turns with no POSITIVE_INDICATOR regex match are silently dropped,
// even if they carry learnable preferences or decisions. Once a
// conversation's extraction job is marked 'skipped', there is no second
// chance — the turn is lost for ever.
//
// This sweeper is the second-chance pass. It walks `brain_extraction_job`
// rows whose `skip_reason` is a prefilter-class reason, re-examines the
// underlying messages with `shouldExtractBackfill()` (a more permissive
// variant of the prefilter that drops the indicator-match gate), and
// re-enqueues qualifying conversations for a fresh LLM extraction run.
//
// CURSOR DESIGN
// -------------
// A single pg-boss singleton run carries a cursor payload:
//
//   { cursor: string | null }
//
// `cursor` is the last processed `conversation_id`. On every call the
// sweeper fetches up to BATCH_SIZE conversations whose id is
// GREATER than the cursor (alphabetical order — cuid2 IDs are
// monotonically increasing, so this is a stable forward scan). After
// the batch it self-re-enqueues with the updated cursor. When there are
// no more qualifying conversations the job exits without re-enqueueing,
// ending the sweep. The weekly cron kick-starts the cycle with cursor=null.
//
// SKIPPING RULES (per conversation)
// ----------------------------------
//   1. memory_learning_paused = true → skip (sensitivity gate)
//   2. Any brain_extraction_job for this conversation in state
//      'done', 'pending', or 'running' → skip (already handled)
//   3. shouldExtractBackfill(messages) returns false → skip (below
//      even the relaxed threshold — e.g. empty or no-dialogue turn)
//   4. No agent_id on the conversation → skip (cannot construct
//      a valid BrainExtractPayload without agent_id)
//
// §0.1: `server-only` — this file must never be imported by client
// bundles. It uses cross-tenant admin helpers that bypass RLS.
import "server-only";
import { sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { shouldExtractBackfill } from "@orchester/mnemosyne";
import { safeLogError } from "@/lib/safe-log";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { withBrainTx } from "@/lib/brain/store";
import { resolveSmallTierModel } from "@/lib/brain/model-resolve";
import { enqueue, JOB_MNEMO_SWEEPER, JOB_BRAIN_EXTRACT } from "@/lib/queue";
import type { BrainExtractPayload } from "@/lib/brain/extract-job";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Conversations processed per sweep run before re-enqueue with new cursor. */
const BATCH_SIZE = 100;

/** Messages fetched per conversation for the backfill prefilter check.
 *  Matches `MAX_MESSAGES_PER_SLICE` in extract-job.ts so the backfill
 *  sees the same window the extractor will process. */
const MAX_MESSAGES_PER_PREFILTER = 20;

/**
 * `brain_extraction_job.skip_reason` values produced by the strict
 * prefilter (`shouldExtract`). These are the only skips that warrant a
 * second chance — skips for infrastructure reasons (no_llm_provider,
 * memory_learning_paused) are intentional and must not be retried here.
 */
const PREFILTER_SKIP_REASONS = [
  "no_indicator",
  "no_content_tokens",
  "too_short",
  "all_short_messages",
  "no_dialogue",
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** pg-boss job data for a sweep batch run. */
export interface SweeperPayload {
  /** cuid2 conversation_id of the last processed row; null = start from
   *  the beginning. Used as an exclusive lower bound for the next page. */
  cursor: string | null;
}

export interface SweeperStats {
  conversationsScanned: number;
  conversationsSkipped: number;
  conversationsReenqueued: number;
  /** True when more rows remain past this batch (next run will continue). */
  hasMore: boolean;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface BackfillCandidate {
  conversationId: string;
  workspaceId: string;
  agentId: string | null;
}

/**
 * Find up to `limit` conversations that were skipped due to the strict
 * prefilter and don't yet have any successful/in-flight extraction.
 * Uses the cross-tenant admin bypass so we can scan across workspaces.
 *
 * Cursor `afterConvId` is an exclusive lower bound (id > afterConvId)
 * over the cuid2 primary key; NULL means start from the beginning.
 */
async function findBackfillCandidates(
  afterConvId: string | null,
  limit: number
): Promise<BackfillCandidate[]> {
  return withCrossTenantAdmin("mnemo.sweeper.scan", async (tx) => {
    const afterClause = afterConvId ? sql`AND bej.conversation_id > ${afterConvId}` : sql``;

    const rows = (await tx.execute(sql`
      SELECT DISTINCT ON (bej.conversation_id)
        bej.conversation_id,
        bej.workspace_id,
        c.agent_id
      FROM brain_extraction_job bej
      JOIN conversation c ON c.id = bej.conversation_id
      WHERE bej.state = 'skipped'
        AND bej.skip_reason = ANY(${sql.param(Array.from(PREFILTER_SKIP_REASONS))}::text[])
        AND c.memory_learning_paused = false
        ${afterClause}
        -- Exclude conversations already handled or in-flight
        AND NOT EXISTS (
          SELECT 1 FROM brain_extraction_job bej2
          WHERE bej2.conversation_id = bej.conversation_id
            AND bej2.state IN ('done', 'pending', 'running', 'deferred_provider_outage')
        )
      ORDER BY bej.conversation_id ASC
      LIMIT ${limit}
    `)) as unknown as Array<{
      conversation_id: string;
      workspace_id: string;
      agent_id: string | null;
    }>;

    return rows.map((r) => ({
      conversationId: r.conversation_id,
      workspaceId: r.workspace_id,
      agentId: r.agent_id,
    }));
  });
}

/**
 * Fetch messages for a conversation (cross-tenant admin bypass).
 * Returns only what the extractor will see (same `limit` cap).
 */
async function fetchMessages(
  conversationId: string
): Promise<Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>> {
  return withCrossTenantAdmin("mnemo.sweeper.fetch-msgs", async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT role, content
      FROM message
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at ASC
      LIMIT ${MAX_MESSAGES_PER_PREFILTER}
    `)) as unknown as Array<{ role: string; content: string }>;

    return rows.map((r) => ({
      role: r.role as "user" | "assistant" | "system" | "tool",
      content: r.content,
    }));
  });
}

/**
 * Create a fresh `brain_extraction_job` row and enqueue the extractor.
 * Mirrors the logic in `enqueueExtractJob` from extract-job.ts so the
 * re-attempt job is indistinguishable from a first-attempt job to the
 * extractor worker.
 *
 * Returns true when the job was enqueued, false when the workspace has
 * no LLM provider (skip recorded but not queued — same as the original
 * extract path).
 */
async function reenqueueConversation(candidate: BackfillCandidate): Promise<boolean> {
  if (!candidate.agentId) {
    // Cannot construct a valid extraction payload without an agent.
    return false;
  }

  const jobId = `bext_${createId()}`;
  let enqueued = false;

  try {
    const skipped = await withBrainTx(candidate.workspaceId, async (tx) => {
      // Respect the same Mode-A short-circuit used at original enqueue time.
      // If no LLM is configured, record a skipped row and bail — no point
      // flooding the queue with jobs that will always fail.
      const resolved = await resolveSmallTierModel(
        candidate.workspaceId,
        tx as Parameters<Parameters<typeof withBrainTx>[1]>[0]
      );
      if (!resolved) {
        await tx.insert(schema.brainExtractionJobs).values({
          id: jobId,
          workspaceId: candidate.workspaceId,
          conversationId: candidate.conversationId,
          state: "skipped",
          skipReason: "no_llm_provider",
          // Backfill jobs don't know the exact current message count cheaply;
          // 0 is a safe sentinel (the extractor fetches messages itself).
          messageCount: 0,
          factsProduced: 0,
          completedAt: new Date(),
        });
        return true; // skipped = true
      }

      await tx.insert(schema.brainExtractionJobs).values({
        id: jobId,
        workspaceId: candidate.workspaceId,
        conversationId: candidate.conversationId,
        state: "pending",
        // Backfill marker — makes it easy to filter in the health dashboard.
        skipReason: null,
        messageCount: 0,
      });
      return false; // skipped = false
    });

    if (skipped) return false;

    await enqueue<BrainExtractPayload>(
      JOB_BRAIN_EXTRACT,
      {
        jobId,
        workspaceId: candidate.workspaceId,
        conversationId: candidate.conversationId,
        agentId: candidate.agentId,
      },
      {
        retryLimit: 1,
        expireInSeconds: 5 * 60,
        // Use a different singleton key than the original so a concurrent
        // first-attempt job and a backfill re-attempt don't clobber each other.
        singletonKey: `brain.extract.backfill:${candidate.conversationId}`,
      }
    );
    enqueued = true;
  } catch (err) {
    safeLogError(`[mnemo.sweeper] re-enqueue failed (conv=${candidate.conversationId}):`, err);
  }

  return enqueued;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Run one batch of the message-grain backfill sweep.
 *
 * Processes up to `BATCH_SIZE` prefilter-skipped conversations starting
 * from `payload.cursor`. For each qualifying conversation it:
 *   1. Fetches messages
 *   2. Runs `shouldExtractBackfill()` (permissive threshold)
 *   3. Re-enqueues `JOB_BRAIN_EXTRACT` when the check passes
 *
 * After the batch, if `hasMore` is true the caller MUST re-enqueue
 * `JOB_MNEMO_SWEEPER` with the updated cursor so the next batch runs.
 * The weekly cron kicks off the first batch with `cursor: null`.
 */
export async function runSweeperBatch(payload: SweeperPayload): Promise<SweeperStats> {
  const stats: SweeperStats = {
    conversationsScanned: 0,
    conversationsSkipped: 0,
    conversationsReenqueued: 0,
    hasMore: false,
  };

  let lastConvId = payload.cursor;

  try {
    const candidates = await findBackfillCandidates(payload.cursor, BATCH_SIZE);
    stats.conversationsScanned = candidates.length;
    stats.hasMore = candidates.length === BATCH_SIZE;

    for (const candidate of candidates) {
      lastConvId = candidate.conversationId;

      // Fetch messages and run the backfill prefilter check.
      let msgs: Awaited<ReturnType<typeof fetchMessages>>;
      try {
        msgs = await fetchMessages(candidate.conversationId);
      } catch (err) {
        safeLogError(
          `[mnemo.sweeper] message fetch failed (conv=${candidate.conversationId}):`,
          err
        );
        stats.conversationsSkipped += 1;
        continue;
      }

      const { yes } = shouldExtractBackfill(msgs);
      if (!yes) {
        stats.conversationsSkipped += 1;
        continue;
      }

      const queued = await reenqueueConversation(candidate);
      if (queued) {
        stats.conversationsReenqueued += 1;
      } else {
        stats.conversationsSkipped += 1;
      }
    }
  } catch (err) {
    safeLogError("[mnemo.sweeper] batch scan failed:", err);
    // Return partial stats — the cron will retry next week.
    return stats;
  }

  // Self-re-enqueue when there are more pages to sweep.
  if (stats.hasMore && lastConvId) {
    try {
      await enqueue<SweeperPayload>(
        JOB_MNEMO_SWEEPER,
        { cursor: lastConvId },
        {
          // No delay — process immediately after this batch completes.
          retryLimit: 0,
          expireInSeconds: 10 * 60,
          // Singleton so concurrent cron ticks don't spawn two parallel
          // sweeps at the same cursor position.
          singletonKey: `mnemo.sweeper:${lastConvId}`,
        }
      );
    } catch (err) {
      safeLogError("[mnemo.sweeper] self-re-enqueue failed:", err);
      // Not fatal — the next weekly cron will restart from the beginning.
      stats.hasMore = false;
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: "info",
      msg: "mnemo.sweeper.batch.done",
      cursor: payload.cursor,
      nextCursor: lastConvId,
      ...stats,
    })
  );

  return stats;
}
