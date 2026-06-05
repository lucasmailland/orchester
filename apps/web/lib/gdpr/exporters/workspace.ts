// apps/web/lib/gdpr/exporters/workspace.ts
//
// Workspace metadata exporter — entry point for the per-table dumpers.
// Every exporter follows the same shape:
//
//   export async function exportX(workspaceId, db) => Promise<unknown>
//
// `db` is REQUIRED (R2-C bonus #15). The caller — currently the GDPR
// export job — runs inside `withCrossTenantAdmin` and must thread the
// transaction handle so every SELECT lands on the same connection
// that has the `app.cross_tenant_admin` GUC set. The previous
// `db ?? getDb()` fallback masked future regressions where a refactor
// accidentally dropped the wrapper and the per-table reads silently
// hit FORCE RLS rejection.
//
// Returns the workspace row with sensitive lifecycle metadata stripped
// (restore tokens, suspended-by user, etc.) — the export is for the
// data owner, not for an admin reviewing operational state.
import "server-only";
import { eq } from "drizzle-orm";
import { schema, type DbClient } from "@orchester/db";
import type { CrossTenantTx } from "@/lib/tenant/cron";

export type ExporterDb = DbClient | CrossTenantTx;

export async function exportWorkspace(
  workspaceId: string,
  db: ExporterDb
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const ws = rows[0];
  if (!ws) return null;
  // Drop fields that are operational metadata (not user data) or that
  // would leak admin identities into the export.
  const {
    restoreToken: _restoreToken,
    restoreTokenConsumedAt: _restoreTokenConsumedAt,
    suspendedByUserId: _suspendedByUserId,
    deletedByUserId: _deletedByUserId,
    ...sanitised
  } = ws;
  return sanitised;
}
