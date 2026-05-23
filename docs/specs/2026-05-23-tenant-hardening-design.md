# Tenant Hardening + Workspace Switcher — Design

```yaml
spec_id: 2026-05-23-tenant-hardening
status: draft
version: 0.1.0
created: 2026-05-23
authors:
  - Claude (architecture)
  - Lucas Mailland (product direction, sign-off)
reviewers:
  - Lucas Mailland
phase_target: Q3 2026
sub_spec_of: brain-layer-program
sub_spec_index: 1
related_sub_specs:
  - 2026-XX-XX-brain-core # Sub-spec 2 — depends on this
  - 2026-XX-XX-conversation-brain-bridge
  - 2026-XX-XX-employee-360
  - 2026-XX-XX-knowledge-governance
compliance_scope:
  - SOC2-CC6 # Logical Access
  - SOC2-CC7 # System Operations
  - SOC2-CC8 # Change Management
  - SOC2-CC9 # Risk Mitigation
  - ISO27001-A.5 # Organizational
  - ISO27001-A.8 # Asset Management
  - ISO27001-A.9 # Access Control
  - ISO27001-A.10 # Cryptography
  - ISO27001-A.12 # Operations
  - ISO27001-A.13 # Communications
  - ISO27001-A.16 # Incident Management
  - ISO27001-A.18 # Compliance
  - GDPR-Art.15 # Right of access
  - GDPR-Art.17 # Right to erasure
  - GDPR-Art.20 # Data portability
  - GDPR-Art.25 # Privacy by design
  - GDPR-Art.32 # Security of processing
estimated_effort: 5 weeks (Phases A-E)
risk_level: high
dependencies:
  - Postgres 15+
  - pg-boss queue
  - Object storage (S3 / MinIO)
  - Email transactional (Resend / SES / Postmark)
  - Better-auth (existing)
```

---

## Table of contents

