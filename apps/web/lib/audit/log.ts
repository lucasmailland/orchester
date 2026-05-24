// apps/web/lib/audit/log.ts
//
// Append-only writer for the tamper-evident audit log.
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §3.3 + §3.4
// Plan reference: Task A.18.
//
// `appendAuditSync` runs inside a transaction with a per-workspace
// advisory lock so monotonic `seq` is preserved under concurrent
// writers. The async wrapper `appendAudit` will eventually enqueue a
// pg-boss job (Phase B) — for now it falls back to the sync path so we
// never lose entries.
import "server-only";
import { sql, desc, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { computePayloadHash, computeChainHash } from "./chain";
import type { AuditEntryInput } from "./types";

export async function appendAuditSync(workspaceId: string, entry: AuditEntryInput): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // Advisory lock keyed by workspace id; releases at COMMIT.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);

    const last = await tx
      .select({
        seq: schema.auditLog.seq,
        chainHash: schema.auditLog.chainHash,
      })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, workspaceId))
      .orderBy(desc(schema.auditLog.seq))
      .limit(1);

    const nextSeq = (last[0]?.seq ?? BigInt(0)) + BigInt(1);
    // Pre-chain legacy rows have placeholder zero chain_hash; treat as
    // null prev so the first real entry starts a fresh chain after them.
    const lastChain = last[0]?.chainHash ?? null;
    const prevHash = lastChain && lastChain !== "0".repeat(64) ? lastChain : null;

    const createdAt = new Date();
    const payloadHash = computePayloadHash({
      action: entry.action,
      actorUserId: entry.actorUserId,
      actorKind: entry.actorKind,
      targetType: entry.targetType,
      targetId: entry.targetId,
      meta: entry.meta,
      createdAt,
    });
    const chainHash = computeChainHash(prevHash, payloadHash, nextSeq);

    await tx.insert(schema.auditLog).values({
      id: createId(),
      workspaceId,
      seq: nextSeq,
      prevHash,
      payloadHash,
      chainHash,
      action: entry.action,
      actorUserId: entry.actorUserId,
      actorKind: entry.actorKind,
      actorIp: entry.actorIp ?? null,
      actorUserAgent: entry.actorUserAgent ?? null,
      targetType: entry.targetType,
      targetId: entry.targetId,
      meta: entry.meta,
      createdAt,
    });
  });
}

/**
 * Async path. Eventually enqueues a pg-boss `audit.append` job (Phase
 * B). Until then, falls through to the sync writer so we never drop
 * entries.
 */
export function appendAudit(workspaceId: string, entry: AuditEntryInput): void {
  void appendAuditSync(workspaceId, entry).catch(async (e) => {
    const { safeLogError } = await import("../safe-log");
    safeLogError("[audit] appendAudit failed:", e);
  });
}
