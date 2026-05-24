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
