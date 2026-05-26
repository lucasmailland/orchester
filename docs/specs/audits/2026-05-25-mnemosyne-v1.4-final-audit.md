# Mnemosyne v1.4 — Final Comprehensive Audit

- **Date**: 2026-05-25
- **Tag at HEAD**: `mnemosyne-v1.4` (branch `mnemo-v1.4-graph-rem-tom`, HEAD `d4828ba`)
- **Releases covered**: v1.0 → v1.1 → v1.2 → v1.3 → v1.4 (50 commits since `mnemosyne-v1.0`)
- **Spec**: `docs/specs/2026-05-24-mnemosyne-design.md` §0-§39 (v1.0 design — pre-dates v1.1-v1.4 additions)
- **Plan**: `docs/specs/plans/2026-05-24-mnemosyne-implementation-plan.md`
- **Prior audit**: `docs/specs/audits/2026-05-24-mnemosyne-v1-final-audit.md` (1 P0, 3 P1, 7 P2 — **all addressed**)
- **Scope**: READ-ONLY diagnostic across security, code quality, spec compliance, test coverage, operational readiness, documentation, outstanding issues
- **Outcome**: 0 P0, 1 P1, 6 P2 — substantial net improvement vs. v1.0; the v1.0 P0 fix held across 4 minor versions.

> Severity legend
>
> - P0 — security hole, broken production, data loss risk
> - P1 — functional bug, test failure, spec violation
> - P2 — code quality, minor inconsistency, dead/latent code, doc drift
> - OK — verified clean

---

## Executive Summary

**No P0 findings.** Every v1.0 P0/P1 finding is resolved; the defense-in-depth layer (`SET LOCAL ROLE app_user` in `withMnemoTx`/`withBrainTx`/`withTenantContext` + `assertSafeDbRole` boot probe) survived 4 minor releases without regression. The codebase now ships 11 RLS+FORCE mnemo\_\* tables with full 4-policy/Pattern-A coverage and an additional layer of role-downgrade safety inside every transaction wrapper.

**Headline P1 finding**: `deploy/docker-compose.prod.yml:96,153` still injects `DATABASE_URL=postgresql://orchester:...` (the superuser+BYPASSRLS role) into the `web` + `worker` services. The boot probe `assertSafeDbRole` is fail-closed in production (it throws when `rolsuper=t OR rolbypassrls=t`), so the deploy will refuse to come up — but the compose file is the production-ready artifact and ships unusable until updated to `app_user`. The v1.0 audit's Step 3 of the P0 fix (update the prod compose) was not executed; only Layer 1 (tx wrappers) and Layer 2 (boot probe) landed.

**Top 5 issues**:

1. **P1 §1.b** — `deploy/docker-compose.prod.yml:96,153` keeps `DATABASE_URL` as `orchester` (SUPERUSER, BYPASSRLS). Prod boot will hard-fail via `assertSafeDbRole`.
2. **P2 §3.§5 (carryover)** — `searchMnemo` exists at `packages/mnemosyne/src/recall/search.ts:80` (v1.1 ported it from brain to mnemo), but the _L3 query cache_ path (`mnemo_query_cache`) still has only a `TODO` in `packages/mnemosyne/src/recall/search.ts:42`. Cache table is dead until v1.5+.
3. **P2 §3.§28** — Spec §28 "C2 — Memory Inference Engine (tiered embedding + halfvec)" remains deferred. No `halfvec`/tiered-embedding code in `packages/mnemosyne/src` or `packages/db/migrations`. Documented deferral.
4. **P2 §5.b** — `JOB_MNEMO_EXTRACT = "mnemo.extract"` is defined in `apps/web/lib/queue.ts:174` but never enqueued, registered, or otherwise referenced outside its own export. Dead constant.
5. **P2 §6.c** — `docs/adr/0020-mnemosyne-multi-tenant-memory.md:51-52` still lists the _original-design_ verb names (`relates_to, contradicts, supports, derives_from, assigned_to, blocks, mentions, references, succeeds`) — but the deployed schema uses the v1.0-final set (`related, compatible, scoped, conflicts_with, supersedes, not_conflict, derived_from, part_of, member_of`). ADR documentation drift. The ADR also still claims "six tables" while v1.4 ships 11.

**Verified-clean ledger** (vs. v1.0):

- All 11 mnemo\_\* tables: `relrowsecurity=t, relforcerowsecurity=t, policies=4`, full `SELECT/INSERT/UPDATE/DELETE` GRANT to `app_user`.
- `withMnemoTx` / `withBrainTx` / `withTenantContext` all set `LOCAL ROLE app_user` _before_ `app.workspace_id`. Layer 1 of defense-in-depth is uniform.
- `assertSafeDbRole` is invoked from `apps/web/instrumentation.ts:24-40` on `NEXT_RUNTIME === "nodejs"`. Throws in prod, warns in dev.
- TypeScript strict: both packages clean (`tsc --noEmit` EXIT=0).
- Tests: `@orchester/mnemosyne` 223 passed / 47 files / 0 skipped; `@orchester/web` 232 passed / 6 skipped / 0 failed.
- Lint: `@orchester/web` clean.
- `scripts/audit-invariants.sh` EXIT=0; **now covers both `apps/web` AND `packages/mnemosyne/src`** (the v1.0 P2 §5.b gap is closed).
- Provider Charter §25: zero hardcoded provider/model strings in `packages/mnemosyne/src/**/*.ts` operational paths (the only matches are JSDoc examples and a typed identifier union).
- Bitemporal GIST indexes (`idx_mnemo_fact_valid`, `idx_mnemo_decision_valid`, `idx_mnemo_relation_valid`) all live (migration 0026). v1.0 P2 §3.§2.1 closed.
- RBAC: `mnemo.read | mnemo.write | mnemo.admin` defined in `apps/web/lib/rbac.ts:42-44` and assigned to roles. v1.0 P2 §3.§17 closed.
- `package.json` `exports`: only valid paths remain (`"."` and `"./protocol"`). v1.0 P1 §5.e closed.
- 9 locked relation verbs intact in code (`packages/mnemosyne/src/graph/verbs.ts:14-24`) AND in `mnemo_relation_relation_check` constraint.
- Memory Protocol injection still wired (`apps/web/lib/agent-runtime.ts:387`).
- PII redaction wired into `createFact` (`packages/mnemosyne/src/primitives/fact.ts:185`).

