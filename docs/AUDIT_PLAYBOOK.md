# Audit System — Methodology, History & Structural Guards

> Single source of truth for: how we audit this repo, what we found, what we
> learned, and how the CI guard now enforces the invariants automatically.

---

## 1. Scope & Severity

Audits cover **14 dimensions** of a multi-tenant SaaS:

| Code | Dimension                               |
| ---- | --------------------------------------- |
| A    | Architecture & design                   |
| B    | Distributed systems / scalability       |
| C    | Reliability (SRE)                       |
| D    | Observability                           |
| E    | FinOps (cost)                           |
| F    | Compliance / privacy                    |
| G    | Data lifecycle                          |
| H    | Supply chain                            |
| I    | Secrets management                      |
| J    | CI/CD & deploy                          |
| K    | Frontend architecture                   |
| L    | AI-specific (RCE, injection, streaming) |
| M    | Multi-tenancy isolation                 |
| N    | Business correctness (billing, quotas)  |

**Severity rubric:**

| Sev             | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| **P0** Critical | Data breach, cross-tenant leak, money loss, RCE, prod-down |
| **P1** High     | Serious bug/risk, likely in prod, no workaround            |
| **P2** Medium   | Real issue, limited blast radius or workaround             |
| **P3** Low      | Polish, hygiene, future-proofing                           |

Tag each finding with **likelihood** (low/med/high), **blast radius** (1 tenant /
all tenants / infra), and **effort** (S/M/L).

---

## 2. How to run an audit

- **Trigger:** only when explicitly asked ("ejecutá la auditoría completa").
  Documenting the process is NOT a trigger to run.
- **Method:** 5 fresh-context reviewer agents in parallel, clustered by area:
  1. Security (M, L, I)
  2. Reliability/SRE (B, C, G)
  3. Architecture + Frontend (A, K)
  4. Observability + FinOps + Compliance + Business (D, E, F, N)
  5. Supply chain + CI/CD (H, J)
- **Ground rules:**
  1. Evidence over assumption — cite `path:line-range` + a code snippet for every finding.
  2. Don't trust the previous remediation report — re-prove with code.
  3. No false alarms — verify a guard isn't already present elsewhere.
  4. Don't leak secrets in the report.
- **Output:** synthesize agents → one report with TL;DR, severity table, per-dimension
  findings, remediation plan, what was NOT audited (gaps in the audit itself).

---

## 3. History — three audit passes on Orchester

### v1 (2026-05-22 AM) — 51 findings

- **7 P0**: RCE in `code`/`runFormula` node (`node:vm` not a sandbox), flows running
  inline (no queue producers), no reaper, plan quotas never enforced (`checkQuota`
  0 callers), AI cost not attributed, no per-workspace spend cap, `drizzle-kit push
--force` in prod deploy.
- **27 P1**: RBAC built but not enforced (`assertCan`/`requireAuth` adoption ≈ 2%),
  no rotation path for AES key, missing fetch timeouts, no transactions, in-memory
  rate-limit per replica, etc.
- **17 P2 / ~7 P3**.

### Meta-audit pass 1 (independent reviewer after first remediation wave)

Found **6 P1s the remediation missed**, most importantly:

- `channels/router.ts` (the primary inbound chat path: Telegram/Slack/widget/embed)
  was NOT migrated — both `assertWithinSpend` and `usageEvents.costUsd` missing.
- Net effect: the kill-switch and monthly cap **did not apply to inbound chat**.
- Plus SSRF false-positive in `net-guard.ts` (rejected public hostnames starting
  with "fc"/"fd"/"fe80"), `vm` timeout that only covered IIFE compilation (not
  invocation), `ALLOW_PRIVATE_HTTP` inconsistency between flow `http` node and
  agent `http_request` tool.

### Meta-audit pass 2 (2nd sweep of the same pattern)

Found **4 more `llmCall`/`llmStream` sites without spend guards**:
`agent-runtime`, `memory-compaction`, `test-chat-stream`, `handleInboundStream`.
Same systemic pattern.

### v2 full re-run (2026-05-22 PM)

With fresh-context reviewers. **0 P0 remained.** Found **6 new P1s**, mostly the
same pattern recurring elsewhere:

