import "server-only";
import { assertCan, type Action } from "@/lib/rbac";
import { requireTenantContext } from "./context";
import type { TenantContext } from "./types";

/**
 * Combined tenant + RBAC guard.
 *
 * Use at the top of every mutating route handler. Returns the
 * resolved TenantContext so the handler can read workspace metadata
 * (id, role, etc.) without a second lookup.
 *
 * Throws:
 *   - TenantContextError if there's no session / no tenant / not a
 *     member.
 *   - ForbiddenError if the caller's role lacks `action`.
 *
 * Callers wrap in their existing try/catch — http-util converts both
 * error classes into the right 4xx response.
 */
export async function requireAction(action: Action): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  assertCan(ctx.role, action);
  return ctx;
}
