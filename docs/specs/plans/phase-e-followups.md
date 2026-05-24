# Phase E follow-ups

Items from Phase E (Task E.9) that were deliberately deferred to keep
the lifecycle GA cycle focused. Each row stands alone — pick one,
ship it, close.

## Endpoints

| Endpoint                                         | Why deferred                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `POST /api/workspaces/[slug]/suspend`            | Admin-global RBAC role not yet modelled in `rbac.ts` (today's `Role` is workspace-scoped). |
| `DELETE /api/workspaces/[slug]/suspend`          | Same — needs admin-global authorisation surface.                                           |
| `GET /api/workspaces/[slug]/export/[jobId]`      | Job-status polling endpoint for `GdprExportProgress` component (also deferred).            |
| `PATCH /api/workspaces/[slug]/members/[userId]`  | Existing endpoint works; needs `member.role_change` audit entry annotation.                |
| `DELETE /api/workspaces/[slug]/members/[userId]` | Existing endpoint works; needs `member.remove` audit + `invalidateAllMembershipFor`.       |

## Components

| Component                         | Why deferred                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `TransferOwnershipModal.tsx`      | Endpoint shipped (`/transfer`); UI deferred — admins can call via API today. |
| `GdprExportProgress.tsx`          | Needs the job-status GET endpoint above first.                               |
| `DeletedWorkspaceRestoreCard.tsx` | Restore endpoint shipped; standalone page deferred.                          |
| `InviteMemberQuickAction.tsx`     | Existing settings members tab covers this.                                   |

## Hardening

- The streaming GDPR exporter is a stub (`apps/web/lib/gdpr/export-job.ts`) — it serialises a single workspace row. Replace with a true streaming zip writer + per-table exporter once the spec for content is firm.
- `apps/web/lib/gdpr/storage.ts` returns a fake `https://example.com/...` URL. Wire to S3 (env `STORAGE_BACKEND=s3`) / MinIO (self-host) via signed-URL adapter.
- `apps/web/lib/gdpr/email.ts` only logs. Wire to Resend / SES.
- `apps/web/lib/audit/verify-job.ts` currently `console.error`s on chain break. Add the `SECURITY_ALERT_WEBHOOK` fetch.

## Schema gaps surfaced during Phase E

- `pages/active-workspace` route writes the cookie unsigned (relies on origin auth). Consider signing it explicitly to make the trust boundary obvious.
- `workspace.transfer` endpoint does not force session rotation for the previous owner — they continue with the same session, just at `admin` role. A defence-in-depth follow-up would invalidate their sessions and require re-login.

## Post-hardening audit follow-ups (2026-05-23)

Surfaced by the post-`tenant-hardening-v1` audit but not bundled into
the corrective sweep because they require a deeper refactor than a
single in-place edit. None are blocking — every path that reaches them
has a working upstream guard.

- **`apps/web/lib/channels/router.ts` (606 lines, 3 entry points)** — `handleInbound`, `handleInboundStream`, and the shared `resolveInbound` use `getDb()` for every query and never `SET LOCAL app.workspace_id`. Once the inbound message reaches the conversation/message inserts, FORCE RLS rejects. The webhook routes themselves now set the GUC for the channel lookup, but this downstream library path is untouched. **Refactor:** thread an explicit `tx` (or a `WorkspaceCtx`) through `resolveInbound` → `runConversationalTurn` → `persistAssistantTurn`, replacing every `const db = getDb()` with the passed handle. Then wrap the whole call in `db.transaction` at the entry points. Tests would need a webhook end-to-end suite that exercises the FORCE RLS path.
- **GUC propagation across `await import(...)` dynamic imports inside transactions** — `resolveInbound` calls `await import("@/lib/billing/quotas")` and similar inside DB work. Those helpers run their OWN `getDb()` queries on a different pooled connection; the `SET LOCAL` does not propagate. Solution mirrors the router refactor: helpers should accept a `tx` arg.
- **Cluster-wide cache invalidation for workspace/membership LRUs** — currently the LRU in `lib/tenant/resolve.ts` and the in-process map in `lib/tenant/membership.ts` invalidate only on the current pod. With more than one app pod, a soft-delete or role demotion takes up to 5 min (resolve) / 60 s (membership) to propagate. Fix: Postgres `LISTEN/NOTIFY` channel with a tiny pub/sub layer.
- **`appendAudit` durability for chain genesis** — `POST /api/workspaces` writes the `workspace.create` audit entry via fire-and-forget. The chain genesis is the most important row to never lose. Switch that single site to `appendAuditSync` so creation-without-audit is impossible.
