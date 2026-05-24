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
//   - `verifyChain(ws.id)` uses the global pool (`getDb()`). It works
//     because `cron_admin` is granted BYPASSRLS at the role level (see
//     migration 0006), so RLS doesn't block its SELECTs on `audit_log`
//     even outside the GUC-tagged connection.
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
      // verifyChain uses getDb() internally; safe under cron_admin
      // because the role bypasses RLS.
      const result = await verifyChain(ws.id);
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
