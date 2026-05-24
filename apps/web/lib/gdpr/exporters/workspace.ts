// apps/web/lib/gdpr/exporters/workspace.ts
//
// Workspace metadata exporter — entry point for the per-table dumpers.
// Every exporter follows the same shape:
//
//   export async function exportX(workspaceId, db?) => Promise<unknown>
//
// `db` is optional so the streaming worker can pass the same
// transaction handle that `withCrossTenantAdmin` opened. Without it
// the per-table SELECTs would land on a fresh pooled connection that
// doesn't carry the `app.cross_tenant_admin` GUC and FORCE RLS would
// block the read (the export bypasses tenant scope by definition —
// we're reading another workspace's data on behalf of its owner).
//
// Returns the workspace row with sensitive lifecycle metadata stripped
// (restore tokens, suspended-by user, etc.) — the export is for the
// data owner, not for an admin reviewing operational state.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import type { CrossTenantTx } from "@/lib/tenant/cron";

export type ExporterDb = DbClient | CrossTenantTx;

export async function exportWorkspace(
  workspaceId: string,
  db?: ExporterDb
): Promise<Record<string, unknown> | null> {
  const client = db ?? getDb();
  const rows = await client
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
