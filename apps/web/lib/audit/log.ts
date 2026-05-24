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
  let rotatedFromLegacyBootstrap = false;
  // Annotate explicitly: TS narrows the initializer to `null` inside the
  // txn callback closure, so without the union it widens to `never` after
  // the loop and breaks the post-commit log expression below.
  let rotatedAtSeq: bigint | null = null as bigint | null;
  await db.transaction(async (tx) => {
    // Phase C: set the workspace GUC on THIS connection (is_local=true so it
    // releases at COMMIT) so the upcoming INSERT passes FORCE RLS even when
    // the caller is a worker/background path that didn't go through
    // getCurrentWorkspace(). MUST be the first statement in the txn so the
    // advisory-lock query below already sees the tenant context.
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);

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
    // Chain-start logic (B2.1 fix — silent reset closed):
    //   * Genesis row (seq=1): prev_hash MUST be null. Nothing to chain to.
    //   * Post-genesis (seq>1): we MUST inherit a real prev_hash from the
    //     previous row. The one exception is the legacy bootstrap row
    //     (chain_hash = 64 zero-bytes) seeded by the Phase A migration:
    //     when the FIRST real audit append happens after that bootstrap,
    //     we explicitly ROTATE the chain (set prev=null), starting a new
    //     chain from seq=N+1. Without an explicit rotation an attacker
    //     could insert a single zero-hash row at any seq to fork the
    //     chain. We make rotation observable by emitting a structured
    //     stderr warning AFTER the txn commits (logging inside the txn
    //     can't reach a different workspace; we deliberately avoid
    //     recursive audit insertion).
    let prevHash: string | null;
    if (nextSeq === BigInt(1)) {
      prevHash = null;
    } else {
      const lastChain = last[0]?.chainHash ?? null;
      if (!lastChain) {
        throw new Error(
          `audit chain corruption at workspace ${workspaceId}: last seq=${last[0]?.seq} has null chain_hash`
        );
      }
      if (lastChain === "0".repeat(64)) {
        // Legacy bootstrap cutover: rotate the chain. Log AFTER commit.
        rotatedFromLegacyBootstrap = true;
        rotatedAtSeq = nextSeq;
        prevHash = null;
      } else {
        prevHash = lastChain;
      }
    }

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

  // Post-commit observability: structured warn so operators see when a
  // chain rotation happens past the Phase A legacy bootstrap row. We log
  // here (not via appendAudit) on purpose: writing another audit entry
  // would either succeed (and chain to the new row, suppressing the
  // signal) or recurse if the chain were corrupted again.
  if (rotatedFromLegacyBootstrap) {
    const { safeLogWarn } = await import("../safe-log");
    safeLogWarn("[audit] chain rotated past legacy bootstrap row:", {
      level: "warn",
      msg: "audit.chain.rotated_past_legacy_bootstrap",
      workspaceId,
      seq: rotatedAtSeq?.toString() ?? null,
    });
  }
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
