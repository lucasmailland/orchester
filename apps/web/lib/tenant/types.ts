import "server-only";
import type { Workspace, WorkspaceMember, WorkspaceMemberRole } from "@orchester/db";

/**
 * Tenant context resolved at the start of every request that touches
 * workspace-scoped data. Built by {@link withTenantContext} after the
 * caller's session + membership + workspace lifecycle have all been
 * validated.
 *
 * Once a context exists, every DB query inside the same transaction is
 * filtered by RLS using `app.workspace_id` GUC (see migration 0006).
 */
export interface TenantContext {
  workspace: Workspace;
  member: WorkspaceMember;
  role: WorkspaceMemberRole;
}

/**
 * Typed failure modes for the tenant resolver / context wrapper.
 *
 * Callers should translate these into HTTP responses:
 *   - no_tenant_in_request   → 400 (middleware should have set x-tenant-id)
 *   - workspace_not_found    → 404
 *   - no_session             → 401
 *   - not_a_member           → 403
 *   - workspace_suspended    → 423 (Locked) — billing/admin lockout
 *   - workspace_deleted      → 410 (Gone) — soft-deleted, may be restorable
 */
export class TenantContextError extends Error {
  constructor(
    public code:
      | "no_tenant_in_request"
      | "workspace_not_found"
      | "no_session"
      | "not_a_member"
      | "workspace_suspended"
      | "workspace_deleted"
  ) {
    super(`TenantContextError: ${code}`);
    this.name = "TenantContextError";
  }
}