1. [Goal, non-goals, success criteria](#1-goal-non-goals-success-criteria)
2. [Architecture & repository layout](#2-architecture--repository-layout)
3. [Data model & migrations](#3-data-model--migrations)
4. [API surface](#4-api-surface)
5. [UI surface](#5-ui-surface)
6. [Security model](#6-security-model)
7. [Testing strategy](#7-testing-strategy)
8. [Implementation phases & rollout](#8-implementation-phases--rollout)
9. [Open questions, decisions log, deferred items, glossary, references](#9-open-questions-decisions-log-deferred-items-glossary-references)

---

## Executive summary

Convert Orchester from **multi-tenant L1 with a single active workspace per user** to **multi-tenant enterprise-grade SOC2 / ISO 27001-ready with N workspaces per user, full switcher UX, defense-in-depth isolation, and complete operational lifecycle (suspend / restore / export / delete)**.

This is **Sub-spec 1 of 5** in the Brain Layer program. It is the foundational sub-spec: every later sub-spec (Brain Core, Conversation Bridge, Employee 360, Knowledge Governance) depends on the tenant guarantees we establish here.

**Why this first:** Sub-spec 2 (Brain Core) introduces high-volume fact storage with semantic search. A cross-tenant leak in that data model would be catastrophic. Hardening tenant isolation now is non-negotiable foundation.

---

## 1. Goal, non-goals, success criteria

### 1.1 Goal

Convert Orchester from **multi-tenant L1 with a single active workspace per user** to **multi-tenant enterprise-grade SOC2 / ISO 27001-ready with N workspaces per user, full switcher UX, defense-in-depth isolation, and complete operational lifecycle (suspend / restore / export / delete)**.

### 1.2 Non-goals (explicitly out of scope of this sub-spec)

- Brain Layer / Knowledge graph / Memory v2 → Sub-spec 2
- Subdomain per tenant (`acme.orchester.io`) → future Enterprise tier (Defer-A)
- DB-per-tenant L3 isolation → future Enterprise tier (Defer-C)
- SSO / SAML / SCIM → future Cloud Enterprise (Defer-A)
- Customer-managed keys (CMK) → future Cloud Enterprise (Defer-B)
- Hard-delete without window → always soft-delete + 30d window
- Cross-workspace data migration tools → out of scope
- White-label / custom domain → Defer-F
- BYO Postgres per tenant → future Enterprise

### 1.3 Success criteria

**Functional (gate to ship):**

| #   | Criterion                                                                                                                                       | Verification                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| F1  | User with 3 workspaces sees them listed in topbar switcher, navigates via URL `/{locale}/{workspaceSlug}/...`, each tab keeps its own workspace | Playwright E2E `tests/e2e/workspace-switcher.spec.ts` |
| F2  | Zero cross-tenant leak across isolation E2E suite (2 workspaces, 50+ API routes tested)                                                         | `tests/isolation/*` pass at 100%                      |
| F3  | RLS policy blocks queries without `app.workspace_id` set → error `RLS_NO_TENANT_CONTEXT`                                                        | Direct SQL test without SET → fails                   |
| F4  | Owner triggers GDPR export → email received within p95 ≤ 5 min for workspaces ≤ 1M rows, ≤ 1 h for ≤ 10M rows                                   | Synthetic workspace benchmark                         |
| F5  | Soft-delete 30d window with functional restore endpoint + hard-delete cron post-window                                                          | Lifecycle E2E suite                                   |
| F6  | Suspended workspace: UI readable read-only, mutations return 423 Locked, agents/flows/integrations off                                          | `tests/lifecycle/suspended.spec.ts`                   |
| F7  | Audit chain verify job reports no broken chains after 30 days continuous use in staging                                                         | Cron `verify_audit_chain` exits 0 daily               |

**Non-functional (SLOs):**

| Metric                              | Target                                  |
| ----------------------------------- | --------------------------------------- |
| Switcher dropdown load (p95)        | < 100 ms for users with ≤ 50 workspaces |
| Workspace resolver middleware (p95) | < 10 ms (cached) / < 50 ms (cold)       |
| RLS overhead vs baseline            | < 5% throughput regression              |
| GDPR export job p95 (1M rows)       | < 5 min                                 |
| Soft-delete restore RPO / RTO       | RPO = 0 within window, RTO < 30 s       |
| Audit log insert overhead           | < 5 ms p95 (async via pg-boss)          |
| Tenant isolation E2E suite runtime  | < 5 min in CI                           |

### 1.4 Threat model

| ID   | STRIDE                 | Threat                                  | Vector                                      | Mitigation in this sub-spec                                                                                  | Control            |
| ---- | ---------------------- | --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| T-1  | Spoofing               | Session hijack                          | XSS, MITM, malware                          | `__Host-` cookie, httpOnly, SameSite=Lax, TLS-only, session rotation on privilege escalation                 | A.9.4.1, CC6.1     |
| T-2  | Tampering              | SQL injection bypassing tenant filter   | Bug in query construction                   | Drizzle ORM parameterized + RLS as 2nd barrier + ESLint rule banning raw `sql\`\`` interpolation             | A.14.2.5, CC6.7    |
| T-3  | Tampering              | Audit log mutation by malicious actor   | DB UPDATE via app role                      | `REVOKE UPDATE, DELETE ON audit_log FROM app_user` + hash chain detection + verify cron                      | A.12.4.1, CC7.2    |
| T-4  | Repudiation            | User denies action after delete         | —                                           | Every mutation → audit_log with actor_user_id, actor_ip, actor_user_agent, immutable hash chain              | A.12.4.2, CC7.3    |
| T-5  | Information Disclosure | IDOR — user A fetches user B's resource | Direct API call with guessed ID             | `app.workspace_id` SET per request + RLS forces filter + isolation E2E tests                                 | A.9.4.1, CC6.1     |
| T-6  | Information Disclosure | Workspace slug enumeration              | GET with random slugs until hit             | 404 indistinguishable from 403 + rate limit 100/min/IP on lookup + audit log of attempts                     | A.13.1.1, CC6.6    |
| T-7  | Information Disclosure | GDPR export signed URL leak             | Forwarded email, browser history, proxy log | 7d expiry + email-bound token + single-use option + audit log on download                                    | A.13.2.1, CC6.7    |
| T-8  | Information Disclosure | Cross-tab leak                          | User switches in tab A, tab B stale         | URL-bound tenant context (each tab has its own URL) — by design impossible                                   | A.9.4.1            |
| T-9  | Information Disclosure | LLM prompt cache leak between customers | Provider cache shared across customers      | Provider cache keys include content hash; embedding cache key includes workspace_id                          | A.13.2.1, A.15.2.1 |
| T-10 | DoS                    | One tenant exhausts cluster resources   | Spike of queries, integration loops         | Spend cap + per-workspace pg-boss queue limit + per-workspace rate limit                                     | A.13.1.3, CC7.1    |
| T-11 | Elevation of Privilege | viewer escalates to admin               | API call bypassing RBAC                     | `assertCan(role, action)` before every mutation + RLS on `workspace_member` + audit log of role changes      | A.9.2.3, CC6.3     |
| T-12 | Elevation of Privilege | Suspended workspace bypassing read-only | Direct API call ignoring UI state           | Middleware checks `workspace.status='suspended'` → 423                                                       | A.9.2.1, CC6.2     |
| T-13 | Tampering              | Hash chain tampering                    | App server compromise + time                | Verify cron runs with separate secret + alert on chain break                                                 | A.12.4.3, CC7.2    |
| T-14 | Spoofing               | Restore token reuse / replay            | Email forwarded, token leaked               | Single-use token (DB column `consumed_at`) + bound to workspace + 30d expiry + audit log                     | A.9.4.2, CC6.7     |
| T-15 | Tampering              | User kicked mid-session retains access  | Session valid post-removal                  | Middleware revalidates membership every request (cache 60s)                                                  | A.9.2.6, CC6.2     |
| T-16 | Information Disclosure | Backup contains cross-tenant data       | DB dump leak                                | Per-workspace logical export + encryption at rest + access control on backup storage                         | A.12.3.1, CC9.1    |
| T-17 | DoS                    | Audit log table bloat from one tenant   | Event spam                                  | Per-tenant insert rate limit (10k/min/workspace soft cap) + monthly partitioning + retention policy          | A.12.1.3, CC7.1    |
| T-18 | Elevation of Privilege | RLS bypass via Postgres BYPASSRLS role  | Cron infrastructure compromise              | Separate `cron_admin` role + BYPASSRLS only during explicit operations + every bypass logged + anomaly alert | A.9.2.3, CC6.1     |

### 1.5 Failure modes & graceful degradation

| Failure                                                               | Behavior                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `app.workspace_id` SET fails on connection                            | Hard fail with 500 + log alert. Tenant safety > availability.                                     |
| User accesses workspace they no longer belong to (kicked mid-session) | Middleware detects → 403 + redirect to `/workspaces` switcher                                     |
| User deletes their last workspace                                     | Redirect to onboarding "Create your first workspace"                                              |
| GDPR export job fails mid-ZIP                                         | Resumable state machine `pending → exporting:N% → uploaded → emailed`, retry from checkpoint      |
| Hard-delete cron fails mid-cascade                                    | Idempotent: each step safe to retry, advisory lock prevents concurrency                           |
| Hash chain integrity break detected                                   | Alert PagerDuty + UI banner + audit log entry + workspace NOT auto-suspended (human investigates) |
| Postgres connection pool exhausted                                    | Per-tenant queue limits prevent one workspace from monopolizing pool                              |
| Slug collision on create                                              | Validate unique + auto-suggest numeric suffix (`acme`, `acme-2`) or prompt user                   |

### 1.6 Migration plan summary

5 phases (see [§8](#8-implementation-phases--rollout) for full detail):

1. **Phase A — Foundation.** Migrations applied additively, no behavior change. RLS enabled, not forced. Modules written, tests passing.
2. **Phase B — Silent backfill.** Middleware sets `app.workspace_id`. Telemetry confirms 99%+ queries have tenant context.
3. **Phase C — RLS FORCE.** Critical tables forced first, then rest. Canary 10% → 25% → 50% → 100%.
4. **Phase D — URL migration.** Workspace switcher launched. `/[locale]/[slug]/*` routes live. Legacy redirects active 30 days.
5. **Phase E — Lifecycle features.** Soft-delete, restore, suspend, transfer, GDPR export, audit verify cron, feature flag admin UI.

Each phase has rollback procedures executable in < 5 minutes.

### 1.7 Observability contract

| Metric                                    | Type      | Alert                |
| ----------------------------------------- | --------- | -------------------- |
| `tenant.switcher.latency_ms` p95          | histogram | > 200 ms             |
| `tenant.resolver.cache_hit_rate`          | gauge     | < 90%                |
| `tenant.rls.violations_per_minute`        | counter   | > 0 → PagerDuty      |
| `tenant.isolation_test.pass_rate` (CI)    | gauge     | < 100% blocks deploy |
| `tenant.gdpr_export.duration_seconds` p95 | histogram | > 600 s              |
| `tenant.soft_delete.window_utilization`   | gauge     | informational        |
| `tenant.audit_chain.broken_workspaces`    | gauge     | > 0 → PagerDuty      |
| `tenant.suspended.active_count`           | gauge     | informational        |
| `tenant.create.rate_per_hour_per_user`    | counter   | > 5 → abuse alert    |

### 1.8 Assumptions

- Postgres ≥ 15 (RLS, JSONB, generated columns)
- pg-boss installed and configured
- Object storage available: S3-compatible (MinIO self-host, S3 Cloud)
- Email transactional service available (Resend, SES, Postmark)
- Next.js 15 + Turbopack
- Better-auth for sessions

### 1.9 Compliance evidence trail

Automated artifacts generated for future SOC2 audit:

- `tests/isolation/*` results → evidence of control CC6.1 (logical access)
- `audit_log` with hash chain → evidence of CC7.1 (system monitoring)
- GDPR export job logs → evidence of privacy controls
- Migration phase records → evidence of CC8.1 (change management)
- Per-tenant access logs → evidence of CC6.2

---

## 2. Architecture & repository layout

### 2.1 Design principles

1. **Modular boundaries with single responsibility.** Each module exposes a stable API; internals are private.
2. **Safe by default.** Code cannot make cross-tenant queries without breaking the abstraction.
3. **Defense in depth.** Application filter + RLS + isolation tests. Three barriers, never one.
4. **Stateless requests.** Each request sets its own tenant context at the start. No shared mutable global.
5. **Async by default.** Long operations (GDPR export, hard-delete, audit verify) go through pg-boss. HTTP never blocks.
6. **Built-in observability.** Each module emits structured metrics. Logs are structured with `workspace_id` always present.
7. **Reversible migrations.** Every DB migration has a `down`. Every deploy reversible in < 5 min.

### 2.2 System components

```
┌────────────────────────────────────────────────────────────────────┐
│                          ROOT MIDDLEWARE                           │
│  Resolves {locale}/{workspaceSlug}/* → sets app.workspace_id ctx   │
│  Validates membership → sets req.tenant{workspace, role, member}   │
└──────────────────────┬─────────────────────────────────────────────┘
                       │
        ┌──────────────┼─────────────────────────────────────┐
        ↓              ↓                                     ↓
┌───────────────┐ ┌─────────────────┐                ┌──────────────┐
│  UI surfaces  │ │  API routes     │                │  pg-boss     │
│  (App Router) │ │  (REST + RPC)   │                │  workers     │
└──────┬────────┘ └────────┬────────┘                └──────┬───────┘
       │                   │                                │
       └────────┬──────────┴────────────────────────────────┘
                ↓
┌─────────────────────────────────────────────────────────────────────┐
│                            DOMAIN LAYER                             │
│  ┌──────────────┐ ┌────────────┐ ┌─────────┐ ┌─────────────┐        │
│  │ tenant/      │ │ audit/     │ │ gdpr/   │ │ feature-    │        │
│  │ context      │ │ hash chain │ │ export  │ │ flags/      │        │
│  │ resolve      │ │ verify     │ │ storage │ │ check       │        │
│  │ membership   │ │ log        │ │ email   │ │ cache       │        │
│  │ lifecycle    │ │            │ │         │ │             │        │
│  └──────┬───────┘ └─────┬──────┘ └────┬────┘ └──────┬──────┘        │
└─────────┼───────────────┼─────────────┼─────────────┼───────────────┘
          ↓               ↓             ↓             ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         INFRASTRUCTURE                              │
│  Postgres (RLS enforced) · Object storage · pg-boss · Email · Cache │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.3 Repository layout

```
apps/web/
├─ middleware.ts                          ★ extend: resolve slug → ctx
│
├─ app/
│   ├─ [locale]/
│   │   ├─ (auth)/                        ← no tenant context
│   │   ├─ (no-workspace)/                ★ new: signup, /workspaces (switcher)
│   │   │   ├─ workspaces/page.tsx        — list + create
│   │   │   ├─ invites/[token]/page.tsx   — accept invite
│   │   │   └─ deleted/[id]/page.tsx      — restore window UI
│   │   └─ [workspaceSlug]/               ★ new: under tenant context
│   │       ├─ (shell)/                   ← move shell layout here
│   │       │   ├─ layout.tsx
│   │       │   ├─ page.tsx               — dashboard
│   │       │   ├─ agents/...
│   │       │   ├─ flows/...
│   │       │   ├─ conversations/...
│   │       │   └─ ...all existing features
│   │       └─ suspended/page.tsx         ★ read-only landing
│   │
│   └─ api/
│       ├─ workspaces/
│       │   ├─ route.ts                   ★ GET list mine, POST create
│       │   ├─ [slug]/route.ts            ★ GET, PATCH, DELETE (soft)
│       │   ├─ [slug]/restore/route.ts    ★ POST restore from soft-delete
│       │   ├─ [slug]/suspend/route.ts    ★ POST suspend / DELETE unsuspend
│       │   ├─ [slug]/export/route.ts     ★ POST trigger GDPR export
│       │   ├─ [slug]/audit/route.ts      ★ GET audit log + chain status
│       │   └─ [slug]/transfer/route.ts   — transfer ownership
│       └─ me/
│           └─ workspaces/route.ts        ★ GET my memberships
│
├─ lib/
│   ├─ tenant/                            ★ new module
│   │   ├─ index.ts                       — barrel exports + types
│   │   ├─ context.ts                     — withTenantContext(workspaceId) wrapper
│   │   ├─ middleware.ts                  — Next middleware integration
│   │   ├─ resolve.ts                     — slug → workspace (LRU cache)
│   │   ├─ membership.ts                  — checkMembership(userId, workspaceId)
│   │   ├─ lifecycle.ts                   — soft-delete, suspend, restore
│   │   ├─ session.ts                     — read activeWorkspaceSlug from cookie
│   │   ├─ guards.ts                      — requireTenantContext(), requireRole()
│   │   ├─ migration.ts                   — Phase A/B/C helpers
│   │   └─ telemetry.ts                   — emit metrics
│   │
│   ├─ audit/                             ★ new module
│   │   ├─ index.ts                       — barrel
│   │   ├─ log.ts                         — appendAudit() — async via pg-boss
│   │   ├─ chain.ts                       — hash calc (sha256(prev + payload))
│   │   ├─ verify.ts                      — verifyChain(workspaceId)
│   │   ├─ verify-job.ts                  — pg-boss worker
│   │   └─ types.ts                       — AuditAction enum + payloads
│   │
│   ├─ gdpr/                              ★ new module
│   │   ├─ index.ts
│   │   ├─ export-job.ts                  — pg-boss worker, state machine
│   │   ├─ exporters/                     — one per domain
│   │   │   ├─ workspace.ts
│   │   │   ├─ agents.ts
│   │   │   ├─ conversations.ts
│   │   │   ├─ knowledge.ts
│   │   │   ├─ memory.ts
│   │   │   └─ integrations.ts
│   │   ├─ zip-builder.ts                 — stream zip
│   │   ├─ storage.ts                     — S3/MinIO put + signed URL
│   │   └─ email.ts                       — delivery
│   │
│   ├─ feature-flags/                     ★ new module
│   │   ├─ index.ts
│   │   ├─ check.ts                       — isEnabled(workspaceId, flagKey)
│   │   ├─ cache.ts                       — in-memory cache + invalidation
│   │   └─ admin.ts                       — internal admin set/unset
│   │
│   └─ workspace.ts                       ★ refactor: existing, now delegates
│
├─ components/
│   └─ workspace/                         ★ new module
│       ├─ WorkspaceSwitcher.tsx          — topbar dropdown
│       ├─ WorkspaceMenu.tsx              — open menu content
│       ├─ CreateWorkspaceModal.tsx       — slug + name + plan
│       ├─ InviteMemberQuickAction.tsx    — modal from switcher
│       ├─ SuspendedBanner.tsx            — overlay when ws.status='suspended'
│       ├─ DeletedWorkspaceRestoreCard.tsx
│       ├─ WorkspaceListEmpty.tsx
│       └─ hooks/
│           ├─ useActiveWorkspace.ts
│           └─ useMyWorkspaces.ts
│
└─ tests/
    ├─ isolation/                         ★ new suite
    │   ├─ helpers.ts                     — setupTwoWorkspaces() fixture
    │   ├─ api-routes.spec.ts             — all API routes with 2 workspaces
    │   ├─ rls-policies.spec.ts           — bypass attempts (raw SQL)
    │   └─ session-context.spec.ts        — middleware sets correctly
    ├─ lifecycle/
    │   ├─ soft-delete.spec.ts
    │   ├─ restore.spec.ts
    │   ├─ hard-delete-cron.spec.ts
    │   ├─ suspend.spec.ts
    │   └─ gdpr-export.spec.ts
    └─ audit/
        ├─ hash-chain.spec.ts
        ├─ verify-job.spec.ts
        └─ tamper-detection.spec.ts

packages/db/src/schema/
├─ workspaces.ts                          ★ extend: status, deleted_at, etc.
├─ audit.ts                               ★ new: audit_log table
├─ feature-flags.ts                       ★ new: feature_flag table
└─ gdpr.ts                                ★ new: gdpr_export_job state

packages/db/migrations/
├─ NNNN_workspace_lifecycle.sql           ★ add columns + indices
├─ NNNN_audit_log.sql                     ★ create + RLS + REVOKE
├─ NNNN_feature_flags.sql                 ★ create + RLS
├─ NNNN_gdpr_export_jobs.sql              ★ create + RLS
└─ NNNN_rls_policies.sql                  ★ enable per table (Phase A→C)
```

### 2.4 Module contracts

#### `lib/tenant/`

```typescript
// context.ts — heart of the module
export interface TenantContext {
  workspace: Workspace; // active workspace
  member: WorkspaceMember; // current user's membership
  role: WorkspaceMemberRole; // owner | admin | editor | viewer
}

/**
 * Set Postgres session var + run callback. The DB connection used inside
 * the callback has app.workspace_id set, so RLS policies enforce isolation.
 *
 * Throws TenantContextError if workspaceId is null/invalid.
 */
export function withTenantContext<T>(
  workspaceId: string,
  fn: (ctx: TenantContext) => Promise<T>
): Promise<T>;

// resolve.ts
export async function resolveBySlug(slug: string): Promise<Workspace | null>;
export async function resolveById(id: string): Promise<Workspace | null>;
export function invalidateCache(workspaceIdOrSlug: string): void;

// guards.ts — for server components + route handlers
export async function requireTenantContext(): Promise<TenantContext>;
export async function requireRole(action: Action): Promise<TenantContext>;

// lifecycle.ts
export async function softDelete(
  workspaceId: string,
  actor: User
): Promise<void>;
export async function restore(workspaceId: string, actor: User): Promise<void>;
export async function suspend(
  workspaceId: string,
  reason: string,
  actor: User
): Promise<void>;
export async function unsuspend(
  workspaceId: string,
  actor: User
): Promise<void>;
export async function isAccessible(workspace: Workspace): {
  ok: boolean;
  reason?: "suspended" | "deleted";
};
```

#### `lib/audit/`

```typescript
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
  | "member.invite"
  | "member.role_change"
  | "member.remove"
  | "apikey.create"
  | "apikey.revoke"
  | "agent.create"
  | "agent.delete";

export interface AuditEntry {
  action: AuditAction;
  actorUserId: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
}

/**
 * Append to audit_log. Computes hash from prev entry of this workspace.
 * Async via pg-boss to keep request path fast.
 */
export function appendAudit(workspaceId: string, entry: AuditEntry): void;
export function computeHash(prevHash: string | null, payload: object): string;

export interface ChainVerifyResult {
  workspaceId: string;
  entriesChecked: number;
  brokenAt: { entryId: string; expectedHash: string; foundHash: string } | null;
  verifiedAt: Date;
}
export async function verifyChain(
  workspaceId: string
): Promise<ChainVerifyResult>;
```

#### `lib/gdpr/`

```typescript
export interface GdprExportRequest {
  workspaceId: string;
  requestedBy: string;
  format: "json" | "json+csv";
}

export type ExportState =
  | "pending"
  | "exporting"
  | "uploading"
  | "emailing"
  | "completed"
  | "failed";

export async function requestExport(
  req: GdprExportRequest
): Promise<{ jobId: string }>;
export async function getExportStatus(jobId: string): Promise<{
  state: ExportState;
  progress: number;
  signedUrl?: string;
  expiresAt?: Date;
}>;
```

### 2.5 Tenant context propagation

```typescript
// middleware.ts (Next.js root middleware)
import { NextResponse } from "next/server";
import { tenant } from "@/lib/tenant";

export async function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);

  if (isPublicRoute(segments)) return NextResponse.next();

  const slug = extractWorkspaceSlug(segments);
  if (!slug) return NextResponse.next();

  const ws = await tenant.resolveBySlug(slug);
  if (!ws)
    return NextResponse.redirect(
      new URL(`/${locale}/workspaces?error=not_found`, url)
    );
  if (ws.deletedAt)
    return NextResponse.redirect(new URL(`/${locale}/deleted/${ws.id}`, url));

  const session = await getSession(req);
  if (!session) return redirectToLogin();

  const member = await tenant.checkMembership(session.user.id, ws.id);
  if (!member)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const res = NextResponse.next();
  res.headers.set("x-tenant-id", ws.id);
  res.headers.set("x-tenant-slug", ws.slug);
  return res;
}
```

```typescript
// lib/tenant/context.ts
export async function withTenantContext<T>(
  workspaceId: string,
  fn: (ctx: TenantContext) => Promise<T>
): Promise<T> {
  const ws = await resolveById(workspaceId);
  if (!ws) throw new TenantContextError("workspace_not_found");
  const session = await getCurrentSession();
  if (!session) throw new TenantContextError("no_session");
  const member = await checkMembership(session.user.id, workspaceId);
  if (!member) throw new TenantContextError("not_a_member");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`
    );
    const ctx: TenantContext = { workspace: ws, member, role: member.role };
    return fn(ctx);
  });
}
```

**Why transaction:** `SET LOCAL` requires transaction. Without tx, the SET is not applied. This guarantees every query inside the callback has `app.workspace_id` set → RLS enforces.

### 2.6 Scalability considerations

| Concern                          | Mitigation                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slug resolver hot path           | LRU cache 5 min TTL in process. Invalidate on `workspace.update`. Multi-instance: Redis pub/sub for invalidations (Phase 2).                          |
| Audit log table size             | Partitioning by month (`audit_log_2026_05`). Drop partitions older than retention.                                                                    |
| Hash chain verify cost           | Per workspace, not global. Job parallelizable. Workspaces with > 1M entries: incremental (last N entries per run + full verify weekly).               |
| GDPR export with huge workspaces | Stream zip (no RAM load). Resumable state machine.                                                                                                    |
| Per-tenant pg-boss queue depth   | `max_queue_per_workspace` config; reject excess submissions.                                                                                          |
| RLS overhead                     | Measurable via benchmark. Target: < 5% throughput hit. If exceeded, fall back to application-only filter on hot path (FORCE on critical tables only). |

### 2.7 Security in this layer

- **Defense-in-depth = 3 mandatory layers per workspace_id table:**
  1. App-level filter (Drizzle query with `eq(t.workspaceId, ctx.workspace.id)`)
  2. RLS policy (`USING (workspace_id = current_setting('app.workspace_id'))`)
  3. E2E isolation test verifying zero leak
- **`REVOKE ALL` on audit_log for INSERT-only:** app role cannot UPDATE/DELETE audit log rows.
- **Slug enumeration mitigation:** 404 indistinguishable from 403 (same body, same timing — rate limit on endpoint).
- **Workspace creation rate limit:** 5/hour/user (configurable via feature flag).
- **Per-tenant secret isolation:** encrypted credentials (`credentialsEncrypted`, `aiProviders.apiKey`) already scoped; RLS reinforces.

---

## 3. Data model & migrations

### 3.1 Workspace table extension

```sql
-- migrations/NNNN_workspace_lifecycle.sql

CREATE TYPE workspace_status AS ENUM ('active', 'suspended', 'deleted');

ALTER TABLE workspace
  ADD COLUMN status workspace_status NOT NULL DEFAULT 'active',
  ADD COLUMN suspended_at timestamp,
  ADD COLUMN suspended_reason text,
  ADD COLUMN suspended_by_user_id text REFERENCES "user"(id),
  ADD COLUMN deleted_at timestamp,
  ADD COLUMN delete_scheduled_at timestamp,
  ADD COLUMN deleted_by_user_id text REFERENCES "user"(id),
  ADD COLUMN restore_token text UNIQUE,
  ADD COLUMN restore_token_consumed_at timestamp,
  ADD COLUMN owner_user_id text REFERENCES "user"(id);

CREATE INDEX idx_workspace_status ON workspace(status) WHERE status != 'active';
CREATE INDEX idx_workspace_delete_scheduled ON workspace(delete_scheduled_at)
  WHERE delete_scheduled_at IS NOT NULL;
CREATE INDEX idx_workspace_owner ON workspace(owner_user_id);

UPDATE workspace w SET owner_user_id = (
  SELECT m.user_id FROM workspace_member m
  WHERE m.workspace_id = w.id AND m.role = 'owner'
  ORDER BY m.created_at ASC LIMIT 1
);

ALTER TABLE workspace
  ADD CONSTRAINT workspace_owner_must_be_member CHECK (owner_user_id IS NOT NULL),
  ADD CONSTRAINT workspace_lifecycle_consistent CHECK (
    (status = 'active' AND deleted_at IS NULL AND suspended_at IS NULL) OR
    (status = 'suspended' AND deleted_at IS NULL AND suspended_at IS NOT NULL) OR
    (status = 'deleted' AND deleted_at IS NOT NULL AND delete_scheduled_at IS NOT NULL)
  );
```

### 3.2 Lifecycle state machine

```
                       ┌─────────────┐
                       │   active    │◀────────────┐
                       └──┬───┬──────┘             │
                          │   │                    │  unsuspend()
                  suspend()│   │softDelete()        │  / restore()
                          ↓   ↓                    │
                   ┌──────────┐  ┌──────────┐      │
                   │suspended │  │ deleted  │──────┘
                   └────┬─────┘  │  (≤30d)  │
                        │        └─────┬────┘
                        │              │ delete_scheduled_at passed
                        │              ↓
                        │       ┌──────────────┐
                        │       │ HARD-DELETED │  ← cron, row physically gone
                        │       │  (no row)    │
                        └──────▶ (suspend can be restored OR deleted normally)
```

**Transition rules** (enforced by `lib/tenant/lifecycle.ts` + DB CHECK):

| From      | To        | Triggered by                                                      | Action                                                                                                     |
| --------- | --------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| active    | suspended | admin via API (`POST /workspaces/[slug]/suspend`)                 | set `status='suspended'`, `suspended_at=NOW()`, audit                                                      |
| suspended | active    | admin via API (`DELETE /workspaces/[slug]/suspend`)               | clear suspend fields, audit                                                                                |
| active    | deleted   | owner via API (`DELETE /workspaces/[slug]`)                       | set `status='deleted'`, `deleted_at=NOW()`, `delete_scheduled_at=NOW()+30d`, `restore_token=random`, audit |
| suspended | deleted   | owner only (must unsuspend first OR force=true)                   | same as above                                                                                              |
| deleted   | active    | owner within 30d via `POST /workspaces/[slug]/restore` with token | clear delete fields, audit                                                                                 |
| deleted   | (gone)    | cron `hard_delete_workspace` after `delete_scheduled_at`          | `DELETE FROM workspace WHERE id=X` → CASCADE cleans everything                                             |

### 3.3 Audit log — tamper-evident

```sql
-- migrations/NNNN_audit_log.sql

CREATE TABLE audit_log (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,

  -- Chain integrity
  seq bigint NOT NULL,
  prev_hash char(64),
  payload_hash char(64) NOT NULL,
  chain_hash char(64) NOT NULL,

  -- Identity
  action text NOT NULL,
  actor_user_id text REFERENCES "user"(id),
  actor_kind text NOT NULL,
  actor_ip inet,
  actor_user_agent text,

  -- Target
  target_type text NOT NULL,
  target_id text NOT NULL,

  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, seq)
);

CREATE INDEX idx_audit_workspace_seq ON audit_log(workspace_id, seq DESC);
CREATE INDEX idx_audit_workspace_action ON audit_log(workspace_id, action, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id, created_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_audit_target ON audit_log(target_type, target_id, created_at DESC);

REVOKE UPDATE, DELETE ON audit_log FROM app_user;
GRANT SELECT, INSERT ON audit_log TO app_user;
```

### 3.4 Hash chain algorithm

```typescript
// lib/audit/chain.ts
import { createHash } from "crypto";

function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize((obj as any)[k]))
      .join(",") +
    "}"
  );
}

export function computePayloadHash(entry: {
  action: string;
  actorUserId: string | null;
  actorKind: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown>;
  createdAt: Date;
}): string {
  const canonical = canonicalize({
    action: entry.action,
    actor_user_id: entry.actorUserId,
    actor_kind: entry.actorKind,
    target_type: entry.targetType,
    target_id: entry.targetId,
    meta: entry.meta,
    created_at: entry.createdAt.toISOString(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function computeChainHash(
  prevHash: string | null,
  payloadHash: string,
  seq: bigint
): string {
  const prev = prevHash ?? "0".repeat(64);
  return createHash("sha256")
    .update(`${prev}|${payloadHash}|${seq}`)
    .digest("hex");
}
```

### 3.5 Append flow (atomic per workspace)

```typescript
export async function appendAuditSync(
  workspaceId: string,
  entry: AuditEntryInput
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`
    );

    const last = await tx
      .select({ seq: audit_log.seq, chainHash: audit_log.chainHash })
      .from(audit_log)
      .where(eq(audit_log.workspaceId, workspaceId))
      .orderBy(desc(audit_log.seq))
      .limit(1);

    const nextSeq = (last[0]?.seq ?? 0n) + 1n;
    const prevHash = last[0]?.chainHash ?? null;

    const createdAt = new Date();
    const payloadHash = computePayloadHash({ ...entry, createdAt });
    const chainHash = computeChainHash(prevHash, payloadHash, nextSeq);

    await tx.insert(audit_log).values({
      id: cuid(),
      workspaceId,
      seq: nextSeq,
      prevHash,
      payloadHash,
      chainHash,
      ...entry,
      createdAt,
    });
  });
}
```

### 3.6 Verify job

```typescript
export async function verifyChain(
  workspaceId: string
): Promise<ChainVerifyResult> {
  const entries = await db
    .select()
    .from(audit_log)
    .where(eq(audit_log.workspaceId, workspaceId))
    .orderBy(asc(audit_log.seq));

  let prevHash: string | null = null;
  for (const e of entries) {
    const expectedPayloadHash = computePayloadHash(e);
    const expectedChainHash = computeChainHash(
      prevHash,
      expectedPayloadHash,
      e.seq
    );

    if (
      e.payloadHash !== expectedPayloadHash ||
      e.chainHash !== expectedChainHash
    ) {
      return {
        workspaceId,
        entriesChecked: Number(e.seq),
        brokenAt: {
          entryId: e.id,
          expectedHash: expectedChainHash,
          foundHash: e.chainHash,
        },
        verifiedAt: new Date(),
      };
    }
    prevHash = e.chainHash;
  }

  return {
    workspaceId,
    entriesChecked: entries.length,
    brokenAt: null,
    verifiedAt: new Date(),
  };
}
```

### 3.7 Feature flags

```sql
-- migrations/NNNN_feature_flags.sql

CREATE TABLE feature_flag (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  flag_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  rolled_out_at timestamptz,
  set_by_user_id text REFERENCES "user"(id),
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, flag_key)
);

CREATE INDEX idx_feature_flag_workspace ON feature_flag(workspace_id);
CREATE INDEX idx_feature_flag_enabled ON feature_flag(workspace_id, flag_key) WHERE enabled = true;
```

### 3.8 GDPR export jobs

```sql
-- migrations/NNNN_gdpr_export_jobs.sql

CREATE TYPE gdpr_export_state AS ENUM (
  'pending', 'exporting', 'uploading', 'emailing', 'completed', 'failed'
);

CREATE TABLE gdpr_export_job (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  requested_by_user_id text NOT NULL REFERENCES "user"(id),
  state gdpr_export_state NOT NULL DEFAULT 'pending',
  progress integer NOT NULL DEFAULT 0,
  format text NOT NULL DEFAULT 'json+csv',

  storage_key text,
  signed_url text,
  signed_url_expires_at timestamptz,
  bytes_total bigint,

  error text,
  retry_count integer NOT NULL DEFAULT 0,
  checkpoint jsonb,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX idx_gdpr_export_workspace ON gdpr_export_job(workspace_id, created_at DESC);
CREATE INDEX idx_gdpr_export_state ON gdpr_export_job(state)
  WHERE state IN ('pending', 'exporting', 'uploading', 'emailing');
```

### 3.9 Idempotency keys

```sql
CREATE TABLE idempotency_key (
  key text NOT NULL,
  workspace_id text,
  user_id text NOT NULL REFERENCES "user"(id),
  endpoint text NOT NULL,
  request_hash char(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL DEFAULT NOW() + INTERVAL '24 hours',

  PRIMARY KEY (user_id, endpoint, key)
);
CREATE INDEX idx_idempotency_expires ON idempotency_key(expires_at);
```

### 3.10 Security event log

```sql
CREATE TABLE security_event (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspace(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity text NOT NULL,
  actor_user_id text,
  actor_ip inet,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

REVOKE UPDATE, DELETE ON security_event FROM app_user;
```

### 3.11 RLS — full SQL

#### Postgres roles & grants

```sql
CREATE ROLE app_user NOINHERIT LOGIN PASSWORD '<from-secret-manager>';
CREATE ROLE cron_admin NOINHERIT LOGIN PASSWORD '<from-secret-manager>' BYPASSRLS;
CREATE ROLE read_only_audit NOINHERIT LOGIN PASSWORD '<from-secret-manager>';

GRANT CONNECT ON DATABASE orchester TO app_user, cron_admin, read_only_audit;
GRANT USAGE ON SCHEMA public TO app_user, cron_admin, read_only_audit;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO app_user, cron_admin;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO read_only_audit;

REVOKE UPDATE, DELETE ON audit_log FROM app_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user, cron_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

#### GUC helpers

```sql
CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::text;
$$;

CREATE OR REPLACE FUNCTION is_cross_tenant_admin()
RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT current_setting('app.cross_tenant_admin', true) = 'true';
$$;
```

#### Policy patterns — the 3 shapes

**Pattern A — Direct workspace_id column** (most tables):

```sql
CREATE OR REPLACE FUNCTION apply_pattern_a(tbl text)
RETURNS void LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

  EXECUTE format('
    CREATE POLICY %I_tenant_select ON %I FOR SELECT
    USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  ', tbl, tbl);

  EXECUTE format('
    CREATE POLICY %I_tenant_insert ON %I FOR INSERT
    WITH CHECK (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  ', tbl, tbl);

  EXECUTE format('
    CREATE POLICY %I_tenant_update ON %I FOR UPDATE
    USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    WITH CHECK (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  ', tbl, tbl);

  EXECUTE format('
    CREATE POLICY %I_tenant_delete ON %I FOR DELETE
    USING (workspace_id = current_workspace_id() OR is_cross_tenant_admin())
  ', tbl, tbl);
END;
$$;

SELECT apply_pattern_a(tbl) FROM (VALUES
  ('agent'), ('team'), ('channel'), ('employee'), ('conversation'),
  ('flow'), ('flow_run'), ('integration'), ('api_key'),
  ('knowledge_base'), ('knowledge_doc'), ('knowledge_chunk'),
  ('agent_memory'), ('audit_log'), ('feature_flag'),
  ('gdpr_export_job'), ('conversation_label'), ('notification_pref'),
  ('ai_provider'), ('webhook_out'), ('idempotency_key')
) AS t(tbl);
```

**Pattern B — Indirect (JOIN to parent)** (e.g. `message → conversation`):

```sql
ALTER TABLE message ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_tenant_select ON message FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );

CREATE POLICY message_tenant_insert ON message FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversation c
      WHERE c.id = message.conversation_id
        AND (c.workspace_id = current_workspace_id() OR is_cross_tenant_admin())
    )
  );
```

**Pattern C — Special tables** (`workspace`, `workspace_member`):

```sql
ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_member_select ON workspace FOR SELECT
  USING (
    id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR EXISTS (
      SELECT 1 FROM workspace_member m
      WHERE m.workspace_id = workspace.id
        AND m.user_id = current_setting('app.user_id', true)::text
    )
  );

ALTER TABLE workspace_member ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_member_tenant ON workspace_member FOR ALL
  USING (
    workspace_id = current_workspace_id()
    OR is_cross_tenant_admin()
    OR (user_id = current_setting('app.user_id', true)::text AND TG_OP = 'SELECT')
  )
  WITH CHECK (workspace_id = current_workspace_id() OR is_cross_tenant_admin());
```

#### Phase-aware FORCE enforcement

```sql
-- Phase C — FORCE on critical tables first
ALTER TABLE agent_memory FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunk FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation FORCE ROW LEVEL SECURITY;
ALTER TABLE message FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_flag FORCE ROW LEVEL SECURITY;
ALTER TABLE gdpr_export_job FORCE ROW LEVEL SECURITY;
ALTER TABLE ai_provider FORCE ROW LEVEL SECURITY;
ALTER TABLE integration FORCE ROW LEVEL SECURITY;
ALTER TABLE api_key FORCE ROW LEVEL SECURITY;
```

`FORCE` means even the table owner (app_user) is subject to RLS — no escape hatch.

### 3.12 Migration order

```
NNN1_workspace_lifecycle.sql       Phase A — additive, no break
NNN2_audit_log.sql                 Phase A — new table + REVOKE
NNN3_feature_flags.sql             Phase A — new table
NNN4_gdpr_export_jobs.sql          Phase A — new table
NNN5_rls_helpers.sql               Phase A — functions
NNN6_rls_enable_no_force.sql       Phase A — RLS on, not forced
NNN7_idempotency_key.sql           Phase A — new table
NNN8_security_event.sql            Phase A — new table
NNN9_rls_force_critical.sql        Phase C — FORCE on critical tables
NNN10_rls_force_rest.sql           Phase C — FORCE on remaining tables
NNN11_partition_audit_log.sql      Phase E — when audit_log > 10M rows
```

Each migration has its `.down.sql` rollback.

---

## 4. API surface

### 4.1 API design principles

1. REST on Next.js Route Handlers (no GraphQL in this sub-spec)
2. Shared types in `lib/tenant/api-types.ts`
3. Uniform error model with enumerable `code`
4. RBAC enforced via `assertCan(role, action)` before every mutation
5. Idempotency keys for resource-creating POSTs
6. Request ID propagated through logs and pg-boss jobs
7. Versioning via path (`/api/v1/...`) reserved for the future
8. No breaking changes to existing routes during Phase D

### 4.2 Uniform error model

```typescript
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  detail?: Record<string, unknown>;
  fields?: Record<string, string>;
  requestId: string;
}

export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_a_member"
  | "role_insufficient"
  | "workspace_not_found"
  | "workspace_suspended"
  | "workspace_deleted"
  | "workspace_slug_taken"
  | "workspace_lifecycle_invalid"
  | "validation_failed"
  | "idempotency_conflict"
  | "rate_limited"
  | "quota_exceeded"
  | "spend_cap_reached"
  | "tenant_context_missing"
  | "rls_violation"
  | "internal_error"
  | "service_unavailable";
```

### 4.3 Endpoint inventory

**Workspace lifecycle:**

```
GET    /api/me/workspaces
POST   /api/workspaces
GET    /api/workspaces/[slug]
PATCH  /api/workspaces/[slug]
DELETE /api/workspaces/[slug]
POST   /api/workspaces/[slug]/restore
POST   /api/workspaces/[slug]/suspend
DELETE /api/workspaces/[slug]/suspend
POST   /api/workspaces/[slug]/transfer
POST   /api/workspaces/[slug]/export
GET    /api/workspaces/[slug]/export/[jobId]
GET    /api/workspaces/[slug]/audit
GET    /api/workspaces/[slug]/audit/verify
GET    /api/workspaces/[slug]/feature-flags
PUT    /api/workspaces/[slug]/feature-flags/[key]
POST   /api/me/active-workspace
```

**Membership** (extending existing routes):

```
GET    /api/workspaces/[slug]/members
POST   /api/workspaces/[slug]/invites
PATCH  /api/workspaces/[slug]/members/[userId]
DELETE /api/workspaces/[slug]/members/[userId]
```

### 4.4 RBAC matrix

| Endpoint                                     | viewer | editor | admin | owner         |
| -------------------------------------------- | ------ | ------ | ----- | ------------- |
| `GET /me/workspaces`                         | ✓      | ✓      | ✓     | ✓             |
| `POST /workspaces`                           | ✓      | ✓      | ✓     | ✓             |
| `GET /workspaces/[slug]`                     | ✓      | ✓      | ✓     | ✓             |
| `PATCH /workspaces/[slug]` (name/tz)         | ✗      | ✗      | ✓     | ✓             |
| `PATCH /workspaces/[slug]` (slug)            | ✗      | ✗      | ✗     | ✓             |
| `DELETE /workspaces/[slug]`                  | ✗      | ✗      | ✗     | ✓             |
| `POST /workspaces/[slug]/restore`            | ✗      | ✗      | ✗     | ✓ (or token)  |
| `POST /workspaces/[slug]/suspend`            | ✗      | ✗      | ✗     | (super-admin) |
| `POST /workspaces/[slug]/transfer`           | ✗      | ✗      | ✗     | ✓             |
| `POST /workspaces/[slug]/export`             | ✗      | ✗      | ✗     | ✓             |
| `GET /workspaces/[slug]/audit`               | ✗      | ✗      | ✓     | ✓             |
| `GET /workspaces/[slug]/audit/verify`        | ✗      | ✗      | ✓     | ✓             |
| `GET /workspaces/[slug]/feature-flags`       | ✗      | ✗      | ✓     | ✓             |
| `PUT /workspaces/[slug]/feature-flags/[key]` | ✗      | ✗      | ✓     | ✓             |

### 4.5 Rate limiting

| Endpoint                          | Scope         | Limit                |
| --------------------------------- | ------------- | -------------------- |
| `POST /workspaces`                | per user      | 5/h                  |
| `POST /workspaces/[slug]/export`  | per workspace | 1 concurrent + 5/day |
| `POST /workspaces/[slug]/invites` | per workspace | 50/h                 |
| Slug enumeration mitigation       | per IP        | 100/min              |
| Audit log reads                   | per workspace | 600/h                |
| Other mutations                   | per user      | 600/min              |

### 4.6 Idempotency

Endpoints accepting `Idempotency-Key`:

```
POST /api/workspaces
POST /api/workspaces/[slug]/export
POST /api/workspaces/[slug]/invites
POST /api/workspaces/[slug]/transfer
```

```typescript
// lib/api/idempotency.ts
export async function withIdempotency<T>(
  req: NextRequest,
  endpoint: string,
  userId: string,
  workspaceId: string | null,
  handler: () => Promise<{ status: number; body: T }>
): Promise<NextResponse<T | ApiError>> {
  const key = req.headers.get("idempotency-key");
  if (!key)
    return handler().then((r) =>
      NextResponse.json(r.body, { status: r.status })
    );

  const requestHash = await sha256(await req.clone().text());
  const existing = await getIdempotencyRecord(userId, endpoint, key);

  if (existing) {
    if (existing.request_hash !== requestHash) {
      return err("idempotency_conflict", "Same key, different body");
    }
    return NextResponse.json(existing.response_body, {
      status: existing.response_status,
    });
  }

  const result = await handler();
  await saveIdempotencyRecord({
    key,
    userId,
    workspaceId,
    endpoint,
    requestHash,
    ...result,
  });
  return NextResponse.json(result.body, { status: result.status });
}
```

### 4.7 Request ID & tracing

```typescript
// middleware.ts
import { randomUUID } from "crypto";

export function middleware(req: NextRequest) {
  const reqId = req.headers.get("x-request-id") ?? randomUUID();
  const res = NextResponse.next();
  res.headers.set("x-request-id", reqId);
  return res;
}
```

Every audit log entry, log line, and pg-boss job carries the `requestId`.

---

## 5. UI surface

### 5.1 UX principles

1. **Workspace context always visible** — slug in URL + name+avatar in topbar
2. **Keyboard-first** — `⌘K` switcher, `⌘⇧W` create workspace, `Enter` to confirm
3. **Explicit loading / empty / error states** — never blank screens
4. **A11y baseline** WCAG 2.1 AA
5. **Confirmation proportional to damage** — workspace delete requires typing the slug
6. **i18n by default** — all strings via `next-intl`
7. **Cognitive load reduction** — switcher shows ≤ 8 workspaces + search
8. **Mobile-aware** — switcher collapses to bottom sheet at < 768px

### 5.2 Components inventory

```
components/workspace/
├─ WorkspaceSwitcher.tsx              ← topbar entry point
├─ WorkspaceMenu.tsx                  ← dropdown content
├─ WorkspaceMenuItem.tsx              ← row with avatar+name+status
├─ WorkspaceAvatar.tsx                ← rounded square with initials + color
├─ CreateWorkspaceModal.tsx           ← name + slug + timezone
├─ InviteMemberQuickAction.tsx        ← modal from switcher
├─ TransferOwnershipModal.tsx         ← owner-only with confirmation
├─ SoftDeleteWorkspaceModal.tsx       ← confirmation with slug typing
├─ SuspendedBanner.tsx                ← overlay banner when status=suspended
├─ DeletedWorkspaceRestoreCard.tsx    ← landing /deleted/[id]
├─ GdprExportProgress.tsx             ← bottom sheet with state machine
├─ AuditLogViewer.tsx                 ← settings tab
├─ AuditChainStatusBadge.tsx          ← "✓ Intact" / "⚠ Broken"
├─ FeatureFlagAdminPanel.tsx          ← settings tab
└─ hooks/
    ├─ useActiveWorkspace.ts
    ├─ useMyWorkspaces.ts
    ├─ useWorkspaceLifecycle.ts
    └─ useAuditLog.ts
```

### 5.3 Workspace switcher (topbar)

Position: sidebar header. Replaces the standalone "Orchester" logo with a combo: logo + workspace picker.

```
┌──────────────────────────────────────────────┐
│ ┌─┐  ┌─────────────────────────────────┐ ▼  │
│ │O│  │  ●  Acme HR                     │    │
│ └─┘  │     acme-hr                     │    │
│      └─────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

Click opens `WorkspaceMenu`. `⌘K` opens too. `aria-haspopup="menu"`, `aria-expanded`.

Status indicators:

- `active` → emerald-400 dot
- `suspended` → amber-400 dot + "PAUSED" badge
- `deleted` → rose-400 dot + "DELETED" (redirect to /deleted/[id])

### 5.4 Workspace menu layout

```
┌────────────────────────────────────────────────┐
│  Workspaces                              [×]   │
│  ┌────────────────────────────────────────┐    │
│  │ 🔍 Search workspaces…                  │    │
│  └────────────────────────────────────────┘    │
│                                                │
│  CURRENT                                       │
│  ●  ┌──┐ Acme HR              owner  ✓        │
│     │AH│ acme-hr                              │
│     └──┘                                       │
│                                                │
│  OTHER WORKSPACES                              │
│  ●  ┌──┐ Acme Marketing       admin           │
│     │AM│ acme-marketing                       │
│     └──┘                                       │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ + Create workspace                  ⌘⇧W  │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │ ✉  Invite teammate to Acme HR             │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

Behavior:

- Open: instant (cached `useMyWorkspaces`), then SWR revalidate
- Search: client-side fuzzy match
- Click row: `router.push(/{locale}/{slug}/...)` preserving compatible path
- Keyboard: `↑/↓` navigate, `Enter` choose, `Esc` close

### 5.5 Create workspace modal

```
┌──────────────────────────────────────────────────┐
│  Create workspace                          [×]   │
├──────────────────────────────────────────────────┤
│                                                  │
│  Workspace name                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ Acme Marketing                             │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  URL slug                              ✓ available
│  orchester.io/  ┌──────────────────────────┐    │
│                 │ acme-marketing           │    │
│                 └──────────────────────────┘    │
│  Lowercase letters, numbers, hyphens             │
│                                                  │
│  Timezone                                        │
│  ┌────────────────────────────────────────────┐  │
│  │ America/Argentina/Buenos_Aires        ▼   │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Accent color                                    │
│  ● ● ● ● ● ● ● ●                                │
│                                                  │
├──────────────────────────────────────────────────┤
│              [ Cancel ]    [ Create workspace ]  │
└──────────────────────────────────────────────────┘
```

Validation:

- name: 2-80 chars
- slug: `[a-z0-9-]+`, 3-40 chars, debounced availability check
- timezone: IANA valid

On submit: POST `/api/workspaces` with `Idempotency-Key`, optimistic UI update, navigate to `/{locale}/{slug}`.

### 5.6 Soft-delete modal

Confirmation with typing the slug (GitHub/Linear pattern):

```
┌──────────────────────────────────────────────────┐
│  ⚠ Delete Acme HR                       [×]     │
├──────────────────────────────────────────────────┤
│                                                  │
│  This will:                                      │
│  ✓ Hide the workspace from all members           │
│  ✓ Pause all integrations and channels           │
│  ✓ Stop all agents and flows                     │
│  ✓ Send you an email with a restore link         │
│                                                  │
│  You have 30 days to restore. After that, all    │
│  data is permanently deleted.                    │
│                                                  │
│  Reason (optional)                               │
│  ┌────────────────────────────────────────────┐  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  Type the workspace slug to confirm:             │
│  ┌────────────────────────────────────────────┐  │
│  │ acme-hr                                    │  │
│  └────────────────────────────────────────────┘  │
│  Expected: acme-hr                               │
│                                                  │
├──────────────────────────────────────────────────┤
│           [ Cancel ]    [ Delete workspace ]    │
└──────────────────────────────────────────────────┘
```

### 5.7 Suspended workspace banner

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⚠ This workspace is paused (read-only)                                 │
│   You can view data and export, but cannot edit or send messages.      │
│   Reason: Payment overdue.       [ Contact support ]  [ View details ] │
└────────────────────────────────────────────────────────────────────────┘
```

Sticky top, slides down on mount. UI buttons disabled with tooltips. API mutations return 423 → toast.

### 5.8 Deleted workspace restore card

Standalone page `/[locale]/deleted/[id]`:

```
┌────────────────────────────────────────────────────┐
│            ┌──┐                                    │
│            │AH│  Acme HR                           │
│            └──┘  acme-hr                           │
│                                                    │
│   This workspace was deleted on May 21, 2026.     │
│   You can restore it until June 20, 2026.         │
│                                                    │
│   ⏱  29 days remaining                             │
│                                                    │
│   What will be restored:                           │
│   ✓ All conversations, agents, flows               │
│   ✓ Knowledge bases and integrations               │
│   ✓ Members and their roles                        │
│                                                    │
│   What needs your attention:                       │
│   • Agents will remain inactive — re-enable        │
│     manually after restore                         │
│   • Integrations need credential refresh           │
│                                                    │
│   ┌────────────────────────────────────────────┐   │
│   │ Restore token (from email)                 │   │
│   └────────────────────────────────────────────┘   │
│                                                    │
│   [ Restore workspace ]    [ Continue deletion ]  │
└────────────────────────────────────────────────────┘
```

### 5.9 GDPR export progress

Bottom-right sticky toast:

```
States:
┌────────────────────────────┐
│ 🗃 Preparing your export   │
│ ─────────────────────────── │
│ 🔄 Exporting data…         │
│ ▓▓▓▓▓▓▓░░░░░░░░  47%       │
│ Conversations · 23k of 50k │
└────────────────────────────┘

┌────────────────────────────┐
│ 🗃 Export ready             │
│ ─────────────────────────── │
│ ✓ 4.6 MB · 50k rows        │
│ Available until May 30      │
│ [ Download ] [ Email me ]  │
└────────────────────────────┘
```

Polling: `GET /api/workspaces/[slug]/export/[jobId]` every 3s (backoff to 10s after 5 min).

### 5.10 Audit log viewer

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Audit log                              Chain status: ✓ Intact         │
│  Every critical change is recorded.     Last verified May 23, 03:00    │
│                                                                         │
│  Filters: [Action ▾] [Actor ▾] [Target type ▾] [Date range]            │
│           [Search…                                            ]         │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ #42  2 hours ago  Lucas changed Alice's role                    │   │
│  │      member.role_change · target: usr_456                       │   │
│  │      viewer → editor                                            │   │
│  │      from 203.0.113.5 · Chrome 132 on macOS                     │   │
│  │      [Show chain hash]                                          │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ ...                                                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                  [ Load more ]          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.11 A11y baseline

| Component                  | A11y rules                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `WorkspaceSwitcher`        | `aria-haspopup`, `aria-expanded`, `aria-controls`, Tab order                            |
| `WorkspaceMenu`            | Focus trap, `role="menu"`, items `role="menuitem"`, Esc closes, arrow keys              |
| `CreateWorkspaceModal`     | Focus first input, focus return on close, Esc closes, Enter submits, `aria-describedby` |
| `SoftDeleteWorkspaceModal` | `aria-modal="true"`, `aria-disabled` for button states                                  |
| `SuspendedBanner`          | `role="status"` `aria-live="polite"`                                                    |
| `GdprExportProgress`       | `role="status"` `aria-live="polite"`, progress bar `role="progressbar"`                 |
| `AuditLogViewer`           | Table semantics, sortable column headers `aria-sort`                                    |

### 5.12 i18n new keys

All strings under `messages/{en,es,pt-BR}.json` namespace `workspace`. ~60 keys covering switcher, create, delete, restore, suspended, transfer, export, audit, featureFlags, listPage, roles, errors.

### 5.13 Routing migration during Phase D

| Phase        | Old URL      | New URL             | Behavior                                                  |
| ------------ | ------------ | ------------------- | --------------------------------------------------------- |
| Phase A-C    | `/es/agents` | (n/a)               | Works as before                                           |
| Phase D      | `/es/agents` | `/es/{slug}/agents` | 301 redirect if cookie active slug, else `/es/workspaces` |
| Post-Phase D | `/es/agents` | `/es/{slug}/agents` | 404                                                       |

---

## 6. Security model

### 6.1 Reference frameworks

| Standard                       | Control families covered                    |
| ------------------------------ | ------------------------------------------- |
| **SOC 2** (AICPA TSC 2017)     | CC6, CC7, CC8, CC9                          |
| **ISO/IEC 27001:2022** Annex A | A.5, A.8, A.9, A.10, A.12, A.13, A.16, A.18 |
| **NIST 800-53**                | AC, AU, IA, SC, SI                          |

### 6.2 Defense-in-depth — five layers

```
┌───────────────────────────────────────────────────────────┐
│ LAYER 5 — Independent verification                         │
│ Daily audit chain verify · Pen test annually · Isolation   │
│ E2E suite on every CI run                                  │
├───────────────────────────────────────────────────────────┤
│ LAYER 4 — Monitoring & alerting                            │
│ RLS violation counter · Audit chain break detector         │
│ Anomaly detection on tenant create/delete rates            │
├───────────────────────────────────────────────────────────┤
│ LAYER 3 — Database enforcement (PostgreSQL RLS)            │
│ ENABLE ROW LEVEL SECURITY + FORCE on critical tables       │
│ REVOKE UPDATE/DELETE on audit_log                          │
├───────────────────────────────────────────────────────────┤
│ LAYER 2 — Application enforcement                          │
│ app.workspace_id SET per request via middleware            │
│ assertCan(role, action) before every mutation              │
│ tenantQuery() typed helper                                 │
├───────────────────────────────────────────────────────────┤
│ LAYER 1 — Network & transport                              │
│ TLS 1.3 only · HSTS · CSP · CORS strict · CSRF tokens     │
└───────────────────────────────────────────────────────────┘
```

### 6.3 Application-layer safety

**Custom ESLint rule banning unfiltered tenant queries:**

The `TENANT_TABLES` set below is illustrative; the canonical list (21 tables Pattern A + `message` Pattern B) is in §3.11. The real implementation should enumerate from schema introspection or a single shared constant to avoid drift.

```javascript
// lint-rules/require-tenant-filter.ts
export default {
  meta: { type: "problem", schema: [] },
  create(context) {
    const TENANT_TABLES = new Set([
      "agents",
      "teams",
      "channels",
      "employees",
      "conversations",
      "flows",
      "integrations",
      "apiKeys",
      "knowledgeBases",
      "knowledgeDocs",
      "knowledgeChunks",
      "agentMemories",
      "auditLog",
      "featureFlags",
      "gdprExportJobs",
      "aiProviders",
      "webhooksOut",
    ]);
    return {
      CallExpression(node) {
        if (!isDrizzleSelect(node, TENANT_TABLES)) return;
        if (!hasWorkspaceIdFilter(node)) {
          context.report({
            node,
            message:
              "Query on tenant-scoped table without workspaceId filter. Use tenantQuery() or add .where(eq(t.workspaceId, ctx.workspace.id)).",
          });
        }
      },
    };
  },
};
```

**Typed `tenantQuery` wrapper:**

```typescript
// lib/tenant/query.ts
export function tenantQuery(ctx: TenantContext) {
  const ws = ctx.workspace.id;

  return {
    agents: {
      list: () =>
        db
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.workspaceId, ws)),
      byId: (id: string) =>
        db
          .select()
          .from(schema.agents)
          .where(
            and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws))
          )
          .limit(1),
      create: (data: Omit<NewAgent, "workspaceId">) =>
        db
          .insert(schema.agents)
          .values({ ...data, workspaceId: ws })
          .returning(),
      update: (id: string, data: Partial<NewAgent>) =>
        db
          .update(schema.agents)
          .set(data)
          .where(
            and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws))
          )
          .returning(),
      delete: (id: string) =>
        db
          .delete(schema.agents)
          .where(
            and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws))
          ),
    },
  };
}
```

**RBAC guard `requireAction`:**

```typescript
// lib/tenant/guards.ts
import { assertCan, type Action } from "@/lib/rbac";

export async function requireAction(action: Action): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  assertCan(ctx.role, action);
  return ctx;
}
```

### 6.4 Authentication & session

**Cookie configuration:**

```typescript
{
  name: '__Host-orch-session',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
}
```

**Session rotation on privilege escalation:**

- Login (always)
- Invite acceptance
- Password change
- Role upgrade
- 2FA enabled/disabled

**MFA:** Required for owners/admins. Optional for editors/viewers. Re-required for sensitive operations (delete workspace, transfer ownership, API key creation).

### 6.5 Cryptographic standards

| Use case                              | Algorithm                    | Key management                                     |
| ------------------------------------- | ---------------------------- | -------------------------------------------------- |
| TLS termination                       | TLS 1.3 (1.2 fallback)       | Let's Encrypt / managed cert                       |
| Cookies signing                       | HMAC-SHA256                  | `SESSION_SECRET` 32-byte random, rotated quarterly |
| Audit log hashing                     | SHA-256                      | (no secret)                                        |
| Encryption at rest (sensitive fields) | AES-256-GCM                  | `ENCRYPTION_KEY` 32-byte (Phase 1) / KMS (Phase 2) |
| Idempotency key hashing               | SHA-256                      | (no secret)                                        |
| Signed URLs (GDPR export)             | HMAC-SHA256                  | Provider-managed (S3, MinIO)                       |
| Password hashing                      | bcrypt cost 12 (better-auth) | Per-password salt                                  |

### 6.6 API security

**Security headers (added in root middleware):**

```typescript
response.headers.set(
  "Strict-Transport-Security",
  "max-age=63072000; includeSubDomains; preload"
);
response.headers.set("X-Content-Type-Options", "nosniff");
response.headers.set("X-Frame-Options", "DENY");
response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
response.headers.set(
  "Permissions-Policy",
  "geolocation=(), microphone=(), camera=()"
);
response.headers.set(
  "Content-Security-Policy",
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ..."
);
```

**CSRF:** Double-submit cookie pattern for mutating endpoints. Skipped for API-key-authenticated requests.

**CORS:** Strict allowlist (`PUBLIC_URL`, embed origins from env).

### 6.7 Logging & monitoring

**Structured logs:**

```json
{
  "ts": "2026-05-23T13:42:01.234Z",
  "level": "info",
  "msg": "workspace.created",
  "request_id": "req_abc",
  "user_id": "usr_123",
  "workspace_id": "ws_xyz",
  "actor_ip": "203.0.113.5",
  "tenant_status": "active",
  "duration_ms": 42
}
```

Sensitive fields **never** logged: passwords, API keys, encryption keys, full email bodies, message content. Email addresses hashed.

**Alert thresholds:**

| Event                                   | Threshold        | Action                            |
| --------------------------------------- | ---------------- | --------------------------------- |
| `audit_chain.break_detected`            | 1                | PagerDuty + on-call + UI banner   |
| `rls.violation` (per workspace)         | > 100/hr         | Slack notify, investigation queue |
| `auth.failure` (per IP)                 | > 20/15min       | IP-block for 1h, security log     |
| `slug_enumeration.suspected`            | > 50 404s/min/IP | IP rate limit tightened           |
| `workspace.unauthorized_access_attempt` | > 5/user/day     | Email user + audit log            |
| `encryption.failure`                    | 1                | PagerDuty                         |

### 6.8 Data classification & handling

| Class         | Examples                                                | Storage                            | Backup    | Export          | Logs           |
| ------------- | ------------------------------------------------------- | ---------------------------------- | --------- | --------------- | -------------- |
| **Public**    | Workspace slug, agent names                             | Plain                              | Standard  | Yes             | OK             |
| **Internal**  | User name, email                                        | Plain                              | Standard  | Yes (GDPR)      | hash() in logs |
| **Sensitive** | Conversation contents, KB chunks, facts                 | (Plain Phase 1, encrypted Phase 2) | Encrypted | Yes (GDPR)      | Never log      |
| **Secret**    | API keys, channel tokens, OAuth refresh, restore tokens | Encrypted (AES-256-GCM)            | Encrypted | Redacted        | Never log      |
| **Audit**     | audit_log, security_event                               | Plain + REVOKE UPDATE/DELETE       | Encrypted | Yes (selective) | OK             |

### 6.9 GDPR mapping

| GDPR Article                     | Implementation                                   |
| -------------------------------- | ------------------------------------------------ |
| Art. 15 — Right of access        | `POST /workspaces/[slug]/export`                 |
| Art. 16 — Right of rectification | Standard PATCH endpoints                         |
| Art. 17 — Right to erasure       | `DELETE /workspaces/[slug]` + user delete        |
| Art. 20 — Data portability       | GDPR export JSON + CSV                           |
| Art. 25 — Privacy by design      | Default deny RLS, minimal collection, encryption |
| Art. 32 — Security of processing | This entire section                              |
| Art. 33 — Breach notification    | Incident response runbook                        |

### 6.10 Backup & disaster recovery

| Aspect                | Plan                                                      |
| --------------------- | --------------------------------------------------------- |
| RPO                   | ≤ 5 min (continuous WAL archiving)                        |
| RTO                   | ≤ 1 hour                                                  |
| Backup encryption     | AES-256 via S3 SSE-KMS / filesystem                       |
| Retention             | Daily × 30d + Weekly × 12 + Monthly × 12                  |
| Per-tenant restore    | Logical export → import to temp → ETL job (manual, ≤ 24h) |
| Testing               | Monthly restore drill to staging                          |
| Geographic redundancy | (Cloud only) cross-region replication                     |

### 6.11 Incident response (high-level)

**Phase A — Triage (0-15 min):** Alert ack, scope identification, severity classification (SEV-1: cross-tenant leak / chain break; SEV-2: suspected breach; SEV-3: anomaly), open incident channel.

**Phase B — Containment (15-60 min):** Disable affected endpoint via feature flag; freeze writes; force logout; revoke keys/URLs; rotate keys.

**Phase C — Eradication & recovery (1-24h):** Patch root cause, re-enable systems, restore from backup if needed, customer notification within 72h (GDPR Art. 33).

**Phase D — Post-mortem:** Blameless post-mortem within 5 business days, action items tracked, threat model updated.

### 6.12 Security checklist for this sub-spec

- [ ] DB migration creates 3 roles: `app_user`, `cron_admin`, `read_only_audit`
- [ ] RLS policies on 25+ tables (Pattern A) + message (Pattern B) + workspace/member (Pattern C)
- [ ] `current_workspace_id()` and `is_cross_tenant_admin()` functions
- [ ] `withTenantContext()` middleware wrapper that SET LOCAL inside transaction
- [ ] `tenantQuery()` typed helper
- [ ] Custom ESLint rule `orchester/require-tenant-filter` + `orchester/require-action-guard`
- [ ] Security headers in root middleware
- [ ] CSRF protection on mutating routes
- [ ] Cookie flags hardened (`__Host-`, httpOnly, Secure, SameSite=Lax)
- [ ] Session rotation on privilege escalation
- [ ] Audit chain hash chain + verify cron
- [ ] `security_event` table + alerts
- [ ] Rate limit tiers configured
- [ ] Encryption audit (confirm AES-256-GCM + non-reused IVs)
- [ ] Backup restore drill documented and run in staging
- [ ] Incident response runbook committed at `docs/runbooks/incident-response.md`

---

## 7. Testing strategy

### 7.1 Philosophy: layered testing, targeted attack

Coverage targets are per-module risk-based, not global %.

```
                    ┌─────┴──────┐
                    │ Manual /   │     5%
                    │ Demo paths │
                    ├────────────┤
                    │  E2E       │    15%
                    ├────────────┤
                    │ Integration│    30%
                    ├────────────┤
                    │ Unit       │    50%
                    └────────────┘
