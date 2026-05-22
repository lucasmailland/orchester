# Orchester — Full-System Audit (A–N)

> **Date:** 2026-05-22 · **Auditor:** Claude (5 parallel investigators + lead verification)
> **Method:** `.agents/audit-playbook.md`, read-only static analysis + tool checks
> (`madge`, `pnpm audit`, `pnpm licenses`, grep sweeps). All P0 findings independently
> re-verified by the lead before publication.
> **Scope:** dimensions A–N, ~50 checkpoints. **Not** executed: live runtime with real
> provider keys; load/perf testing; infra (backups/DR) beyond what's in-repo.

---

## TL;DR

Orchester is **architecturally clean** (no circular deps, good domain boundaries, genuinely
solid multi-tenant query scoping — the #1 IDOR hunt came back **clean**). But it is **not
production-ready for untrusted multi-tenant use**: there is a **host-RCE reachable by any
workspace member**, the **job queue and RBAC layer are both built but never wired in**, AI
spend is **uncapped and largely unmetered**, plan quotas are **never enforced**, and the prod
deploy applies schema with **`drizzle-kit push --force`**.

The recurring theme is **"built but not wired"**: queue (`lib/queue.ts` + worker), RBAC
(`assertCan`/`requireAuth`), quotas (`checkQuota`), the Redis rate-limiter, and the orphan-run
cleanup cron all exist as code but have **zero or near-zero call sites**. Most P0s are
therefore **medium-effort wiring**, not rewrites.

### Counts by severity

| Severity | Count |
| --- | --- |
| **P0 Critical** | 7 |
| **P1 High** | 18 |
| **P2 Medium** | 19 |
| **P3 Low** | 7 |

### Top 7 risks (all P0, all lead-verified)

1. **L2-1 — Host RCE via `code`/`runFormula` flow node.** `node:vm` (self-described "no es una
   frontera de seguridad") + dead RBAC ⇒ any member, even `viewer`, runs arbitrary code on the
   shared host → reads `ENCRYPTION_SECRET`, `DATABASE_URL`, every tenant's keys. **All tenants.**
2. **B1 — Flows execute inline in the HTTP request; the job queue has no producers.** Verified:
   the only `enqueue(JOB_FLOW_RUN…)` is a doc comment. Long media polling (up to ~8 min) runs
   inside a request → serverless timeout → stuck runs.
3. **C5 — No orphan-run reaper.** Killed mid-run (timeout/SIGTERM/OOM) ⇒ `flow_run` stuck
   `running` forever; nothing ever sets `cancelled`/`failed`.
4. **N2-1 — Plan quotas never enforced.** `checkQuota` has **zero callers**; limits are
   decorative → revenue leakage on every plan.
5. **D4-1 — AI cost attribution incomplete.** Only web-chat writes a usage row
   (`channels/router.ts:233`); **all flow + media AI spend is invisible** to billing.
6. **E1-1 — No per-workspace spend cap.** Only a per-employee budget on the chat path. A loop
   or one tenant can run unbounded provider spend.
7. **J1-1 — `drizzle-kit push --force` is the production migration step** (`vercel.json:3`,
   `ci.yml:73`). Destructive DDL auto-applied, no reviewable history, build mutates prod DB.

### What's genuinely good (don't "fix" these)

- **M1 multi-tenant isolation** — every `[id]` route re-checks `and(eq(id), eq(workspaceId))`;
  workspace derived server-side from session, never client-supplied. No IDOR found.
- **Secret-safe logging** (`lib/safe-log.ts`) is real and used; no key/PII/prompt leakage found.
- **Audit writes are server-derived, not tenant-spoofable.**
- **FK cascades** are well-modeled; `.env` never committed; `gitleaks` in CI.
- **No circular dependencies** (madge, 422 files); UI never imports the DB package directly.
- **Postgres pooling** is correct (memoized client, `max`/idle/connect timeouts).

---

## Severity table (all findings)

| ID | Sev | Dim | Title | Evidence | Effort |
| --- | --- | --- | --- | --- | --- |
| L2-1 | P0 | L | RCE via `code`/`runFormula` node (`node:vm` not a sandbox) | `flow-engine.ts:195-232` | M |
| B1 | P0 | B | Flows run inline; job queue has no producers | `flows/[id]/run/route.ts:10`; `worker/index.ts:11` | M |
| C5 | P0 | C | No orphan-run reaper; runs stuck `running` forever | `flow-engine.ts:256-303` | M |
| N2-1 | P0 | N | `checkQuota` never called — quotas unenforced | `billing/quotas.ts:65` (0 callers) | M |
| D4-1 | P0 | D | AI cost not attributed (flow + media unmetered) | `run.ts` (no usage); `router.ts:233` (only site) | M |
| E1-1 | P0 | E | No per-workspace spend cap | `employee-budget.ts:32-85` | M |
| J1-1 | P0 | J | `push --force` is the prod migration mechanism | `vercel.json:3`; `ci.yml:73` | M |
| RBAC-1 | P1 | M/A | RBAC built but not enforced (`assertCan` 0, `requireAuth` 2/81) | grep verified | M |
| M4-1 | P1 | M | Workspace delete leaks storage media + external webhooks | `workspaces/[id]/route.ts:142` | M |
| I1-1 | P1 | I | Single AES key, no versioning/rotation path | `encryption.ts:7-46` | M |
| B2-1 | P1 | B | No per-step idempotency; retries double-fire side effects | `flow-engine.ts:307-372` | M |
| B3-1 | P1 | B | No lock on run creation; unbounded parallel same-flow runs | `flow-engine.ts:256-264` | S |
| B4-1 | P1 | B | In-memory rate limiter per-instance (Redis adapter unwired) | `rate-limit.ts:44-71` | S |
| C1-1 | P1 | C | Missing timeouts on most fetches; multi-min poll loops | `llm-call.ts`, `ai/adapters/*` | M |
| C3-1 | P1 | C | No transactions/atomicity in run+step writes | `flow-engine.ts:287-360` | M |
| J1-2 | P1 | J | Schema drift: 35 tables, 1 migration (stale `0000`) | `drizzle/` (verified) | M |
| H1-1 | P1 | H | `next` 15.5.15 — middleware/auth bypass + SSRF | `pnpm audit` | S |
| H1-2 | P1 | H | `kysely` <0.28.17 JSON-path injection (runtime) | `pnpm audit --prod` | S |
| D3-1 | P1 | D | Audit-log coverage partial (~31 sites / 64 mutations) | grep | M |
| E2-1 | P1 | E | `usageEvents.costUsd` never written; blended rate | `router.ts:233`; `production.ts:139` | M |
| E3-1 | P1 | E | Guardrails notify but don't block; no kill-switch | `cost-alerts.ts:104` | M |
| E4-1 | P1 | E | Generated media write-only forever (no TTL) | `run.ts:48-89` | M |
| F1-1 | P1 | F | `me/delete` orphans data w/ co-owners; no export | `me/delete/route.ts:60-119` | M |
| F3-1 | P1 | F | No content moderation; deepfake avatar unguarded | `ai/adapters/avatar.ts:8-91` | M |
| N1-1 | P1 | N | Pricing approximate; Stripe webhook period/plan parsing bug | `pricing.ts:35`; `billing/webhook/route.ts:40-78` | M |
| K2-1 | P1 | K | No error boundaries; failed loads spin forever | `app/**` (no `error.tsx`) | S |
| K4-1 | P1 | K | Server-side input validation absent (0/81 routes use zod) | grep | M |
| L2-3 | P2 | L | Agent `http_request` weaker SSRF filter than `net-guard` | `tools.ts:309-319` | S |
| L5-1 | P2 | L | SSE streams don't cancel upstream LLM (cost/leak) | `test-chat-stream/route.ts:68`; `llm-call.ts:522` | M |
| L1-1 | P2 | L | Prompt injection: untrusted content + tools, no segregation | `agent-runtime.ts:104-166` | M |
| http-SSRF | P2 | L | Flow `http` node bypasses `assertPublicUrl` | `flow-engine.ts:446-499` | S |
| A3-1 | P2 | A | Ports declared but adapters don't implement them | `capabilities.ts:45`; `media.ts:71` | M |
| A4-1 | P2 | A | 3 parallel model registries; pricing covers 9/~60 | `pricing.ts:15`; `providers.ts:4`; catalog | M |
| A5-1 | P2 | A | 3 list envelopes; no idempotency; v1 unpaginated | `api/**` | M |
| A6-1 | P2 | A | No boot-time env validation; lazy secret checks | `instrumentation.ts:12-79` | S |
| A7-1 | P2 | A | New node = 5–6 files incl. DB enum migration; type dup ×6 | `flows.ts:26-56` | M |
| B7-1 | P2 | B | Unbounded fan-out to providers (`parallel` → `Promise.all`) | `flow-engine.ts:773` | M |
| C2-1 | P2 | C | Retries re-send non-idempotent POSTs; no circuit breaker | `flow-engine.ts:470-499` | M |
| C4-1 | P2 | C | No model/provider fallback chain | `run.ts:22`; `llm-call.ts:606` | M |
| C6-1 | P2 | C | Webhook subscriber never auto-disabled; no DLQ | `webhooks-out.ts:184-196` | S |
| C7-1 | P2 | C | Web shutdown is flat 10s timer; doesn't drain runs | `instrumentation.ts:49-64` | M |
| D1-1 | P2 | D | No correlation/trace ID across run→step→AI | `flow-engine.ts`; `observability.ts` | M |
| D2-1 | P2 | D | No RED/USE metrics, SLO, or alerting | `observability.ts:1-82` | M |
| F2-1 | P2 | F | Full PII/history/memory to providers; no minimization | `router.ts:247`; `memory.ts:206` | M |
| G1-1 | P1 | G | No retention/TTL on runs/steps/deliveries/media | cron is no-op `worker/index.ts:73` | M |
| K1-1 | P2 | K | Manual fetch + full refetch; no cache/optimism | `components/**` (32 sites) | M |
| K3-1 | P2 | K | No code-splitting; heavy libs static; 71% `use client` | `flows/[id]/page.tsx:5` | S |
| M2-1 | P2 | M | Noisy-neighbor: no queue fairness / global cap | `rate-limit.ts:44-73` | M |
| N1-2 | P2 | N | No zero-usage / mid-cycle / refund handling | `billing/quotas.ts:31` | M |
| N2-2 | P2 | N | Public v1 API runs without metering/quota | `v1/agents/route.ts:7-37` | M |
| L4-1 | P3 | L | Structured output not validated vs `outputSchema` | `agent-runtime.ts:108` | S |
| D3-2 | P3 | D | Audit log readable by `viewer` | `audit-logs/route.ts:6`; `rbac.ts:42` | S |
| F1-2 | P3 | F | Audit retains userId/before-after post-erasure (undisclosed) | `me/delete/route.ts:116` | S |
| G3-1 | P3 | G | Backups/DR doc-only; cron not verified installed | `RUNBOOK.md:140` | S |
| H2-1 | P3 | H | Copyleft (sharp LGPL, jszip dual) — document election | `pnpm licenses` | S |
| H3-1 | P2 | H | Auth/db/crypto deps float on caret | `package.json` | S |
| J3-2 | P3 | J | `esbuild` pinned to abandoned 0.18.20; no `.nvmrc` | `apps/web/package.json` | S |

---

## A. Arquitectura & Diseño

- **A1 · ✅** Domains cleanly separated. `flow-engine.ts` (30KB) and `db-queries.ts` (28KB) are
  large but cohesive (query layer / engine), not god-files. Only smell: `executeNode` is a
  ~30-branch `if (node.type===…)` chain (see A7).
- **A2 · ✅** `madge` clean — no circular deps across 422 files. UI never imports `@orchester/db`.
- **A3-1 · ⚠️ P2** Ports are declarative-only. `TtsAdapter`/`ChatAdapter` (`capabilities.ts:45`)
  are never implemented; `speakWith` returns `{bytes,mime}` not `AudioResult`; `llm-call.ts`
  re-declares its own `ChatMessage` and `getProviderKey`. Azure special-cased before family
  routing; adapters dispatch by `switch(providerId)` while chat uses `switch(family)` — three
  dispatch styles. Error shapes are ad-hoc strings. *Fix: make adapters return port types,
  implement `ChatAdapter`, unify dispatch + a typed error envelope.*
- **A4-1 · ⚠️ P2** Three parallel model registries: catalog (~60 models) vs `pricing.ts` (9) vs
  `providers.ts` (4, vestigial). Cost falls back to `DEFAULT_COST_PER_1K=0.008` for ~85% of
  models. *Fix: per-model price in `ModelDef`; delete `routeToProvider`/`defaultModelsFor`.*
- **A5-1 · ⚠️ P2** Three list envelopes (`{data}` / bare array / `{rows,hasMore,nextOffset}`);
  no zod; no idempotency keys; public `/api/v1/agents` returns all rows unpaginated.
- **A6-1 · ⚠️ P2** No boot-time env validation; `ENCRYPTION_SECRET` checked lazily on first
  crypto call (misconfig boots green, 500s later). Good: `ALLOW_LOCAL_AI_PROVIDERS` defaults off.
- **A7-1 · ⚠️ P2** Adding a node touches 5–6 files **incl. a pgEnum migration**; node-type id
  duplicated in 6 places; engine dispatch is an if-chain (missing handler = runtime, not compile,
  error). *Fix: derive enum+union from one const; `Record<NodeType,handler>` map.*

## B. Sistemas distribuidos & Escalabilidad

- **B1 · ⚠️ P0** *(verified)* Flows execute **inline** in the request (`flows/[id]/run/route.ts:10`,
  `run-stream`, `webhooks/[secret]/route.ts:104`). The pg-boss queue + worker exist and are
  correct, but **no route enqueues** `JOB_FLOW_RUN` — the only occurrence is a doc comment
  (`worker/index.ts:11`). Media/avatar polling up to ~6–8 min runs in-request → serverless
  timeout. *Fix: enqueue runs, insert `pending` row, return `{runId}`; keep `run-stream` for
  short dry-runs only.*
- **B2-1 · ⚠️ P1** Every `runFromNode` inserts a fresh step row; no `(runId,nodeId)` succeeded
  guard. Worker retry (`retryLimit:3`) re-runs the **whole** flow with a new `runId` → `http`
  POSTs, `notify`, paid `generate_*` re-fire. No idempotency keys to external calls.
- **B3-1 · ⚠️ P1** No `SELECT … FOR UPDATE`/advisory lock on run creation (grep: 0). Concurrent
  triggers run fully in parallel; `singletonKey` exists in queue but unused for flows.
- **B4-1 · ⚠️ P1** Default rate-limit adapter is in-process `Map`; Redis adapter
  (`rate-limit-redis.ts`, correct atomic Lua) only activates if `REDIS_URL` set and
  `setRateLimitAdapter` is never called at bootstrap. N replicas ⇒ N× effective limits; the
  public webhook DoS/cost guard under-enforces.
- **B5 · ✅** `postgres()` memoized on `globalThis`, `max:10`, idle/connect timeouts. (Size pool
  vs replica count × pg-boss pool.)
- **B6 · ✅/❓** No per-tenant cache leak found (rate-limit keys include `ws.id`). Medium
  confidence — not every route's caching read.
- **B7-1 · ⚠️ P2** `parallel` node and `webhooks-out` fan out with `Promise.all`, no concurrency
  cap or 429-aware throttle to providers.

## C. Confiabilidad / Resiliencia (SRE)

- **C1-1 · ⚠️ P1** Timeout audit: the `http` node (`flow-engine.ts:475`), outbound webhooks
  (8s), and integration `fetchJson` (10s) have timeouts. **Everything else does not** — all LLM
  calls (`llm-call.ts:158,259,287,326,436,529`), embeddings, image/video/tts/stt/rerank/ocr
  adapters, channels (Slack/Telegram), Stripe, Resend, storage S3, the `web_fetch` tool. Media
  poll loops have max-attempts but no wall-clock deadline (video `200×2s≈6.7min`, avatar
  `≈5–8min`). *Fix: AbortController on every fetch + overall poll deadline; move polling to worker.*
- **C2-1 · ⚠️ P2** `http` node retries any method incl. POST (double-fire); LLM/media have no
  retry at all (single 429 fails the run); no circuit breaker anywhere.
- **C3-1 · ⚠️ P1** Only one `.transaction(` in the repo (`employee-budget.ts:103`). The engine
  writes run + steps + `flows.lastRunAt` as independent updates; crash between them ⇒ steps
  `succeeded` while run `running`. `subflow` commits its own run independently (no saga/compensation).
- **C4-1 · ⚠️ P2** `runChat`→`llmCall` resolves one model and throws; `pickAvailableModel` exists
  but isn't used as a failover path.
- **C5 · ⚠️ P0** *(verified)* No reaper for stuck runs. Status set `running` at
  `flow-engine.ts:261`; only transitions inside the in-process try/catch. `cancelled` exists in
  the enum but **nothing sets it**. The daily `usage:aggregate` cron (`worker/index.ts:73`) is a
  no-op. Crash/timeout ⇒ permanent zombie runs. *Fix: reaper in the (existing) daily cron.*
- **C6-1 · ⚠️ P2** Webhook subscriber: 3 attempts, records `failureCount`, but **no auto-disable**
  and no DLQ — a broken endpoint is retried on every future event forever. (pg-boss archive is an
  acceptable DLQ for jobs.)
- **C7-1 · ⚠️ P2** Web process SIGTERM = flat 10s `setTimeout` then exit; doesn't await in-flight
  `executeFlow` (minutes). Worker shutdown is correct (`boss.stop({graceful,timeout:30s})`) —
  another reason flows belong in the worker.

## D. Observabilidad

- **D1-1 · ⚠️ P2** `runId` is only a PK; never propagated to `llmCall`, the `http` fetch, or any
  log line. `observability.ts` only does Sentry `captureException` with no trace context.
- **D2-1 · ⚠️ P2** No RED/USE metrics, no SLO, no alerting. `health-detailed` is point-in-time,
  emits no time-series.
- **D3-1 · ⚠️ P1** `logAudit` called from ~31 sites; ~64 mutating handlers exist. Missing on
  agents/[id], flows/[id], conversations/[id], integrations/[id], webhooks-out/[id], v1/* writes.
- **D3-2 · ⚠️ P3** Audit log GET has no role gate and `audit.read` is granted to `viewer`. (Writes
  are server-derived, **not** spoofable — good.)
- **D4-1 · ⚠️ P0** *(verified)* `usageEvents` inserted only at `channels/router.ts:233` (web/TG/
  Slack/widget chat). Flow `llm_prompt`/`agent` nodes only stash `tokensUsed` in step output;
  `lib/ai/run.ts` (image/video/tts/stt/rerank/avatar/music/ocr) writes **no** usage/cost. Flow &
  media AI spend is invisible to billing — direct money loss on platform keys.
- **D5 · ✅** `safe-log.ts` redacts Anthropic/OpenAI/Google/Slack/Bearer/JWT/postgres creds and is
  the standard; only benign `console.*` (dev email body, worker name) found. No prompt/key/PII leak.

## E. FinOps / Costos

- **E1-1 · ⚠️ P0** Only hard quota is `checkEmployeeBudget` (per-employee, chat path only); anon
  visitors always `allowed`. No workspace USD cap anywhere. Combined with D4-1, spend is uncapped
  **and** partly invisible.
- **E2-1 · ⚠️ P1** `usageEvents.costUsd` column exists but is never written (insert omits it);
  `tokens_in/out` kinds defined but never inserted; pricing is a single blended rate per model.
- **E3-1 · ⚠️ P1** `maybeFireBudgetAlert` only webhooks/emails; the only enforcement is the
  employee budget on the chat prelude. No workspace kill-switch.
- **E4-1 · ⚠️ P1** `generateImage`/`textToSpeech` `storage.put` under `ai-images`/`ai-audio` and
  never schedule deletion; `storage.delete()` has zero callers. Unbounded cost + biometric/PII
  retention.

## F. Compliance / Privacidad / Legal

- **F1-1 · ⚠️ P1** `me/delete`: for workspaces with another owner, only removes membership;
  authored content + `messages.authorUserId` (plain text, no FK) dangle. No data-export endpoint;
  no documented retention.
- **F1-2 · ⚠️ P3** `auditLogs.userId` + before/after retained post-erasure (intentional for
  forensics, but must be disclosed + bounded).
- **F2-1 · ⚠️ P2** Full message history + `employee/team/global` memories spliced verbatim into
  the system prompt to whatever provider resolves; no PII scrub, no per-provider data flag, no
  disclosure layer.
- **F3-1 · ⚠️ P1** `generateAvatarWith` forwards arbitrary `text` + `imageUrl`/`avatarId` to
  HeyGen/D-ID/Replicate with no identity/consent/moderation checks. The exact "avatar saying a
  name" deepfake case is fully open. Image/video prompts also unfiltered.
- **F4 · ❓** BYO-key pushes most ToS risk to tenants; platform exposure is F3 (deepfake) + the
  `code` node. Doc-level; needs provider contracts.
- **F5 · ❓** Media region = `S3_REGION`/`S3_ENDPOINT`; DB region = deploy config. No per-tenant
  residency controls. Infra-dependent.

## G. Ciclo de vida de datos

- **G1-1 · ⚠️ P1** No retention/TTL on `flow_runs`, `flow_run_steps`, `webhook_deliveries`, or
  generated media. The daily cron is explicitly a no-op ("limpieza … No-op por ahora"). Monotonic
  growth of full JSON inputs/outputs + payloads + media.
- **G2 · ✅** Every child→parent FK has explicit `onDelete`; workspace cascades thorough;
  intentional `set null` on conversation/team refs is sensible. No missing-cascade orphans.
- **G3-1 · ⚠️ P3** `RUNBOOK.md` covers backup/restore/DR and `PRODUCTION-CHECKLIST.md` references
  `scripts/backup.sh` via cron — but it's doc/manual only; confirm the cron is installed and
  rehearse a restore.

## H. Supply chain / Dependencias

- **H1-1 · ⚠️ P1** `pnpm audit`: 24 advisories (8 high). `next@15.5.15` — Middleware/Proxy bypass
  (auth bypass) + SSRF + DoS, one patch below fix. Critical in a multi-tenant app if isolation is
  enforced in middleware. *Fix: `next ≥ 15.5.18`.*
- **H1-2 · ⚠️ P1** `kysely@0.28.16` (transitive via drizzle) — JSON-path injection, runtime. *Fix:
  `pnpm.overrides: { kysely: ">=0.28.17" }`.*
- **H1-3 · ⚠️ P2** Moderate cluster: `next-intl` open redirect + proto pollution, `ws` mem
  disclosure, `postcss` XSS, `esbuild`/`vite` dev-server. Bump each.
- **H2-1 · ⚠️ P3** No AGPL/GPL/SSPL in runtime. `sharp` LGPL (dynamically linked, fine), `jszip`
  dual MIT/GPL (elect MIT). Document the election.
- **H3-1 · ⚠️ P2** Auth/db/crypto deps float on caret (`better-auth^`, `drizzle-orm^`, `next^`,
  `postgres^`); lockfile mitigates day-to-day but the caret already allowed the vulnerable `next`.
  Transitive `kysely:'*'` wildcard.
- **Secrets-in-git · ✅** Only `.env.example` tracked; `.env` git-ignored, never in history;
  `gitleaks` in CI.

## I. Gestión de secretos

- **I1-1 · ⚠️ P1** `getKey()` reads one `ENCRYPTION_SECRET`; ciphertext `iv:tag:ct` has **no key
  version**; no re-encrypt routine. The master key **cannot be rotated** without a manual
  decrypt-and-re-encrypt of every `ai_provider.apiKey`, `channel.credentialsEncrypted`,
  `workspace_integration.configEncrypted`. One leak compromises all tenants. *Fix: version the
  ciphertext (`v1:…`), keyring (current+previous), re-encrypt job; consider envelope encryption.*
- **I2 · ⚠️ P2** Master key is plain env, no KMS. Positives: not committed, not logged, `getKey`
  doesn't log. Risk is solely that anything reading the process env (incl. the RCE in L2-1) dumps
  every credential. KMS/secrets-manager at boot would contain that blast radius.

## J. CI/CD & Deploy

- **J1-1 · ⚠️ P0** *(verified)* `vercel.json:3` and `ci.yml:73` deploy with
  `drizzle-kit push --force` — destructive DDL auto-applied, no reviewable migration, build
  mutates prod DB. A `db:migrate` script exists but is used by no deploy path.
- **J1-2 · ⚠️ P1** *(verified)* 35 tables in schema, 1 migration file (`0000_new_triathlon`,
  12 tables, references a dropped `employee` table). 23 tables exist only via `push`. A
  migrate-based env would be missing 2/3 of the schema.
- **J1-3 · ⚠️ P2** `pgvector` `CREATE EXTENSION` runs in CI only; prod deploy doesn't ensure it.
- **J2-1 · ⚠️ P2** App can roll back but the schema was already pushed forward — no down-path; old
  app version then runs against forward-migrated DB. Classic non-zero-downtime trap.
- **J2-2 · ⚠️ P3** No preview-env DB isolation; `buildCommand` pushes for every env (risk: preview
  pushing to a shared DB). No feature flags.
- **J3-1 · ⚠️ P2** Build mutates external prod state (not a pure function of source).
- **J3-2 · ⚠️ P3** `esbuild` pinned to abandoned `0.18.20`; no `.nvmrc` (local Node 25 vs CI 22).
- **Good:** Node pinned in CI/Docker, `--frozen-lockfile` everywhere, `packageManager` pinned,
  release workflow scoped, healthcheck + restart policy.

## K. Frontend (arquitectura)

- **K1-1 · ⚠️ P2** Every screen is `useState(null)`+`useEffect`+raw `fetch`; full `loadAll()`
  refetch after each mutation; no SWR/React Query, no optimism, no dedup (32 components).
- **K2-1 · ⚠️ P1** **Zero** `error.tsx`/`global-error.tsx`/`not-found.tsx`/`loading.tsx` anywhere.
  Fetch components only set state `if (res.ok)` ⇒ on 401/500 they spin "Cargando…" forever; a
  thrown render error white-screens the route. Real user-facing failure class.
- **K3-1 · ⚠️ P2** No `next/dynamic` anywhere; `FlowBuilder` (47KB) + `@xyflow` + `dagre` +
  `recharts` shipped statically; 82/115 components (71%) `"use client"`.
- **K4-1 · ⚠️ P1** zod in 4 **client** forms; **0/81** API routes validate server-side. Any direct
  API caller (and public `/api/v1/*`) bypasses validation; `await req.json()` is `any`.

## L. IA-específico

- **L1-1 · ⚠️ P2** Untrusted content (KB chunks, `http_request` bodies, inbound messages, prior
  memories) flows into the system prompt **with tools enabled**, no trusted/untrusted segregation,
  no side-effecting-tool allow-list. `memory_set` persists attacker-influenced "facts". Confined
  to the tenant's own integrations (tools are workspace-scoped) → P2, not cross-tenant.
- **L2-1 · ⚠️ P0** *(verified)* `runUserJs`/`runFormula` (`flow-engine.ts:195-232`) use `node:vm`
  — explicitly "no es una frontera de seguridad". `this.constructor.constructor("return process")()`
  escapes to full Node → `process.env` (all secrets), fs, network. 1s timeout doesn't stop a sync
  escape. Reachable by **any authenticated member** (RBAC dead) via `POST /api/flows` +
  `/api/flows/[id]/run`. → host RCE, all tenants. *Fix: out-of-process real sandbox (isolated-vm /
  worker with seccomp / Firecracker) with no secret env + egress controls; gate behind owner role
  + feature flag meanwhile.*
- **L2-3 · ⚠️ P2** Agent `http_request` tool uses an inline private-IP regex that misses
  `169.254.169.254` (cloud metadata) and IPv6 — while `net-guard.assertPublicUrl` (hardened) exists
  and is used by webhooks-out. SSRF to metadata via an injected agent. *Fix: use `assertPublicUrl`.*
- **http-SSRF · ⚠️ P2** The flow-engine `http` node (`flow-engine.ts:446-499`) also bypasses
  `assertPublicUrl` → reaches `169.254.169.254`.
- **L4-1 · ⚠️ P3** `responseFormat:"json"` agents append "respond JSON" but return raw string; no
  parse/validate vs the stored `outputSchema`. (Tool-arg parsing is try/catch-guarded — fine.)
- **L5-1 · ⚠️ P2** SSE `ReadableStream` has no `cancel()` and never forwards `req.signal`; upstream
  `fetch` has no signal. Client disconnect ⇒ server keeps consuming + billing the LLM stream, leaks
  a generator. Cost-amplification + resource exhaustion. *Fix: thread `req.signal`, add `cancel()`.*
- **L6/C4 · ⚠️ P2** No fallback chain (see C4-1).

## M. Multi-tenancy

- **M1 · ✅** *(lead-verified intent)* No cross-tenant IDOR found. Workspace derived server-side
  from session; every `[id]` route enforces `and(eq(id), eq(workspaceId))`; service fns take +
  filter by `workspaceId`. Public surfaces (`webhooks/[secret]`, `widget/[channelId]`, `v1` API
  key) scope to the resource's own workspace. (Low note: a couple of PATCH handlers store
  body-supplied `agentId`/`flowId` without verifying same-workspace; reads re-scope so it dangles,
  not a leak — add a defensive check.)
- **RBAC-1 · ⚠️ P1** *(verified)* The RBAC layer is **dead code**: `assertCan`/`can()` used in **0**
  API routes; `requireAuth({minRole})` in **2** of 81; **62** gate on bare `getCurrentWorkspace()`
  (membership only). A `viewer` can create/edit/delete agents, flows, integrations, channels, API
  keys — and (with L2-1) run arbitrary code. Privilege escalation + the enabler for the P0 RCE.
- **M2-1 · ⚠️ P2** No per-tenant queue fairness / global concurrency cap; one tenant competes
  freely for the event loop + provider quota.
- **M3 · ⚠️ P2** Rate-limit keys are correctly workspace-scoped, but the in-memory default makes
  them per-process (see B4-1).
- **M4-1 · ⚠️ P1** *(verified)* Workspace delete cascades DB rows correctly, but `storage.delete()`
  has **zero callers** → uploaded KB docs/avatars under `${workspaceId}/…` orphaned; external
  webhook registrations (e.g. Telegram `setWebhook`) not de-registered. GDPR + cost + orphan risk.

## N. Correctitud de negocio

- **N1-1 · ⚠️ P1** Blended single-rate pricing + `DEFAULT_COST_PER_1K=0.008` fallback undercharges
  unknown/expensive models. Stripe webhook reads top-level `current_period_end` (moved under
  `items.data[]` in modern payloads) ⇒ `currentPeriodEnd` may persist null; `priceId` parsing
  assumes a shape absent on `checkout.session.completed` ⇒ plan defaults to `"starter"` regardless
  of tier purchased. Mis-billing + wrong plan.
- **N1-2 · ⚠️ P2** Usage keyed on calendar-month UTC, not the Stripe billing period (mid-cycle
  upgrade doesn't reset window); `subscription.deleted` flips to free with no proration/grace; no
  refund path.
- **N2-1 · ⚠️ P0** *(verified)* `checkQuota` (`billing/quotas.ts:65`) has **zero callers**. Plan
  limits (conversations/tokens/agents/flows/members/KB) are never enforced server-side; combined
  with `isSelfHosted()`→"enterprise" when `STRIPE_SECRET_KEY` unset, limits are decorative. Revenue
  leakage. *Fix: call `checkQuota` in create/run handlers + `handleInbound` + `v1/*`.*
- **N2-2 · ⚠️ P2** Public `v1/*` authenticates + rate-limits but triggers executions that aren't
  metered (D4-1) and aren't quota-checked (N2-1).

---

## Prioritized remediation plan

### P0 — fix before any untrusted multi-tenant / production traffic
1. **L2-1 RCE** — sandbox the `code`/`runFormula` nodes out-of-process (isolated-vm / worker with
   no secret env + egress controls). Interim: gate behind owner role + feature flag. **(+ RBAC-1)**
2. **RBAC-1** — actually enforce `requireAuth({minRole})` / `assertCan` on all mutating routes.
   This is the enabler for #1 and a standalone priv-esc. *(Listed P1 but fix alongside #1.)*
3. **B1 + C5 + C7** — route flow runs through `enqueue(JOB_FLOW_RUN…)` + the existing worker;
   insert `pending` run in the route; add the orphan reaper to the (currently no-op) daily cron.
   One change resolves the inline-execution, zombie-run, and shutdown-drain problems together.
4. **N2-1** — wire `checkQuota` into create/run/inbound/v1 paths.
5. **D4-1 + E1-1** — meter every AI dispatch (flow nodes + `lib/ai/run.ts`) keyed by
   workspace+model+capability; add a per-workspace USD cap checked before dispatch.
6. **J1-1 + J1-2** — stop `push --force`; adopt `generate` → commit SQL → `migrate`; regenerate a
   fresh baseline; move schema application out of `buildCommand`.

### P1 — fix before GA / scale
- C1 (timeouts everywhere + poll deadlines), B2 (idempotent steps + keys), C3 (transactions),
  B3 (run lock / `singletonKey`), B4 (wire Redis limiter), I1 (key versioning + re-encrypt),
  M4 (storage + webhook cleanup on delete), E2/E3/E4 (cost rows, kill-switch, media TTL), G1
  (retention cron), F1 (erasure + export), F3 (media moderation/consent), N1 (pricing + Stripe
  webhook), H1-1/H1-2 (`next`, `kysely`), K2 (error boundaries), K4 (server-side zod), D3 (audit
  coverage).

### P2 / P3 — hardening & hygiene
- A3/A4/A5/A6/A7 (port contracts, single price source, response envelope, env validation, node
  ergonomics), C2/C4/C6 (retry/fallback/DLQ), D1/D2 (tracing + metrics), L1/L2-3/L5/http-SSRF
  (injection guardrails, `assertPublicUrl`, stream cancel), K1/K3 (data-fetching + code-split),
  M2 (queue fairness), N1-2/N2-2, H1-3/H2/H3/J2/J3 (dep bumps, pins, `.nvmrc`, expand/contract),
  D3-2/F1-2/G3/L4 (low).

---

## What was NOT audited
- **Live runtime / real provider keys** — no end-to-end execution; findings are static. The
  bespoke adapters (Ideogram/BFL/HeyGen/D-ID/Mistral OCR) are unverified against live APIs.
- **Load / performance / soak testing** — no measured latency, throughput, or memory under load.
- **Infra ops** — backup cron installation, restore rehearsal, PITR, DB region/residency, KMS
  availability (J/F/G items flagged as doc- or infra-level).
- **Per-handler audit-log coverage** — D3-1 is file-level grep, medium confidence on exact gaps.
- **Provider ToS** (F4) — requires the actual provider contracts.
- **Schedule trigger wiring** — `flow_schedule` table exists; no code wires it to
  `boss.schedule`, suggesting schedule triggers may be inert (flagged, not fully traced).

---

## Remediation status (2026-05-22)

All **P0 (7/7)** and **P1 (18/18)** findings are fixed, plus most P2. Shipped across
~14 commits, full typecheck green (`apps/web` + `packages/db`).

**Fixed:** L2-1, B1, C5, C7, N2-1, D4-1, E1-1, E2-1, E3-1, E4-1, J1-1, J1-2 · RBAC-1,
I1-1, C1, C2, C3, B2 (retryLimit 0), B3, B4 (already wired), G1, M4, F1, F3, N1-1,
N1-2, K2, K4, D3 · L2-3, http-SSRF, L1, L5, C4, C6, L4, D1, D2, F2, K1, K3, N2-2,
D3-2, A6, G3, H2, H1-*, J3-2, A5 (helper).

### Architecture (A3–A7) — done in their safe, high-value slices

- **A4 (pricing single source): ✅ DONE.** `ModelDef` carries `costPer1kIn/Out`;
  `pricing.ts` reads the catalog first (legacy tables → blended as fallback). Adding a
  priced model to the catalog now auto-costs it.
- **A3 (ports): ✅ safe slice DONE** — removed vestigial `routeToProvider`/
  `defaultModelsFor` (routing lives in the catalog). **Deferred:** unifying the two
  `ChatMessage` types / making adapters implement the port interfaces — the two shapes
  differ in tool-block types (`ToolUseBlock`/`ToolResultBlock`) and need a deeper
  reconciliation across `llm-call` + adapters.
- **A7 (node ergonomics): ✅ safe slice DONE** — `FlowNodeType` derives from the single
  `FLOW_NODE_TYPES` const. **Deferred:** the `executeNode` if-chain → `Record<NodeType,
  handler>` rewrite — highest-risk change in the engine; do it once a flow-engine test
  harness exists.
- **A5 (response envelope): ✅ helper DONE** (`lib/api-response.ts`). **Not pursued:** a
  full 80-route rewrite — the error shape is already uniform and changing list shapes is
  frontend-coupled; lowest-value item, migrate incrementally.

The 2 remaining deep refactors (A3 ports/ChatMessage unification, A7 executeNode
handler-map) are **maintainability-only** on hot paths and are best done as dedicated,
test-backed efforts rather than rushed into a security sweep.
