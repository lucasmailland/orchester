// apps/web/lib/audit/chain.ts
//
// Tamper-evident hash chain primitives. Spec §3.4.
//
// `canonicalize` produces a stable string for any JSON value (sorted
// keys, arrays preserve order). `computePayloadHash` is sha256 over the
// canonical form of the entry's mutable fields. `computeChainHash` is
// sha256 over `${prev}|${payloadHash}|${seq}` so any tampering breaks
// verification by Task A.19.
import { createHash } from "crypto";

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

export function computeChainHash(
  prevHash: string | null,
  payloadHash: string,
  seq: bigint
): string {
  const prev = prevHash ?? "0".repeat(64);
  return createHash("sha256").update(`${prev}|${payloadHash}|${seq}`).digest("hex");
}
