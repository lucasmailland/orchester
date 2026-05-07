import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";

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
}

/**
 * Fire-and-forget audit log entry. Errors swallow silently.
 */
export async function logAudit(entry: AuditLogInput): Promise<void> {
  try {
    const db = getDb();
    await db.insert(schema.auditLogs).values({
      id: createId(),
      workspaceId: entry.workspaceId,
      userId: entry.userId ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (e) {
    // Don't crash the caller because of audit failure
    const { safeLogError } = await import("./safe-log");
    safeLogError("[audit] failed to log:", e);
  }
}
