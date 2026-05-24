// apps/web/lib/gdpr/export-job.ts
//
// pg-boss worker that turns a `gdpr_export_job` row into a downloadable
// archive: pending → exporting → completed (or failed). Real archival
// uses a streaming zip writer (deferred to a follow-up); this skeleton
// dumps the workspace metadata JSON to satisfy the state machine and
// exercise storage + email plumbing.
//
// Runs inside `withCrossTenantAdmin` so the job row updates and the
// per-table reads bypass FORCE RLS — we're operating across whatever
// workspace the requester targeted.
import "server-only";
import { eq } from "drizzle-orm";
import { Readable } from "node:stream";
import { schema } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { exportWorkspace } from "./exporters/workspace";
import { uploadZip } from "./storage";
import { sendExportReadyEmail } from "./email";

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

      // Streaming export — pseudo-code: build the zip per table and
      // append to `Readable` as rows are paginated. For now we ship a
      // single JSON file with the workspace row.
      const ws = await exportWorkspace(job.workspaceId);
      const stub = Buffer.from(JSON.stringify({ workspace: ws }, null, 2));
      // Demonstrates the storage adapter accepts a Readable as well —
      // the streaming exporter will use this path:
      Readable.from(stub);

      const { signedUrl, expiresAt } = await uploadZip(`${job.workspaceId}/${jobId}.zip`, stub);

      const ownerRows = await tx
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, job.requestedByUserId))
        .limit(1);
      const owner = ownerRows[0];
      if (owner) await sendExportReadyEmail(owner.email, signedUrl, expiresAt);

      await tx
        .update(schema.gdprExportJobs)
        .set({
          state: "completed",
          progress: 100,
          signedUrl,
          signedUrlExpiresAt: expiresAt,
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
      const { safeLogError } = await import("../safe-log");
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
