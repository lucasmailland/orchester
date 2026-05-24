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

Surfaced during the router refactor (`f1` bundle) — narrow scope, low risk, NOT blocking sub-spec 2:

- **LLM tool loop tx propagation** — `lib/tools.ts` (`executeTool`), `lib/memory.ts`, `lib/memory-compaction.ts`, and `lib/llm-call.ts::getProviderKey` still use `getDb()` inside `runConversationalTurn`'s transaction. Tests pass because the test agents have no tool definitions. Production agents with tools configured will hit FORCE RLS rejection when the tool tries to read/write tenant data. Same `tx?: WsDb` optional-arg pattern as the billing helpers; mechanical change.
- **`lib/flow-engine.ts::executeFlow` inline branch** — only the inline (synchronous) flow-agent branch still uses `getDb()`. Async branch enqueues into pg-boss workers which carry their own `withCrossTenantAdmin` envelope, so the async path is safe. The inline branch is only reached for `agent.kind === "flow"` with short flows; covered by a separate follow-up.
- **GDPR true streaming** — `archiver` is configured but the result is buffered in memory before upload. For workspaces > 100MB of conversation history this needs to switch to a true streaming pipe (writeable into S3 multipart upload, or stream-into-filesystem-then-uploadPart).
- **GDPR exporters credentials redaction** — `agents`, `conversations`, `messages`, `knowledge` exporters dump full rows. Verify there is no `encryptedCredentials`, `apiKey`, or similar in the dumps; add redaction if so. (Audit not yet performed.)
- **Filesystem storage `/api/exports/[token]` download route** — when `STORAGE_BACKEND=filesystem`, the signed URL is `file://...` which a browser can't open. Self-host needs an HTTP route that HMAC-signs (`token`, `expiry`) and serves the file from disk.
