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
 *
 * ## Why `SET LOCAL ROLE app_user`?
 *
 * The 2026-05-24 final audit (P0 — see
 * `docs/specs/audits/2026-05-24-mnemosyne-v1-final-audit.md` §1.b)
 * found that the deployed `DATABASE_URL` connects as the `orchester`
 * Postgres role, which is `rolsuper=t, rolbypassrls=t`. Every Pattern
 * A policy on tenant-scoped tables is silently bypassed by the
 * deployed app: isolation relied entirely on application-level GUC
 * discipline.
 *
 * `SET LOCAL ROLE app_user` downgrades the transaction to a
 * non-BYPASSRLS role (migration 0007_postgres_roles.sql) so RLS+FORCE
 * actually applies, even when the connection role is elevated. The
 * LOCAL scope means the role reverts on COMMIT/ROLLBACK, so pooled
 * connections don't carry the elevation across callers. This is
 * layer 1 of a defense-in-depth fix; layer 2 is connecting production
 * directly as `app_user` (see ADR-0010 and the boot-time
 * `assertSafeDbRole` check in `apps/web/lib/db-role-check.ts`).
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
    // ── Layer 1 of defense-in-depth (audit P0, 2026-05-24): downgrade
    // the tx to `app_user` so RLS+FORCE actually applies even if the
    // connection role is BYPASSRLS. MUST precede every GUC set so
    // subsequent statements run under the non-elevated role.
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    // `true` => SET LOCAL semantics: GUCs auto-revert when the txn
    // ends, so they cannot leak across pooled connections.
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${session.user.id}, true)`);
    const ctx: TenantContext = { workspace: ws, member, role: member.role };
    return fn(ctx);
  });
}

/**
 * Like `withTenantContext` but skips the session/membership check —
 * for **system-authenticated** entry points (webhooks already validated
 * via channel secret, async workers, the LLM provider-key lookup from
 * inside `llmStream` after the parent tx has closed). The caller takes
 * responsibility for having authenticated the request out-of-band.
 *
 * Still sets `app_user` role + `app.workspace_id` GUC, so FORCE RLS
 * applies and the workspace boundary is enforced at the DB layer
 * regardless of where the call originated. Same Postgres tx semantics
 * as `withTenantContext`: per-call, GUCs auto-revert at commit.
 *
 * Returns the callback's result. Throws if `workspaceId` is empty.
 *
 * **Do not use** from user-facing API routes — they should use
 * `withTenantContext` so membership is verified.
 */
export async function withWorkspaceTx<T>(
  workspaceId: string,
  fn: (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) => Promise<T>
): Promise<T> {
  if (!workspaceId) throw new TenantContextError("workspace_not_found");
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
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
