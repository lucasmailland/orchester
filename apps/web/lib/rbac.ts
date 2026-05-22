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
    "audit.read",
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
    "audit.read",
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
  constructor(public action: Action, public role: Role) {
    super(`Role ${role} cannot ${action}`);
    this.name = "ForbiddenError";
  }
}

export function assertCan(role: Role | undefined, action: Action): void {
  if (!role || !can(role, action)) {
    throw new ForbiddenError(action, role ?? ("viewer" as Role));
  }
}
