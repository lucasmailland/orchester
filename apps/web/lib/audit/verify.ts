// apps/web/lib/audit/verify.ts
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §3.4
// Plan: Task A.19
//
// Walks a workspace's audit_log in seq order, recomputing payload + chain
// hashes from the persisted columns. The first row whose recomputed hash
// doesn't match what's stored is returned as `brokenAt`. An intact chain
// returns `brokenAt: null` plus the total number of entries verified.
//
// Each row is checked by its hash_version (1 = unkeyed sha256, 2 = HMAC, see
// chain.ts). Retention trims the oldest rows, so the walk starts from the
// first row that still exists and trusts its stored prev_hash as the anchor.
// Rows before it are gone by design; the tail is anchored outside the DB by
// the daily verify job's log line.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import {
  auditKey,
  computePayloadHash,
  computeChainHash,
  computePayloadHashV2,
  computeChainHashV2,
} from "./chain";
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

  // Design decision (migration 0002c compatibility):
  // Legacy rows migrated from audit_log_legacy carry `action LIKE 'legacy.%'`
  // and a sentinel chain_hash of '0'.repeat(64) — they were never part of the
  // original hash chain and have no meaningful payload hash to verify.
  // We skip them entirely during chain computation so the verifier starts
  // from the first non-legacy row (the true chain origin).  The skipped rows
  // are still counted in `entriesChecked` so callers can detect a fully-legacy
  // workspace (entriesChecked > 0, brokenAt: null).
  const chainEntries = entries.filter((e) => !e.action.startsWith("legacy."));

  let key: Buffer | null = null;
  let prevHash: string | null = chainEntries[0]?.prevHash ?? null;
  let seenV2 = false;
  for (const [i, e] of chainEntries.entries()) {
    const base = {
      action: e.action,
      actorUserId: e.actorUserId,
      actorKind: e.actorKind,
      targetType: e.targetType,
      targetId: e.targetId,
      meta: e.meta as Record<string, unknown>,
      createdAt: e.createdAt,
    };
    let expectedPayloadHash: string;
    let expectedChainHash: string;
    if (e.hashVersion === 2) {
      seenV2 = true;
      key ??= auditKey();
      expectedPayloadHash = computePayloadHashV2({
        ...base,
        workspaceId: e.workspaceId,
        actorIp: e.actorIp ?? null,
        actorUserAgent: e.actorUserAgent ?? null,
      });
      expectedChainHash = computeChainHashV2(key, prevHash, expectedPayloadHash, e.seq);
    } else {
      expectedPayloadHash = computePayloadHash(base);
      expectedChainHash = computeChainHash(prevHash, expectedPayloadHash, e.seq);
    }
    // A v1 row after a v2 one is a downgrade: v1 hashes need no key, so
    // relabelling rows as v1 would let anyone with DB access rewrite them.
    const downgraded = e.hashVersion !== 2 && seenV2;
    if (downgraded || e.payloadHash !== expectedPayloadHash || e.chainHash !== expectedChainHash) {
      return {
        workspaceId,
        entriesChecked: i + 1,
        brokenAt: {
          entryId: e.id,
          expectedHash: expectedChainHash,
          foundHash: e.chainHash,
        },
        head: null,
        verifiedAt: new Date(),
      };
    }
    prevHash = e.chainHash;
  }

  const last = chainEntries.at(-1);
  return {
    workspaceId,
    entriesChecked: entries.length, // includes legacy rows (not chain-verified)
    brokenAt: null,
    head: last ? { seq: last.seq.toString(), chainHash: last.chainHash } : null,
    verifiedAt: new Date(),
  };
}