```

### 7.2 Coverage targets by module

| Module                     | Statement | Branch | Reason                          |
| -------------------------- | --------- | ------ | ------------------------------- |
| `lib/tenant/context.ts`    | 95%       | 90%    | If this fails, everything fails |
| `lib/tenant/lifecycle.ts`  | 95%       | 90%    | Critical state machine          |
| `lib/audit/chain.ts`       | 100%      | 100%   | Cryptographic correctness       |
| `lib/audit/verify.ts`      | 95%       | 90%    | Tampering detection             |
| `lib/audit/log.ts`         | 90%       | 85%    | Append + advisory lock          |
| `lib/tenant/resolve.ts`    | 90%       | 85%    | Cache invalidation tricky       |
| `lib/tenant/membership.ts` | 95%       | 90%    | Auth-adjacent                   |
| `lib/gdpr/export-job.ts`   | 80%       | 75%    | Resumable state machine         |
| `lib/gdpr/exporters/*`     | 75%       | 70%    | Mostly I/O                      |
| `lib/feature-flags/*`      | 90%       | 85%    | Cache invalidation              |
| `lib/rbac.ts`              | 100%      | 100%   | Tiny + critical                 |
| UI components              | 70%       | 60%    | Playwright covers regressions   |
| API routes                 | 85%       | 80%    | Integration coverage            |

Global target: **≥ 85%** statement coverage (CI gate).

### 7.3 Testing stack

| Layer                  | Tool                                         |
| ---------------------- | -------------------------------------------- |
| Unit                   | Vitest                                       |
| Integration (DB + RLS) | Vitest + testcontainers                      |
| API routes             | Vitest + Next.js test harness                |
| E2E browser            | Playwright                                   |
| Tenant isolation       | Vitest + raw `pg` client (multiple sessions) |
| Performance            | k6                                           |
| Mutation               | Stryker (core modules)                       |
| Property-based         | fast-check                                   |
| Snapshot SQL           | Drizzle-kit + custom diff                    |
| Visual regression      | Playwright `toHaveScreenshot()`              |
| Security scan          | `pnpm audit` + Snyk                          |
| SAST                   | semgrep with tenant-isolation rule pack      |

### 7.4 Tenant isolation suite (★ critical control evidence)

```typescript
// tests/isolation/setup.ts
export interface IsolationFixture {
  wsA: WorkspaceFixture;
  wsB: WorkspaceFixture;
  userA: { id: string; session: SessionToken };
  userB: { id: string; session: SessionToken };
  userCross: {
    id: string;
    session: SessionToken;
    rolesByWs: Record<string, Role>;
  };
}
```

**Matrix test — every endpoint × every workspace × every role:**

```typescript
const TENANT_ROUTES = [
  ["GET", "/api/workspaces/{slug}/agents", 200, 404],
  ["POST", "/api/workspaces/{slug}/agents", 201, 403],
  ["PATCH", "/api/workspaces/{slug}/agents/{id}", 200, 404],
  ["DELETE", "/api/workspaces/{slug}/agents/{id}", 204, 404],
  // ... 50+ rows
];

describe("Cross-tenant isolation matrix", () => {
  describe.each(TENANT_ROUTES)(
    "%s %s",
    (method, path, ownExpected, otherExpected) => {
      it("userA → wsA returns expected", async () => {
        /* ... */
      });
      it("userA → wsB blocked, body has zero leak", async () => {
        /* ... */
      });
      it("userA crafting cross-tenant path injection blocked", async () => {
        /* ... */
      });
    }
  );
});
```

**Deep DB scan:**

```typescript
const TENANT_TABLES = [
  'agent', 'team', 'channel', 'employee', 'conversation', 'message',
  'flow', 'flow_run', 'integration', 'api_key',
  'knowledge_base', 'knowledge_doc', 'knowledge_chunk',
  'agent_memory', 'audit_log', 'feature_flag',
  'gdpr_export_job', 'ai_provider', 'webhook_out',
  'conversation_label', 'notification_pref',
];