---

## 1. SECURITY

### 1.a · RLS+FORCE live verification — OK

Schema check passes for all 11 mnemo** tables. Result of `SELECT relname, relrowsecurity, relforcerowsecurity, (SELECT count(*) FROM pg_policies WHERE tablename = pg_class.relname) AS policies FROM pg_class WHERE relname LIKE 'mnemo*%' ORDER BY relname;`:

| table                  | rowsecurity | forcerowsecurity | policies |
| ---------------------- | ----------- | ---------------- | -------- |
| `mnemo_citation`       | t           | t                | 4        |
| `mnemo_decision`       | t           | t                | 4        |
| `mnemo_episode`        | t           | t                | 4        |
| `mnemo_extraction_job` | t           | t                | 4        |
| `mnemo_fact`           | t           | t                | 4        |
| `mnemo_fact_archive`   | t           | t                | 4        |
| `mnemo_health`         | t           | t                | 4        |
| `mnemo_query_cache`    | t           | t                | 4        |
| `mnemo_relation`       | t           | t                | 4        |
| `mnemo_review_queue`   | t           | t                | 4        |
| `mnemo_summary`        | t           | t                | 4        |

Pattern A universally applied. GRANT inspection (`information_schema.role_table_grants WHERE grantee = 'app_user' AND table_name LIKE 'mnemo_%'`) returns 44 rows — exactly 11 tables × 4 privileges (SELECT/INSERT/UPDATE/DELETE). No coverage gaps in the new v1.1-v1.4 tables (`mnemo_summary` 0028, `mnemo_fact_archive` 0029, `mnemo_health` 0031, `mnemo_review_queue` 0032, `mnemo_episode` 0034).

### 1.b · Production connection role — **P1 (carryover, partial)**

The v1.0 P0 fix landed as a 3-step plan:

1. **Layer 1**: `SET LOCAL ROLE app_user` inside every tx wrapper — **DONE** (verified `packages/mnemosyne/src/tx.ts:50`, `apps/web/lib/tenant/context.ts:70`, `apps/web/lib/brain/store.ts:49`).
2. **Layer 2**: boot probe `assertSafeDbRole` in `apps/web/instrumentation.ts` — **DONE** (verified lines 24-40).
3. **Layer 3**: update `deploy/docker-compose.prod.yml` to inject `DATABASE_URL` with `app_user`, not `orchester` — **NOT DONE**.

`deploy/docker-compose.prod.yml:96` (web service) and `:153` (worker service) still set:

```yaml
DATABASE_URL: postgresql://orchester:${POSTGRES_PASSWORD}@postgres:5432/orchester
```

Net effect at prod boot:

- `assertSafeDbRole` runs in `NEXT_RUNTIME === "nodejs"` mode and throws on `rolsuper=t OR rolbypassrls=t`. So **prod will refuse to boot** with this compose as-shipped.
- Layer 1 (tx wrappers) would still keep RLS effective if Layer 2 were disabled — but Layer 2 is intentionally fail-closed, so the deploy is unusable.

**Why P1, not P0**: the _deployed_ posture is fail-closed: the worst case is a prod that doesn't start, not a prod that leaks rows. But the headline compose file is the production-ready artifact and ships broken. Operators following the deploy README will hit the assert.

**Fix (P1)**: in `deploy/docker-compose.prod.yml:96,153`, introduce a separate `APP_DB_PASSWORD` env var and connect `web`/`worker` as `postgresql://app_user:${APP_DB_PASSWORD}@postgres:5432/orchester`. Keep `orchester` only for `postgres` service init + migrations. Add a `MIGRATION_DATABASE_URL` for `drizzle migrate`. Update `.env.example` lines 9-12 (the comment block already explains the requirement). Safe to apply standalone.

### 1.c · Provider hardcodes (Charter §25) — OK

`grep -rEn 'claude-|gpt-[0-9]|text-embedding-[0-9]|"voyage-|"openai"|"anthropic"|"google"' packages/mnemosyne/src` returns one match:

- `packages/mnemosyne/src/recall/embed.ts:18` — `export type EmbeddingProvider = "openai" | "google" | "voyage";`. This is a typed identifier union used to route a caller-provided `embedFn`; mnemosyne never picks one. Charter §25 compliant (same finding as v1.0 §1.c).

In `apps/web/lib/brain` and `apps/web/worker`, the matches are all comments (JSDoc examples or inline explainers in `embed-batch-job.ts:312`). The `.dist/worker.mjs` build artifact contains the catalog (`m("anthropic", "claude-opus-4-7", …)`) — that's the workspace credential catalog, not an operational hardcode.

### 1.d · SQL injection surface — OK

`grep -rEn 'sql\.raw|sql\.unsafe' packages/mnemosyne/src apps/web/lib apps/web/app/api/mnemo apps/web/worker` returns 2 hits, both in `apps/web/app/api/mnemo/facts/route.ts:146,174`:

```ts
const sortColumn = sql.raw(SORT_COLUMNS[sortByParam]);
// ...
const orderSql = sql.raw(
  `${SORT_COLUMNS[sortByParam]} ${isDesc ? "DESC" : "ASC"}, f.id ${isDesc ? "DESC" : "ASC"}`
);
```

`SORT_COLUMNS` (lines 29-34) is a typed whitelist of 4 string literals; `sortByParam` is validated against the whitelist at line 102 before this code runs. Cursor values are bound as parameters (`${cursorValue}`) inside `sql\`…\``. Safe pattern: the only `sql.raw`inputs are whitelisted column identifiers + the boolean-derived`"DESC"`/`"ASC"` strings.

No `sql.unsafe(`, no template-literal string concat into SQL, no user-input → raw SQL anywhere in mnemosyne or mnemo routes. End-to-end parameterized.

### 1.e · Audit chain integration — OK

Every mutating route under `apps/web/app/api/mnemo` calls `logAudit` post-mutation:

