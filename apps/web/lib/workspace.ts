import "server-only";
import { cache } from "react";
import { auth } from "./auth";
import { headers } from "next/headers";
import { getDb, schema } from "@orchester/db";
import { and, eq, sql } from "drizzle-orm";
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

/**
 * Phase D: a typed slug variant is invoked by the shell layout. To
 * keep `cache()` deduping per-request we keep two memoized functions:
 * the legacy no-arg version (any-workspace fallback) and the
 * slug-scoped version that returns null when the user isn't a member
 * of that specific slug.
 */
async function loadWorkspace(
  userId: string,
  slug: string | null
): Promise<{
  workspace: typeof schema.workspaces.$inferSelect;
  role: schema.WorkspaceMemberRole;
} | null> {
  const db = getDb();
  const result = await db
    .select({ workspace: schema.workspaces, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(
      slug
        ? and(eq(schema.workspaceMembers.userId, userId), eq(schema.workspaces.slug, slug))
        : eq(schema.workspaceMembers.userId, userId)
    )
    .limit(1);
  return result[0] ?? null;
}

async function applyTenantGucs(workspaceId: string, userId: string): Promise<void> {
  const db = getDb();
  // Phase B: set the GUCs that Phase C's FORCE-RLS policies key off.
  // SET LOCAL would require a transaction; set_config(..., is_local=false)
  // persists for the connection. Acceptable for the read-only fetches a
  // server component issues — mutating routes always use
  // withTenantContext, which wraps in a transaction.
  try {
    await db.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, false)`);
    await db.execute(sql`SELECT set_config('app.user_id', ${userId}, false)`);
    recordTenantContextSet();
  } catch (e) {
    safeLogError("[tenant] set_config failed:", e);
    recordTenantContextMissing("set-config-failed");
  }
}

export const getCurrentWorkspace = cache(async () => {
  const session = await getCurrentSession();
  if (!session) {
    recordTenantContextMissing("no-session");
    return null;
  }

  const ctx = await loadWorkspace(session.user.id, null);
  if (!ctx) {
    recordTenantContextMissing("no-membership");
    return null;
  }

  await applyTenantGucs(ctx.workspace.id, session.user.id);
  return ctx;
});

/**
 * Phase D variant: resolve a workspace by URL slug and verify the
 * caller is a member. Returns null both when the slug doesn't exist
 * AND when the user isn't a member, so the layout 404s either way
 * (we don't want to leak the existence of arbitrary workspaces).
 *
 * Sets the same GUCs as `getCurrentWorkspace` so downstream queries
 * remain tenant-scoped.
 */
export const getCurrentWorkspaceBySlug = cache(async (slug: string) => {
  const session = await getCurrentSession();
  if (!session) {
    recordTenantContextMissing("no-session");
    return null;
  }

  const ctx = await loadWorkspace(session.user.id, slug);
  if (!ctx) {
    recordTenantContextMissing("no-membership");
    return null;
  }

  await applyTenantGucs(ctx.workspace.id, session.user.id);
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