it.each(TENANT_TABLES)('%s: app_user only sees own tenant rows', async (table) => {
  const wsACount = await withTenantContext(wsA.id, async () => /* count */);
  const wsBCount = await withTenantContext(wsB.id, async () => /* count */);
  const totalCount = await cronPool.query(`SELECT count(*) FROM ${table}`);
  expect(wsACount + wsBCount).toBeLessThanOrEqual(totalCount);
});
```

**SQL injection probes:**

```typescript
const PAYLOADS = [
  `'; DROP TABLE agent; --`,
  `' OR '1'='1`,
  `'; SET LOCAL app.workspace_id = '${"wsB-id"}'; --`,
  `' UNION SELECT * FROM agent WHERE workspace_id = '...' --`,
];

it.each(PAYLOADS)("payload %s does not leak data", async (payload) => {
  // Inject as agent name
  // Verify either rejected or stored literally
  // Verify DB integrity
});
```

### 7.5 CI pipeline

```yaml
jobs:
  lint: # ESLint + custom rules + semgrep + pnpm audit + prettier
  typecheck: # pnpm tsc --noEmit
  unit: # vitest unit + coverage report + per-module thresholds
  integration: # vitest integration with testcontainers (~5 min)
  isolation: # ★ blocks merge — tenant isolation matrix + injection probes
  e2e: # smoke on PR, full on merge to main
  perf: # nightly on main, k6 vs baseline
  security: # weekly, snyk + OWASP ZAP + extended SAST
