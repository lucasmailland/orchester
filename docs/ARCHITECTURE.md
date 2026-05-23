# Architecture

This document is the map of the codebase. It explains what lives where, how a request flows through the system, where the security boundaries are, and which decisions are load-bearing.

Audience: new contributors and anyone evaluating Orchester for a non-trivial deployment. Out of scope: tutorials and "how to use Orchester" — see the [README quickstart](../README.md#quickstart) for that.

## Top-level shape

```
orchester/
├── apps/
│   ├── web/         Next.js 15 application (Studio UI + REST API + MCP + worker)
│   └── widget/      Embeddable chat widget (separate bundle)
├── packages/
│   └── db/          Drizzle schema, migrations, typed client
├── scripts/
│   └── audit-invariants.sh   Structural CI guard
├── .agents/         Audit playbooks, agent specs (internal)
└── docs/            This file plus operational docs
```

One Next.js app. One database package. One widget. The worker process lives inside the web app and shares the same code paths — see "Worker" below.

## Runtime topology

```
                        ┌──────────────────────────────┐
                        │   Next.js 15 (App Router)    │
                        │                              │
   Browser  ────────►   │   • Studio (React + HeroUI)  │
                        │   • REST API + SSE           │
                        │   • MCP server (HTTP+stdio)  │
   MCP client ──────►   │   • Public /api/v1/*         │
                        └──────────────────────────────┘
                                      │
                                      ▼
            ┌──────────────────────────────────────────────┐
            │   Postgres 15+ with pgvector                 │
            │   • Application data (Drizzle schema)        │
            │   • Job queue rows (pg-boss)                 │
            │   • Vector embeddings for KB                 │
            │   • Advisory locks for quota/spend writes    │
            └──────────────────────────────────────────────┘
                                      ▲
                                      │
                        ┌──────────────────────────────┐
                        │   Worker process (pg-boss)   │
                        │   • Polls flow_runs queue    │
                        │   • Executes flows           │
                        │   • Runs the orphan reaper   │
                        └──────────────────────────────┘
                                      │
                                      ▼
                       ┌────────────────────────────────┐
                       │   AI providers (BYO keys)      │
                       │   80+ adapters, 10 capabilities│
                       └────────────────────────────────┘
```

The worker is the _same_ process bundle as the web app started in a different mode (`pnpm worker:dev` / `pnpm worker`). This means schema, types, and helpers are shared at compile time — there is no RPC boundary between the API and flow execution code.

## Request lifecycle

A representative POST `/api/flows/:id/run` request:

1. **Edge middleware** (`apps/web/middleware.ts`) — locale routing, auth cookie check, rate limiting (Redis-backed if configured, otherwise an in-memory limiter; both gated by `lib/rate-limit.ts`).
2. **Route handler** (`apps/web/app/api/...`) — zod validates the body, `auth-guards.ts` resolves the session into a `{ userId, workspaceId, role }` triple.
3. **RBAC check** — `lib/rbac.ts` exposes `assertCan(role, action)`. Every mutating route calls it. The structural invariants guard fails the build if a new mutating route forgets either zod or `assertCan`.
4. **Quota + spend gates** — `lib/billing/check-quota.ts` (plan limits) and the spend cap check in `lib/ai/metering.ts` run inside the same DB transaction as the write that consumes them, protected by a `pg_advisory_xact_lock` keyed on `workspaceId`. This closes the TOCTOU window that an earlier audit pass found.
5. **Job enqueue** — for flow runs, the request enqueues a `flow_run` job in pg-boss and returns `202 Accepted` with the `runId`. SSE subscribers stream telemetry as the worker executes.
6. **Worker execution** — `lib/flow-engine.ts` walks the flow graph, dispatches to per-node executors (AI calls, HTTP, code-node sandbox, integration adapters, subflows), threads an `AbortSignal` so disconnected clients cancel cleanly, and writes telemetry events as it goes.

Read-only requests (list, get) skip steps 4–6 and return inline.

## Data model

`packages/db/src/schema/` is partitioned by domain:

| File              | Owns                                                         |
| ----------------- | ------------------------------------------------------------ |
| `core.ts`         | Users, workspaces, memberships, roles, sessions              |
| `auth.ts`         | Better-Auth tables (accounts, verifications, etc.)           |
| `workspaces.ts`   | Workspace settings, plans, quotas, audit log                 |
| `ai-providers.ts` | Provider credentials (encrypted), per-workspace model gating |
| `flows.ts`        | Flows, flow versions, flow runs, run telemetry               |
| `agent-tools.ts`  | Agent definitions, tool configs                              |
| `integrations.ts` | Integration accounts and credentials                         |
| `knowledge.ts`    | KB sources, chunks, embeddings (pgvector columns)            |
| `production.ts`   | Webhooks, channels, public API keys                          |

Migrations live in `packages/db/migrations/` and are produced by `drizzle-kit generate`. Never run `drizzle-kit push` against anything but a throwaway dev DB — the audit playbook documents why.

### Tenancy

Every domain row has a `workspace_id`. The pattern is:

```ts
db.query.flows.findMany({ where: eq(flows.workspaceId, workspaceId) });
```

There is no row-level security via Postgres policies — tenant filtering is application-layer. The invariants guard enforces that no new query against a workspace-scoped table is missing the `workspaceId` predicate. This is the single most important property of the system.

## AI catalog

`lib/ai/` is the adapter layer. Three concentric concepts:

- **Capabilities** — chat, image, video, embeddings, rerank, TTS, STT, code, vision, OCR. Defined as TypeScript discriminated unions; every adapter implements one or more.
- **Providers** — the vendors (OpenAI, Anthropic, Google, etc.). Each provider has a record in the catalog with metadata: which capabilities it implements, model list, pricing, auth shape.
- **Adapters** — concrete `runChat(...)`, `generateImage(...)`, etc. functions per provider, normalized to a common request/response contract.

Adding a new provider that fits an existing family (e.g. another OpenAI-compatible endpoint) is a single row in the catalog. A genuinely new family is a new adapter file plus a catalog entry.

Costs are computed from token usage × catalog price and written to `usage_events` synchronously inside the adapter. That row is what the spend cap reads.

## Flow engine

`lib/flow-engine.ts` is the heart of the runtime. Responsibilities:

- Topologically iterate the flow graph (DAG with conditional edges).
- Dispatch per-node execution to handlers registered in `lib/flows/node-registry.ts`.
- Manage parallel branches with bounded fan-out (per-flow concurrency cap, enforced via a Postgres advisory lock keyed on `(workspaceId, flowId)`).
- Thread `AbortSignal` through every async dispatch so client disconnect propagates to in-flight AI calls.
- Emit telemetry events (`node_started`, `node_succeeded`, `node_failed`, `flow_completed`) for the SSE stream and run inspector.

Nodes are pure-ish — they read from the run context and return `{ outputs, telemetry }`. Side effects (HTTP, AI calls, DB writes) go through narrow modules that the engine doesn't otherwise know about.

The code-node is a special case: it runs in `node:vm` with timeouts, restricted globals, and a per-workspace feature gate. The audit playbook explicitly notes `node:vm` is not a security boundary — it's a usability boundary. RCE-equivalent capability stays gated behind explicit opt-in.

## Worker

The worker process consumes the pg-boss queue. Job types:

- `flow_run` — the main execution path described above.
- `flow_run_orphan_reaper` — periodic scan for runs stuck in `running` past their deadline; transitions them to `failed` with a documented reason. Idempotent.
- `memory_compaction` — periodic per-agent memory rollup, opportunistic.
- `usage_rollup` — daily aggregation of `usage_events` into `usage_daily` for billing UI.

The worker shares code with the web app, so adding a new job type means: new handler module, register it in `lib/queue.ts`, deploy. No separate build pipeline.

## Authentication & authorization

- **Authentication** — [Better Auth](https://www.better-auth.com/) with email/password and (optionally) OAuth providers. Sessions are cookie-based, HttpOnly + SameSite=Lax + Secure in production.
- **Authorization** — `lib/rbac.ts` defines four roles (`owner`, `admin`, `editor`, `viewer`) and a closed enum of `Action`s. `can(role, action)` is the only sanctioned check; routes call `assertCan` which throws `ForbiddenError` and gets translated to `403` by the API response helper.
- **API keys** — `/api/v1/*` accepts a per-workspace API key (`x-api-key` header). Keys are hashed (Argon2id) at rest and scoped to a workspace + role.
- **MCP** — same auth as `/api/v1/*` for HTTP transport; stdio uses a token injected via env at process spawn.

## Encryption

`lib/encryption.ts` implements AES-256-GCM with versioned keys:

- Encryption key set is loaded from `ENCRYPTION_SECRET` (current) and `ENCRYPTION_SECRET_V1..N` (older versions, for decrypt-only).
- Every ciphertext carries the key version it was encrypted under. Rotation is: add a new version to env, redeploy, run the re-encryption job. No downtime.
- Provider credentials and integration tokens go through this layer. Sessions and ephemerals do not.

## Observability

- **Logs** — structured JSON via a thin wrapper around `pino`. Every log line carries `runId`, `workspaceId`, `userId` when in scope.
- **Telemetry events** — flow runs emit a stream of structured events the studio's run inspector consumes via SSE.
- **Metrics** — no external metrics backend by default. Hooks exist in `lib/observability.ts` for plugging in OTLP/Prometheus exporters; self-hosters wire these up to their existing stack.
- **Audit log** — `lib/audit.ts` writes one row per sensitive mutation (member added, role changed, key created, provider credential rotated). Admin-only read.

## Cost & quota enforcement

Two independent gates:

1. **Plan quotas** — `lib/billing/check-quota.ts` reads `workspace.plan` and compares against `workspace.usageThisPeriod`. Rejects with `402` when over.
2. **Spend cap** — `lib/ai/metering.ts` reads `workspace.aiMonthlyCapUsd` and `usage_events` sum for the period. Rejects with `402` when over.

Both run inside the same transaction as the write they gate, under an advisory lock. There is also a global kill-switch (`AI_DISABLED=1`) that short-circuits every AI call without touching the DB.

## Security posture

The summary version. Detailed threat model lives in `.agents/audit.md`.

- **Multi-tenancy** — every workspace-scoped query carries `workspaceId`. Enforced structurally by the invariants guard.
- **Code execution** — code-node uses `node:vm`. Per-workspace gate, hard timeout, restricted globals. Not claimed as a sandbox against a determined attacker.
- **Outbound network** — `lib/net-guard.ts` validates URLs before HTTP-node dispatch (no private IP ranges, no localhost, no metadata endpoints) to mitigate SSRF.
- **Secrets at rest** — all third-party credentials encrypted (above). `.env` files are gitignored; example file ships with placeholder values only. `gitleaks` runs in CI.
- **Dependency hygiene** — Dependabot with grouped patches; `pnpm audit` runs in CI.
- **Supply chain** — DCO sign-off required on all PRs.

## Deployment topology

Two reference deployments:

### Single-node (self-hoster default)

```
Docker host
├── orchester-web      Next.js app
├── orchester-worker   Same image, started as worker
├── postgres-pgvector  Postgres 15 + pgvector
└── (optional) redis   Rate limiting at scale
```

Single Postgres database. Single worker process. Suits up to a few thousand active users.

### Managed Postgres + serverless web

```
Vercel (or any Node host)
├── Next.js app        Edge for static, Node for API
└── Worker             Separate long-running process (Fly, Render, Railway, K8s)

Managed Postgres (Supabase, Neon, RDS, Aiven, CrunchyData)
└── pgvector enabled
```

The worker MUST be a long-running process — it polls. Serverless functions don't work as the worker host. The web app itself is happy on serverless.

## Code conventions

- Strict TypeScript. `any` is rejected in PR review.
- No default exports for cross-module functions.
- Server-only modules import `"server-only"` so a mis-import surfaces at build time.
- Public API responses go through `lib/api-response.ts` — direct `Response.json(...)` in routes is rejected by review.
- Per-module tests colocated as `*.test.ts`.

## Testing

- **Unit + integration** — Vitest. Run `pnpm --filter @orchester/web test`. 80+ specs cover the flow engine, RBAC, providers, copilot tools, spreadsheet, encryption.
- **Structural invariants** — `scripts/audit-invariants.sh` (also runs in CI). Checks:
  - Every mutating route has zod validation.
  - Every mutating route has an `assertCan` call.
  - Every AI dispatch writes a `usage_events` row.
  - Every flow execution carries an `AbortSignal`.
- **Type checking** — `pnpm --filter @orchester/web exec tsc --noEmit`. Zero-error policy on `main`.

## Where to read next

- [`docs/migrations.md`](migrations.md) — how schema changes get authored, reviewed, and shipped.
- [`docs/encryption-key-rotation.md`](encryption-key-rotation.md) — rotating `ENCRYPTION_SECRET` without downtime.
- [`docs/dependency-licenses.md`](dependency-licenses.md) — license inventory for the dependency tree.
- [`docs/UI-DESIGN-SYSTEM.md`](UI-DESIGN-SYSTEM.md) — studio UI tokens and components.
- [`docs/adr/`](adr/) — architecture decision records.
