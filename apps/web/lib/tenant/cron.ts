import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@orchester/db";
import { safeLogWarn } from "../safe-log";

/**
 * Run callback with the cross-tenant admin GUC set. Used by cron jobs and
 * background workers that LEGITIMATELY need to operate across multiple
 * workspaces (e.g. retention sweeps, audit chain verifier, orphan-run
 * reaper, GDPR/hard-delete reapers).
 *
 * The bypass is logged structured-JSON every time it's invoked so the
 * security audit trail captures every cross-tenant access. Phase C will
 * teach RLS policies to honor `app.cross_tenant_admin = 'true'`; for now
 * the GUC is set for observability + forward-compat.
 *
 * The set_config third argument `true` (is_local) scopes the GUC to the
 * current transaction, which is why this MUST run inside `db.transaction`.
 *
 * TODO(phase-c): the wrapped `fn()` today calls `getDb()` internally and
 * issues queries on a fresh connection — the LOCAL GUC set on `tx` does
 * NOT propagate there. This is acceptable now because Phase B does not
 * FORCE RLS. Phase C must refactor wrapped handlers to take `tx` (or
 * propagate the bypass via a contextual binding) so the GUC actually
 * reaches their queries.
 */
export async function withCrossTenantAdmin<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.cross_tenant_admin', 'true', true)`);
    safeLogWarn("[tenant] cross-tenant bypass:", {
      level: "info",
      msg: "tenant.cross_tenant_admin.bypass",
      reason,
    });
    return fn();
  });
}