```

Gates for merge: lint, typecheck, unit coverage targets, integration, **isolation (no exceptions)**, E2E smoke.

### 7.6 Test runtime budgets

| Suite           | Max wall-clock    |
| --------------- | ----------------- |
| Unit            | < 30s             |
| Integration     | < 5min            |
| Isolation       | < 5min            |
| E2E smoke       | < 3min            |
| E2E full        | < 15min           |
| Perf            | < 30min (nightly) |
| Security weekly | < 1h              |

### 7.7 Anti-flaky rules

- No `setTimeout`/`setInterval`; use fake timers
- No assertions on exact timestamps; use `expect.closeToDate()`
- Seed Faker with fixed value per test
- Reset Postgres state between tests
- Isolated DB per worker
- Network mocks via msw
- Fixed clock via `vi.setSystemTime()`
- No order dependencies

### 7.8 Testing checklist

- [ ] Vitest config with testcontainers + per-worker DB
- [ ] `tests/fixtures/` + `tests/factories/`
- [ ] Suite `tests/unit/` with coverage targets
- [ ] Suite `tests/integration/` with real DB
- [ ] ★ Suite `tests/isolation/` matrix (50+ endpoints × 2 workspaces × 4 roles)
- [ ] Suite `tests/isolation/db-scan.spec.ts`
- [ ] Suite `tests/isolation/injection-probes.spec.ts`
- [ ] Suite `tests/lifecycle/` state machine + cron + middleware
- [ ] Suite `tests/audit/` chain + verify + tampering
- [ ] Suite `tests/security/` pentest scenarios
- [ ] Custom ESLint rules
- [ ] semgrep rules pack
- [ ] Playwright E2E smoke + full
- [ ] k6 perf scripts
- [ ] Stryker config (weekly mutation runs)
- [ ] CI workflow with gates
- [ ] Coverage report integration
- [ ] Test runtime budget monitoring

---

## 8. Implementation phases & rollout

### 8.1 Overview

```
Time →   Day 1      Week 1      Week 2      Week 3     Week 4     Week 5

