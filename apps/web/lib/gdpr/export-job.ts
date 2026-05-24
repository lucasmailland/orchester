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
import { exportBrain } from "./exporters/brain";
import { uploadZip } from "./storage";
import { sendExportReadyEmail } from "./email";

/**
 * Hard cap on archive size before we refuse to upload. The current
 * in-memory pipeline (`archiver` → `Buffer.concat` → adapter PUT)
 * holds the full zip resident; on the worker pod this means a
 * multi-GB tenant export trips the Node heap limit and SIGKILLs the
 * process mid-pipeline (leaving the row stuck in `exporting` until
 * the watchdog flips it).
 *
 * 1 GiB matches what the largest tenants we ship today produce with
 * headroom; revisit this constant when the streaming-upload path
 * lands (then we can drop the limit since we won't be buffering).
 */
const MAX_ARCHIVE_BYTES = 1 * 1024 * 1024 * 1024;

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
  { name: "conversations.json", run: exportConversations, weight: 25 },
  { name: "messages.json", run: exportMessages, weight: 40 },
  { name: "knowledge.json", run: exportKnowledge, weight: 10 },
  { name: "brain.json", run: exportBrain, weight: 10 },
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
      //
      // Size guard: workspaces with millions of messages or hundreds of
      // ingested docs can produce multi-GB zips that OOM the worker
      // pod before we ever reach `uploadZip`. We track the running
      // byte total on every 'data' chunk and abort once it exceeds
      // `MAX_ARCHIVE_BYTES`. The job is then flipped to `failed` with
      // a deterministic `export_too_large` sentinel so ops / the UI
      // can distinguish "your tenant is too big for the current
      // pipeline" from a genuine bug.
      const archive = archiver("zip", { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      let bytesSoFar = 0;
      const exportTooLargeErr = new Error("export_too_large");
      archive.on("data", (c: Buffer) => {
        chunks.push(c);
        bytesSoFar += c.length;
        if (bytesSoFar > MAX_ARCHIVE_BYTES) {
          // Best-effort abort: lets `finalize()` settle via the 'error'
          // listener wired up below. The throw in the loop / post-loop
          // is the deterministic trigger; this just stops archiver from
          // continuing to allocate.
          try {
            archive.abort();
          } catch {
            // ignore — error path propagates via the loop guard
          }
        }
      });
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
        // If the size guard tripped during the append above, stop the
        // pipeline. The 'data' listener already called
        // `archive.abort()`; throwing here routes to the catch block
        // and flips the job state with the size-guard sentinel.
        if (bytesSoFar > MAX_ARCHIVE_BYTES) {
          throw exportTooLargeErr;
        }
      }

      await archive.finalize();
      await done;
      // Final belt-and-suspenders check: if `finalize()` emitted the
      // last chunks AFTER the loop already moved on, still trip the
      // failure path here instead of uploading a too-large artefact.
      if (bytesSoFar > MAX_ARCHIVE_BYTES) {
        throw exportTooLargeErr;
      }

      const buffer = Buffer.concat(chunks);
      const key = `${job.workspaceId}/${jobId}.zip`;
      const { signedUrl, expiresAt } = await uploadZip(key, buffer);

      const ownerRows = await tx
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, job.requestedByUserId))
        .limit(1);
      const owner = ownerRows[0];
      // Surface email send failures on the job row WITHOUT failing the
      // whole job — the artefact is on storage and the signed URL is
      // about to be persisted. We piggyback on the existing `error`
      // column (no schema migration here): the polling response shows
      // `error` alongside the download link, so a recipient sees
      // `email_send_failed: <provider message>` and knows to use the
      // URL directly instead of waiting for an inbox notification.
      let emailError: string | null = null;
      if (owner) {
        const r = await sendExportReadyEmail(owner.email, signedUrl, expiresAt);
        if (!r.ok && r.error) {
          emailError = `email_send_failed: ${r.error}`;
        }
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
          // null = email sent (or stub path), string = surface the
          // provider message so the user knows to use the URL directly.
          error: emailError,
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
