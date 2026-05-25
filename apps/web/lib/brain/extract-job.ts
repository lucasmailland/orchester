// apps/web/lib/brain/extract-job.ts
//
// pg-boss handler for JOB_BRAIN_EXTRACT. Loads the conversation slice,
// calls extractFacts, persists each fact via store.createFact, updates
// brain_extraction_job state. Runs inside withCrossTenantAdmin so RLS
// FORCE is satisfied for the message read across workspaces.
//
// v1.1 (circuit breaker): when the LLM provider is unhealthy (rolling
// window of failures crosses the threshold), the job is DEFERRED with
// `state='deferred_provider_outage'` + a `defer_until` timestamp. The
// pg-boss send uses `startAfter` so the worker re-picks the conversation
// once the cool-down elapses. Outage-period conversations are NOT lost.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { schema, type DbClient } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { appendAudit } from "@/lib/audit/log";
import { safeLogError } from "@/lib/safe-log";
import {
  getProviderHealth,
  recordProviderResult,
  resolveActiveMode,
  resolveConfiguredMode,
} from "@orchester/mnemosyne";
import { resolveSmallTierModel } from "./model-resolve";
import { extractFacts } from "./extract";
import { createFact, withBrainTx } from "./store";
import { invalidateRecallCache } from "./recall";

/**
 * Cool-down before pg-boss re-picks a deferred job. Keep small enough
 * that a flapping provider doesn't strand the workspace's memory, large
 * enough that we don't burn through retry budget while the provider is
 * objectively down.
 */
const DEFER_WAIT_MS = 5 * 60 * 1000; // 5 minutes

type Tx = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export interface BrainExtractPayload {
  jobId: string; // brain_extraction_job.id
  workspaceId: string;
  conversationId: string;
  agentId: string;
}

const MAX_MESSAGES_PER_SLICE = 20;

