# Full-System Audit Playbook — Orchester

> **Purpose:** Reusable, on-demand methodology for a deep, total system audit across 14
> dimensions (A–N). This file is the **spec**; running it produces a **report**.
> Optimized for an AI agent (Claude Code) to execute end-to-end.

## When to run (IMPORTANT)

- **Only execute when the user explicitly asks** (e.g. "ejecutá la auditoría", "corré el
  audit playbook", "hacé la auditoría completa"). Documenting/refining this playbook is NOT
  a trigger to run it.
- When triggered, execute **all dimensions A→N, in order, point by point** unless the user
  scopes it down ("solo seguridad", "A–C", "top-3 de riesgo").
- Default mode is **read-only investigation + written report**. Do **not** fix anything
  during the audit unless the user says "auditá y arreglá". Findings are reported; fixes are
  a separate, confirmed step.

## Ground rules (methodology)

1. **Evidence over assumption.** Every finding cites real files + line ranges. If you claim
   "no hay timeout", show the fetch call that lacks one. No hand-waving.
2. **Ground in the actual repo.** The primitives below already exist — *verify whether they
   actually deliver*, don't assume they're missing:
   - Jobs/queue: `apps/web/lib/queue.ts`
   - Rate limiting: `apps/web/lib/rate-limit.ts`, `apps/web/lib/rate-limit-redis.ts`
   - FinOps: `apps/web/lib/cost-alerts.ts`, `apps/web/lib/employee-budget.ts`, `apps/web/lib/pricing.ts`
   - SSRF: `apps/web/lib/net-guard.ts`
   - Secret-safe logging: `apps/web/lib/safe-log.ts`
   - Audit log: `apps/web/lib/audit.ts` + `apps/web/app/api/audit-logs/`
   - GDPR delete: `apps/web/app/api/me/delete/`
   - Encryption: `apps/web/lib/encryption.ts`
   - Storage: `apps/web/lib/storage.ts`
   - Flow engine: `apps/web/lib/flow-engine.ts`
   - RBAC: `apps/web/lib/rbac.ts`, `apps/web/lib/auth-guards.ts`
   - DB schema: `packages/db/src/schema/*`
3. **Root cause, not symptom.** Follow the systematic-debugging discipline: trace data flow,
   find the origin, don't pattern-match a fix.
4. **No false alarms.** Before logging a finding, confirm it's real (read the surrounding
   code, check for an existing guard elsewhere). Mark confidence when unsure.
5. **Static-first, dynamic-optional.** Most of this is code reading + `grep`/`pnpm` checks.
   Browser/runtime verification (Chrome MCP) only where a finding needs live proof.
6. **Don't leak secrets** in the report (redact keys, tokens, PII you encounter).

## Severity rubric

| Sev | Label | Meaning | Examples |
| --- | --- | --- | --- |
| **P0** | Critical | Data breach, cross-tenant leak, money loss, RCE, prod-down | IDOR across workspaces, unsandboxed dynamic code execution, unbounded AI spend |
| **P1** | High | Serious bug/risk, likely in prod, no workaround | Missing timeout that hangs flows, non-idempotent retried side-effect |
| **P2** | Medium | Real issue, limited blast radius or has workaround | Missing index, inconsistent error shape, no TTL on media |
| **P3** | Low | Polish, hygiene, future-proofing | Naming, dead code, minor a11y |

Tag each finding with **likelihood** (low/med/high), **blast radius** (1 tenant / all
tenants / infra), and **effort to fix** (S/M/L).

## Output