| route                                    | action                       |
| ---------------------------------------- | ---------------------------- |
| `mnemo/facts/[id]/route.ts:97`           | `mnemo.fact.update`          |
| `mnemo/facts/[id]/pin/route.ts:57`       | `mnemo.fact.pin`             |
| `mnemo/facts/[id]/unpin/route.ts:58`     | `mnemo.fact.unpin`           |
| `mnemo/facts/[id]/forget/route.ts:41`    | `mnemo.fact.forget`          |
| `mnemo/facts/[id]/restore/route.ts:35`   | `mnemo.fact.restore`         |
| `mnemo/review/[id]/resolve/route.ts:77`  | `mnemo.review.resolve`       |
| `mnemo/export/route.ts:84`               | `mnemo.export`               |
| `agents/[id]/memory-policy/route.ts:117` | `agent.memory_policy.update` |

Read-only routes (`GET /api/mnemo/episodes`, `GET /api/mnemo/episodes/[id]`, `GET /api/mnemo/facts`, `GET /api/mnemo/facts/[id]/citations`, `POST /api/mnemo/recall-unified`, `GET /api/mnemo/health/*`, `GET /api/mnemo/review`) correctly do not write to the audit chain. POST `/api/mnemo/recall-unified` is a search; not a mutation; not auditable.

The 9 mnemo audit action families from spec §17.3 are now substantively covered (fact.{update,pin,unpin,forget,restore}, review.resolve, export, plus the new `agent.memory_policy.update`). v1.0 P2 §1.e was a true gap then; v1.4 closes it.

### 1.f · Spend cap (`audit-invariants.sh`) — OK

```
$ bash scripts/audit-invariants.sh
✓ all transversal invariants hold.   EXIT=0
```

Inspected `scripts/audit-invariants.sh:50-67`: the script **now scans both `apps/web` AND `packages/mnemosyne/src`** (the v1.0 P2 §5.b regression is closed). Files matching `llmCall(|llmStream(` are required to contain both `assertWithinSpend` and `recordAiUsage|persistAssistantTurn` in the same file. Manual verification confirmed pairing in every consumer:

| file                                          | `assertWithinSpend`                                                                                                                                                                                                                                 | `recordAiUsage` |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `apps/web/lib/agent-runtime.ts`               | yes                                                                                                                                                                                                                                                 | yes             |
| `apps/web/lib/ai/run.ts`                      | yes                                                                                                                                                                                                                                                 | yes             |
| `apps/web/lib/brain/extract.ts`               | yes                                                                                                                                                                                                                                                 | yes             |
| `apps/web/lib/channels/router.ts`             | yes                                                                                                                                                                                                                                                 | yes             |
| `apps/web/lib/flow-engine.ts`                 | yes                                                                                                                                                                                                                                                 | yes             |
| `apps/web/lib/memory-compaction.ts`           | yes (`:5`)                                                                                                                                                                                                                                          | yes (`:6`)      |
| `apps/web/worker/consolidation-job.ts`        | yes                                                                                                                                                                                                                                                 | yes             |
| `apps/web/worker/summary-job.ts`              | yes                                                                                                                                                                                                                                                 | yes             |
| `packages/mnemosyne/src/recall/query-prep.ts` | n/a (host-supplied `llm` callback only — see `packages/mnemosyne/src/recall/query-prep.ts:23-26,54-58` for the rename rationale: the mnemosyne callback is named `llm` precisely to avoid the bare `llmCall(` token that the audit script gates on) | n/a             |

The mnemosyne `query-prep` rename pattern is a deliberate hygiene boundary: mnemosyne never owns spend; the host wraps the LLM with its own `llmCall` (which DOES get audited) and passes the wrapped function in.

### 1.g · PII detection wiring — OK

`packages/mnemosyne/src/primitives/fact.ts:185` calls `redactPIIWithCategories(statement)` _inside_ `createFact`, recording the categories on `fact.metadata.pii_categories` and storing the redacted statement. `detectPII` is re-exported from the package barrel (`packages/mnemosyne/src/index.ts:27`). The v1.0 P2 §1.g (PII unwired) is closed.

### 1.h · Memory Protocol injection — OK

`apps/web/lib/agent-runtime.ts:387` injects `\n\n---\n${MEMORY_PROTOCOL_V1}\n---\n` into the system prompt. The protocol body is at `packages/mnemosyne/src/protocol/v1.ts:18-29` — **v1.1.0, ~80 tokens** (tightened from the v1.0.0 ~300-token version, which is preserved as `MEMORY_PROTOCOL_V1_LEGACY` for migration callers). The unit test `packages/mnemosyne/tests/unit/protocol-v1.test.ts` locks the body so any bump is deliberate.

### 1.i · Cross-tenant probe in production — OK

The existing isolation test (`packages/mnemosyne/tests/integration/cross-tenant-isolation.spec.ts`) switches to `app_user` and proves RLS rejects the cross-tenant read. **And** the production code now does the same role downgrade unconditionally inside every tx wrapper — so what the test exercises matches what prod sees on every request path. Conjunction of Layer 1 + Layer 2 is what closed the v1.0 §1.i finding.

### 1.j · Episode store / archive / review / consolidation paths — OK

Sampled tx wrapper usage in v1.1-v1.4 modules:

- `packages/mnemosyne/src/episode/store.ts` — uses `tx` parameter (caller supplies `withMnemoTx` transaction). ✓
- `packages/mnemosyne/src/review/queue.ts` — same. ✓
- `packages/mnemosyne/src/consolidation/cluster.ts` — same. ✓
- `packages/mnemosyne/src/consolidation/summarize.ts` — same. ✓
- `packages/mnemosyne/src/recall/unified.ts` — same. ✓
- `packages/mnemosyne/src/janitor/{dedup,prune}.ts` — same. ✓

No new module bypasses the tx wrapper. The v1.4 cron drivers (`apps/web/worker/{consolidation,summary,health,review-sweep,auto-pin}-job.ts`) all open `withMnemoTx(workspaceId, …)` before touching mnemo tables.

---

## 2. CODE QUALITY

### 2.a · TypeScript strict — OK

