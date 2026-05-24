// apps/web/lib/audit/verify-job.ts
//
// Daily cron worker that walks every ACTIVE workspace's audit chain and
// records a `security_event` of severity `critical` for any break. The
// real PagerDuty/Slack alert is environment-driven (env var
// SECURITY_ALERT_WEBHOOK); for now we log to stderr so deployment can
// scrape it.
//
// Cross-tenant access pattern:
//   - The workspace iteration runs INSIDE the `withCrossTenantAdmin`
//     transaction (`tx`) so the `app.cross_tenant_admin` GUC bypasses
//     FORCE RLS on `workspace`.
//   - `verifyChain(ws.id, tx)` runs on the SAME transaction handle so
//     the GUC bypass propagates to `audit_log` SELECTs. Previously this
//     fell through to `getDb()` and relied on the cron_admin role being
//     BYPASSRLS — fragile because (a) any future re-pool grabs a fresh
//     connection without the GUC, and (b) the cron role's bypass might
//     be revoked or scoped down without anyone noticing the audit-log
//     dependency. Passing `tx` makes the dependency explicit.
//   - The `security_event` INSERT also runs on `tx` — same reasoning,
//     keeps the bypass auditable through the cron log.
import "server-only";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { verifyChain } from "./verify";

export async function runVerifyAllChains(): Promise<void> {
  await withCrossTenantAdmin("audit.verify_all_chains", async (tx) => {
    const workspaces = await tx
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.status, "active"));

    for (const ws of workspaces) {
      // B2.2 — pass `tx` so the chain SELECT runs under the same GUC
      // bypass we set above. Don't rely on the cron role's BYPASSRLS to
      // paper over a missing GUC propagation.
      const result = await verifyChain(ws.id, tx);
      if (result.brokenAt) {
        await tx.insert(schema.securityEvents).values({
          id: createId(),
          workspaceId: ws.id,
          eventType: "audit_chain.break_detected",
          severity: "critical",
          detail: {
            entryId: result.brokenAt.entryId,
            expectedHash: result.brokenAt.expectedHash,
            foundHash: result.brokenAt.foundHash,
          },
        });
        // PagerDuty/Slack webhook integration is environment-specific
        // (configured via env var SECURITY_ALERT_WEBHOOK in production).
        // For now we log to stderr; production deploy adds the webhook fetch.
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            level: "error",
            msg: "audit.chain_break_detected",
            workspaceId: ws.id,
            entriesChecked: result.entriesChecked,
            brokenAt: result.brokenAt,
            verifiedAt: result.verifiedAt.toISOString(),
          })
        );
      }
    }
  });
}