export async function runBrainExtractJob(payload: BrainExtractPayload): Promise<void> {
  // Mark running. Read messages with cross-tenant bypass — extraction
  // is admin-initiated (cron / inbound event), legitimate cross-tenant
  // access through cron_admin role.
  let factsProduced = 0;
  try {
    await withCrossTenantAdmin("brain.extract", async (tx) => {
      // 1. Pull conversation messages
      const msgs = await tx
        .select({
          id: schema.messages.id,
          role: schema.messages.role,
          content: schema.messages.content,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, payload.conversationId))
        .orderBy(asc(schema.messages.createdAt))
        .limit(MAX_MESSAGES_PER_SLICE);

      if (msgs.length === 0) {
        await tx
          .update(schema.brainExtractionJobs)
          .set({
            state: "done",
            factsProduced: 0,
            completedAt: new Date(),
          })
          .where(eq(schema.brainExtractionJobs.id, payload.jobId));
        return;
      }

      // FIX-001 + FIX-009 (audit, M-A-005): resolve the workspace's
      // small-tier chat model. If none is configured the workspace is
      // in Mode A — mark the job 'skipped' with reason 'no_llm_provider'
      // and return without calling llmCall. pg-boss does NOT retry; the
      // tracking row is the durable record.
      const resolved = await resolveSmallTierModel(payload.workspaceId, tx as unknown as Tx);
      if (!resolved) {
        await tx
          .update(schema.brainExtractionJobs)
          .set({
            state: "skipped",
            skipReason: "no_llm_provider",
            completedAt: new Date(),
          })
          .where(eq(schema.brainExtractionJobs.id, payload.jobId));
        return;
      }

      // v1.1 circuit breaker: even though a provider IS configured, the
      // provider may be unhealthy right now (outage, rate limit, spend
      // cap recently hit, network partition). Skip-vs-defer here matters
      // because deferred jobs keep the conversation in queue for retry,
      // skipped jobs lose it forever. We compute the active mode from
      // the configured capabilities + the live health snapshot; if the
      // active mode isn't 'C' we defer for DEFER_WAIT_MS and let pg-boss
      // re-enqueue the job after the cool-down. RetryAfter equivalent:
      // pg-boss `enqueue` with `startAfterSeconds`.
      const health = getProviderHealth(payload.workspaceId);
      const configured = resolveConfiguredMode({
        hasLLM: true,
        // We don't track embed status in the simple resolver for the job
        // gate — extraction is LLM-only. If a chat provider IS configured
        // (resolved truthy) we treat configured mode as 'C' for the
        // purpose of detecting LLM outage.
        hasEmbed: true,
      });
      const { active, degraded, reason } = await resolveActiveMode({
        workspaceId: payload.workspaceId,
        configured,
        health,
      });
      // Extraction requires the chat provider. Active mode 'A' or 'B'
      // (chat unavailable) → defer. Mode 'C' (even degraded with
      // embedding down) is fine — extraction is LLM-only.
      const chatDown = active === "A" || active === "B";
      if (degraded && chatDown) {
        const deferUntil = new Date(Date.now() + DEFER_WAIT_MS);
        await tx
          .update(schema.brainExtractionJobs)
          .set({
            state: "deferred_provider_outage",
            skipReason: reason ?? "chat_unavailable",
            deferUntil,
          })
          .where(eq(schema.brainExtractionJobs.id, payload.jobId));
        // Re-enqueue at the cool-down boundary. Same payload, fresh
        // pg-boss job; the brain_extraction_job row stays the durable
        // record (worker reads it back by `jobId` on the next run).
        try {
          const { enqueue, JOB_BRAIN_EXTRACT } = await import("@/lib/queue");
          await enqueue<BrainExtractPayload>(
            JOB_BRAIN_EXTRACT,
            {
              jobId: payload.jobId,
              workspaceId: payload.workspaceId,
              conversationId: payload.conversationId,
              agentId: payload.agentId,
            },
            {
              startAfterSeconds: Math.ceil(DEFER_WAIT_MS / 1000),
              retryLimit: 1,
              expireInSeconds: 15 * 60,
              singletonKey: `brain.extract:defer:${payload.conversationId}`,
            }
          );
        } catch (enqErr) {
          safeLogError("[brain.extract] failed to re-enqueue deferred job:", enqErr);
        }
        return;
      }

      await tx
        .update(schema.brainExtractionJobs)
        .set({
          state: "running",
          startedAt: new Date(),
        })
        .where(eq(schema.brainExtractionJobs.id, payload.jobId));

      const slice = msgs.map((m) => `${m.role}: ${m.content}`).join("\n");

      // 2. Extract facts via LLM (uses workspace's ai_provider key —
      // assertWithinSpend in llmCall will cap on budget exhaustion).
      // Pass tx so getProviderKey reads inside the cross-tenant txn.
      //
      // Wrap with circuit-breaker bookkeeping: each call records a
      // health sample for the 'chat' provider. After N failures within
      // the rolling window, subsequent jobs see `active != C` above and
      // get deferred instead of repeatedly burning retries.
      let facts;
      try {
        facts = await extractFacts({
          workspaceId: payload.workspaceId,
          agentId: payload.agentId,
          conversationSlice: slice,
          model: resolved.modelId,
          tx: tx as unknown as Parameters<typeof extractFacts>[0]["tx"],
        });
        recordProviderResult(payload.workspaceId, "chat", true);
      } catch (llmErr) {
        recordProviderResult(payload.workspaceId, "chat", false);
        throw llmErr;
      }

      // 3. Persist each fact in a workspace-scoped txn (separate from
      // the cross-tenant admin txn — facts must be created with
      // app.workspace_id set so RLS write WITH CHECK is satisfied).
      const messageIds = msgs.map((m) => m.id);
      await withBrainTx(payload.workspaceId, async (factTx) => {
        for (const f of facts) {
          try {
            await createFact({
              workspaceId: payload.workspaceId,
              agentId: payload.agentId,
              scope: "conversation",
              scopeRef: payload.conversationId,
              kind: f.kind,
              subject: f.subject,
              statement: f.statement,
              confidence: f.confidence,
              sourceMessageIds: messageIds,
              tx: factTx,
            });
            factsProduced++;
          } catch (e: unknown) {
            // Likely unique violation (dedup) — fine, skip.
            const msg = e instanceof Error ? e.message : String(e);
            if (!/duplicate key|uniq_brain_fact/.test(msg)) {
              safeLogError("[brain.extract] createFact failed:", e);
            }
          }
        }
      });

      // 4. Mark done + drop recall cache for the workspace so the new
      // facts surface on the next recall.
      await tx
        .update(schema.brainExtractionJobs)
        .set({
          state: "done",
          factsProduced,
          completedAt: new Date(),
        })
        .where(eq(schema.brainExtractionJobs.id, payload.jobId));

      invalidateRecallCache(payload.workspaceId);

      // 5. Single audit row per extraction batch (B-T8: don't spam
      // per-fact, the source_message_ids cover that).
      appendAudit(payload.workspaceId, {
        action: "brain.fact.extracted",
        actorUserId: null,
        actorKind: "system",
        targetType: "conversation",
        targetId: payload.conversationId,
        meta: {
          agentId: payload.agentId,
          factsProduced,
          jobId: payload.jobId,
        },
      });
    });
  } catch (e: unknown) {
    safeLogError("[brain.extract] job failed:", e);
    // Best-effort: mark job failed so the UI doesn't spin forever.
    // Use withBrainTx so the UPDATE satisfies RLS FORCE.
    try {
      await withBrainTx(payload.workspaceId, async (failTx) => {
        await failTx
          .update(schema.brainExtractionJobs)
          .set({
            state: "failed",
            error: e instanceof Error ? e.message : String(e),
            completedAt: new Date(),
          })
          .where(eq(schema.brainExtractionJobs.id, payload.jobId));
      });
    } catch (updErr) {
      safeLogError("[brain.extract] failed to record failure:", updErr);
    }
    throw e; // let pg-boss retry once
  }
}