```
$ cd packages/mnemosyne && npx tsc --noEmit
TypeScript: No errors found
EXIT=0

$ cd apps/web && npx tsc --noEmit
TypeScript: No errors found
EXIT=0
```

### 2.b · `any` usage — OK

`grep -rEn ': any\b|\bas any\b' packages/mnemosyne/src apps/web/lib apps/web/app/api/mnemo apps/web/worker` returns 11 lines; after stripping comments and `apps/web/lib/{toast,llm-call,rate-limit-redis,auth-client}.ts` (pre-existing infrastructure, not Mnemosyne):

- `packages/mnemosyne/src/*` user-code `any` count: **0** (3 matches are comments containing the word "any" in prose).
- `apps/web/app/api/mnemo/*` user-code `any` count: **0**.
- `apps/web/worker/*` user-code `any` count: **0**.

### 2.c · Silent failures — OK (mnemosyne), pre-existing in brain

`grep -rEn 'catch[^{]*\{\s*\}' packages/mnemosyne/src` — **no hits**.

In `apps/web/lib`, the 4 `catch {}` cases (`flow-engine.ts:220,752`, `storage.ts:80`, `tools.ts:371`) and the `.catch(() => {})` patterns (`observability.ts:68`, `llm-call.ts:747,751,787`) are pre-existing engine/IO best-effort lanes, unrelated to Mnemosyne. Out of scope.

### 2.d · Lint — OK

```
$ pnpm --filter @orchester/web lint
✔ No ESLint warnings or errors
```

`packages/mnemosyne` has no lint script (typecheck-only via `tsc`).

### 2.e · Dead / orphan code — P2

`packages/mnemosyne/src/index.ts` is a comprehensive barrel (~240 lines, exports for every module). But these symbols are defined but never imported outside their own definition or tests:

1. **`MNEMOSYNE_VERSION = "0.1.0"`** (`src/index.ts:7`) — version constant is stale (we are at v1.4, branch `mnemo-v1.4-graph-rem-tom`) and no caller imports it. Either bump to `"1.4.0"` and wire into a `/__health` endpoint, or remove. _(P2)_
2. **`createDecision`, `listDecisions`, `supersedeDecision`, `withdrawDecision`** (`src/primitives/decision.ts`) — implemented + tested in `tests/integration/decision-crud.spec.ts`, but **not re-exported** from the barrel AND not called from any production path. The decision primitive is still latent (same as v1.0). _(P2 carryover)_
3. **`createCitation`, `listCitationsForMemory`** (`src/citation/store.ts`) — implemented + tested in `tests/integration/citation-crud.spec.ts`. `apps/web/app/api/mnemo/facts/[id]/citations/route.ts` queries `mnemo_fact.source_message_ids` directly with raw SQL — it does NOT use these helpers. Latent. _(P2 carryover)_
4. **`dismissRelation`, `listPendingRelations`** (`src/graph/relation.ts`) — exported only internally, used only in tests. `createRelation` and `judgeRelation` ARE used by production (`packages/mnemosyne/src/consolidation/summarize.ts` stamps `derived_from` edges). The other two are latent. _(P2)_
5. **`saveDecisionWithCandidates`** (`src/conflict/candidate.ts`) — only test-imported. (`saveFactWithCandidates` from `src/conflict/fact-candidate.ts` IS used.) Latent. _(P2)_

This is the same architectural pattern as v1.0: facts + a few graph helpers shipped to production; decisions, citations, and pending-relation queries remain unwired. Acceptable for v1.4 if the roadmap pulls them in v2.0 — but they should not multiply.

### 2.f · Barrel completeness — OK

The barrel re-exports `primitives/fact.ts` (`createFact` and friends via deep import in apps/web), `graph/verbs.ts` (`RELATION_VERBS`/`isRelationVerb`), `conflict/fact-candidate.ts`, `modes/{detect,health}.ts`, `recall/{search,query-prep,rerank,render,triggering,unified}.ts`, `summary/index.ts`, `health/index.ts`, `janitor/index.ts`, `review/index.ts`, `episode/index.ts`, `policy/index.ts`, `consolidation/index.ts`, `protocol/v1.ts`, `pii/{detect,redact,patterns}.ts`. Coverage of _needed_ surfaces is good. Orphan symbols above are a separate concern from barrel completeness.

### 2.g · `package.json` exports — OK

```json
"exports": {
  ".": "./src/index.ts",
  "./protocol": "./src/protocol/v1.ts"
}
```

Both paths exist. v1.0 P1 §5.e closed.

---

## 3. SPEC COMPLIANCE (vs §0-§39, v1.0 design + v1.1-v1.4 evolution)

### Caveat — Spec ↔ code version skew

`docs/specs/2026-05-24-mnemosyne-design.md` documents the v1.0 design. v1.1, v1.2, v1.3, v1.4 added: summary/distillation, health/drift, janitor (dedup/prune), review queue + auto-pin, memory types, episodes, attribution, agent memory policies, recall-unified, REM consolidation. These additions exist in code but are not yet reflected in the spec document (see §6.d). Per brief: "flag the gap; spec update is a separate next step."

### 3.§2 Four primitives — Partial (deferred where committed)

| primitive  | table            | status                                                                        |
| ---------- | ---------------- | ----------------------------------------------------------------------------- |
| `fact`     | `mnemo_fact`     | OK — shipped v1.0, extended through v1.4 (memory_type, attribution, actor_id) |
| `decision` | `mnemo_decision` | OK — shipped v1.0, schema unchanged                                           |
| `entity`   | n/a              | Deferred to v2.0 per plan §27 — no `mnemo_entity` table, no `entity.ts`       |
| `episode`  | `mnemo_episode`  | NEW v1.4 — table + `episode/{store,query}.ts` + REST routes + 6 tests         |

Episode shipped at v1.4 (E1 / migration 0034); entity still deferred. Matches the brief's "fact + decision shipped at v1.0; episode shipped at v1.4 (E1). Entity still deferred."

### 3.§2.1 Bitemporal GIST indexes — OK

