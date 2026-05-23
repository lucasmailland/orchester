# Orchester — Full-System Audit v2 (post-remediation re-run)

> **Date:** 2026-05-22 (same day; v2 ≈ 6h after v1)
> **Method:** Re-execute the A–N playbook (`.agents/audit-playbook.md`) on the
> remediated codebase. 5 independent reviewer agents, fresh-context, instructed to
> NOT trust the v1 remediation report and re-prove with code.
> **Tools used:** static analysis, `madge`, `pnpm audit`, grep sweeps, `git log/show`.

## TL;DR — substantively better, with real gaps

The v1 remediation **delivered for most P0/P1 items**. The system moved from "do not
ship multi-tenant" to "good for a beta". The wins are real:

- **8 `next` high CVEs → 0.** Verified by `pnpm audit --prod`.
- **L2-1 RCE** — fail-closed gate + the IIFE-inside-`runInContext` fix (timeout
  covers the user body, not just compilation).
- **`push --force` removed from prod;** baseline migration covers 38 tables; pgvector folded in.
- **Queue + reaper + retention cron** wired, with safe `retryLimit: 0`.
- **AES key versioning + back-compat** for legacy ciphertext; new tests lock it in.
- **M1 IDOR clean** (12 routes resampled, all enforce `workspaceId`).
- **RBAC enforcement** 2/81 routes → 50/82 (+48).
- **zod validation** 0/81 → 50/64 mutating routes (78%).
- **Streaming cancellation, moderation gate, GDPR delete + export, Stripe webhook**
  — all materially correct under independent re-verification.

