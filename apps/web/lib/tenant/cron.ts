import "server-only";
import { sql } from "drizzle-orm";
import { getDb, type DbClient } from "@orchester/db";
import { safeLogWarn } from "../safe-log";

/**
 * Transaction handle exposed to cross-tenant admin callbacks.
 *
 * Same type as the argument drizzle passes to `db.transaction(async (tx) => …)`.
 * Callbacks MUST issue all queries that need to bypass tenant RLS on this
 * handle — running queries on the global `getDb()` instance pulls a different
 * pooled connection that does NOT carry the `app.cross_tenant_admin` GUC set
 * by this wrapper, and they will be blocked by FORCE ROW LEVEL SECURITY.
 */
export type CrossTenantTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * Run callback with the cross-tenant admin GUC set. Used by cron jobs and
 * background workers that LEGITIMATELY need to operate across multiple
 * workspaces (e.g. retention sweeps, audit chain verifier, orphan-run
 * reaper, GDPR/hard-delete reapers).
 *
 * The bypass is logged structured-JSON every time it's invoked so the
 * security audit trail captures every cross-tenant access.
 *
 * Phase C contract: the callback receives the transaction handle (`tx`)
 * that has the GUC applied. Callers MUST issue their queries against `tx`
 * (passing it down to helper functions as needed) instead of calling
 * `getDb()`. The set_config third argument `true` (is_local) scopes the
 * GUC to the current transaction, which is why the bypass only reaches
 * statements running on this exact connection.
 */
export async function withCrossTenantAdmin<T>(
  reason: string,
  fn: (tx: CrossTenantTx) => Promise<T>
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.cross_tenant_admin', 'true', true)`);
    safeLogWarn("[tenant] cross-tenant bypass:", {
      level: "info",
      msg: "tenant.cross_tenant_admin.bypass",
      reason,
    });
    return fn(tx);
  });
}