Verified live: `idx_mnemo_fact_valid gist (tstzrange(valid_from, valid_to))`, same on `mnemo_decision`, `mnemo_relation`. Migration 0026 closed the v1.0 P2 §3.§2.1 gap.

### 3.§3 Graph layer + 9 verbs — OK

`packages/mnemosyne/src/graph/verbs.ts:14-24` enumerates exactly `[related, compatible, scoped, conflicts_with, supersedes, not_conflict, derived_from, part_of, member_of]`. The live `mnemo_relation_relation_check` CHECK constraint matches verbatim. `RELATION_VERB_VERSION = "v1.0.0"` (locked since v1.0).

### 3.§4 Citation — OK

`mnemo_citation` schema unchanged from v1.0. `extractor_prompt_version` + `judge_relation_id` fields intact in DB.

### 3.§5 Hybrid retrieval — OK

`packages/mnemosyne/src/recall/search.ts:80` defines `searchMnemo()` against `mnemo_fact`. v1.1 ported the brain logic; v1.4 added `expandGraph` (1-hop relation traversal), `memoryTypes` filter, `attributionFilter`, and the unified recall path (`recall/unified.ts`). The v1.0 P1 §3.§5 finding is closed. **However**, the L3 query cache (`mnemo_query_cache` table) is still unused; only L1 (LRU in-process) + L2 (embedding LRU) are live. Comment at `packages/mnemosyne/src/recall/search.ts:39-43` acknowledges the TODO. _(P2 — see §3.§26 below.)_

### 3.§6 Extraction pipeline — OK

`packages/mnemosyne/src/extraction/prefilter.ts` exports `shouldExtract()`. Used by `apps/web/lib/brain/extract-job.ts` to gate LLM extraction. Tested.

### 3.§7 Candidate-on-write — OK

`saveFactWithCandidates` (`src/conflict/fact-candidate.ts`) is used in production from `apps/web/lib/brain/extract.ts` / extraction pipeline. `saveDecisionWithCandidates` exists but is unused (see §2.e).

### 3.§13 Memory protocol versioned — OK

`MEMORY_PROTOCOL_VERSION = "v1.1.0"` (`packages/mnemosyne/src/protocol/v1.ts:17`). Body ~80 tokens. v1.0 legacy preserved as `MEMORY_PROTOCOL_V1_LEGACY`. Locked by `tests/unit/protocol-v1.test.ts`.

### 3.§17 RBAC actions — OK

`apps/web/lib/rbac.ts:42-44` defines `mnemo.read | mnemo.write | mnemo.admin`. Assigned at lines 53 (viewer: read), 76-77 (editor: read+write), 109+ (admin/owner: all). v1.0 P2 §3.§17 closed.

### 3.§25 Provider Agnosticism Charter — OK

Zero provider/model defaults in `packages/mnemosyne/src/**/*.ts` operational paths. Only matches are: (a) JSDoc examples, (b) one typed identifier union (`EmbeddingProvider`). Same finding as v1.0; still clean.

### 3.§26 Cost engineering — OK (A1/A2/L1/L2), P2 (L3 still dead)

- **A1 prefilter** (`shouldExtract`): used. ✓
- **A2 capability detection** (`adapters/types.ts`): tested; consumed via `resolveActiveMode`. ✓
- **L1 query cache** (in-process LRU in `recall/cache.ts`): used by `searchMnemo`. ✓
- **L2 embedding cache** (LRU in `recall/embed.ts`): used. ✓
- **L3 `mnemo_query_cache` table**: still dead. `grep -rn "mnemo_query_cache" packages/mnemosyne` returns 3 hits, all comments/TODOs. The table is populated by nothing and read by nothing. _(P2 carryover from v1.0 §3.§26.)_
- **Prompt caching** (`cache_control: { type: "ephemeral" }`): wired in `apps/web/lib/llm-call.ts:206-217`. ✓
- **Tiered injection** (`agent-runtime.ts:86`/`:366`): wired. ✓
- **Smart triggering** (`shouldTriggerRecall`): wired (`agent-runtime.ts:108`). ✓

### 3.§28 C2 Memory Inference Engine (tiered embedding + halfvec) — Deferred

Per the audit brief: "C2 (tiered embedding + halfvec) was deferred — not in v1.2/v1.3/v1.4." Verified:

- `grep -rn "halfvec" packages/db packages/mnemosyne` — 0 matches.
- `grep -n "C2 " docs/specs/plans/2026-05-24-mnemosyne-implementation-plan.md` — 0 matches.
- `mnemo_fact.embedding` remains `vector(1536)`.

No drift; deferred openly. _(P2 — explicit deferred-item flag.)_

### 3.§32 PII detection — OK

Wired in `createFact` (see §1.g). v1.0 P2 §3.§32 closed.

### 3.§39 Operational modes — OK

`resolveModeFromCapabilities` plus the v1.1 health-aware `resolveActiveMode` are both wired (`packages/mnemosyne/src/modes/{detect,health}.ts`). Used in `apps/web/lib/brain/extract-job.ts` (Mode A graceful degradation). Circuit-breaker logic in `recordProviderResult`/`getProviderHealth` (in-memory rolling window). Tested by `packages/mnemosyne/tests/integration/circuit-breaker.spec.ts` (7.5KB suite). v1.0 P2 §3.§39 (dead-helper finding) closed — production now wires the resolver.

### v1.1-v1.4 net-new spec coverage

These exist in code but are not yet codified in `docs/specs/2026-05-24-mnemosyne-design.md` — flagged here as a _spec drift / docs gap_, not a bug. Each has a feature-specific commit message in the v1.0→v1.4 log:

- v1.1: Layer 1 summary (`mnemo_summary` 0028) + async embed (`mnemo.embed.{fact,batch}`) + post-recall pipeline (rerank, hyde, render, triggering).
- v1.2: health snapshots (`mnemo_health` 0031), bitemporal GIST 0026, janitor dedup+prune (`mnemo_fact_archive` 0029), provider health 0027.
- v1.3: review queue (`mnemo_review_queue` 0032), auto-pin rules, brain UI surfaces (undo log, sensitivity toggle, export modal).
- v1.4: memory types (`mnemo_fact.memory_type` 0033), episodes (`mnemo_episode` 0034), attribution (`mnemo_fact.attribution` 0035), agent memory policies (`agent.memory_policy` 0036, `mnemo_fact.actor_id` 0037), recall-unified (KB+memory), REM consolidation.

