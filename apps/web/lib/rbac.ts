import "server-only";

/**
 * Role-based access control.
 * 4 roles: owner | admin | editor | viewer
 */
export type Role = "owner" | "admin" | "editor" | "viewer";

export type Action =
  | "agent.create"
  | "agent.update"
  | "agent.delete"
  | "flow.create"
  | "flow.update"
  | "flow.delete"
  | "flow.run"
  | "channel.create"
  | "channel.update"
  | "channel.delete"
  | "knowledge.create"
  | "knowledge.update"
  | "knowledge.delete"
  | "conversation.read"
  | "conversation.write"
  | "conversation.takeover"
  | "settings.read"
  | "settings.write"
  | "billing.read"
  | "billing.write"
  | "members.invite"
  | "members.remove"
  | "members.role"
  | "apikey.manage"
  | "webhook.manage"
  | "audit.read";

const PERMISSIONS: Record<Role, Action[]> = {
  viewer: [
    // Reads/lists are gated only by authentication, not by an Action.
    "conversation.read",
    "settings.read",
    "billing.read",
    // audit.read removido: los logs de auditoría son sensibles → admin+ only.
  ],
  editor: [
    "agent.create",
    "agent.update",
    "agent.delete",
    "flow.create",
    "flow.update",
    "flow.delete",
    "flow.run",
    "channel.create",
    "channel.update",
    "channel.delete",
    "knowledge.create",
    "knowledge.update",
    "knowledge.delete",
    "conversation.read",
    "conversation.write",
    "conversation.takeover",
    "settings.read",
    "billing.read",
    // audit.read removido de editor: logs de auditoría son admin+ only.
  ],
  admin: [
    "agent.create",
    "agent.update",
    "agent.delete",
    "flow.create",
    "flow.update",
    "flow.delete",
    "flow.run",
    "channel.create",
    "channel.update",
    "channel.delete",
    "knowledge.create",
    "knowledge.update",
    "knowledge.delete",
    "conversation.read",
    "conversation.write",
    "conversation.takeover",
    "settings.read",
    "settings.write",
    "billing.read",
    "billing.write",
    "members.invite",
    "members.remove",
    "members.role",
    "apikey.manage",
    "webhook.manage",
    "audit.read",
  ],
  owner: [], // all — handled below
};

export function can(role: Role, action: Action): boolean {
  if (role === "owner") return true;
  return PERMISSIONS[role]?.includes(action) ?? false;
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(
    public action: Action,
    public role: Role
  ) {
    super(`Role ${role} cannot ${action}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role | undefined, action: Action): void {
  if (!role || !can(role, action)) {
    throw new ForbiddenError(action, role ?? ("viewer" as Role));
  }
}

/**
 * System-admin gate.
 *
 * The four workspace-scoped roles above (owner/admin/editor/viewer) are
 * intentionally tenant-bound — an owner of workspace A has no special
 * authority over workspace B. A handful of operator endpoints
 * (workspace suspend/unsuspend, tenant telemetry) need to act ACROSS
 * tenants, so they need a separate authority concept that lives
 * outside the workspace_member table.
 *
 * Storage decision: env-var allowlist (`ADMIN_EMAILS`), not a column
 * on `users`. Rationale:
 *   - Lower-risk: no migration, no new RLS surface, no path for a
 *     compromised admin to grant system-admin to themselves via the
 *     normal product UI.
 *   - Matches the existing tenant-telemetry pattern, so operators only
 *     manage one allowlist.
 *   - Operationally rotatable via env without a DB write.
 *
 * If the var is empty or unset, NO email is admin — endpoints fail
 * closed (403). Production deployments MUST set this explicitly.
 *
 * Trade-off: this is a deploy-time secret, not a runtime knob. To add
 * an admin you redeploy. That friction is by design for the small
 * number of system-admin actions; once we need finer-grained ops
 * roles we'll graduate to a real table.
 */
export class SystemAdminRequiredError extends Error {
  status = 403;
  constructor(public actor: string | null) {
    super(`System-admin required: ${actor ?? "anonymous"}`);
    this.name = "SystemAdminRequiredError";
  }
}

export function isSystemAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env["ADMIN_EMAILS"] ?? "";
  // Parse on each call. The env should be set at boot and not change
  // mid-process; the cost of splitting a short string is negligible
  // compared to the DB round-trips around it, and avoiding a module-
  // level cache means tests can override per-test via stubEnv.
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return false;
  return allow.includes(email);
}

/**
 * Throws `SystemAdminRequiredError` (status=403) when the caller is not
 * on the `ADMIN_EMAILS` allowlist. Pass the email from `requireAuth()`
 * — `null`/`undefined` is treated as not-admin (fail closed).
 */
export function assertSystemAdmin(email: string | null | undefined): void {
  if (!isSystemAdmin(email)) {
    throw new SystemAdminRequiredError(email ?? null);
  }
}
