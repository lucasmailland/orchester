import "server-only";
import { cache } from "react";
import { auth } from "./auth";
import { headers } from "next/headers";
import { getDb, schema } from "@orchester/db";
import { and, asc, eq } from "drizzle-orm";
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
 * the slug-scoped lookup (the only valid post-Phase-D entry point) and
 * the legacy any-workspace fallback (kept ORDER BY created_at so the
 * result is at least deterministic, but callers should prefer the slug
 * variant).
 *
 * IMPORTANT: this function returns workspace + role only. It does NOT
 * set any Postgres GUCs. The previous implementation called
 * `set_config(..., false)` on the pooled connection, which leaked GUCs
 * across requests (cross-tenant data leak post-FORCE). GUCs MUST now be
 * applied per-transaction via `withTenantContext` (see
 * `lib/tenant/context.ts`) — set_config with `is_local=true` inside a
 * `db.transaction(...)` auto-reverts on commit/rollback and cannot leak
 * across pooled connections.
 */
async function loadWorkspace(
  userId: string,
  slug: string | null
): Promise<{
  workspace: typeof schema.workspaces.$inferSelect;
  role: schema.WorkspaceMemberRole;
} | null> {
  const db = getDb();
  const query = db
    .select({ workspace: schema.workspaces, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(
      slug
        ? and(eq(schema.workspaceMembers.userId, userId), eq(schema.workspaces.slug, slug))
        : eq(schema.workspaceMembers.userId, userId)
    );
  // Deterministic order for the no-slug fallback path: pick the oldest
  // workspace the user belongs to. Without an ORDER BY postgres-js may
  // return rows in any order, which made `getCurrentWorkspace()`
  // non-deterministic.
  const result = slug
    ? await query.limit(1)
    : await query.orderBy(asc(schema.workspaces.createdAt)).limit(1);
  return result[0] ?? null;
}

/**
 * Resolves the caller's session → workspace context for SSR (shell
 * layout) and `requireAuth`.
 *
 * Does NOT set Postgres GUCs — see the comment on `loadWorkspace`.
 * Route handlers that query FORCED tenant tables MUST wrap their DB
 * work in `withTenantContext` (or an inline `db.transaction` + `SET
 * LOCAL app.workspace_id`) so RLS allows the read.
 */
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

  // Telemetry only — the actual GUC application happens per-transaction
  // via `withTenantContext`. Recording "set" here keeps the histogram
  // honest about how many requests resolved a tenant context, even
  // though the DB-level enforcement is delayed until the transaction.
  recordTenantContextSet();
  return ctx;
});

/**
 * Phase D variant: resolve a workspace by URL slug and verify the
 * caller is a member. Returns null both when the slug doesn't exist
 * AND when the user isn't a member, so the layout 404s either way
 * (we don't want to leak the existence of arbitrary workspaces).
 *
 * Same caveat as `getCurrentWorkspace`: no GUCs are applied here.
 * Server components / route handlers must scope DB reads via
 * `withTenantContext` (per query, transaction-local) — see B3.1 fix
 * notes for why session-level set_config was removed.
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

  recordTenantContextSet();
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