---

## 4. TEST COVERAGE

### 4.a · `pnpm --filter @orchester/mnemosyne test` — OK

```
Test Files  47 passed (47)
     Tests  223 passed (223)
   Duration  19.06s
```

Above the 223+ target. 0 skipped. 47 spec files vs. 17 src files-tested-by-integration → high coverage.

### 4.b · `pnpm --filter @orchester/web test` — OK

```
Test Files  38 passed | 2 skipped (40)
     Tests  232 passed | 6 skipped (238)
   Duration  11.69s
```

Above the 230+ target. The GDPR watchdog suite (v1.0 §4.b flake) **now passes deterministically** in the concurrent run — confirmed clean across the full execution.

### 4.c · v1.4 module integration tests — OK

Each new v1.4 module has at least one integration spec:

| module                                       | spec                                                      |
| -------------------------------------------- | --------------------------------------------------------- |
| `episode/{store,query}.ts`                   | `tests/integration/episode-crud.spec.ts` (8.5KB)          |
| `recall/search.ts` memoryTypes filter        | `tests/integration/memory-types-recall.spec.ts` (6.0KB)   |
| `recall/search.ts` expandGraph               | `tests/integration/recall-expand-graph.spec.ts` (7.5KB)   |
| `recall/search.ts` attributionFilter         | `tests/integration/recall-attribution.spec.ts` (4.9KB)    |
| `consolidation/cluster.ts`                   | `tests/integration/consolidation-cluster.spec.ts` (8.0KB) |
| `consolidation/summarize.ts`                 | `tests/unit/consolidation-summarize.test.ts` (2.4KB)      |
| `policy/index.ts`                            | `tests/unit/policy.test.ts` (6.8KB)                       |
| `recall/unified.ts`                          | `tests/unit/recall-unified.test.ts` (7.7KB)               |
| `episode` type system                        | `tests/unit/episode-types.test.ts` (1.6KB)                |
| `recall/search.ts` attribution discriminator | `tests/unit/attribution.test.ts` (1.6KB)                  |

### 4.d · Coverage gaps in `packages/mnemosyne/src/`

Every source file has at least one corresponding test. No zero-coverage files. Specifically:

- `policy/index.ts` ← `unit/policy.test.ts`
- `recall/unified.ts` ← `unit/recall-unified.test.ts`
- `consolidation/{cluster,summarize}.ts` ← integration + unit
- `episode/{store,query}.ts` ← integration + unit
- `review/{queue,auto-pin}.ts` ← `integration/review-queue.spec.ts` + `unit/auto-pin.test.ts`
- `summary/{distill,store}.ts` ← `integration/summary{,-heuristic-fallback}.spec.ts` + (indirectly via summary integration)
- `janitor/{dedup,prune}.ts` ← `integration/{dedup,prune}.spec.ts` + `unit/dedup-cluster.test.ts`
- `health/compute.ts` ← `unit/health.test.ts`

### 4.e · Pre-existing skipped tests in `apps/web`

6 skipped tests; all pre-existing (Mnemosyne-unrelated):

- `tests/unit/tenant/resolve.spec.ts` × 5 (env-gated)
- `tests/unit/tenant/membership.spec.ts` × 1

---

## 5. OPERATIONAL READINESS

### 5.a · Migrations applied vs files — OK

Disk migration files: `0001-0018`, `0020-0022`, `0024-0029`, `0031-0037`. Intentional gaps: **0019** + **0023** (per v1.0 audit §5.a — plan-reserved unused), **0030** (no commit history; treat as plan-reserved unused gap). All listed migrations are present in both `.sql` and `.down.sql` form.

Live `\dt`: all 11 mnemo\_\* tables present (`mnemo_citation`, `mnemo_decision`, `mnemo_episode`, `mnemo_extraction_job`, `mnemo_fact`, `mnemo_fact_archive`, `mnemo_health`, `mnemo_query_cache`, `mnemo_relation`, `mnemo_review_queue`, `mnemo_summary`). No drift.

Migration 0030 absence is **not** a regression — there are no orphan/lost migrations: the deploy is consistent with the disk files.

### 5.b · Worker registers every mnemo/brain queue job — **P2**

Comparison of job constants in `apps/web/lib/queue.ts` vs registrations in `apps/web/worker/index.ts`:

| constant                  | value                 | registered?                   |
| ------------------------- | --------------------- | ----------------------------- |
| `JOB_BRAIN_EXTRACT`       | `brain:extract`       | yes (`:180`)                  |
| `JOB_BRAIN_COMPACTION`    | `brain:compaction`    | yes (`:186`, `schedule :189`) |
| `JOB_BRAIN_DECAY`         | `brain:decay`         | yes (`:194`, `schedule :197`) |
| `JOB_MNEMO_EMBED_FACT`    | `mnemo.embed.fact`    | yes (`:211`)                  |
| `JOB_MNEMO_EMBED_BATCH`   | `mnemo.embed.batch`   | yes (`:214`, `schedule :217`) |
| `JOB_MNEMO_SUMMARY`       | `mnemo.summary`       | yes (`:230`, `schedule :233`) |
| `JOB_MNEMO_HEALTH`        | `mnemo.health`        | yes (`:244`, `schedule :247`) |
| `JOB_MNEMO_DEDUP`         | `mnemo.janitor.dedup` | yes (`:261`, `schedule :264`) |
| `JOB_MNEMO_PRUNE`         | `mnemo.janitor.prune` | yes (`:266`, `schedule :269`) |
| `JOB_MNEMO_REVIEW_SWEEP`  | `mnemo.review.sweep`  | yes (`:276`, `schedule :279`) |
| `JOB_MNEMO_AUTO_PIN`      | `mnemo.auto-pin`      | yes (`:287`, `schedule :290`) |
| `JOB_MNEMO_CONSOLIDATION` | `mnemo.consolidation` | yes (`:304`, `schedule :307`) |
| **`JOB_MNEMO_EXTRACT`**   | **`mnemo.extract`**   | **NO**                        |

