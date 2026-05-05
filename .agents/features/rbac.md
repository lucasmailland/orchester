# RBAC

**File:** `apps/web/lib/rbac.ts`
**Owner:** auth / production
**Status:** matrix in place; enforcement partial — Phase 6 finalization pending

## Purpose
Role-based access control. 4 roles, ~25 actions, `assertCan()` middleware.

## Planning (initial design)

### Roles (workspace-scoped, stored in `workspace_member.role`)
- **owner** — all permissions.
- **admin** — all except destructive workspace-level (transfer, billing
  cancellation full).
- **editor** — create/update/delete agents, flows, channels, KBs.
  Read settings, billing. No member or API-key management.
- **viewer** — read-only across the workspace.

### Action matrix
~25 actions covering: agent.{create,update,delete}, flow.{...},
channel.{...}, knowledge.{...}, conversation.{read,write,takeover},
settings.{read,write}, billing.{read,write}, members.{invite,remove,role},
apikey.manage, webhook.manage, audit.read.

Defined in `PERMISSIONS: Record<Role, Action[]>`. `owner` is a wildcard.

### Public API
- `can(role, action) → boolean`
- `assertCan(role, action) → throws ForbiddenError(403)` on deny

### Decisions & trade-offs
- **Static matrix in code**, not a row in DB. Simple, fast, version-controlled.
  Trade-off: changing permissions requires a deploy.
- **Owner is wildcard** — `can("owner", anything) === true`.
- **Per-resource scoping** is uniform "anything within my workspace". No
  fine-grained ACLs (e.g. agent A is shared with user X) — explicitly out of
  scope until Enterprise plan.

## Execution (changelog — newest first)

### 2026-04-28 — Phase 6
- Initial matrix + assertCan helper.
- Used by /api/api-keys, /api/invites, /api/audit-logs.

## Open issues / TODO
- **Wire `assertCan` into EVERY mutating endpoint.** Today many endpoints
  only check `getCurrentWorkspace()` (membership) but not role. CRITICAL
  before launch.
- UI to change a member's role from the Members section.
- Fine-grained per-resource ACLs (Enterprise feature).
