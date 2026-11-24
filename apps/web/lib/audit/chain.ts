// apps/web/lib/audit/chain.ts
//
// Tamper-evident hash chain primitives. Spec §3.4.
//
// `canonicalize` produces a stable string for any JSON value (sorted
// keys, arrays preserve order). `computePayloadHash` is sha256 over the
// canonical form of the entry's mutable fields. `computeChainHash` is
// sha256 over `${prev}|${payloadHash}|${seq}` so any tampering breaks
// verification by Task A.19.
//
// v2 (SEC-009): the v1 chain hash is plain sha256, so anyone who can write
// to the database can rewrite a row and recompute every hash after it. v2
// rows key the chain hash with an HMAC whose key is derived from
// ENCRYPTION_SECRET, which never lives in the database, and the payload hash
// also covers workspace_id, actor_ip and actor_user_agent. Rows written
// before v2 keep hash_version = 1 and are still verified the v1 way.
//
// Rotating ENCRYPTION_SECRET changes the audit key, so every v2 row written
// under the old secret stops verifying. Keep the old secret until those rows
// age out through RETENTION_AUDIT_DAYS, or re-anchor the chain on purpose.
import { createHash, createHmac, hkdfSync } from "crypto";

export function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize((obj as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

export interface PayloadHashInput {
  action: string;
  actorUserId: string | null;
  actorKind: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export function computePayloadHash(input: PayloadHashInput): string {
  const canonical = canonicalize({
    action: input.action,
    actor_user_id: input.actorUserId,
    actor_kind: input.actorKind,
    target_type: input.targetType,
    target_id: input.targetId,
    meta: input.meta,
    created_at: input.createdAt.toISOString(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export interface PayloadHashInputV2 extends PayloadHashInput {
  workspaceId: string;
  actorIp: string | null;
  actorUserAgent: string | null;
}

export function computePayloadHashV2(input: PayloadHashInputV2): string {
  const canonical = canonicalize({
    workspace_id: input.workspaceId,
    action: input.action,
    actor_user_id: input.actorUserId,
    actor_kind: input.actorKind,
    actor_ip: input.actorIp,
    actor_user_agent: input.actorUserAgent,
    target_type: input.targetType,
    target_id: input.targetId,
    meta: input.meta,
    created_at: input.createdAt.toISOString(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

let cachedKey: { secret: string; key: Buffer } | null = null;

/** HMAC key for v2 chain hashes, derived from ENCRYPTION_SECRET (outside the DB). */
export function auditKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || !/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new Error("ENCRYPTION_SECRET must be a 32-byte hex string (64 chars)");
  }
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "hex"), "orchester", "audit-log-v1", 32)
  );
  cachedKey = { secret, key };
  return key;
}

export function computeChainHashV2(
  key: Buffer,
  prevHash: string | null,
  payloadHash: string,
  seq: bigint
): string {
  const prev = prevHash ?? "0".repeat(64);
  return createHmac("sha256", key).update(`${prev}|${payloadHash}|${seq}`).digest("hex");
}

export function computeChainHash(
  prevHash: string | null,
  payloadHash: string,
  seq: bigint
): string {
  const prev = prevHash ?? "0".repeat(64);
  return createHash("sha256").update(`${prev}|${payloadHash}|${seq}`).digest("hex");
}
