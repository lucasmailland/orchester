// apps/web/lib/gdpr/export-job.ts
//
// pg-boss worker that turns a `gdpr_export_job` row into a downloadable
// archive: pending → exporting → completed (or failed).
//
// The pipeline runs every per-table exporter sequentially, appends
// each JSON dump to an in-memory zip via `archiver` (level 9 deflate),
// hands the buffer to the storage adapter, then notifies the
// requester. Progress is published per-step so the UI can poll
// `/api/workspaces/[slug]/export/[jobId]`.
//
// Runs inside `withCrossTenantAdmin` so the job row updates and the
// per-table reads bypass FORCE RLS — we're operating across whatever
// workspace the requester targeted. Exporters receive `tx` so their
// SELECTs inherit the cross-tenant GUC.
//
// Why in-memory (not true streaming yet): `archiver` supports
// streaming output, but the storage adapters currently sink to a
// single PUT or `writeFile`. Splitting that surface is a follow-up;
// for the workspace sizes we ship today the buffer cost is small
// enough that the simpler code path wins. The buffer-shaped surface
// also keeps progress reporting linear and the failure mode clean
// (a partial zip never reaches storage).
import "server-only";
import { eq } from "drizzle-orm";
import archiver from "archiver";
import { schema } from "@orchester/db";
import { withCrossTenantAdmin, type CrossTenantTx } from "@/lib/tenant/cron";
import { safeLogError } from "@/lib/safe-log";
import { exportWorkspace } from "./exporters/workspace";
import { exportAgents } from "./exporters/agents";
import { exportConversations } from "./exporters/conversations";
import { exportMessages } from "./exporters/messages";
import { exportKnowledge } from "./exporters/knowledge";
import { uploadZip } from "./storage";
import { sendExportReadyEmail } from "./email";

/**
 * Pipeline definition. `weight` is the fraction of the 0..95 progress
 * window contributed by each step (we cap at 95 so the UI doesn't
 * flash 100% before the upload/email finishes). Weights must sum to
 * 100; the cap is applied after each accumulation.
 */
const STEPS: Array<{
  name: string;
  run: (workspaceId: string, db: CrossTenantTx) => Promise<unknown>;
  weight: number;
}> = [
  { name: "workspace.json", run: exportWorkspace, weight: 5 },
  { name: "agents.json", run: exportAgents, weight: 10 },
  { name: "conversations.json", run: exportConversations, weight: 30 },
  { name: "messages.json", run: exportMessages, weight: 45 },
  { name: "knowledge.json", run: exportKnowledge, weight: 10 },
];

export async function runExportJob(jobId: string): Promise<void> {
  await withCrossTenantAdmin("gdpr.export", async (tx) => {
    const jobRows = await tx
      .select()
      .from(schema.gdprExportJobs)
      .where(eq(schema.gdprExportJobs.id, jobId))
      .limit(1);
    const job = jobRows[0];
    if (!job) return;

    try {
      await tx
        .update(schema.gdprExportJobs)
        .set({ state: "exporting", progress: 0, startedAt: new Date() })
        .where(eq(schema.gdprExportJobs.id, jobId));

      // Build the zip in memory. archiver emits 'data' chunks as each
      // entry is finalised; we accumulate them so `uploadZip` gets a
      // single Buffer (matching the adapter surface today).
      const archive = archiver("zip", { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      archive.on("data", (c: Buffer) => chunks.push(c));
      const done = new Promise<void>((resolve, reject) => {
        archive.on("end", () => resolve());
        archive.on("error", (err: Error) => reject(err));
      });

      let progress = 0;
      for (const step of STEPS) {
        const data = await step.run(job.workspaceId, tx);
        archive.append(JSON.stringify(data, null, 2), { name: step.name });
        progress += step.weight;
        await tx
          .update(schema.gdprExportJobs)
          .set({ progress: Math.min(progress, 95) })
          .where(eq(schema.gdprExportJobs.id, jobId));
      }

      await archive.finalize();
      await done;

      const buffer = Buffer.concat(chunks);
      const key = `${job.workspaceId}/${jobId}.zip`;
      const { signedUrl, expiresAt } = await uploadZip(key, buffer);

      const ownerRows = await tx
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, job.requestedByUserId))
        .limit(1);
      const owner = ownerRows[0];
      if (owner) {
        await sendExportReadyEmail(owner.email, signedUrl, expiresAt);
      }

      await tx
        .update(schema.gdprExportJobs)
        .set({
          state: "completed",
          progress: 100,
          storageKey: key,
          signedUrl,
          signedUrlExpiresAt: expiresAt,
          bytesTotal: BigInt(buffer.byteLength),
          completedAt: new Date(),
        })
        .where(eq(schema.gdprExportJobs.id, jobId));
    } catch (e) {
      // B2.6 — log the ORIGINAL error first. If the state UPDATE below
      // also throws (e.g. the txn is in a "current transaction is
      // aborted" state after a prior failed statement), the catch-all
      // here would otherwise lose the root cause and surface only the
      // generic state-update error to the worker — making the failure
      // un-diagnosable from logs.
      safeLogError("[gdpr.export] job failed:", e);

      const msg = e instanceof Error ? e.message : String(e);
      try {
        await tx
          .update(schema.gdprExportJobs)
          .set({
            state: "failed",
            error: msg,
            retryCount: (job.retryCount ?? 0) + 1,
          })
          .where(eq(schema.gdprExportJobs.id, jobId));
      } catch (updateErr) {
        // We've already logged the root cause above; surface the
        // secondary failure separately so on-call sees both signals.
        safeLogError("[gdpr.export] state UPDATE to 'failed' also failed:", updateErr);
        // Re-throw the original error so pg-boss can apply retry policy.
        throw e;
      }
    }
  });
}
