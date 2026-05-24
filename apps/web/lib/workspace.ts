import "server-only";
import { cache } from "react";
import { auth } from "./auth";
import { headers } from "next/headers";
import { getDb, schema } from "@orchester/db";
import { eq, sql } from "drizzle-orm";
import { safeLogError } from "./safe-log";
import { recordTenantContextSet, recordTenantContextMissing } from "./tenant/telemetry";

/**
 * `cache()` deduplicates calls within a single React request — if 5 server
 * components call getCurrentSession(), there's still only ONE auth lookup.
 * Big win because the shell layout + 3-4 loaders all hit this.
 */
export const getCurrentSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export const getCurrentWorkspace = cache(async () => {
  const session = await getCurrentSession();
  if (!session) {
    recordTenantContextMissing("no-session");
    return null;
  }

  const db = getDb();
  const result = await db
    .select({ workspace: schema.workspaces, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(eq(schema.workspaceMembers.userId, session.user.id))
    .limit(1);

  const ctx = result[0] ?? null;
  if (!ctx) {
    recordTenantContextMissing("no-membership");
    return null;
  }

  // Phase B: set the GUCs that Phase C's FORCE-RLS policies will key off.
  // SET LOCAL would require a transaction; using set_config(..., is_local=false)
  // persists for the connection. With pgbouncer/pooled connections the GUC
  // can leak across requests — that's acceptable in Phase B because RLS is
  // not yet FORCED, and Phase C will revisit pooling guarantees.
  try {
    await db.execute(sql`SELECT set_config('app.workspace_id', ${ctx.workspace.id}, false)`);
    await db.execute(sql`SELECT set_config('app.user_id', ${session.user.id}, false)`);
    recordTenantContextSet();
  } catch (e) {
    safeLogError("[tenant] set_config failed:", e);
    recordTenantContextMissing("set-config-failed");
  }

  return ctx;
});

export async function requireSession(redirectTo = "/en/login") {
  const session = await getCurrentSession();
  if (!session) {
    const { redirect } = await import("next/navigation");
    redirect(redirectTo);
  }
  return session;
}
