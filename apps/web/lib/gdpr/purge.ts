// apps/web/lib/gdpr/purge.ts
//
// Daily reaper for GDPR export artefacts. A download link dies after 7
// days (`SIGNED_URL_TTL_DAYS`) but the file behind it used to live
// forever; this deletes it. Cross-tenant by definition, so it runs under
// `withCrossTenantAdmin` (same pattern as the stalled-export watchdog).
import "server-only";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { schema } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { safeLogError } from "@/lib/safe-log";
import { deleteExport, SIGNED_URL_TTL_MS } from "./storage";

/** Failed jobs (and any partial file) are kept this long for triage. */
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgeExpiredExports(now = new Date()): Promise<{ purged: number }> {
  let purged = 0;
  await withCrossTenantAdmin("gdpr.purge", async (tx) => {
    const t = schema.gdprExportJobs;

    const expired = await tx
      .select({ id: t.id, storageKey: t.storageKey })
      .from(t)
      .where(
        and(
          eq(t.state, "completed"),
          isNotNull(t.storageKey),
          lt(t.completedAt, new Date(now.getTime() - SIGNED_URL_TTL_MS))
        )
      );
    for (const job of expired) {
      try {
        await deleteExport(job.storageKey!);
        await tx.update(t).set({ storageKey: null }).where(eq(t.id, job.id));
        purged++;
      } catch (e) {
        // One bad row shouldn't kill the sweep; it is retried tomorrow.
        safeLogError(`[gdpr.purge] failed to purge job ${job.id}:`, e);
      }
    }

    const failed = await tx
      .select({ id: t.id, workspaceId: t.workspaceId })
      .from(t)
      .where(
        and(eq(t.state, "failed"), lt(t.createdAt, new Date(now.getTime() - FAILED_RETENTION_MS)))
      );
    for (const job of failed) {
      try {
        // A failed run may have left a partial upload under the deterministic key.
        await deleteExport(`${job.workspaceId}/${job.id}.zip`);
        await tx.delete(t).where(eq(t.id, job.id));
        purged++;
      } catch (e) {
        safeLogError(`[gdpr.purge] failed to purge failed job ${job.id}:`, e);
      }
    }
  });
  return { purged };
}