/**
 * Enqueue a Brain extraction job for a conversation. Called from
 * `lib/channels/router.ts persistAssistantTurn` (after the user turn
 * committed). Fire-and-forget — the agent reply already shipped.
 *
 * Uses `singletonKey` so concurrent enqueues for the same conversation
 * collapse into one job (we'll extract incrementally on the next tick).
 */
export async function enqueueBrainExtract(args: {
  workspaceId: string;
  conversationId: string;
  agentId: string;
  messageCount: number;
}): Promise<void> {
  const jobId = `bext_${createId()}`;

  try {
    // FIX-009 (audit, M-A-005): Mode A short-circuit at enqueue time.
    // If the workspace has no fast-tier chat model wired up, insert a
    // tracking row with `state='skipped'` + `skip_reason='no_llm_provider'`
    // and skip the pg-boss enqueue entirely. This prevents the worker
    // from polling a job that would always no-op and avoids retry spam.
    const skipped = await withBrainTx(args.workspaceId, async (tx) => {
      const resolved = await resolveSmallTierModel(args.workspaceId, tx);
      if (!resolved) {
        await tx.insert(schema.brainExtractionJobs).values({
          id: jobId,
          workspaceId: args.workspaceId,
          conversationId: args.conversationId,
          state: "skipped",
          skipReason: "no_llm_provider",
          messageCount: args.messageCount,
          factsProduced: 0,
          completedAt: new Date(),
        });
        return true;
      }
      // Insert the tracking row (workspace-scoped — RLS FORCE on
      // brain_extraction_job requires app.workspace_id set).
      await tx.insert(schema.brainExtractionJobs).values({
        id: jobId,
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        state: "pending",
        messageCount: args.messageCount,
      });
      return false;
    });
    if (skipped) return;

    // Enqueue pg-boss job (singleton on conversation id)
    const { enqueue, JOB_BRAIN_EXTRACT } = await import("@/lib/queue");
    await enqueue<BrainExtractPayload>(
      JOB_BRAIN_EXTRACT,
      {
        jobId,
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        agentId: args.agentId,
      },
      {
        retryLimit: 1,
        expireInSeconds: 5 * 60,
        singletonKey: `brain.extract:${args.conversationId}`,
      }
    );
  } catch (e) {
    safeLogError("[brain.extract] enqueue failed:", e);
  }
}
