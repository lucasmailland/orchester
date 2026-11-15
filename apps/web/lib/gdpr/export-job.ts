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
// Streaming pipeline (post-2026-05-26, Phase F.5): `archiver` writes
// straight into a PassThrough that the storage adapter consumes —
// S3 via `@aws-sdk/lib-storage`'s multipart `Upload`, filesystem via
// `pipeline(stream, createWriteStream(...))`. Peak memory is bounded
// by archiver's deflate buffer + a single multipart part (5–10 MB)
// instead of the entire archive, so multi-GB tenant exports no longer
// OOM the worker.
//
// Size guard semantics unchanged: a 'data' listener tracks bytes
// written and aborts the stream once `MAX_ARCHIVE_BYTES` trips.
// Partial uploads are cleaned up by the adapter's abort path (S3
// multipart `AbortMultipartUpload`; filesystem `unlink`).
import "server-only";
import { Transform } from "node:stream";
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

      // Streaming pipeline: archiver writes into a Transform that
      // counts bytes and forwards them downstream, where the storage
      // adapter consumes them. Peak memory is bounded by the
      // archiver's deflate buffer + one multipart part (S3) or the
      // OS write buffer (filesystem), independent of the archive size.
      //
      // ## Why a Transform, not a 'data' listener
      //
      // Original F.5 attached a `'data'` listener on `archive` for
      // byte counting. That listener flips the Readable into
      // **flowing mode immediately** — bytes start emitting on the
      // next tick. But the adapter's `pipeline(archive, sink)` call
      // sits behind 5 dynamic `await import(...)` calls, so the
      // first `archive.append()` produced bytes BEFORE the pipe
      // target existed. Those bytes were consumed by the byte-
      // counter and never reached disk; the resulting zip was
      // missing its local file header and yauzl threw "invalid
      // central directory file header signature". (Observed during
      // the v1.0 GA test sweep: first 4 bytes were `[8d 90 3d 4f]`
      // instead of `[50 4b 03 04]`.)
      //
      // A `Transform` in default (paused) mode buffers internally
      // via _transform until a downstream consumer reads. So
      // `archive.pipe(counter)` captures every byte from archive
      // into counter's internal queue, and the adapter's later
      // `pipeline(counter, sink)` drains the queue without losing
      // the early chunks.
      //
      // ## Size guard
      //
      // `_transform` counts bytes per chunk. When the total trips
      // `MAX_ARCHIVE_BYTES` we abort archive (so it stops producing)
      // AND fail the transform with `export_too_large` (so the
      // downstream pipeline rejects). The adapter's catch path
      // cancels the upload (S3 multipart `AbortMultipartUpload` or
      // filesystem unlink). The outer try/catch flips the job state
      // to `failed` with the sentinel.
      const archive = archiver("zip", { zlib: { level: 9 } });
      let bytesSoFar = 0;
      let aborted = false;
      const exportTooLargeErr = new Error("export_too_large");

      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytesSoFar += chunk.length;
          if (bytesSoFar > MAX_ARCHIVE_BYTES && !aborted) {
            aborted = true;
            // Stop archive from producing more bytes; the abort fires
            // an 'error' on the source side which propagates through
            // the pipe to this Transform anyway. Best-effort: ignore
            // any throw from abort() itself.
            try {
              archive.abort();
            } catch {
              // ignore — error path propagates via callback below
            }
            // Fail this Transform → downstream pipeline rejects →
            // adapter cleans up → uploadZip rejects → outer catch
            // flips the job to failed with the sentinel message.
            return callback(exportTooLargeErr);
          }
          // Pass the chunk through to the downstream consumer.
          callback(null, chunk);
        },
      });

      // Defense-in-depth: a no-op 'error' listener on `counter`
      // prevents Node's default "uncaughtException on emit('error')
      // with zero listeners" behaviour during the brief window
      // between `archive.pipe(counter)` and the adapter's internal
      // `pipeline(counter, sink)` subscribing its own listener. The
      // adapter's listener still receives the error (Node allows
      // multiple listeners on EventEmitters), so the failure
      // propagation contract is preserved.
      counter.on("error", () => {
        /* swallow — downstream pipeline() handles real propagation */
      });
      // Wire archive → counter. Errors from archive propagate to
      // counter via the pipe; if archive emits 'error' the counter
      // destroys with the same error, and any downstream pipeline
      // sees the failure.
      archive.pipe(counter);

      // Kick off the upload concurrently with the archiver. The adapter
      // begins consuming bytes from `counter` as soon as the first
      // chunk lands; we append per-step JSON below and await this
      // promise after `finalize()`. Critically: counter is in default
      // (paused) mode and buffers bytes in its internal queue until
      // the adapter's pipeline() picks them up, so no chunks are lost
      // during the adapter's import-resolution window.
      const key = `${job.workspaceId}/${jobId}.zip`;
      const uploadPromise = uploadZip(key, counter);

      let progress = 0;
      for (const step of STEPS) {
        const data = await step.run(job.workspaceId, tx);
        archive.append(JSON.stringify(data, null, 2), { name: step.name });
        progress += step.weight;
        await tx
          .update(schema.gdprExportJobs)
          .set({ progress: Math.min(progress, 95) })
          .where(eq(schema.gdprExportJobs.id, jobId));
        if (bytesSoFar > MAX_ARCHIVE_BYTES) {
          throw exportTooLargeErr;
        }
      }

      await archive.finalize();
      // Belt + suspenders on the final byte count once finalize has
      // flushed the central directory.
      if (bytesSoFar > MAX_ARCHIVE_BYTES) {
        throw exportTooLargeErr;
      }
      const { signedUrl, expiresAt } = await uploadPromise;
      const bytesTotal = bytesSoFar;

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
          // SEC-9: never persist the signed URL — a DB dump would leak
          // 7-day-live download links. Regenerate per request in the
          // polling route instead. signedUrl is kept in the email only.
          bytesTotal: BigInt(bytesTotal),
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
