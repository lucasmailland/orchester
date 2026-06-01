// apps/web/lib/audit/types.ts
//
// Public types for the tamper-evident audit log. Mirrors §3.3 / §3.4 of
// docs/specs/2026-05-23-tenant-hardening-design.md.

export type AuditAction =
  | "workspace.create"
  | "workspace.update"
  | "workspace.soft_delete"
  | "workspace.restore"
  | "workspace.hard_delete"
  | "workspace.suspend"
  | "workspace.unsuspend"
  | "workspace.transfer"
  | "workspace.export"
  | "workspace.delete"
  | "member.invite"
  | "member.role_change"
  | "member.remove"
  | "apikey.create"
  | "apikey.revoke"
  | "agent.create"
  | "agent.delete"
  | "session.revoke"
  | "session.revoke_all"
  | "audit.chain_break_detected"
  | "audit.chain_verified"
  // Inspector UI v2 — recall debug endpoint emits this per call so an
  // admin can detect script-driven harvesting of fact-statement
  // previews via the captureTrace payload. See
  // apps/web/app/api/mnemo/recall-debug/route.ts.
  | "inspector.recall_debug";

export type ActorKind = "user" | "system" | "api_key";

export interface AuditEntryInput {
  action: AuditAction | (string & {}); // accept open strings during phase A
  actorUserId: string | null;
  actorKind: ActorKind;
  actorIp?: string | null;
  actorUserAgent?: string | null;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
}

export interface ChainVerifyResult {
  workspaceId: string;
  entriesChecked: number;
  brokenAt: { entryId: string; expectedHash: string; foundHash: string } | null;
  verifiedAt: Date;
}