`JOB_MNEMO_EXTRACT = "mnemo.extract"` is exported at `apps/web/lib/queue.ts:174` but:

- Not registered in `apps/web/worker/index.ts`.
- Not enqueued from anywhere (`grep -rln "JOB_MNEMO_EXTRACT\|\"mnemo\\.extract\"" apps/web packages/mnemosyne` → only `queue.ts:174` + compiled bundle artefacts).
- Not referenced in any test.

The constant is dead. Either wire the extraction path to enqueue against it (so `apps/web/lib/brain/extract-job.ts` becomes the brain extractor and a parallel `mnemo-extract-job.ts` runs for mnemosyne), or delete the constant. Today the mnemo facts get written via the brain extraction path's dual-write — `mnemo.extract` is a placeholder that confuses readers. _(P2 — fix is one of: delete the constant, or implement the mnemo-side extractor and register it.)_

### 5.c · `audit-invariants.sh` — OK

Already verified in §1.f. EXIT=0, scans both `apps/web` and `packages/mnemosyne/src`.

### 5.d · DB role + `assertSafeDbRole` — see §1.b (P1)

### 5.e · Worker boots cleanly (typecheck) — OK

`apps/web/worker/index.ts` imports resolve via `tsc --noEmit` (EXIT=0). Not exercised at runtime in this audit (read-only).

### 5.f · Git working tree — OK

```
$ git status --short
(empty)
```

No uncommitted changes. The v1.0 P2 §5.c (`apps/web/tsconfig.tsbuildinfo` tracked) is closed.

### 5.g · Deploy compose (P1) — see §1.b

---

## 6. DOCUMENTATION

### 6.a · Plan checkboxes — OK

`grep -cE "^\s*-\s*\[x\]"` → **169 ticked**.
`grep -cE "^\s*-\s*\[ \]"` → **15 unticked**.

All 15 unticked are: (a) pre-flight setup items (5), (b) "Step N: Push (deferred)" markers (3), (c) post-v1.0 verification-checklist items (7). No regression vs. v1.0 audit §6.a.

### 6.b · Spec ↔ code consistency (sampled) — OK

Sampled 4 spec invariants:

1. Spec §2.1 `mnemo_fact.kind` enum (`preference|trait|event|relationship|skill|concern|other`) ↔ live `mnemo_fact_kind_check`: matches.
2. Spec §3 9 verbs ↔ `verbs.ts` ↔ `mnemo_relation_relation_check`: matches.
3. Spec §4 citation `extractor_prompt_version` + `judge_relation_id` ↔ migration 0021 + drizzle: matches.
4. Spec §2 `mnemo_fact.scope` enum (`global|conversation|employee|team`) ↔ live `mnemo_fact_scope_check`: matches.

### 6.c · ADR-0020 alignment — **P2 (drift)**

`docs/adr/0020-mnemosyne-multi-tenant-memory.md` was created (closing v1.0 P2 §6.c) but its body is now out of sync with deployed reality:

1. **Wrong verb list** (`:51-52`): ADR says `relates_to, contradicts, supports, derives_from, assigned_to, blocks, mentions, references, succeeds`. Code + DB have `related, compatible, scoped, conflicts_with, supersedes, not_conflict, derived_from, part_of, member_of`. The ADR appears to predate the v1.0 freeze of `RELATION_VERBS` in `packages/mnemosyne/src/graph/verbs.ts:14-24`.
2. **Table count** (`:37,81`): ADR says "Six tables". v1.4 ships **11** (`mnemo_fact`, `mnemo_decision`, `mnemo_relation`, `mnemo_citation`, `mnemo_extraction_job`, `mnemo_query_cache`, `mnemo_summary`, `mnemo_fact_archive`, `mnemo_health`, `mnemo_review_queue`, `mnemo_episode`).
3. **Missing v1.1-v1.4 evolution log** — the ADR has no "Updates" section recording subsequent feature waves.

**Fix (P2)**: amend ADR-0020 — correct the verb list (point to `packages/mnemosyne/src/graph/verbs.ts` for the canonical source), bump the table count to 11 with a per-version table-list breakdown, add an "Updates" section tracking v1.1→v1.4. Safe standalone doc-only PR.

### 6.d · Spec doc drift — P2 (carryover, mostly expected)

`docs/specs/2026-05-24-mnemosyne-design.md` reflects v1.0 design only. v1.1-v1.4 added significant surface area (summary cron, health snapshots, janitor, review queue, auto-pin, episodes, memory types, attribution, actor isolation, agent policies, recall-unified, REM consolidation) that is not in the spec.

**Per the audit brief**: "This will be fixed in the next step (spec update), but you flag it." Flagged here. Either revise the spec to add §40-§50 sections covering v1.1-v1.4, or commit to a v2.0 spec rewrite once the dust settles.

### 6.e · ADR-0010 — OK

`docs/adr/0010-rls-force-defense-in-depth.md` has an "Amendment 2026-05-25" section explicitly recording the P0 fix from the v1.0 audit, with the (verbatim) `rolname | rolsuper | rolbypassrls` table that motivated the change and the two-layer fix description. References `app_user` (the deployed role) correctly. v1.0 P2 §7.a closed.

---

## 7. KNOWN OUTSTANDING ISSUES (carried + new)

### 7.a · v1.0 P0/P1/P2 status

