import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@orchester/db";
import { resolveById } from "./resolve";
import { checkMembership } from "./membership";
import { TenantContextError, type TenantContext } from "./types";
import { getCurrentSession } from "@/lib/workspace";

/**
 * Run a callback inside a Postgres transaction with tenant context
 * GUCs set. RLS policies (migration 0008+) consult these GUCs via
 * `current_workspace_id()` / `app.user_id` to enforce isolation, so
 * any DB call made *inside* the callback is automatically tenant-
 * scoped without the caller having to remember a WHERE clause.
 *
 * Validates, in order:
 *   1. workspaceId looks plausible (non-empty)
 *   2. the workspace actually exists
 *   3. there's an authenticated session
 *   4. the session user is a member of the workspace
 *
 * Throws TenantContextError on any failure. Callers translate these
 * into HTTP responses (see lib/tenant/types.ts for the mapping).
 *
 * The transaction is per-call, so concurrent withTenantContext calls
 * for different workspaces never share a connection / never see each
 * other's GUC state. set_config(..., true) makes the values local to
 * the transaction so they're auto-cleared on commit/rollback.
 */
export async function withTenantContext<T>(
  workspaceId: string,
  fn: (ctx: TenantContext) => Promise<T>
): Promise<T> {
  if (!workspaceId) throw new TenantContextError("workspace_not_found");

  const ws = await resolveById(workspaceId);
  if (!ws) throw new TenantContextError("workspace_not_found");

  const session = await getCurrentSession();
  if (!session) throw new TenantContextError("no_session");

  const member = await checkMembership(session.user.id, workspaceId);
  if (!member) throw new TenantContextError("not_a_member");

  const db = getDb();
  return db.transaction(async (tx) => {
    // `true` => SET LOCAL semantics: GUCs auto-revert when the txn
    // ends, so they cannot leak across pooled connections.
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${session.user.id}, true)`);
    const ctx: TenantContext = { workspace: ws, member, role: member.role };
    return fn(ctx);
  });
}

/**
 * Read tenant context implicitly from the request. Edge middleware is
 * responsible for resolving the URL slug → workspace id and stamping
 * it as `x-tenant-id` on the forwarded headers (Phase D); route
 * handlers consume it via this helper.
 *
 * Throws TenantContextError("no_tenant_in_request") if the middleware
 * did not run (e.g. someone hit an unprotected internal route).
 */
export async function requireTenantContext(): Promise<TenantContext> {
  // Dynamic import: `next/headers` is a Server Component / Route
  // Handler only API. Static import would break unit tests that
  // import this file purely for the withTenantContext export.
  const { headers } = await import("next/headers");
  const h = await headers();
  const workspaceId = h.get("x-tenant-id");
  if (!workspaceId) throw new TenantContextError("no_tenant_in_request");
  return withTenantContext(workspaceId, async (ctx) => ctx);
}