But pass #2 finds **25 new or still-open items**, including **6 P1s** that the v1
report claimed were closed. The systemic pattern from the meta-audits repeats: every
transversal invariant ("all LLM calls → guard", "all flows → enqueue", "every table
→ retention") needs an **exhaustive caller sweep**, not parch-by-parch.

### Severity counts (v2)

| Severity | Count |
| --- | --- |
| **P0 Critical** | 0 |
| **P1 High** | 6 |
| **P2 Medium** | ~12 |
| **P3 Low** | ~7 |

---

## Top 6 P1 findings — the ones to fix before launch

### 1. F-B1 · executeFlow inline in 4 internal callers
The v1 B1 fix covered the public HTTP routes (`/api/flows/[id]/run`, `/api/webhooks/[secret]`),
but 4 internal entry points still execute `executeFlow` **inline in the request**:

- `lib/mcp/server.ts:280` (MCP endpoint)
- `lib/tools.ts:340` (agent `flow_call` tool)
- `lib/agent-runtime.ts:174` (agent `kind=flow`)
- `lib/channels/router.ts:196` (chat inbound flow trigger)

A flow with video polling on these paths blocks the request for ~6 min and dies on
serverless timeout, leaving runs in `running` until the reaper. Fix: route them through
`enqueueFlowRun`.

### 2. F-G1 · Retention misses audit_logs / usage_events / messages / flow_versions
`purgeOldData` only covers `flow_runs` + `webhook_deliveries`. The 4 missing tables
grow unbounded. For an active widget tenant, `messages` dominates DB size within
months. Fix: extend the retention sweeper.

### 3. F-B3 · TOCTOU race in per-flow concurrency cap
`count → if < cap → insert` at `flow-engine.ts:1022-1049` is not atomic. Webhook
burst can exceed the cap; with a small cap (e.g. 2) the gate is meaningless. Fix:
wrap in a tx with `repeatable read`, advisory lock per `flowId`, or a CTE insert
with the count condition.

### 4. F-2 · `test-chat` + `test-chat-stream` skip role gate
- `apps/web/app/api/agents/[id]/test-chat/route.ts:21-24`
- `apps/web/app/api/agents/[id]/test-chat-stream/route.ts:44-49`

A `viewer` who is a workspace member can burn paid LLM credits via the studio.
`assertWithinSpend` is present; the role gate is not. Fix: `requireAuth({ minRole: "editor" })`.

### 5. E2-2 · `recordAiUsage` missing at 5 sites that have spend guards
The same systemic pattern: the v1 D4-1 metering fix landed in `lib/ai/run.ts` + the
flow-engine `agent` handler. The 4 sites the meta-audit later guarded with
`assertWithinSpend` were never given `recordAiUsage`. So the cap **blocks** when
exceeded but **doesn't accumulate** from their traffic:

- `lib/agent-runtime.ts:245` (test-chat + MCP)
- `lib/memory-compaction.ts:99`
- `app/api/agents/[id]/test-chat-stream/route.ts:93`
- `app/api/agents/[id]/generate-prompt/route.ts:55`
- `app/api/flows/[id]/copilot/route.ts:85`

Fix: wrap each in `await recordAiUsage(...)` after success, like `flow-engine.ts:556`.

### 6. F-C7 · Web process doesn't drain pg-boss on SIGTERM
`instrumentation.ts:66-78` is a flat `setTimeout(10s) → exit(0)` with no
`shutdownQueue()` call. Worker drains correctly; web doesn't. Sockets leak in
TIME_WAIT on every rolling deploy.

---

## P2 findings (12)

| ID | Area | Finding | File |
| --- | --- | --- | --- |
| F-1 | L5 (sec) | `/run-stream` cancels SSE emit but `executeFlow` keeps running, burning credits | `flows/[id]/run-stream/route.ts:27-65` |
| F-3 | RBAC | `assertCan`/`Action` ladder has 0 callers; only coarse `minRole` enforced | `lib/rbac.ts:97-114` |
| F-4 | M1 (sec) | PATCH `agents/[id]` saves body `teamId`/`flowId` without same-workspace check | `agents/[id]/route.ts:88,92` |
| F-5 | SSRF | `net-guard.assertPublicUrl` doesn't resolve DNS → rebinding bypass | `lib/net-guard.ts:43-57` |
| F-6 | I2 | Master AES key still env-only; no KMS / secrets-manager integration | `lib/encryption.ts:132` |
| F-C1 | C1 (SRE) | Sentry envelope uses bare `fetch()` with no timeout | `lib/observability.ts:61-68` |
| F-C2 | C2 (SRE) | `http` node retries POST/PUT/DELETE on 5xx → double-fire (Stripe/Twilio) | `flow-engine.ts:630-659` |
| F-G3 | DB | **No indexes** on hot columns: `flow_run(flow_id,status)`, `(started_at)`, `flow_run_step(run_id)`, `message(conversation_id, created_at)`, `audit_log(workspace_id,created_at)`, `usage_event(workspace_id,created_at)`, etc. PostgreSQL doesn't auto-index FKs. | `packages/db/src/schema/*` |
| M2 | M | Still no per-tenant noisy-neighbor cap (only per-flow) | n/a |
| N1-3 | E (FinOps) | TTS cost: `units: text.length` paired with `calculateCapabilityCostUsd("tts", 1)` → flat $0.015 regardless of input length | `lib/ai/run.ts:225-233` |
| N1-4 | N (billing) | `subscription.deleted` hard-flips to `free` with no grace period | `billing/webhook/route.ts:110-114` |
| N2-3 | E (FinOps) | `checkQuota("tokens"/"conversations")` not enforced on flow executions (only chat path + creates) | n/a |
| A4-v2 | A (arch) | 14 chat models in catalog (groq/cerebras/together/fireworks/perplexity/openrouter/qwen/moonshot/zhipu/sambanova/deepinfra/cohere/nvidia/ai21) lack `cin/cout` and silently fall back to blended $0.008 | `lib/ai/catalog/models.ts:48-67` |
| A6-v2 | A (arch) | ~18 env vars consumed in code (`FLOW_*`, `AI_*`, `ALLOW_*`, `S3_*`, `MODERATION_*`, etc.) are missing from `validateEnv` schema; worker process never calls `validateEnv()` | `lib/env.ts` |
| K4-v2 | A (api) | 14 of 64 mutating route files still lack `parseBody` (notably `api-keys` POST, `mcp` POST) | `app/api/api-keys/route.ts` |
| H1-3 | H (supply) | 7 moderate (prod) advisories remain: `next-intl@3.26.5` (open-redirect + proto-pollution, fix requires 3→4 major), `postcss@8.4.31`, `ws@8.20.0`, `vite<=6.4.1`, transitive `esbuild@0.18.20`, `turbo<=2.9.13`, `brace-expansion` | `pnpm-lock.yaml` |
| H3-1 | H (supply) | `better-auth`/`drizzle-orm`/`next`/`postgres` still float on caret — the mechanism that let the vulnerable `next` slip in is unchanged | `apps/web/package.json` |
| F1-3 | F (GDPR) | `/api/me/export` has no rate limit (auth-gated DoS) | `me/export/route.ts:24` |

## P3 findings (7)

| ID | Finding |
| --- | --- |
| F-7 | `node:vm` is still the underlying code execution mechanism (gate fail-closed; if operator enables, vm escape is possible) |
| F-B6 | `flow_schedule` table populated by API but **no worker reads it** → user-configured schedules are silent no-ops |
| F-C1-inconsistency | 3 bare `fetch()` with manual `AbortController` (flow-engine http node, integrations registry, webhooks-out) — work fine but should use `fetchWithTimeout` for consistency |
| D1-2 | `correlationId` accepted by `llmCall` but no caller passes one → `ai.call.latency_ms` metrics + provider error logs aren't tied to a run |
| A1-v2 | `flow-engine.ts` grew to 1109 LOC (NODE_HANDLERS adds ~430). Cohesive but candidate for split (`lib/flow-engine/handlers/*.ts`) |
| A3-v2 | `*Adapter` interfaces in `capabilities.ts` are declared but unused — adapters return port data types but don't implement port behaviors. Hygiene |
| A5-v2 | `lib/api-response.ts` has 0 callers; 335 raw `NextResponse.json` calls. Dead code, intentional on-ramp |
| A7-v2 | `FLOW_NODE_TYPES` const has 0 callers outside flow-engine; the pgEnum in schema still hardcodes the list independently |
| K1-v2 | SWR migration covers 2 of ~32 components — pattern established but not propagated |
| E4-2 | Media TTL delegated to S3 lifecycle, not code-enforced (problem for non-S3 backends) |
| F4, F5 | Provider ToS / data residency — doc-level, not auditable from code |

---

## v1 → v2 by category

| Dimension | v1 P0 | v1 P1 | Now P0 | Now P1 | Notes |
| --- | :-: | :-: | :-: | :-: | --- |
| A · Architecture | 0 | 0 | 0 | 0 | 5 P2/P3 hygiene gaps |
| B · Distributed/scale | 1 | 4 | 0 | **2** | B1 fix partial (4 inline callers); B3 has TOCTOU race |
| C · Reliability | 1 | 4 | 0 | **1** | Most fixed; web shutdown drain missing |
| D · Observability | 1 | 1 | 0 | 0 | Mostly delivered; D1 partial |
| E · FinOps | 2 | 4 | 0 | **1** | E2-2 metering gap mirrors the v1 D4-1 (5 unmetered sites) |
| F · Compliance | 0 | 3 | 0 | 0 | Genuinely fixed; F1-3 DoS is P3 |
| G · Data lifecycle | 0 | 1 | 0 | **1** | Retention covers 2 of 6 growing tables |
| H · Supply chain | 0 | 2 | 0 | 0 | `next` highs gone; mod cluster remains P2 |
| I · Secrets | 0 | 1 | 0 | 0 | I1 keyring shipped; I2 KMS still open (P2) |
| J · CI/CD | 1 | 1 | 0 | 0 | Real; baseline + migrate workflow correct |
| K · Frontend | 0 | 2 | 0 | 0 | K2/K3 done; K1/K4 partial |
| L · AI security | 1 | 0 | 0 | **1** | L2-1 closed; test-chat role gate missing |
| M · Multi-tenancy | 0 | 2 | 0 | 0 | IDOR clean; M2 still open P2 |
| N · Business | 0 | 2 | 0 | 0 | Stripe robust; TTS math bug + flow-quota gap P2 |
| **Total** | **7** | **27** | **0** | **6** | |

---

## The recurring meta-pattern

This is the **third audit pass** in which the same class of bug appears: an
invariant that should hold across all callers (`assertWithinSpend`, `recordAiUsage`,
`enqueueFlowRun`, retention coverage, role-gate on LLM endpoints) is fixed at the
*sites named in the previous report* but not swept across all callers. The honest
fix is **structural**:

1. Make the invariant compile-time-checkable where possible (e.g., wrap `llmCall`
   so it cannot be invoked without a `{ workspaceId }` that runs the cap+meter
   internally — the function becomes "the only path" so direct callers vanish).
2. Where compile-time isn't feasible, automate the sweep: a CI grep that fails
   if any new `llmCall(` site lacks a sibling `assertWithinSpend`.
3. Apply the same logic to: every `executeFlow(` outside the worker → fail CI;
   every new table without retention → fail CI; every mutating route without
   `parseBody` or `requireAuth` → fail CI.

That's the only way to actually close these classes rather than chase them.

---

## What I'd fix before launch (priority order)

1. **E2-2 metering gap** (5 sites). Mechanical; closes the second half of D4.
2. **F-2 role gate on `test-chat[-stream]`**. One line per route.
3. **F-B1 internal `executeFlow` callers**. 4 file-level changes.
4. **F-G1 retention** for `messages`, `audit_logs`, `usage_events`, `flow_versions`.
5. **F-G3 missing indexes** (1 migration file).
6. **F-B3 atomic cap** (advisory lock or CTE-insert).
7. **F-C7 shutdown drain** for web process.

The rest (P2/P3) is post-launch hardening.
