// apps/web/lib/tenant/hard-delete-job.ts
//
// Phase E.5 — daily reaper that hard-deletes workspaces whose 30-day
// soft-delete window expired.
//
// Cross-tenant access pattern:
//   - All queries run on the `tx` handle provided by
//     `withCrossTenantAdmin` so the `app.cross_tenant_admin` GUC
//     bypass propagates to FORCE-RLS-enforced tables.
//   - A per-workspace advisory lock prevents two concurrent ticks (e.g.
//     in a redundant worker deployment) from racing on the same row.
//   - The DELETE cascades through every tenant FK; nothing to manually
//     scrub here.
import "server-only";
import { eq, lt, and, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import { withCrossTenantAdmin } from "./cron";

export async function runHardDeleteCron(): Promise<void> {
  await withCrossTenantAdmin("workspace.hard_delete_cron", async (tx) => {
    const now = new Date();
    const due = await tx
      .select({ id: schema.workspaces.id, slug: schema.workspaces.slug })
      .from(schema.workspaces)
      .where(
        and(eq(schema.workspaces.status, "deleted"), lt(schema.workspaces.deleteScheduledAt, now))
      );

    for (const ws of due) {
      // Advisory lock keyed by workspace id; releases at COMMIT.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ws.id}))`);

      // B2.5 — re-check status under the lock. Between the initial SELECT
      // above and the lock acquisition here, a restore() (or any other
      // status mutation) might have flipped this row to "active". The
      // original code would have CASCADE-deleted the just-restored
      // workspace and every dependent row. Re-fetching under the lock
      // closes the TOCTOU window: any concurrent restore() also takes
      // the per-workspace advisory lock (via appendAudit → audit log
      // chain), so by the time we own the lock we see the post-restore
      // status.
      const fresh = await tx
        .select({
          status: schema.workspaces.status,
          deleteScheduledAt: schema.workspaces.deleteScheduledAt,
        })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, ws.id))
        .limit(1);
      const cur = fresh[0];
      if (
        !cur ||
        cur.status !== "deleted" ||
        !cur.deleteScheduledAt ||
        cur.deleteScheduledAt >= now
      ) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            level: "info",
            msg: "workspace.hard_delete.skipped",
            reason: "status_changed_under_lock",
            workspaceId: ws.id,
            slug: ws.slug,
            currentStatus: cur?.status ?? "missing",
          })
        );
        continue;
      }

      // CASCADE wipes every dependent row (members, agents, conversations…).
      await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          level: "info",
          msg: "workspace.hard_delete",
          workspaceId: ws.id,
          slug: ws.slug,
        })
      );
    }
  });
}
