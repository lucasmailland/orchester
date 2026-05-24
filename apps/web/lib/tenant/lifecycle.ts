// apps/web/lib/tenant/lifecycle.ts
//
// Workspace lifecycle transitions (soft-delete / restore / suspend /
// unsuspend) and a small predicate helper for read paths.
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §4 + §5
// Plan reference: Task A.22.
//
// Every transition:
//   1. Writes the new status to `workspace`.
//   2. Calls `invalidateCache` so the in-process resolver picks up the
//      change immediately (otherwise the next request could load a
//      cached "active" row and let traffic in).
//   3. Appends a tamper-evident audit entry via `appendAudit`.
//
// `softDelete` mints a one-shot restore token so an operator can undo a
// soft-delete within 30 days without re-issuing a row. The token is
// burned on first successful `restore`.
import "server-only";
import { eq } from "drizzle-orm";
import { randomBytes, timingSafeEqual } from "crypto";
import { getDb, schema } from "@orchester/db";
import type { Workspace } from "@orchester/db";
import { appendAudit } from "@/lib/audit/log";
import { invalidateCache } from "./resolve";

const RESTORE_WINDOW_DAYS = 30;

/**
 * Constant-time string equality. timingSafeEqual itself throws on
 * differing-length inputs (which would itself leak length via the throw
 * vs no-throw path), so we short-circuit on length before calling it.
 * The length short-circuit is OK because the restore-token format is
 * fixed (`rst_` + 32 base64url chars) — an attacker cannot mint shorter
 * tokens that look syntactically valid.
 *
 * Exported (not the default — callers should keep using restore()) so
 * the unit suite can pin behaviour without touching DB fixtures.
 */
export function tokensMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function softDelete(
  workspaceId: string,
  opts: { userId: string; reason?: string }
): Promise<{ restoreToken: string; restoreUntil: Date }> {
  const db = getDb();
  const restoreToken = `rst_${randomBytes(24).toString("base64url")}`;
  const now = new Date();
  const restoreUntil = new Date(now.getTime() + RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  await db
    .update(schema.workspaces)
    .set({
      status: "deleted",
      deletedAt: now,
      deletedByUserId: opts.userId,
      deleteScheduledAt: restoreUntil,
      restoreToken,
      restoreTokenConsumedAt: null,
    })
    .where(eq(schema.workspaces.id, workspaceId));

  invalidateCache(workspaceId);

  appendAudit(workspaceId, {
    action: "workspace.soft_delete",
    actorUserId: opts.userId,
    actorKind: "user",
    targetType: "workspace",
    targetId: workspaceId,
    meta: {
      reason: opts.reason ?? null,
      restoreUntil: restoreUntil.toISOString(),
    },
  });

  return { restoreToken, restoreUntil };
}

export async function restore(
  workspaceId: string,
  opts: { token?: string; userId: string }
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const ws = rows[0];
  if (!ws) throw new Error("workspace_not_found");
  if (ws.status !== "deleted") throw new Error("workspace_lifecycle_invalid");
  if (
    opts.token &&
    (!ws.restoreToken || !tokensMatch(ws.restoreToken, opts.token) || ws.restoreTokenConsumedAt)
  )
    throw new Error("invalid_or_used_token");

  await db
    .update(schema.workspaces)
    .set({
      status: "active",
      deletedAt: null,
      deletedByUserId: null,
      deleteScheduledAt: null,
      restoreToken: null,
      restoreTokenConsumedAt: opts.token ? new Date() : null,
    })
    .where(eq(schema.workspaces.id, workspaceId));

  invalidateCache(workspaceId);

  appendAudit(workspaceId, {
    action: "workspace.restore",
    actorUserId: opts.userId,
    actorKind: "user",
    targetType: "workspace",
    targetId: workspaceId,
    meta: { via_token: Boolean(opts.token) },
  });
}

export async function suspend(
  workspaceId: string,
  opts: { reason: string; userId: string }
): Promise<void> {
  const db = getDb();
  // B2.4 — assert current status. A blind UPDATE would silently flip a
  // deleted workspace to "suspended", stranding deletedAt and causing
  // the hard-delete cron to skip the row forever.
  const rows = await db
    .select({ status: schema.workspaces.status })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const ws = rows[0];
  if (!ws) throw new Error("workspace_not_found");
  if (ws.status !== "active") throw new Error("workspace_lifecycle_invalid");

  await db
    .update(schema.workspaces)
    .set({
      status: "suspended",
      suspendedAt: new Date(),
      suspendedReason: opts.reason,
      suspendedByUserId: opts.userId,
    })
    .where(eq(schema.workspaces.id, workspaceId));

  invalidateCache(workspaceId);

  appendAudit(workspaceId, {
    action: "workspace.suspend",
    actorUserId: opts.userId,
    actorKind: "user",
    targetType: "workspace",
    targetId: workspaceId,
    meta: { reason: opts.reason },
  });
}

export async function unsuspend(workspaceId: string, opts: { userId: string }): Promise<void> {
  const db = getDb();
  // B2.4 — assert current status. Unsuspending an already-active workspace
  // is a no-op masking a control-flow bug; unsuspending a deleted one
  // would resurrect it without restore-token validation.
  const rows = await db
    .select({ status: schema.workspaces.status })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const ws = rows[0];
  if (!ws) throw new Error("workspace_not_found");
  if (ws.status !== "suspended") throw new Error("workspace_lifecycle_invalid");

  await db
    .update(schema.workspaces)
    .set({
      status: "active",
      suspendedAt: null,
      suspendedReason: null,
      suspendedByUserId: null,
    })
    .where(eq(schema.workspaces.id, workspaceId));

  invalidateCache(workspaceId);

  appendAudit(workspaceId, {
    action: "workspace.unsuspend",
    actorUserId: opts.userId,
    actorKind: "user",
    targetType: "workspace",
    targetId: workspaceId,
    meta: {},
  });
}

/**
 * Predicate for read paths that need to short-circuit on suspended /
 * deleted workspaces. Returns the reason so the caller can map it to
 * the appropriate HTTP status (423 for suspended, 410 for deleted).
 */
export function isAccessible(workspace: Workspace): {
  ok: boolean;
  reason?: "suspended" | "deleted";
} {
  if (workspace.status === "active") return { ok: true };
  if (workspace.status === "suspended") return { ok: false, reason: "suspended" };
  return { ok: false, reason: "deleted" };
}