Phase A  ████████
Phase B          ████████
Phase C                    ████
Phase D                          ████████
Phase E                                  ████████████

            ▲ Migrations         ▲ RLS FORCE   ▲ URL    ▲ Lifecycle
           additive,             on critical   migration features
           no behavior           tables                 GA
           change
```

### 8.2 Phase A — Foundation (Week 1)

**Goal:** All new infrastructure created in dormant state. Tables exist, code exists, but no behavior changes.

**Outputs:**

| Deliverable                                                            | Verification                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| Migrations applied                                                     | `pg_dump --schema-only` contains new columns/tables |
| Backfill: `workspace.owner_user_id`, `status='active'`                 | Zero NULL after backfill                            |
| `lib/tenant/`, `lib/audit/`, `lib/gdpr/`, `lib/feature-flags/` modules | Typecheck pass                                      |
| Custom ESLint + semgrep rules (warning only)                           | Configured                                          |
| Test fixtures and factories                                            | Available                                           |
| Unit tests passing with coverage targets                               | Vitest green                                        |

**Observability gate (before Phase B):**

```sql
-- Schema integrity
SELECT count(*) FROM information_schema.tables WHERE table_name IN
  ('audit_log', 'feature_flag', 'gdpr_export_job') = 3;

-- RLS enabled but not forced
SELECT count(*) FROM pg_tables WHERE rowsecurity = true AND schemaname = 'public' >= 25;
SELECT count(*) FROM pg_tables WHERE rowsecurity = true AND forcerowsecurity = true = 0;