- Save the report to: `docs/superpowers/audits/YYYY-MM-DD-full-system-audit.md`
- Structure:
  1. **TL;DR** — overall posture, count by severity, top 5 risks.
  2. **Severity table** — every finding: `ID · Sev · Dimension · Title · File:lines · Effort`.
  3. **Per-dimension sections (A–N)** — each checkpoint: ✅ ok / ⚠️ finding / ❓ needs-more.
     For findings: evidence (file:lines + snippet), why it matters, recommended fix.
  4. **Prioritized remediation plan** — P0→P3, grouped, with effort.
  5. **What was NOT audited** — explicit gaps (e.g. couldn't test with real keys).
- Finding ID format: `<DIM>-<n>` → `A-1`, `C-3`, `L-2`.

---

## A. Arquitectura & Diseño

- **A1 · Límites de dominio / bounded contexts.** Check: are `flows`, `agents`, `ai`,
  `integrations`, `channels`, `billing` cleanly separated? Where: `apps/web/lib/*` import
  graph. Red flags: a feature module importing another's internals; god-files mixing
  concerns. Verify: `grep` cross-module imports; look at `flow-engine.ts` (30KB) and
  `db-queries.ts` (28KB) for too-many-responsibilities.
- **A2 · Dirección de dependencias / ciclos.** Check: circular deps; UI importing infra
  directly; dependency inversion respected. Where: components → lib → db. Verify: `pnpm dlx
  madge --circular apps/web` (or equivalent), and spot-check that `app/` server routes go
  through `lib/` not raw DB inline.
- **A3 · ⭐ Consistencia ports & adapters.** Check: every AI adapter honors the same
  contract from `apps/web/lib/ai/capabilities.ts`; `family` routing is uniform. Where:
  `apps/web/lib/ai/adapters/*`, `apps/web/lib/ai/run.ts`, `apps/web/lib/llm-call.ts`. Red
  flags: special-cases that bypass the port (azure special-case, bespoke image adapters with
  divergent signatures), inconsistent error/return shapes across adapters.
- **A4 · Single source of truth.** Check: duplicated logic/constants. Where: catalog
  (`lib/ai/catalog/*`) vs `lib/flows/node-registry.ts` vs `node-docs.ts`; `lib/pricing.ts`
  vs any hardcoded prices. Red flags: model lists or capability labels defined twice.
- **A5 · Diseño de API.** Check: REST consistency, error shape uniformity, idempotency keys
  on mutations, pagination/filtering. Where: every `apps/web/app/api/**/route.ts`. Red
  flags: each route inventing its own error JSON; list endpoints with no pagination;
  POST/PUT with no idempotency on side-effecting ops; `/api/v1/*` vs internal inconsistency.
- **A6 · Config management.** Check: env vars centralized + validated at boot; safe
  defaults; feature flags. Where: search `process.env` usage repo-wide; look for a schema
  (zod) validating env. Red flags: `process.env.X!` scattered, missing-var crashes at
  runtime instead of boot, insecure defaults (e.g. `ALLOW_LOCAL_AI_PROVIDERS`).
- **A7 · Extensibilidad.** Check: adding a provider/model/node — how many files? Where:
  trace what it takes to add one chat provider (catalog row?) vs one flow node
  (`node-registry.ts` + `field-types.ts` + `node-docs.ts` + `icon-map.ts` + `FlowBuilder` +
  `flow-engine` + db enum). Red flags: a "new node" touching 7+ files = friction.

## B. Sistemas distribuidos & Escalabilidad

- **B1 · ⭐ Ejecución de flows long-running.** Check: do flows run inline in the HTTP
  request or via `lib/queue.ts`? Where: `apps/web/app/api/flows/[id]/` run route →
  `flow-engine.ts`; `lib/queue.ts`. Red flags: video/avatar/`delay`/polling executed inside
  the request lifecycle; serverless function timeout vs long flows; no worker.
- **B2 · ⭐ Idempotencia & re-run safety.** Check: on retry/crash mid-flow, do
  side-effecting steps (notify/email, http POST, integration writes, billing) re-fire?
  Where: `flow-engine.ts` step execution + `flow_run_steps` status handling. Red flags: no
  per-step "already-completed" guard; no idempotency key passed to external calls.
- **B3 · Concurrencia & locking.** Check: two triggers of the same flow at once; shared
  mutable state. Where: schedule/webhook trigger paths, `flow-engine.ts` module-level state.
  Red flags: in-memory maps keyed by flowId, no row lock on run creation.
- **B4 · Statelessness / scaling horizontal.** Check: server safe at N instances. Where:
  module-level singletons, in-memory caches, in-memory rate-limit (`rate-limit.ts` vs
  `rate-limit-redis.ts`). Red flags: state that only works on one instance.
- **B5 · Connection pooling.** Check: Postgres pool sizing/limits. Where: db client init in
  `packages/db`. Red flags: new connection per request, no max, no idle timeout.
- **B6 · Caching.** Check: layers + invalidation + staleness. Where: any `unstable_cache`,
  Redis usage, fetch caching in routes. Red flags: caching authz-sensitive or per-tenant
  data without keying by workspace.
- **B7 · Backpressure / rate limiting interno.** Check: limits between components & on AI
  calls. Where: `rate-limit*.ts`, AI run paths. Red flags: unbounded concurrency to providers.

## C. Confiabilidad / Resiliencia (SRE)

- **C1 · ⭐ Timeouts en todos lados.** Check: every external `fetch` has a timeout/abort.
  Where: `lib/llm-call.ts`, `lib/ai/adapters/*` (media polling!), `lib/webhooks-out.ts`,
  `http` node in `flow-engine.ts`, `lib/integrations/*`. Red flags: bare `fetch()` with no
  `AbortSignal.timeout`; polling loops with no max-attempts/deadline.
- **C2 · ⭐ Retries + backoff + circuit breakers.** Check: external calls retried sanely.
  Where: same files as C1. Red flags: no retry, or retry with no backoff/jitter, or infinite
  retry; no breaker on a down provider.
- **C3 · ⭐ Atomicidad de flows.** Check: partial failure leaves consistent state;
  transactions where needed. Where: `flow-engine.ts`, multi-write DB ops in `db-queries.ts`.
  Red flags: multiple writes without a tx; run marked succeeded with steps failed.
- **C4 · Degradación / fallback chains.** Check: provider down → fallback model. Where:
  `lib/ai/run.ts`, `llm-call.ts`. Red flags: hard fail with no fallback strategy.
- **C5 · Resumabilidad / crash recovery.** Check: in-flight runs recoverable after restart.
  Where: `flow_runs`/`flow_run_steps` status machine, `lib/queue.ts`. Red flags: "running"
  rows orphaned forever after a crash; no reaper.
- **C6 · Dead-letter / poison handling.** Check: webhooks/jobs that keep failing. Where:
  `lib/queue.ts`, `app/api/webhooks/[secret]`. Red flags: failed job retried forever, no DLQ.
- **C7 · Graceful shutdown.** Check: deploy doesn't kill running work. Where: queue/worker
  lifecycle. Red flags: SIGTERM drops in-flight runs with no drain.

## D. Observabilidad (nivel producción)

- **D1 · Tracing distribuido / correlation IDs.** Check: an ID flows trigger → each step →
  AI call → external call. Where: `lib/observability.ts`, `flow-engine.ts` logging. Red
  flags: logs you can't correlate across a single run.
- **D2 · Métricas RED/USE, SLI/SLO, alerting.** Check: request rate/errors/duration &
  resource metrics emitted. Where: `lib/observability.ts`, `app/api/health`,
  `app/api/admin/health-detailed`. Red flags: no metrics, no alert thresholds.
- **D3 · ⭐ Audit log (quién hizo qué).** Check: sensitive actions recorded with actor +
  tenant. Where: `lib/audit.ts`, `app/api/audit-logs/`. Red flags: mutations not audited;
  audit writable/spoofable by tenant.
- **D4 · ⭐ Atribución de costo IA por workspace.** Check: every AI call attributes
  tokens/cost to a workspace (BYO-key vs platform key). Where: `lib/cost-alerts.ts`,
  `lib/pricing.ts`, `llm-call.ts`, `lib/ai/run.ts`, `app/api/billing/usage`. Red flags: AI
  calls with no usage record; cost not tied to workspace.
- **D5 · Logging estructurado sin secretos/PII.** Check: structured logs; redaction. Where:
  `lib/safe-log.ts` — verify it's actually used everywhere keys/PII could be logged. Red
  flags: `console.log` of request bodies, headers, API keys, prompts with PII.

## E. FinOps / Costos ⭐

- **E1 · Cuotas y límites de gasto por tenant.** Check: a workspace can't run up unbounded
  spend. Where: `lib/employee-budget.ts`, `lib/cost-alerts.ts`, billing usage. Red flags: no
  hard cap, only soft alerts.
- **E2 · Tracking de tokens/costo por run/capability/modelo.** Check: granularity of cost
  records. Where: `lib/pricing.ts`, usage tables in `schema/production.ts` or `billing`. Red
  flags: only aggregate, can't attribute to a model/run.
- **E3 · Guardrails: max spend, budget alerts, kill-switch.** Check: enforcement not just
  notification. Where: `cost-alerts.ts`. Red flags: alert fires but calls keep going.
- **E4 · Lifecycle de media generada.** Check: TTL/cleanup of generated images/audio/video
  in storage. Where: `lib/storage.ts`, where `run.ts` saves media. Red flags: write-only,
  never deleted → unbounded storage cost.

## F. Compliance / Privacidad / Legal

- **F1 · GDPR: borrado real, export, retención.** Check: `/api/me/delete` truly cascades;
  data export exists. Where: `app/api/me/delete/`, FK `onDelete` in `schema/*`. Red flags:
  delete leaves orphans (conversations, flow_runs, media, embeddings).
- **F2 · ⭐ PII hacia providers de IA.** Check: what user data is sent to OpenAI/Google/etc;
  is it minimized/disclosed? Where: prompt assembly in `agent-runtime.ts`, `llm-call.ts`,
  memory/RAG (`lib/memory.ts`, `lib/knowledge-search.ts`). Red flags: raw PII in prompts with
  no redaction option, no provider data-handling note.
- **F3 · Moderación de contenido.** Check: guardrails on generated images/video — especially
  the **avatar saying a name** use case (deepfake/abuse risk). Where: `lib/ai/adapters/avatar.ts`,
  `images.ts`, `media.ts`. Red flags: no moderation hook, no consent/usage gating.
- **F4 · ToS de cada provider.** Check: usage respects model providers' terms. Where:
  catalog `docsUrl`. Red flags: aggregator usage that violates a provider ToS. (Best-effort.)
- **F5 · Data residency.** Check: where data + media live. Where: storage driver, DB region.
  Red flags: no statement; EU data to US with no control.

## G. Ciclo de vida de datos

- **G1 · ⭐ Retención/TTL.** Check: `flow_runs`, `flow_run_steps`, logs, media pruned. Where:
  schema + any cron/cleanup. Red flags: monotonic growth, no retention job.
- **G2 · Soft vs hard delete + cascadas.** Check: deletes consistent; FK cascades correct.
  Where: `schema/*` `references(..., { onDelete })`. Red flags: mix of soft/hard with
  orphans; missing cascade.
- **G3 · Backups & DR.** Check: backup strategy + restore tested. Where: infra/ops docs. Red
  flags: none documented. (Likely a doc-level finding.)

## H. Supply chain / Dependencias

- **H1 · Vulnerabilidades.** Run: `pnpm audit --prod` (and full). Red flags: high/critical
  advisories, especially in runtime deps.
- **H2 · Licencias.** Check: license compatibility of deps. Where: `pnpm licenses list` if
  available. Red flags: GPL/AGPL in a proprietary product.
- **H3 · Lockfile integrity & staleness.** Check: lockfile committed, versions pinned,
  abandoned packages. Where: `pnpm-lock.yaml`, `package.json`. Red flags: floating ranges on
  security-sensitive libs, unmaintained crypto/auth deps.

## I. Gestión de secretos

- **I1 · ⭐ Rotación de la encryption key.** Check: can the AES master key be rotated
  without losing stored credentials? Where: `lib/encryption.ts` (key versioning?),
  `schema/ai-providers.ts`. Red flags: single global key, no version tag on ciphertext, no
  re-encrypt path.
- **I2 · KMS vs env + lifecycle.** Check: where the master key lives. Where: env usage in
  `encryption.ts`. Red flags: master key in plain env with no KMS, committed anywhere.

## J. CI/CD & Deploy

- **J1 · ⭐ Seguridad de migraciones.** Check: expand/contract, zero-downtime; drift between
  `drizzle-kit push` and committed migrations (baseline `0000` is stale per notes). Where:
  `packages/db` migrations + schema. Red flags: destructive migrations, push-only workflow
  with no reviewable migration history.
- **J2 · Rollback / preview / flags.** Check: rollback strategy, preview envs, progressive
  rollout. Where: CI config (`.github/` or similar). Red flags: no rollback path.
- **J3 · Build reproducible.** Check: deterministic build, pinned toolchain (Node 22). Red
  flags: build depends on local-only state.

## K. Frontend (arquitectura)

- **K1 · Data fetching: caching/revalidación, optimistic updates.** Where: client
  components hitting `/api/*`, SWR/React Query usage. Red flags: optimistic update with no
  rollback on error; stale after mutation.
- **K2 · Error boundaries & network failure handling.** Where: app router
  `error.tsx`/boundaries. Red flags: white-screen on fetch failure; no retry UI.
- **K3 · Bundle analysis, lazy loading, hidratación.** Check: heavy imports, code splitting.
  Red flags: shipping the whole catalog/3D/builder to every page; hydration mismatches.
- **K4 · Paridad de validación cliente/servidor.** Check: same validation both sides. Red
  flags: client validates, server trusts blindly (or vice-versa).

## L. IA-específico

- **L1 · ⭐ Prompt injection / jailbreak en agentes.** Check: an agent reading
  untrusted content (email, web, KB) can be steered to misuse tools. Where: `agent-runtime.ts`,
  `lib/tools.ts`, memory/RAG inputs. Red flags: untrusted content concatenated into system
  prompt with tool access and no guardrail.
- **L2 · ⭐ Sandboxing de tool-calling.** Check: which tools an agent can call and with what
  authority; is the `code` node / any dynamic code execution sandboxed and tenant-scoped?
  Where: `lib/tools.ts`, `flow-engine.ts` `code` executor, `lib/agent-runtime.ts`. Red
  flags: tools not scoped to workspace, dynamic code-evaluation primitives with network/fs
  access.
- **L3 · Context window management.** Check: truncation/overflow handling. Where:
  `llm-call.ts`, memory compaction (`lib/memory-compaction.ts`). Red flags: unbounded prompt
  growth, no truncation → provider 400s.
- **L4 · Validación de output estructurado.** Check: structured outputs validated. Where:
  agent/tool result parsing. Red flags: `JSON.parse` of model output with no schema/guard.
- **L5 · Streaming: cancelación + cleanup.** Check: client abort closes upstream stream.
  Where: `streamOpenAI` in `llm-call.ts`, SSE routes. Red flags: stream leaks when client
  disconnects.
- **L6 · Fallback chains de modelos.** (Cross-ref C4.) Where: `run.ts`. Red flags: none.

## M. Multi-tenancy (profundo) ⭐

- **M1 · Aislamiento en CADA capa.** Check: every query filters by `workspaceId`; consider
  row-level security. Where: `lib/db-queries.ts` (28KB — high risk), every `app/api/**`
  handler. Red flags: a query or route that takes an id from the URL/body and reads/writes
  without verifying it belongs to the caller's workspace (IDOR). **This is the #1 P0 hunt.**
- **M2 · Noisy neighbor.** Check: one heavy tenant can't degrade others. Where: queue
  fairness, rate limits per tenant. Red flags: global queue with no per-tenant fairness.
- **M3 · Cuotas/rate-limits por tenant.** Check: limits keyed by workspace. Where:
  `rate-limit*.ts`. Red flags: global-only limits.
- **M4 · Offboarding.** Check: deleting a workspace removes everything (DB rows, media,
  credentials, webhooks, schedules). Where: `app/api/workspaces/[id]` delete + cascades. Red
  flags: leftover media in storage, orphaned schedules still firing.

## N. Correctitud de negocio

- **N1 · Cálculos de pricing/billing/usage metering.** Check: precision, rounding, edge
  cases (zero usage, refunds, plan change mid-cycle). Where: `lib/pricing.ts`,
  `lib/billing/*`, `app/api/billing/*`. Red flags: float rounding errors, double-count,
  off-by-one on period boundaries.
- **N2 · Enforcement de cuotas y planes.** Check: plan limits actually enforced server-side.
  Where: billing + `auth-guards.ts`/`rbac.ts`. Red flags: limits only shown in UI, not
  enforced on the API.

---

## Execution checklist (when triggered)

1. Create the report file `docs/superpowers/audits/YYYY-MM-DD-full-system-audit.md` with the
   TL;DR + severity table scaffold.
2. Walk A→N **in order**, point by point. For each checkpoint: read the cited files, record
   ✅/⚠️/❓ with evidence.
3. Run the tool-backed checks: `madge --circular` (A2), `pnpm audit` (H1), `pnpm licenses`
   (H2), `grep` sweeps for `fetch(` without timeout (C1), `process.env` (A6), `workspaceId`
   filter presence (M1).
4. Prioritize all findings P0→P3; write the remediation plan.
5. List what was NOT audited (e.g. live execution without real API keys, DR/backups if
   infra-only).
6. Report the TL;DR back in chat; do not start fixing unless asked.