| v1.0 finding                                     | status                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| P0 §1.b — prod DATABASE_URL = SUPERUSER          | **partial** — Layers 1+2 done; Layer 3 (compose update) NOT done (now P1 §1.b) |
| P1 §3.§5 — hybrid recall over mnemo\_\* missing  | **closed** (v1.1 ported)                                                       |
| P1 §4.b — GDPR watchdog flake                    | **closed** (passes deterministically)                                          |
| P1 §5.e — `package.json` exports paths broken    | **closed**                                                                     |
| P2 §1.f — `audit-invariants.sh` misses mnemosyne | **closed**                                                                     |
| P2 §1.g — PII unwired                            | **closed**                                                                     |
| P2 §2.e — dead code (decision/citation/etc.)     | **carryover** — same orphans (§2.e)                                            |
| P2 §2.f — barrel incompleteness                  | **closed**                                                                     |
| P2 §3.§2.1 — bitemporal GIST missing             | **closed**                                                                     |
| P2 §3.§17 — `mnemo.*` RBAC missing               | **closed**                                                                     |
| P2 §3.§26 L3 — `mnemo_query_cache` unused        | **carryover**                                                                  |
| P2 §3.§32 — PII unwired                          | **closed**                                                                     |
| P2 §3.§39 — operational-mode helper dead         | **closed**                                                                     |
| P2 §5.c — tsbuildinfo tracked                    | **closed**                                                                     |
| P2 §6.c — ADR-0020 missing                       | **closed** (but body drifted — see §6.c above)                                 |
| P2 §7.a — ADR-0010 drift                         | **closed**                                                                     |

### 7.b · v1.4-introduced concerns

| finding                                                     | severity      |
| ----------------------------------------------------------- | ------------- |
| Prod compose still uses `orchester` (deploy will fail boot) | **P1** §1.b   |
| `JOB_MNEMO_EXTRACT` constant defined but unused everywhere  | **P2** §5.b   |
| `MNEMOSYNE_VERSION = "0.1.0"` stale at v1.4                 | **P2** §2.e   |
| ADR-0020 body lists wrong verbs and table count             | **P2** §6.c   |
| Spec doc not yet updated for v1.1-v1.4                      | **P2** §6.d   |
| `mnemo_query_cache` L3 still dead                           | **P2** §3.§26 |
| C2 tiered-embedding + halfvec deferred (explicit)           | **P2** §3.§28 |

### 7.c · Phase-E / earlier audit follow-ups — out of scope (same as v1.0).

---

## Top 5 P0/P1/P2 issues (one-line summaries, ordered by impact)

1. **P1 §1.b** — `deploy/docker-compose.prod.yml:96,153` injects `DATABASE_URL=postgresql://orchester:...` (SUPERUSER, BYPASSRLS); `assertSafeDbRole` will throw at prod boot. Fix: switch web+worker services to `app_user:${APP_DB_PASSWORD}` and add `MIGRATION_DATABASE_URL` for `drizzle migrate`.
2. **P2 §5.b** — `JOB_MNEMO_EXTRACT` defined at `apps/web/lib/queue.ts:174` but never enqueued/registered/referenced. Dead constant.
3. **P2 §6.c** — `docs/adr/0020-mnemosyne-multi-tenant-memory.md:51-52,37,81` lists wrong verb names (9 different ones from deployed) and "Six tables" while v1.4 ships 11. ADR drift.
4. **P2 §3.§26 + §3.§28** — L3 query cache table (`mnemo_query_cache`) still dead; C2 tiered embedding + halfvec deferred. Both pre-disclosed; no plan for v1.5.
5. **P2 §2.e** — `MNEMOSYNE_VERSION = "0.1.0"` stale; `createDecision`/`createCitation`/`dismissRelation`/`listPendingRelations`/`saveDecisionWithCandidates` are still orphan from v1.0. Decision/citation primitives have integration tests but no production caller.

---

## Total findings by severity

- **P0**: 0
- **P1**: 1 (§1.b — partial v1.0 P0 carryover)
- **P2**: 6 (§2.e dead code & stale version, §3.§26 L3 dead, §3.§28 C2 deferred, §5.b unused job constant, §6.c ADR drift, §6.d spec doc drift)
- **OK**: 17+ verified-clean items (see Executive Summary ledger)

---

## Verification commands run

```bash
# Typecheck — both clean
$ cd packages/mnemosyne && npx tsc --noEmit; echo EXIT=$?   # EXIT=0
$ cd apps/web && npx tsc --noEmit; echo EXIT=$?              # EXIT=0

# Tests — both above target
$ pnpm --filter @orchester/mnemosyne test | tail
# Test Files  47 passed (47) / Tests  223 passed (223)
$ pnpm --filter @orchester/web test | tail
# Test Files  38 passed | 2 skipped (40) / Tests  232 passed | 6 skipped (238)

# Audit invariants — clean
$ bash scripts/audit-invariants.sh; echo EXIT=$?             # EXIT=0

# Lint — clean
$ pnpm --filter @orchester/web lint
# ✔ No ESLint warnings or errors

# Live DB introspection
$ docker exec orchester-postgres psql -U orchester -d orchester \
    -c "SELECT relname, relrowsecurity, relforcerowsecurity, ... FROM pg_class WHERE relname LIKE 'mnemo_%' ..."
# 11 mnemo_* tables, all (t, t, 4)

$ docker exec orchester-postgres psql -U orchester -d orchester \
    -c "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'app_user' AND table_name LIKE 'mnemo_%';"
# 44 (11 tables × 4 privileges)
```

---

## Recommended ordering (for follow-up PRs)

1. **P1 §1.b** (deploy compose) — single-file PR updating `deploy/docker-compose.prod.yml` to inject `app_user:${APP_DB_PASSWORD}` into web/worker services; add `MIGRATION_DATABASE_URL` block. Update `.env.example` if needed (already mostly correct). Document the prod migration playbook in a README.
2. **P2 §5.b** (`JOB_MNEMO_EXTRACT` dead) — either delete the constant from `apps/web/lib/queue.ts:174` (lowest-risk), OR wire an actual mnemo-side extractor (more work but clearer roadmap). Document choice.
3. **P2 §6.c** (ADR-0020 body drift) — amend ADR-0020 to fix verb list, table count, add v1.1-v1.4 evolution. Pure docs PR.
4. **P2 §6.d** (spec doc drift) — out of scope per brief; next step is spec update.
5. **P2 §2.e** (orphan code + stale version) — bump `MNEMOSYNE_VERSION` to `"1.4.0"`; either delete or land production wiring for `createDecision`/`createCitation` etc.; this is the cleanup unit that has been carried since v1.0.
6. **P2 §3.§26 + §3.§28** — either land L3 cache + C2 tiered embedding in v1.5, or document them as "deferred to v2.0" with explicit deferral markers in code.

---

_End of audit_