-- App role permissions
SELECT has_table_privilege('app_user', 'audit_log', 'UPDATE') = false;
SELECT has_table_privilege('app_user', 'audit_log', 'INSERT') = true;
```

CI baseline: existing E2E + integration suites still pass. Performance baseline captured.

**Rollback (< 5 min):** Drop new tables, revert `ALTER TABLE workspace`, disable RLS, drop helper functions, git revert code.

**Risk register:**

| Risk                            | P   | I   | Mitigation                                                    |
| ------------------------------- | --- | --- | ------------------------------------------------------------- |
| Migration fails mid-flight      | M   | H   | Backfill nullable first, then ADD CONSTRAINT after populating |
| RLS enable degrades performance | M   | M   | NO FORCE = minimal overhead. Benchmark before/after.          |
| Helper function name conflict   | L   | L   | `app_*` or `orch_*` prefix                                    |
| Encryption key not provisioned  | L   | H   | Pre-flight check in deploy script                             |

### 8.3 Phase B — Silent backfill (Week 1-2)

**Goal:** Middleware sets `app.workspace_id` on every request. RLS not forced yet, so failures are logged but don't break behavior.

**Outputs:**

| Deliverable                                                            | Verification                         |
| ---------------------------------------------------------------------- | ------------------------------------ |
| Middleware setting `app.workspace_id`                                  | Trace shows SET in each query        |
| `withTenantContext()` integrated                                       | Existing code unchanged behaviorally |
| Telemetry: `tenant.context.set_count` / `tenant.context.missing_count` | Dashboard live                       |
| Cron jobs explicitly setting `is_cross_tenant_admin=true`              | Worker logs verify                   |

**Observability gate (before Phase C):**

```
✓ tenant.context.missing_count / tenant.context.set_count < 1% for 7 consecutive days
✓ Zero "RLS_NO_TENANT_CONTEXT" errors in logs during 24h
✓ Performance baseline: p95 within +5% of pre-Phase A
✓ All existing suites still green
✓ Tenant isolation suite green (against unforced RLS)
```

**Rollback:** Code-only revert. < 2 min.

### 8.4 Phase C — RLS FORCE on critical tables (Week 2)

**Goal:** Enable `FORCE ROW LEVEL SECURITY` on critical tables. Canary first.

**Outputs:**

| Deliverable                                                                                           | Verification                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| RLS FORCED on `audit_log`, `agent_memory`, `ai_provider`, `integration`, `api_key`, `gdpr_export_job` | `pg_tables.forcerowsecurity = true` |
| Canary 10% workspaces 24h                                                                             | No error spike                      |
| Roll-out 25% → 50% → 100% over 72h                                                                    | Telemetry green at each step        |
| All tenant tables FORCED                                                                              | Final state                         |
| Isolation suite with FORCE active                                                                     | 100% pass                           |

**Observability gate (before Phase D):**

```
✓ tenant.rls.violations_per_minute = 0 for 24h
✓ Performance baseline: p95 within +5% (RLS overhead within SLO)
✓ Zero "RLS denied row" errors causing 500s in logs
✓ Isolation suite green
✓ Customer error rate unchanged
```

**Rollback:** `ALTER TABLE … NO FORCE ROW LEVEL SECURITY` per table. < 1 min per table.

### 8.5 Phase D — URL migration + Switcher launch (Week 2-3)

**Goal:** Activate the switcher, migrate URLs to `/[locale]/[workspaceSlug]/...`, legacy URLs 301-redirect.

**Outputs:**

| Deliverable                                      | Verification             |
| ------------------------------------------------ | ------------------------ |
| Routes `/[locale]/[workspaceSlug]/*` live        | All E2E against new URLs |
| Cookie `orch-active-workspace` set/read          | E2E test                 |
| Middleware: legacy redirect 301                  | E2E test                 |
| WorkspaceSwitcher topbar + menu functional       | Playwright               |
| Create / Soft-delete / Restore modals functional | Playwright               |
| Suspended banner appearing                       | Playwright               |
| Audit log viewer with chain status               | Manual + Playwright      |
| Restore window UI                                | Playwright               |
| GDPR export progress UI                          | Playwright               |
| i18n keys translated en/es/pt-BR                 | Lint check               |
| A11y baseline passing (axe-core)                 | CI gate                  |

**Rollout strategy:**

```
Day 1: Deploy code, feature flag for internal only
Day 2: 5% canary
Day 3: 25%
Day 5: 50%
Day 7: 100%
Day 14: Disable feature flag (default on)
Day 30: Legacy redirects removed (404)
```

**Observability gate (before Phase E):**

```
✓ Switcher latency p95 < 100ms for 30 days
✓ Zero "tenant_context_missing" errors in logs for 7 days
✓ Legacy redirect 301 rate < 80% (majority on new URLs)
✓ No spike in 4xx/5xx rate post-deploy
✓ Zero critical support tickets
✓ Multi-tab workflow QA-tested
```

**Rollback:** Feature flag off (< 1 min). Code revert (< 5 min). Legacy URLs remain functional.

### 8.6 Phase E — Lifecycle features GA (Week 3-5)

**Goal:** All lifecycle ops live: soft-delete, restore, suspend, transfer, GDPR export. Audit verify cron daily. Feature flags admin UI. Sub-spec complete.

**Outputs:**

| Deliverable                                     | Verification             |
| ----------------------------------------------- | ------------------------ |
| `POST /workspaces/[slug]/export` end-to-end     | E2E                      |
| Cron `hard_delete_workspace` daily              | Cron logs                |
| Cron `verify_audit_chain` daily                 | `security_event` entries |
| Cron `cleanup_idempotency_keys`                 | Expired records purged   |
| Soft-delete + restore tested in prod (internal) | Manual                   |
| Suspend/unsuspend tested                        | Manual + Playwright      |
| Transfer ownership tested                       | Manual                   |
| Feature flags admin UI                          | Playwright               |
| Audit log viewer with chain badge               | Playwright               |
| Security event alerts wired                     | Manual smoke test        |
| Incident response runbook in `docs/runbooks/`   | Doc reviewed             |
| Penetration test scenarios passing              | Suite green              |

**Completion gate:**

```
✓ Audit chain verify: 0 broken chains in 30 days
✓ GDPR export success rate > 99%
✓ Hard-delete cron success rate 100%
✓ Soft-delete restore success rate 100%
✓ Suspended workspace mutation block rate = 100%
✓ Feature flag toggle latency < 50ms
✓ Security events captured + alerts working
✓ All 18 threats mitigation deployed
✓ Penetration test scenarios passing in CI
✓ Runbooks, evidence trail, ADRs committed
```

### 8.7 Cross-phase concerns

**Migration files** (numbered, idempotent, reversible):

```
NNN1_workspace_lifecycle.sql          (Phase A)
NNN2_audit_log.sql                    (Phase A)
NNN3_feature_flags.sql                (Phase A)
NNN4_gdpr_export_jobs.sql             (Phase A)
NNN5_rls_helpers.sql                  (Phase A)
NNN6_rls_enable_no_force.sql          (Phase A)
NNN7_idempotency_key.sql              (Phase A)
NNN8_security_event.sql               (Phase A)
NNN9_rls_force_critical.sql           (Phase C)
NNN10_rls_force_rest.sql              (Phase C, after canary)
NNN11_partition_audit_log.sql         (Phase E, when needed)
```

**Branching:** Each phase has its own integration branch. Merge to main = deploy to prod = start of phase gate observability window.

**Deployment cadence:** 1-3 PRs per phase. Each PR with description, linked issue, security checklist, migration up/down, tests.

**Communication plan:**

| Event                   | Audience           | Channel               | Timing |
| ----------------------- | ------------------ | --------------------- | ------ |
| Spec approved           | Internal eng       | Slack                 | T+0    |
| Phase A deploy notice   | Internal eng       | Slack                 | T-24h  |
| Phase D customer-facing | All customers      | Email + in-app banner | T-7d   |
| Phase D launched        | All customers      | Changelog post        | T+0    |
| Phase E features GA     | All customers      | Email + blog          | T+0    |
| Any incident            | Affected customers | Email + status page   | < 1h   |

### 8.8 Sub-spec completion criteria

| KPI                                         | Target      | Window        |
| ------------------------------------------- | ----------- | ------------- |
| All 5 phases gate green                     | 100%        | once          |
| Tenant isolation E2E pass rate              | 100%        | sustained 30d |
| Audit chain integrity                       | 0 broken    | sustained 30d |
| GDPR export success rate                    | > 99%       | rolling 7d    |
| Soft-delete restore success rate            | 100%        | all attempts  |
| User-reported support tickets re: switching | 0 critical  | sustained 30d |
| Lint violations on tenant filter            | 0 (CI gate) | sustained     |
| Pen test scenarios                          | All passing | each CI run   |
| Documentation: runbooks, ADRs, evidence     | Committed   | once          |

When all green: sub-spec 1 **complete and production-hardened**. Proceed to Sub-spec 2 (Brain Core).

---

## 9. Open questions, decisions log, deferred items, glossary, references

### 9.1 Decisions log

Inspired by the ADR pattern (Michael Nygard, 2011).

#### D-001 — Multi-tenant L1 (row-level scoping), not L2/L3/L4

- **Status:** Accepted
- **Context:** 4 isolation levels possible; trade-off cost vs isolation.
- **Decision:** L1 logical row-level with RLS as 2nd barrier. L3 (DB-per-tenant) reserved for future Enterprise tier.
- **Rationale:** L1 scales to 10k+ tenants without operational pain. L2/L3 operationally heavy. L4 (dedicated VPC) is separate product.
- **Consequences:** Single code bug = cross-tenant risk. Mitigated by RLS + isolation tests + lint rules.
- **Revisit when:** Enterprise customer requests BYO-DB.

#### D-002 — URL path with slug, not cookie-only or subdomain

- **Status:** Accepted
- **Decision:** URL path with slug (`/[locale]/[workspaceSlug]/...`).
- **Rationale:** Bookmarkable + sharable + multi-tab natural. Standard pattern (Linear, GitHub, Notion, Vercel, Cal.com).
- **Consequences:** Refactor ~30 files. Mitigated by Phase D rollout with 301 redirects.

#### D-003 — RLS session-level, not user-based roles

- **Status:** Accepted
- **Decision:** GUC `app.workspace_id` set per request inside transaction.
- **Rationale:** Roles per tenant don't scale (10k tenants = 10k roles). GUC is what Supabase, Neon, modern B2B SaaS use.
- **Consequences:** Every tenant-bound request runs inside a transaction. Cross-tenant cron uses `cron_admin` with `BYPASSRLS`.

#### D-004 — Hash chain app-level, not Postgres triggers

- **Status:** Accepted
- **Decision:** App-level append helper + daily verify cron.
- **Rationale:** Schema changes don't require trigger migration. More testable. Trade-off mitigated by `REVOKE UPDATE/DELETE` to app role.
- **Consequences:** Verify cron is critical; without it, tampering goes undetected.

#### D-005 — Soft-delete tombstone column, not archive table

- **Status:** Accepted
- **Decision:** Tombstone column in `workspace`.
- **Rationale:** Simpler implementation, single source of truth.
- **Consequences:** Active queries filter `WHERE deleted_at IS NULL`.

#### D-006 — GDPR export async via pg-boss + email

- **Status:** Accepted
- **Decision:** Async job + signed URL via email + UI progress.
- **Rationale:** Scales to large workspaces. No HTTP timeout. Resumable.
- **Consequences:** Email service + object storage required.

#### D-007 — Self-service workspace creation unlimited in OSS, plan-based in Cloud

- **Status:** Accepted
- **Decision:** Self-service unlimited. Plan quotas limit in Cloud.
- **Rationale:** OSS-friendly. Good for agencies/MSPs.
- **Consequences:** Anti-abuse via rate limit + auto-suspend on spam pattern.

#### D-008 — Suspended = read-only UI, not full block

- **Status:** Accepted
- **Decision:** Read-only (UI accessible, mutations 423, runtime off).
- **Rationale:** Customer can export data before deciding. Pattern of Stripe, Vercel, Linear.
- **Consequences:** Middleware check on every mutation route.

#### D-009 — Audit log INSERT-only via REVOKE, no external append-only store

- **Status:** Accepted
- **Decision:** PostgreSQL with REVOKE + hash chain.
- **Rationale:** No external dependency. Hash chain detects retroactive tampering.
- **Revisit when:** Customer requests WORM storage (S3 Object Lock).

#### D-010 — In-process LRU for slug→workspace cache, not Redis upfront

- **Status:** Accepted
- **Decision:** In-process LRU (5min TTL). Redis when multi-instance.
- **Rationale:** Reduces self-host dependencies. Multi-instance stale data acceptable during 5min TTL.

#### D-011 — `withTenantContext` with transaction wrapper, not global context

- **Status:** Accepted
- **Decision:** Transaction wrapper that SET LOCAL at start + runs callback inside.
- **Rationale:** SET LOCAL is tx-scoped, not connection-scoped. Without tx, SET would bleed to other pooled requests.
- **Consequences:** Single-query reads also in tx (Postgres handles billions of tx/s, no perf concern).

#### D-012 — TypeScript-first lint rules, no SQL linter

- **Status:** Accepted
- **Decision:** Custom ESLint rules analyzing Drizzle AST.
- **Rationale:** Drizzle exposes fluent API analyzable in AST. ESLint integrates with IDE, immediate feedback.
- **Consequences:** Raw `sql\`\`` (Drizzle escape hatch) → warning + manual review required.

#### D-013 — Vitest + testcontainers, no in-memory DB for integration

- **Status:** Accepted
- **Decision:** testcontainers spinning real Postgres in CI.
- **Rationale:** RLS behavior cannot be tested in fakes. Real Postgres mandatory.
- **Consequences:** CI ~5min slower. Trade-off accepted.

#### D-014 — pg-boss for async jobs, no Bull/BullMQ

- **Status:** Accepted (status quo)
- **Decision:** Stick with pg-boss.
- **Rationale:** Postgres-native, no Redis dep, integrated.
- **Revisit when:** Job volume > 10k/min.

#### D-015 — Encryption helper hardening: audit pre-deploy, no migrate now

- **Status:** Action item, not decision
- **Decision:** Audit `lib/encryption.ts` in Phase A + addendum if needed.

#### D-016 — Per-tenant feature flags in own table, not Unleash/Flagsmith

- **Status:** Accepted
- **Decision:** Own `feature_flag` table + `isEnabled()` helper.
- **Rationale:** No extra dep. Simple pattern. If % rollout / targeting needed later, migrate to Unleash with same `isEnabled()` API.

#### D-017 — Idempotency keys with 24h TTL

- **Status:** Accepted
- **Decision:** 24h TTL, cleanup cron.
- **Rationale:** Client retry typically < 1h. 24h covers worst case timezone drift.

#### D-018 — Member invite UX from switcher + Settings both

- **Status:** Accepted
- **Decision:** Switcher quick action + Settings detailed view.
- **Rationale:** Quick action accelerates, Settings for management. Linear/Vercel pattern.

#### D-019 — Subdomain per workspace deferred to Enterprise

- **Status:** Deferred
- **Rationale:** Requires wildcard SSL + DNS automation + complicates dev local. Best invest in URL path first.
- **Revisit when:** Enterprise customer requests white-label.

#### D-020 — Cookie-only without URL slug — rejected

- **Status:** Rejected
- **Rationale:** Tab desync problem. Not bookmarkable. Not sharable per-workspace. Anti-professional.

### 9.2 Open questions (to decide during implementation)

| ID    | Question                                                             | Decide when                       | Owner           |
| ----- | -------------------------------------------------------------------- | --------------------------------- | --------------- |
| OQ-1  | Persist `lastVisitedAt` in `workspace_member` or only client-side?   | Building switcher UI              | Frontend        |
| OQ-2  | Support slug rename with redirect old→new?                           | UI surface review                 | UX              |
| OQ-3  | Audit log retention default — 1y, 7y, indefinite?                    | Phase E                           | Compliance lead |
| OQ-4  | Audit log search full-text or simple filters?                        | UX review on audit viewer         | UX              |
| OQ-5  | GDPR export include binaries (avatars, KB original files)?           | Phase E                           | Backend         |
| OQ-6  | Restore window 30d fixed or configurable per plan?                   | Phase E                           | Product         |
| OQ-7  | Multi-region storage for GDPR ZIPs in Cloud?                         | Cloud architecture (out of scope) | Infra           |
| OQ-8  | Bulk operations (transfer 10, delete 5)?                             | Future sub-spec                   | Product         |
| OQ-9  | Workspace templates at create (copy from another)?                   | Future sub-spec                   | Product         |
| OQ-10 | Active sessions when user kicked — force logout vs let expire?       | Implementation                    | Security        |
| OQ-11 | Restore after hard-delete (window expired) from backup, on demand?   | Future runbook                    | SRE             |
| OQ-12 | Audit log access requires `audit.read` permission or owner-only?     | Phase E                           | Security        |
| OQ-13 | 2FA enforce on workspace delete OR transfer?                         | Phase E                           | Security        |
| OQ-14 | Anonymous mode for support (admin views as user)?                    | Future Cloud                      | Product         |
| OQ-15 | Workspace export includes audit log OF the workspace OR of the user? | Phase E                           | Compliance      |

### 9.3 Deferred items

| ID      | Item                                           | Why deferred                                       | ETA                              |
| ------- | ---------------------------------------------- | -------------------------------------------------- | -------------------------------- |
| Defer-A | SSO / SAML / SCIM                              | Cloud Enterprise feature, requires IdP integration | Q3 2026                          |
| Defer-B | Customer-Managed Keys (CMK)                    | Enterprise security tier                           | First Enterprise contract        |
| Defer-C | DB-per-tenant (L3 isolation)                   | Connection routing + tenant migration tool         | First Enterprise request         |
| Defer-D | Dedicated VPC deployment                       | Most paranoid customers                            | Late 2026                        |
| Defer-E | On-prem deployment (air-gapped)                | Self-contained Docker + license server             | TBD                              |
| Defer-F | White-label / custom domain                    | Subdomain config + email/UI branding               | Enterprise launch                |
| Defer-G | Audit log automated archive to S3 Glacier      | When > 50M rows                                    | Volume threshold                 |
| Defer-H | SOC2 Type 2 audit                              | 6-12 month process with external auditor           | When Enterprise demand justifies |
| Defer-I | ISO 27001 certification                        | Similar to SOC2, formal cert                       | Post-SOC2                        |
| Defer-J | GDPR Article 25/35 DPIA formal document        | When EU customer base justifies                    | EU expansion                     |
| Defer-K | Brain Layer integration with tenant model      | Sub-spec 2 work                                    | Sub-spec 2                       |
| Defer-L | Marketplace integration with feature flags     | When marketplace exists                            | Sub-spec 5+                      |
| Defer-M | Per-tenant rate limit on LLM provider keys     | Cloud tier                                         | Cloud launch                     |
| Defer-N | Async workspace create with email confirmation | Higher-trust scenarios                             | When abuse becomes issue         |
| Defer-O | Audit log streaming export to SIEM             | Cloud Enterprise (Splunk/Datadog integration)      | Enterprise tier                  |
| Defer-P | Workspace cloning (duplicate as template)      | Common in agency/MSP setups                        | Future sub-spec                  |

### 9.4 Glossary

| Term                   | Definition                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| **Workspace**          | Tenant unit. Top-level container for agents, conversations, integrations. Owned by one user, can have many members. |
| **Tenant context**     | Per-request state identifying which workspace is operated on. Set in Postgres GUC `app.workspace_id` + middleware.  |
| **L1 tenancy**         | Logical row-level isolation. Single DB, multiple workspaces, scoped by `workspace_id` column + RLS.                 |
| **L3 tenancy**         | Database-per-tenant. Separate Postgres DB per workspace. Future Enterprise tier.                                    |
| **RLS**                | Row Level Security. Postgres feature filtering rows based on policy. Used as 2nd barrier.                           |
| **FORCE RLS**          | `FORCE ROW LEVEL SECURITY` — applies RLS even to table owner. Critical for true isolation.                          |
| **Tenant resolver**    | `lib/tenant/resolve.ts` — maps slug → workspace, with cache.                                                        |
| **withTenantContext**  | Wrapper that SET LOCAL workspace_id in a transaction, executes callback.                                            |
| **Audit chain**        | Hash chain over audit_log entries; each entry's hash depends on previous. Detects tampering.                        |
| **Soft-delete window** | 30-day period after delete during which restore is possible.                                                        |
| **Hard-delete cron**   | pg-boss worker physically deleting workspaces past their `delete_scheduled_at`.                                     |
| **Lifecycle state**    | `active                                                                                                             | suspended | deleted`. Transitions enforced by `lib/tenant/lifecycle.ts` + DB CHECK. |
| **GDPR export**        | Job producing ZIP of all workspace data, emailed to owner with signed URL. GDPR Article 20.                         |
| **Restore token**      | Single-use token bound to a soft-deleted workspace, generated at delete, expires at hard-delete.                    |
| **Signed URL**         | Time-limited URL with embedded signature, for GDPR export downloads. 7d expiry.                                     |
| **Idempotency key**    | Client-supplied UUID that lets server safely dedupe retried requests.                                               |
| **Feature flag**       | Per-workspace boolean for enabling experimental/Cloud features.                                                     |
| **Security event**     | Log entry in `security_event` table — RLS violations, auth failures, etc. Append-only.                              |
| **Cross-tenant admin** | Special role (`cron_admin`) with BYPASSRLS for cross-tenant ops (cron, GDPR workers). Every bypass logged.          |
| **Phase A-E**          | Implementation phases of this sub-spec. See §8.                                                                     |

### 9.5 References / inspiration

**Multi-tenancy patterns:**

- AWS SaaS Lens — Multi-tenancy isolation models L1-L4
- Stripe's "Designing robust APIs" — Idempotency keys, rate limiting
- Linear's engineering blog — URL path tenancy pattern
- Cal.com architecture docs — OSS multi-tenant reference
- Supabase Multi-Tenant Architecture — pgvector + RLS at scale

**Audit & immutability:**

- Michael Nygard, "Release It!" (2018) — Stability patterns
- Hyperledger Fabric — Hash chain inspiration
- Datomic / XTDB — Immutable database patterns
- AWS QLDB — Cryptographic verifiability

**Security:**

- OWASP Top 10 (2021)
- CIS Postgres Benchmark
- OWASP ASVS L2
- STRIDE threat modeling (Microsoft, 1999)

**Compliance:**

- AICPA TSC 2017 — SOC 2 criteria
- ISO/IEC 27001:2022 Annex A
- NIST SP 800-53 Rev. 5
- GDPR Art. 15-22, 32-34

**Operational:**

- Google SRE Book — Phase-based rollout, error budget
- The DevOps Handbook (Kim et al.)
- Charity Majors blog (honeycomb) — Observability-driven dev

### 9.6 ADR creation queue

After spec approval, create:

| ADR     | Title                                              | Status  |
| ------- | -------------------------------------------------- | ------- |
| ADR-006 | Multi-tenancy isolation strategy (L1 RLS)          | Pending |
| ADR-007 | Tenant URL pattern (path-based slug)               | Pending |
| ADR-008 | Audit log hash chain design                        | Pending |
| ADR-009 | Soft-delete + restore window                       | Pending |
| ADR-010 | Feature flags self-hosted table                    | Pending |
| ADR-011 | GDPR export async job pattern                      | Pending |
| ADR-012 | RLS enforcement strategy (NO FORCE → FORCE canary) | Pending |
| ADR-013 | Tenant context propagation via Postgres GUC        | Pending |

Each ADR ≤ 200 words, Nygard format: Context · Decision · Consequences.

### 9.7 Sign-off

| Aspect                              | Reviewer                     | Status                          |
| ----------------------------------- | ---------------------------- | ------------------------------- |
| Goal + Non-goals + Success criteria | Product / User               | ✓ approved during brainstorming |
| Architecture                        | Tech lead (Lucas)            | Pending sign-off                |
| Data model + migrations             | DB owner (Lucas)             | Pending                         |
| API surface                         | API design committee (Lucas) | Pending                         |
| UI surface                          | UX / Frontend lead (Lucas)   | Pending                         |
| Security model                      | Security lead (Lucas)        | Pending — SOC2 prep             |
| Testing strategy                    | QA lead (Lucas)              | Pending                         |
| Implementation phases               | SRE + tech lead (Lucas)      | Pending                         |
| Compliance evidence                 | Future compliance officer    | Future                          |

### 9.8 Next steps

After this spec is approved:

1. `superpowers:writing-plans` skill produces `docs/superpowers/plans/2026-05-23-tenant-hardening.md` with task-by-task implementation plan.
2. Plan divided into 5 chapters (Phase A-E).
3. Each chapter has atomic tasks (15-60 min each).
4. Each task lists: files to touch, code, commands, validation criteria.
5. Plan executed via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.
6. Phase-by-phase implementation with gates between each.

---

**End of design document.**
