import "server-only";
import { appendAuditSync } from "./audit/log";
import type { ActorKind, AuditEntryInput } from "./audit/types";

/**
 * Legacy AuditLogInput shape — preserved for the in-flight call sites
 * (api/sessions, api/me/delete, api/workspaces/[id]).
 *
 * Internally we now write to the new `audit_log` (hash-chain) table via
 * `appendAuditSync` — the legacy fields (resource/resourceId/before/after/
 * ip/userAgent) are mapped to the new actor/target/meta shape.
 *
 * Workspaces left as empty string ("") mean "user-global event with no
 * workspace context" (e.g. session.revoke_all). The new audit_log has a
 * NOT NULL workspace_id FK so we silently skip those writes — callers
 * that need to log user-global events should evolve to use a dedicated
 * security_event table (Task A.8). For now, drop silently to preserve
 * the prior fire-and-forget contract.
 *
 * @deprecated Migrate call sites to `appendAuditSync` from
 * `./audit/log` directly. This wrapper exists only to bridge the rename.
 */
export interface AuditLogInput {
  workspaceId: string;
  userId?: string | null | undefined;
  action: string;
  resource: string;
  resourceId?: string | undefined;
  before?: Record<string, unknown> | undefined;
  after?: Record<string, unknown> | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  actorKind?: ActorKind | undefined;
}

/**
 * Fire-and-forget audit log entry. Errors swallow silently.
 *
 * Bridges the legacy logAudit() shape to the new hash-chained
 * audit_log table. Skips writes with empty workspaceId until the new
 * security_event table lands in Task A.8.
 */
export async function logAudit(entry: AuditLogInput): Promise<void> {
  try {
    if (!entry.workspaceId) {
      // No workspace → no chain to extend. Drop silently for now; user-
      // global events will route to security_event in Task A.8.
      return;
    }
    const meta: Record<string, unknown> = {};
    if (entry.before !== undefined) meta["before"] = entry.before;
    if (entry.after !== undefined) meta["after"] = entry.after;
    const input: AuditEntryInput = {
      action: entry.action,
      actorUserId: entry.userId ?? null,
      actorKind: entry.actorKind ?? "user",
      actorIp: entry.ip ?? null,
      actorUserAgent: entry.userAgent ?? null,
      targetType: entry.resource,
      targetId: entry.resourceId ?? "",
      meta,
    };
    await appendAuditSync(entry.workspaceId, input);
  } catch (e) {
    const { safeLogError } = await import("./safe-log");
    safeLogError("[audit] failed to log:", e);
  }
}
