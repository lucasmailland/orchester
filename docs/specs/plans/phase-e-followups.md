# Phase E follow-ups

State after `tenant-hardening-v1.2`. Items are tracked across three
columns: **Shipped** (already in main), **Open** (still to do), and
**Won't fix** (explicitly out of scope).

## Endpoints

| Endpoint                                         | Status                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `POST /api/workspaces/[slug]/suspend`            | **Shipped** (v1.2). System-admin only via `assertSystemAdmin(session)` reading `ADMIN_EMAILS` env. |
| `DELETE /api/workspaces/[slug]/suspend`          | **Shipped** (v1.2). Same auth gate.                                                                |
| `GET /api/workspaces/[slug]/export/[jobId]`      | **Shipped** (v1.2). Used by `GdprExportProgress` polling.                                          |
| `PATCH /api/workspaces/[slug]/members/[userId]`  | **Shipped** (v1.2). `member.role_change` audited + `invalidateMembership` (cluster-broadcast).     |
| `DELETE /api/workspaces/[slug]/members/[userId]` | **Shipped** (v1.2). `member.remove` audited + cache invalidated.                                   |

## Components

| Component                         | Status                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TransferOwnershipModal.tsx`      | **Shipped** (v1.2). Wired into `DangerZoneSection`. Calls `POST /api/workspaces/[slug]/transfer`.                                                |
| `GdprExportProgress.tsx`          | **Shipped** (v1.2). Mounted in shell layout. Polls export job every 3s; state in `localStorage`.                                                 |
| `DeletedWorkspaceRestoreCard.tsx` | **Shipped** (v1.2). Standalone page at `/[locale]/deleted/[id]`. Auth-gated; non-enumerable failures.                                            |
| `InviteMemberQuickAction.tsx`     | **Won't fix** — `/api/workspaces/[slug]/invites` does not exist; only the cookie-scoped `/api/invites` does. Members tab already covers invites. |

## Hardening

| Item                                    | Status                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GDPR streaming exporter                 | **Shipped** (v1.2). `archiver`-based zip writer with per-table exporters (`workspace`, `agents`, `conversations`, `messages`, `knowledge`). In-memory buffer; true streaming is a future refactor. |
| GDPR storage adapter (S3 + filesystem)  | **Shipped** (v1.2). `STORAGE_BACKEND=s3` uses AWS SDK + signed URLs; default `filesystem` writes to `GDPR_EXPORT_DIR` and returns `file://` URLs (self-host).                                      |
| GDPR email                              | **Shipped** (v1.2). `RESEND_API_KEY` enables Resend; otherwise logs the stub.                                                                                                                      |
| `SECURITY_ALERT_WEBHOOK` on chain break | **Shipped** (v1.2). `verify-job.ts` POSTs to the webhook when a chain break is detected; falls back to `console.error` if unset.                                                                   |

## Schema gaps surfaced during Phase E

| Item                                   | Status                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `active-workspace` cookie signing      | **Shipped** (v1.2). HMAC-SHA256 via SubtleCrypto (edge-runtime compatible). Reads `COOKIE_SIGNING_SECRET`.             |
| Session rotation on workspace.transfer | **Shipped** (v1.2). Previous owner's sessions revoked + `member.session_revoked` audited. Best-effort if revoke fails. |

## Post-hardening audit follow-ups (2026-05-23 / 2026-05-24)

Status after `tenant-hardening-v1.2`:

| Item                                                          | Status                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/channels/router.ts` thread tx through resolveInbound     | **Shipped** (v1.2). `handleInbound` uses two short txns; `handleInboundStream` uses three (resolve / build context / persist) to fit drizzle's "no tx across generator yields" constraint. `ConvCtx` no longer holds the db handle. New integration suite at `tests/integration/channels/router.spec.ts` (4 cases against testcontainer).        |
| GUC propagation across `await import(...)` dynamic imports    | **Shipped** (v1.2). `checkQuota`, `getWorkspacePlan`, `getMonthlyUsage`, `checkEmployeeBudget`, `recordMessageCost`, `assertWithinSpend`, `maybeFireBudgetAlert`, `monthToDateSpendUsd` now accept an optional `tx?: WsDb` and use it when passed. Backwards-compatible: existing callers default to `getDb()`.                                  |
| Cluster-wide cache invalidation for workspace/membership LRUs | **Shipped** (v1.2). `lib/tenant/cluster-cache.ts` opens a dedicated `postgres-js` LISTEN connection at startup. `invalidateCache` / `invalidateMembership` / `invalidateFlag` broadcast NOTIFY on `tenant_cache_invalidation`. Sub-millisecond cross-pod propagation. 5/5 integration tests at `tests/integration/tenant/cluster-cache.spec.ts`. |
| `appendAudit` durability for chain genesis                    | **Shipped** (v1.2). `POST /api/workspaces` now `await`s `appendAuditSync` for `workspace.create`. Other audit sites stay fire-and-forget by design (high-volume routes).                                                                                                                                                                         |

## Remaining open work (after v1.2)

All Phase F items below shipped in v1.0 GA (commits `898787f`, `6d0409b`, `8f3cd3d`).

| Item                                                               | Status                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F.1 — LLM tool loop tx propagation**                             | **Shipped** (v1.0). `lib/tools.ts::executeTool`, `lib/memory.ts`, `lib/memory-compaction.ts`, `lib/llm-call.ts::getProviderKey` now accept `tx?: WsDb` and inherit GUC. Regression: `apps/web/__tests__/phase-f1-tool-loop-tx.test.ts`.                                                                            |
| **F.2 — `lib/flow-engine.ts::executeFlow` inline branch**          | **Shipped** (v1.0). Inline branch threads `tx` through the flow-engine; async branch unchanged (already under `withCrossTenantAdmin`). Regression: `apps/web/__tests__/phase-f2-flow-engine-rls.test.ts`.                                                                                                          |
| **F.3 — GDPR exporters credentials redaction**                     | **Shipped** (v1.0). `lib/gdpr/redact.ts` strips `encryptedCredentials`, `apiKey`, secret-shaped tokens before serialization. Regression: `apps/web/__tests__/gdpr-redact.test.ts`.                                                                                                                                 |
| **F.4 — Filesystem storage `/api/exports/[token]` download route** | **Shipped** (v1.0). HMAC-SHA256 signed token (`base64url(payload).base64url(tag)`) via `lib/gdpr/signed-url.ts` reusing `COOKIE_SIGNING_SECRET`. Path-traversal rejected. Regression: `apps/web/__tests__/phase-f4-signed-download.test.ts`.                                                                       |
| **F.5 — GDPR true streaming**                                      | **Shipped** (v1.0). `archiver` writes into a paused `Transform` (byte counter + size guard) that the storage adapter pipes into S3 multipart `Upload` or `pipeline(stream, createWriteStream)`. Peak memory bounded by one multipart part. Regression: `apps/web/__tests__/phase-f5-streaming-size-guard.test.ts`. |

CI guard for the underlying invariants (spend cap, metering, RBAC, zod, bounded `signal:`) lives in `scripts/audit-invariants.sh` and runs in `.github/workflows/ci.yml`.