- `recordAiUsage` missing at the 5 sites the meta-audit had patched with
  `assertWithinSpend` (the cap blocked when exceeded but never _accumulated_).
- `executeFlow` inline at 4 internal callers (MCP, `flow_call` tool, agent
  `kind=flow`, channels/router) — the v1 B1 fix only covered public HTTP routes.
- Retention covered 2 of 6 growing tables.
- TOCTOU race in per-flow concurrency cap.
- `test-chat[-stream]` skipped role gate (viewers could burn LLM credits).
- Web process didn't drain pg-boss on SIGTERM.

**All resolved in the 3rd remediation wave** (commits 395ad6e → d9b6a77). Final
state: typecheck clean, 82/82 tests, CI invariants guard green.

---

## 4. The Big Learning — Same Pattern Caught 4× in a Row

Every audit pass found the **same class of bug**: a transversal invariant —
_"every LLM call must have a spend guard"_, _"every LLM dispatch must record
usage"_, _"every flow run goes through the queue"_, _"every mutating route uses
`requireAuth` + `parseBody`"_ — fixed only at the specific files named in the
previous report. The sweep was never exhaustive, so the next audit found the same
pattern recurring at a different caller.

**The root cause is structural, not human:** chasing each occurrence by hand
guarantees you miss callers. The fix must be **structural**: either make the
invariant compile-time-checkable, or automate the sweep in CI.

---

## 5. The Structural Fix — `scripts/audit-invariants.sh`

A 90-line shell script wired into `.github/workflows/ci.yml` between TypeScript
check and tests. **Fails CI** if any of these four invariants is violated:

1. **Every file calling `llmCall(` or `llmStream(` must contain `assertWithinSpend`.**
   Closes the spend-cap-bypass class (E1/E3).
2. **Same files must contain `recordAiUsage` (or `persistAssistantTurn`).**
   Closes the metering-without-attribution class (D4/E2). This is exactly the
   gap the v2 audit caught after meta-audit pass 2.
3. **Every mutating route (`POST`/`PUT`/`PATCH`/`DELETE` in `app/api/**/route.ts`)
must use `requireAuth`AND`parseBody`.** Documented exclusions for public
surfaces with their own auth (`/api/auth/`, `/api/webhooks/[secret]`,
`/api/widget/_`, `/api/v1/_`, `/api/mcp`, Stripe webhook, etc.) and for
body-less actions (`_/restore`, `_/takeover`, `\*/test`).
4. **Every `executeFlow(` outside the worker must pass `signal: AbortSignal`.**
   Forces inline callers to be cancellation-bounded; the alternative is
   `enqueueFlowRun` (async). Closes F-B1.

Output sample of a passing run:

```
✓ all transversal invariants hold.
```

Output sample of a failure:

```
✘ spend guard missing in: apps/web/app/api/foo/route.ts (add: import { assertWithinSpend } + call before llmCall/llmStream)
1 violation(s) — fix above before merging.
```

The script accepts new callers only if they follow the invariant. Adding the
guard line to a new file is the price of admission.

---

## 6. Final State of the Remediation

- **P0**: 0 / 7 open.
- **P1**: 0 / 27 (v1) + 6 (v2) open.
- **P2**: most closed, a handful documented as deliberate (e.g. KMS integration
  for I2, DNS-rebinding for `net-guard`, `assertCan` action-level RBAC dead
  code — all P2, hygiene-tier, non-blocking).
- **P3**: docs/polish.
- **31 commits** of remediation from `b7378d4` through `d9b6a77`.
- **82/82 vitest pass**, `tsc --noEmit` clean (`apps/web` + `packages/db`).
- CI invariants guard green.

The system moved from "do not ship multi-tenant" (v1) to a posture where the
critical and high findings are closed AND the structural mechanism that would
let new ones slip in is gated by CI.

---

## 7. What This File Replaces

This single doc replaces:

- `audit-playbook.md` (methodology, now §1+§2 here)
- `2026-05-22-full-system-audit.md` (v1 report, now §3 summary)
- `2026-05-22-v2-full-system-audit.md` (v2 report, now §3 summary)

Granular per-pass reports are not kept — every finding either resulted in code

- a commit (visible via `git log b7378d4^..HEAD`) or is documented above as
  deliberately deferred. The structural guard ensures the same class won't return
  silently.
