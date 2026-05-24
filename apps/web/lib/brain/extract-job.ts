// apps/web/lib/brain/extract-job.ts
//
// pg-boss handler for JOB_BRAIN_EXTRACT. Loads the conversation slice,
// calls extractFacts, persists each fact via store.createFact, updates
// brain_extraction_job state. Runs inside withCrossTenantAdmin so RLS
// FORCE is satisfied for the message read across workspaces.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { schema, type DbClient } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { appendAudit } from "@/lib/audit/log";
import { safeLogError } from "@/lib/safe-log";
import { resolveSmallTierModel } from "./model-resolve";
import { extractFacts } from "./extract";
import { createFact, withBrainTx } from "./store";
import { invalidateRecallCache } from "./recall";

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

      // FIX-001 (audit): resolve the workspace's small-tier chat model
      // explicitly. extract.ts no longer carries a `claude-haiku-4-5`
      // default — Mnemosyne Charter §25 forbids hardcoded model strings.
      // If no fast-tier chat provider is configured, throw — the job
      // will fail and pg-boss will surface it. FIX-009 (later commit)
      // upgrades this to the formal "skipped" tracking path.
      const resolved = await resolveSmallTierModel(payload.workspaceId, tx as unknown as Tx);
      if (!resolved) {
        throw new Error(
          "brain.extract: no fast-tier chat model configured for workspace " +
            `${payload.workspaceId} (mnemo.small_model unset)`
        );
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
      const facts = await extractFacts({
        workspaceId: payload.workspaceId,
        agentId: payload.agentId,
        conversationSlice: slice,
        model: resolved.modelId,
        tx: tx as unknown as Parameters<typeof extractFacts>[0]["tx"],
      });

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
    // Insert the tracking row (workspace-scoped — RLS FORCE on
    // brain_extraction_job requires app.workspace_id set).
    await withBrainTx(args.workspaceId, async (tx) => {
      await tx.insert(schema.brainExtractionJobs).values({
        id: jobId,
        workspaceId: args.workspaceId,
        conversationId: args.conversationId,
        state: "pending",
        messageCount: args.messageCount,
      });
    });

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
