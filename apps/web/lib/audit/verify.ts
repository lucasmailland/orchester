// apps/web/lib/audit/verify.ts
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §3.4
// Plan: Task A.19
//
// Walks a workspace's audit_log in seq order, recomputing payload + chain
// hashes from the persisted columns. The first row whose recomputed hash
// doesn't match what's stored is returned as `brokenAt`. An intact chain
// returns `brokenAt: null` plus the total number of entries verified.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import { computePayloadHash, computeChainHash } from "./chain";
import type { ChainVerifyResult } from "./types";

/**
 * Walk a workspace's audit chain and surface the first break, if any.
 *
 * `db` is optional so the cron worker (B2.2) can pass the same
 * transaction handle that `withCrossTenantAdmin` opened — otherwise the
 * SELECT would run on a different pooled connection that doesn't carry
 * the `app.cross_tenant_admin` GUC and would be blocked by FORCE RLS on
 * `audit_log`. The API-route caller (which already runs in the user's
 * workspace context) keeps the default `getDb()` behaviour.
 *
 * The handle accepted is intentionally typed as `DbClient` — both the
 * pooled client and a drizzle `tx` handle satisfy the structural shape
 * we need (`.select().from(...).where(...).orderBy(...)`).
 */
type AnyDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export async function verifyChain(workspaceId: string, db?: AnyDb): Promise<ChainVerifyResult> {
  const client = db ?? getDb();
  const entries = await client
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.workspaceId, workspaceId))
    .orderBy(asc(schema.auditLog.seq));

  let prevHash: string | null = null;
  for (const e of entries) {
    const expectedPayloadHash = computePayloadHash({
      action: e.action,
      actorUserId: e.actorUserId,
      actorKind: e.actorKind,
      targetType: e.targetType,
      targetId: e.targetId,
      meta: e.meta as Record<string, unknown>,
      createdAt: e.createdAt,
    });
    const expectedChainHash = computeChainHash(prevHash, expectedPayloadHash, e.seq);
    if (e.payloadHash !== expectedPayloadHash || e.chainHash !== expectedChainHash) {
      return {
        workspaceId,
        entriesChecked: Number(e.seq),
        brokenAt: {
          entryId: e.id,
          expectedHash: expectedChainHash,
          foundHash: e.chainHash,
        },
        verifiedAt: new Date(),
      };
    }
    prevHash = e.chainHash;
  }

  return {
    workspaceId,
    entriesChecked: entries.length,
    brokenAt: null,
    verifiedAt: new Date(),
  };
}
