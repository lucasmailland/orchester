# Mnemosyne v1.0 — Final Comprehensive Audit

- **Date**: 2026-05-24
- **Tag at HEAD**: `mnemosyne-v1.0` (commit `70d7070`)
- **Spec**: `docs/specs/2026-05-24-mnemosyne-design.md` §0-§39
- **Plan**: `docs/specs/plans/2026-05-24-mnemosyne-implementation-plan.md`
- **Provider audit (Phase 0)**: `docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md`
- **Scope**: READ-ONLY diagnostic across security, code quality, spec compliance, test coverage, operational readiness, documentation
- **Outcome**: 1 P0, 2 P1, 7 P2, plus a long list of verified-clean items

> Severity legend
>
> - 🔴 P0 — security hole, broken production, data loss risk
> - 🟠 P1 — functional bug, test failure, spec violation
> - 🟡 P2 — code quality, minor inconsistency, dead/latent code
> - 🟢 OK — verified clean

---

## Headline finding

**🔴 P0 — RLS+FORCE is theatre in production.** Every `mnemo_*` and `brain_*` table is correctly configured (`relrowsecurity=t`, `relforcerowsecurity=t`, 4 policies each), but the production `DATABASE_URL` connects as the `orchester` Postgres role — which is a `SUPERUSER` and has `BYPASSRLS` set, so it skips every policy unconditionally. The fact that the cross-tenant tests pass tells us nothing about prod: they explicitly `SET LOCAL ROLE app_user` first. Nothing in `withMnemoTx`, `withTenantContext`, or anywhere in `apps/web/lib/**` ever switches roles. Tenants are isolated only by app-level `app.workspace_id` GUC plumbing today; the RLS+FORCE layer that ADR-0010 promises is a no-op against any caller that hits prod via the configured connection. Fix below.

---

## 1. SECURITY

### 1.a · RLS+FORCE live verification — 🟢 OK (schema), 🔴 P0 (effective)

Schema check passes for all 8 tenant-scoped memory tables. Result of `SELECT relname, relrowsecurity, relforcerowsecurity, (SELECT count(*) FROM pg_policies WHERE tablename = pg_class.relname) AS policies FROM pg_class WHERE relname LIKE 'mnemo_%' OR relname LIKE 'brain_%' ORDER BY relname;`:

| table                  | rowsecurity | forcerowsecurity | policies |
| ---------------------- | ----------- | ---------------- | -------- |
| `brain_extraction_job` | t           | t                | 4        |
| `brain_fact`           | t           | t                | 4        |
| `mnemo_citation`       | t           | t                | 4        |
| `mnemo_decision`       | t           | t                | 4        |
| `mnemo_extraction_job` | t           | t                | 4        |
| `mnemo_fact`           | t           | t                | 4        |
| `mnemo_query_cache`    | t           | t                | 4        |
| `mnemo_relation`       | t           | t                | 4        |

Pattern A is universally applied. But see 1.b — the _effective_ posture depends on the connecting role.

### 1.b · Production connection role — 🔴 P0

Conclusive evidence chain:

1. `/Users/lucasmailland/dev/orchester/.env:1` and `apps/web/.env.local:1`:
   `DATABASE_URL="postgresql://orchester:orchester@localhost:5432/orchester"`
2. `.env.example:2` (the template installers copy): same — `postgresql://orchester:orchester@localhost:5432/orchester`
3. `deploy/docker-compose.prod.yml:96` and `:153`:
   `DATABASE_URL: postgresql://orchester:${POSTGRES_PASSWORD}@postgres:5432/orchester`
   The Postgres service is initialized with `POSTGRES_USER: orchester` (`:36`), which makes `orchester` the cluster superuser (Postgres `POSTGRES_USER` env creates the role with SUPERUSER).
4. Live verification against the running container (`docker ps`: `orchester-postgres pgvector:pg16`):
   ```
   rolname     | rolsuper | rolbypassrls
   ------------+----------+--------------
   orchester   | t        | t
   app_user    | f        | f
   cron_admin  | f        | t
   ```
5. `apps/web/lib/tenant/context.ts:46-50` shows the only place tenant context is applied: `db.transaction((tx) => { tx.execute(sql"SELECT set_config('app.workspace_id', ${workspaceId}, true)") ... })`. There is NO `SET LOCAL ROLE` switch anywhere.
6. Grep across the entire repo (`grep -rn "SET ROLE\|SET LOCAL ROLE" packages apps`): the only callers are the **test** helpers `apps/web/tests/isolation/helpers.ts:72,88` and `packages/mnemosyne/tests/integration/cross-tenant-isolation.spec.ts:66`. Production code never switches roles.
7. `packages/mnemosyne/src/tx.ts` (`withMnemoTx`) sets the workspace GUC but inherits the connection role — same `orchester` superuser.

**Concrete consequence**: a missing `set_config('app.workspace_id', ...)` in any code path silently returns rows from _all_ tenants (since FORCE doesn't apply to the superuser). ADR-0010 explicitly claims "the application connects as a normal role (`orchester_app`)" — that ADR is documentation drift; no such role exists, and the deployed default contradicts it.

**Fix (P0 — coordinate with infra)**:

1. In `packages/db/migrations/0007_postgres_roles.sql` is fine as-is — `app_user` already lacks BYPASSRLS. Migration is the source of roles.
2. Update `.env.example`, `.env`, `apps/web/.env.local` to use `postgres://app_user:app@localhost:5432/orchester` instead of `postgresql://orchester:orchester@...`.
3. Update `deploy/docker-compose.prod.yml:96,153` to inject a separate `APP_DB_PASSWORD` and connect the `web`/`worker` services as `app_user` (not `orchester`). Keep `orchester` only for the `postgres` service bootstrap + migrations entrypoint.
4. Validate by running `psql $DATABASE_URL -c "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;"` after the change — must show `app_user | f | f`.
5. Migrations still need a superuser connection — keep a separate `MIGRATION_DATABASE_URL` (or run `drizzle migrate` as `postgres`/`orchester` via docker exec) that does NOT leak into runtime code.
6. Add a runtime startup probe in `packages/db/src/client.ts` that calls `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user` and throws if true (fail-closed). Cheap and catches future regressions.

**Safety to apply standalone**: requires coordination — changing the role flips DDL ownership for new tables (cron, migrations) and may need a re-grant pass. Suggested approach: dedicated PR with a one-step migration that creates the role-switch + a startup assertion + ADR-0021 documenting the actual deployed role.

### 1.c · Provider hardcodes — 🟢 OK (with one P2 comment polish)

`grep -rEn "claude-|gpt-[0-9]|text-embedding-[0-9]" packages/mnemosyne/src apps/web/lib/brain` returns 2 hits, both in comments:

- `apps/web/lib/brain/model-resolve.ts:27` — JSDoc comment giving `claude-haiku-4-5` as an example. Comment, not load-bearing. Acceptable per Charter §25 ("examples permitted").
- `apps/web/lib/brain/model-resolve.ts:62` — duplicate of the above in inline comment. Same.

`packages/mnemosyne/src/recall/embed.ts:18` exports `type EmbeddingProvider = "openai" | "google" | "voyage"` — these are identifiers used to route a _caller-provided_ `embedFn`, not defaults. The module never picks one; `embedMnemo()` requires `provider` + `model` + `embedFn` in its input. Verified: §25 compliant.

### 1.d · SQL injection — 🟢 OK

Sampled 5 CRUD functions:

- `packages/mnemosyne/src/primitives/fact.ts` — uses `tx.insert(schema.mnemoFacts).values(...).returning()` (drizzle parameterized).
- `packages/mnemosyne/src/primitives/decision.ts` — same; `sql\`md5(${input.body})\`` is parameterized.
- `packages/mnemosyne/src/graph/relation.ts` — drizzle parameterized.
- `packages/mnemosyne/src/citation/store.ts` — drizzle parameterized.
- `packages/mnemosyne/src/conflict/candidate.ts:95-104` — uses `sql` template; values for `workspaceId`, `decision.id`, `query`, `limit` are interpolated via tagged template (drizzle treats `${}` substitutions as parameters, not raw concatenation). The `query` value is the OUTPUT of `sanitizeFTSCandidates()` (lines 71-75), which keeps only `[A-Za-z0-9]+` tokens and joins with `" | "`. Even if the sanitizer were defeated, the value is still bound as a parameter to `to_tsquery('simple', $1)` — Postgres would error on syntax, not execute injected DDL.

No usages of `sql.raw(`, `sql.unsafe(`, or template-literal string interpolation in user code. Mnemosyne is parameterized end-to-end.

### 1.e · Audit chain integration — 🟢 OK (for brain), 🟡 P2 (mnemo routes don't exist yet)

Mnemosyne does not yet expose REST routes (no `apps/web/app/api/workspaces/[slug]/mnemo*` exists). So there is nothing in mnemosyne to `appendAudit` from. The brain routes that already mutate the underlying tables continue to call `appendAudit` correctly:

- `apps/web/app/api/workspaces/[slug]/brain/facts/route.ts:13,133` — present.
- `apps/web/app/api/workspaces/[slug]/brain/facts/[id]/route.ts:12,105,109,138` — present.

Spec §17.3 enumerates 9 mnemo audit action families (`mnemo.fact.*`, `mnemo.decision.*`, etc.) — _none_ are wired yet because no routes exist. This is acceptable for v1.0 (pure data layer) but is the next-stop work item.

### 1.f · Spend cap (`audit-invariants.sh`) — 🟢 OK

Script passes locally:

```
$ bash scripts/audit-invariants.sh
✓ all transversal invariants hold.
```

Inspected the script (`scripts/audit-invariants.sh:32-38`): it greps `apps/web/**/*.ts` only — `packages/mnemosyne/` is not scanned. Mnemosyne contains zero `llmCall(` / `llmStream(` invocations today (`grep -rn "llmCall\|llmStream" packages/mnemosyne/src/` returns empty), so the omission is currently moot, but it will become P1 the moment a mnemosyne module adopts an LLM-judge or extractor call. Listed as P2 below (1.f.1).

### 1.g · PII detection wiring — 🟡 P2

`packages/mnemosyne/src/pii/detect.ts` exports `detectPII()`, `packages/mnemosyne/src/pii/redact.ts` exports `redactPII()`. Both have unit tests (`tests/unit/pii-detect.test.ts`, `tests/unit/pii-redact.test.ts`). However:

- `grep -rn "detectPII\|redactPII" apps/web packages` returns ONLY their own definitions and tests. No production caller.
- They are NOT re-exported from `packages/mnemosyne/src/index.ts` (only `MEMORY_PROTOCOL_V1` and `MEMORY_PROTOCOL_VERSION` are). External consumers cannot reach them through the public barrel.

Listed as 2.e below (dead/latent code). Spec §32 says PII detection is part of v1; the code exists but is unwired and unreachable.

### 1.h · Memory Protocol injection — 🟢 OK

Commit `5f7539d` adds `apps/web/lib/agent-runtime.ts:273` (`finalPrompt += "\n\n---\n${MEMORY_PROTOCOL_V1}\n---\n";`) inside `runAgent` (the only agent entry function — no separate `runConversationalAgent`). Injection comes after the JSON-mode / markdown-mode addenda (`:260-263`) and after `UNTRUSTED_CONTENT_GUARDRAIL` (`:265`), then the model immediately sees the protocol body. The unit test in `packages/mnemosyne/tests/unit/protocol-v1.test.ts` locks the contents of `MEMORY_PROTOCOL_V1` so a bump must be deliberate. Verified.

### 1.i · Cross-tenant probe in production — 🔴 P0 (via 1.b)

The existing test (`packages/mnemosyne/tests/integration/cross-tenant-isolation.spec.ts`) is structurally correct: it switches to `app_user` and proves RLS rejects the cross-tenant read. But in production no such switch happens (1.b), so the _deployed_ posture is "tenant isolation rests on application-level GUC discipline plus a 4-policy RLS layer that the active role unconditionally bypasses." Same fix as 1.b.

---

## 2. CODE QUALITY

### 2.a · TypeScript strict — 🟢 OK

```
$ cd packages/mnemosyne && npx tsc --noEmit
TypeScript: No errors found
EXIT=0

$ cd apps/web && npx tsc --noEmit
TypeScript: No errors found
EXIT=0
```

### 2.b · `any` usage — 🟢 OK

`grep -rEn ": any\b|\bas any\b" packages/mnemosyne/src packages/db/src/schema/mnemosyne.ts` returns one hit:

- `packages/mnemosyne/src/conflict/candidate.ts:64` — inside a JSDoc comment ("any matching token surfaces the row"). Not user code.

User-code `any` count: 0. Drizzle's `as unknown as Citation`/`as unknown as Row` casts in store helpers are at the bridge boundary (drizzle returns a nominal type that's a structural superset) and are documented; not flagged.

### 2.c · Silent failures — 🟢 OK (mnemosyne), 🟡 P2 (one in brain)

`grep -rEn "catch.*\{[\s]*\}" packages/mnemosyne/src` — no hits.
`apps/web/lib/brain/recall.ts:226-228` swallows the fire-and-forget `markRecalled` error: `.catch(() => {})`. The comment above acknowledges this is intentional ("Errors don't surface (next recall tick will retry naturally)"). Pre-existing; ignored.

### 2.d · Lint — 🟢 OK

`apps/web`: `next lint` → `✔ No ESLint warnings or errors` (EXIT=0).
`packages/mnemosyne`: no lint script defined (none added in v1.0); typecheck-only via `tsc`.

### 2.e · Dead / latent code — 🟡 P2

`packages/mnemosyne/src/index.ts` exports:

- `MNEMOSYNE_VERSION = "0.1.0"` — exported but never imported anywhere (`grep -rn "MNEMOSYNE_VERSION" apps packages` only matches the definition).
- `MEMORY_PROTOCOL_V1`, `MEMORY_PROTOCOL_VERSION` — used by `apps/web/lib/agent-runtime.ts:4`. OK.

Modules whose exports are not re-exported through the barrel and have no production consumers:

- `withMnemoTx` (`src/tx.ts`) — only called from tests. No production code uses it. Listed as P2 below.
- `embedMnemo`, `invalidateEmbedding` (`src/recall/embed.ts`) — only test-imported.
- `recallCache`, `invalidateRecallCacheForWorkspace` (`src/recall/cache.ts`) — only test-imported.
- All primitives (`createFact`, `listFacts`, `forgetFact`, `mergeFact`, `markRecalled`, `createDecision`, `listDecisions`, `supersedeDecision`, `withdrawDecision`) — only test-imported.
- All graph helpers (`createRelation`, `judgeRelation`, `dismissRelation`, `listPendingRelations`) — only test-imported.
- `saveDecisionWithCandidates` — only test-imported.
- `createCitation`, `listCitationsForMemory` — only test-imported.
- `resolveModeFromCapabilities`, `detectPII`, `redactPII`, `shouldExtract` — only test-imported.

Mnemosyne v1.0 is essentially a **standalone unit-tested data layer with zero production callers**. Spec §0 says "v0.0-v1.0 scope is the schema + primitive contracts ready for v2.0 product wiring", so this is _expected_ — but it means the audit cannot validate the end-to-end behavior beyond tests, and any wiring bug will only surface when the v1.1+ adapters land.

### 2.f · Index barrel completeness — 🟡 P2

`packages/mnemosyne/src/index.ts` only re-exports `MEMORY_PROTOCOL_V1` + `MEMORY_PROTOCOL_VERSION`. The 30+ other public functions (`createFact`, `createDecision`, `withMnemoTx`, etc.) are not surfaced. External consumers (e.g. apps/web wiring) must import from deep paths (e.g. `@orchester/mnemosyne/primitives/fact`), but the package `exports` map in `packages/mnemosyne/package.json:8` only lists `"."`, `"./schema"`, `"./tools"`. The latter two paths don't exist as files (`src/schema.ts` and `src/tools/index.ts` are absent — `ls packages/mnemosyne/src` shows neither). This is broken. See 5.c.

---

## 3. SPEC COMPLIANCE (vs §0-§39, v0.0-v1.0 scope)

### 3.§2 Four primitives — 🟢 OK (fact + decision), 🟢 OK (entity/episode deferred to v2.0)

`mnemo_fact` and `mnemo_decision` tables exist (migrations 0017, 0018) with all required fields (verified via DB introspection). `mnemo_entity` and `mnemo_episode` do NOT exist (`SELECT to_regclass('mnemo_entity'), to_regclass('mnemo_episode')` returns NULL, NULL) — but the implementation plan §27 explicitly defers them to v2.0 (`packages/mnemosyne/src/primitives/entity.ts` and `episode.ts` are listed under Phase 2 in the planned file structure but not implemented). Confirmed deferred, not missing.

### 3.§2.1 Bitemporal GIST index — 🟡 P2

Spec §2.1 (line 154) requires:

```sql
CREATE INDEX idx_mnemo_fact_valid ON mnemo_fact USING gist (tstzrange(valid_from, valid_to));
```

Live DB has only 6 indexes on `mnemo_fact` (`pkey`, `ws_status`, `ws_scope`, `ws_subject`, `embedding_hnsw`, `fts`, plus the `uniq_dedup`). No GIST/tstzrange index. Bitemporal queries (`WHERE tstzrange(valid_from, valid_to) @> now()`) will seq-scan. Same situation for `mnemo_decision`. P2 because no caller uses bitemporal queries today, but it's silent perf debt.

**Fix**: add a new migration `0026_mnemosyne_bitemporal_indexes.sql`:

```sql
CREATE INDEX idx_mnemo_fact_valid ON mnemo_fact USING gist (tstzrange(valid_from, valid_to));
CREATE INDEX idx_mnemo_decision_valid ON mnemo_decision USING gist (tstzrange(valid_from, valid_to));
CREATE INDEX idx_mnemo_relation_valid ON mnemo_relation USING gist (tstzrange(valid_from, valid_to));
```

### 3.§3 Graph layer + 9 verbs — 🟢 OK

`packages/mnemosyne/src/graph/verbs.ts:14-23` lists exactly `related, compatible, scoped, conflicts_with, supersedes, not_conflict, derived_from, part_of, member_of`. CHECK constraint in `packages/db/migrations/0020_mnemosyne_relation.sql:20-23` matches verbatim. `RELATION_VERB_VERSION = "v1.0.0"`. Drizzle schema (`packages/db/src/schema/mnemosyne.ts:158-170`) matches. Verified.

### 3.§4 Citation with `extractor_prompt_version`, `judge_relation_id` — 🟢 OK

`packages/db/migrations/0021_mnemosyne_citation.sql:14-15` defines both fields; `judge_relation_id` is `REFERENCES mnemo_relation(id) ON DELETE SET NULL`. Drizzle schema (`packages/db/src/schema/mnemosyne.ts:219-221`) mirrors. Verified.

### 3.§5 Hybrid retrieval — 🟠 P1

Spec §5 requires hybrid scoring (semantic + lexical + entity + recency + frequency + pin) over `mnemo_fact`/`mnemo_decision`. The implementation exists ONLY on `brain_fact` in `apps/web/lib/brain/recall.ts`. The mnemosyne package's `src/recall/` contains only `cache.ts` (LRU helper) and `embed.ts` (embedding wrapper) — **no actual recall query implementation against `mnemo_*` tables**. The mnemo equivalent of `searchBrain()` is missing.

**Severity**: P1 spec violation but acceptable for v1.0 (the plan §1.2-§7 only commits to data-layer primitives; recall is part of v1.1+). But the spec section claims §5 is in scope for v1.0, so this is documentation drift, not just deferral.

**Fix options**: (a) port `apps/web/lib/brain/recall.ts` to mnemosyne as `src/recall/search.ts` targeting `mnemo_fact`+`mnemo_decision` (preferred); or (b) explicitly demote §5 to v1.1 in the design spec to remove the drift.

### 3.§7 Candidate-on-write — 🟢 OK

`packages/mnemosyne/src/conflict/candidate.ts:77-145` implements `saveDecisionWithCandidates({...}): Promise<SaveDecisionResult>` returning `{ decision, judgmentRequired, candidates }`. Tested in `tests/integration/candidate-on-write.spec.ts` (3 tests passing). Verified.

### 3.§13 Memory protocol versioned — 🟢 OK

`packages/mnemosyne/src/protocol/v1.ts:7` exports `MEMORY_PROTOCOL_VERSION = "v1.0.0"`. Body locked by `tests/unit/protocol-v1.test.ts`. Verified.

### 3.§17 RBAC actions — 🟡 P2

Spec §17.2 requires `mnemo.read` / `mnemo.write` / `mnemo.admin` actions in `apps/web/lib/rbac.ts`. The file currently has `brain.read` + `brain.write` (lines 36-37, 45, 67, 97-98) but no `mnemo.*` actions. Since no mnemo routes exist yet, this is latent — but the spec was explicit so it counts as a gap.

**Fix**: add to `apps/web/lib/rbac.ts:9-37`:

```ts
| "mnemo.read"
| "mnemo.write"
| "mnemo.admin";
```

and to each role's allowlist (viewer: read; editor: read+write; admin/owner: all). Safe to apply standalone (no consumers yet to break).

### 3.§25 Charter — 🟢 OK

Zero provider/model defaults in `packages/mnemosyne/src/**/*.ts` operational paths. Two comment-only mentions in `apps/web/lib/brain/model-resolve.ts` (acceptable per §25 examples clause). Re-verified via grep in 1.c.

### 3.§26 Cost Tier 1 — 🟢 OK (A1, A2, L1+L2), 🟡 P2 (L3)

- **A1 prefilter**: `packages/mnemosyne/src/extraction/prefilter.ts:104` exports `shouldExtract()`. Tested.
- **A2 ModelAdapter capability detection**: `packages/mnemosyne/src/adapters/types.ts` defines `CallParams` / `CallResult` interfaces with capability hint fields (`cacheableBlocks`, `costCeiling`). Tested in `tests/unit/adapter-types.test.ts`.
- **A7 L1 + L2 cache**: `packages/mnemosyne/src/recall/cache.ts` (L1 query LRU, 60s TTL); `packages/mnemosyne/src/recall/embed.ts` (L2 embedding LRU, 1h TTL). Both tested.
- **A7 L3 (`mnemo_query_cache`)**: table exists (migration 0022) with HNSW index over `query_embedding`, RLS+FORCE Pattern A, but NO code reads or writes it. `grep -rn "mnemo_query_cache" packages/mnemosyne` returns one comment in `recall/cache.ts:6` saying "L3 added in Task 4.3" — but Task 4.3 only created the table, not the code. P2 — the table is dead until a recall implementation lands.

### 3.§32 PII detection — 🟢 OK (code present), 🟡 P2 (not wired)

See 1.g. Code + tests present, not exposed via barrel, no production caller.

### 3.§39 Operational modes (A/B/C) — 🟡 P2

`packages/mnemosyne/src/modes/detect.ts:17` exports `resolveModeFromCapabilities({hasLLM, hasEmbed}) → 'A'|'B'|'C'`. Tested in `tests/unit/modes-detect.test.ts` (4 tests passing). However: `grep -rn "resolveModeFromCapabilities" apps packages` returns only the definition and the test. No production caller. The capability detection helper has no consumer — it's pure dead code until an integration point lands (e.g. wiring in `extract-job.ts` or the future mnemo recall path).

The integration test `tests/integration/mode-a-e2e.spec.ts` proves _the data path_ works without an LLM/embedder (Mode A), but does NOT exercise `resolveModeFromCapabilities` itself.

---

## 4. TEST COVERAGE

### 4.a · `pnpm --filter @orchester/mnemosyne test` — 🟢 OK

```
Test Files  17 passed (17)
     Tests  54 passed (54)
  Duration  8.61s
```

### 4.b · `pnpm --filter @orchester/web test` — 🟠 P1 (flaky)

First run (concurrent suite):

```
Test Files  1 failed | 34 passed | 2 skipped (37)
     Tests  211 passed | 9 skipped (220)
```

Failure: `tests/integration/gdpr/watchdog.spec.ts` — `Hook timed out in 10000ms.`

Re-run in isolation: PASSES in 4.24s (3/3). Flaky under contention; pre-existing testcontainer warmup race, not a Mnemosyne regression. P1 because CI will trip; suggest bumping `hookTimeout` for that one suite from 10s → 30s in `vitest.config.ts` (test-only fix, no production impact).

### 4.c · Skipped tests — 🟢 OK (mnemosyne), 🟡 P2 (apps/web pre-existing)

Mnemosyne: 0 skipped.
apps/web pre-existing skips (not Mnemosyne-introduced):

- `apps/web/tests/unit/tenant/resolve.spec.ts:20,25,31,38,46` — 5 skipped.
- `apps/web/tests/unit/tenant/membership.spec.ts:10` — 1 skipped.
- `apps/web/tests/integration/gdpr/watchdog.spec.ts` — 3 conditionally skipped.

All pre-existing and out of scope for the Mnemosyne audit.

### 4.d · Coverage gaps in mnemosyne

Every source file has at least one test path:

- `tx.ts` → `tests/integration/tx.spec.ts`
- `primitives/fact.ts` → `tests/integration/fact-crud.spec.ts`
- `primitives/decision.ts` → `tests/integration/decision-crud.spec.ts`
- `graph/relation.ts` → `tests/integration/relation-crud.spec.ts`
- `graph/verbs.ts` → `tests/unit/verbs.test.ts`
- `conflict/candidate.ts` → `tests/integration/candidate-on-write.spec.ts`
- `citation/store.ts` → `tests/integration/citation-crud.spec.ts`
- `extraction/prefilter.ts` → `tests/unit/prefilter.test.ts`
- `protocol/v1.ts` → `tests/unit/protocol-v1.test.ts`
- `modes/detect.ts` → `tests/unit/modes-detect.test.ts`
- `pii/detect.ts` → `tests/unit/pii-detect.test.ts`
- `pii/redact.ts` → `tests/unit/pii-redact.test.ts`
- `pii/patterns.ts` → indirectly via the two above.
- `recall/cache.ts` → `tests/unit/recall-cache.test.ts`
- `recall/embed.ts` → `tests/unit/embed.test.ts`
- `adapters/types.ts` → `tests/unit/adapter-types.test.ts`
- `index.ts` → barrel; no direct test (acceptable).

All 17 src files covered. No zero-coverage files.

---

## 5. OPERATIONAL READINESS

### 5.a · Migrations applied vs files — 🟢 OK

Disk files: 0001-0018, 0020-0022, 0024-0025 (missing 0019 + 0023 — intentional gaps from the plan numbering: the plan reserved them for unused features).

Tables present in DB: all expected (`mnemo_fact`, `mnemo_extraction_job`, `mnemo_decision`, `mnemo_relation`, `mnemo_citation`, `mnemo_query_cache` — 6 mnemo\_\* tables matching migrations 0017, 0018, 0020, 0021, 0022). `brain_fact` + `brain_extraction_job` also present (dual-write phase, expected per §21 plan).

No detectable drift between migration files and live schema.

### 5.b · `audit-invariants.sh` — 🟢 OK (now), 🟡 P2 (coverage gap)

Runs green. Does NOT scan `packages/mnemosyne/`. Mnemosyne has zero `llmCall` today, so no current violation, but the script will silently accept a future mnemosyne file that calls `llmCall` without `assertWithinSpend`/`recordAiUsage`.

**Fix**: in `scripts/audit-invariants.sh:32-38`, change `WEB=apps/web` to scan both:

```sh
PATHS="apps/web packages/mnemosyne"
FILES_WITH_LLM=$(grep -rln "llmCall(\\|llmStream(" $PATHS --include='*.ts' \
  | grep -v ".next/standalone" \
  | grep -v "lib/llm-call.ts" || true)
```

Safe to apply standalone.

### 5.c · Uncommitted files — 🟡 P2 (pre-existing)

```
$ git status --short
 M apps/web/tsconfig.tsbuildinfo
```

The file is in `.gitignore` (`*.tsbuildinfo`) but is also `git ls-files`-tracked from before the ignore was added. Now it's perpetually "modified" without being committable cleanly.

**Fix**: `git rm --cached apps/web/tsconfig.tsbuildinfo` in a one-line hygiene commit (does not delete the local file). Pre-existing, not a Mnemosyne regression — but worth a quick cleanup commit.

### 5.d · Build artifacts gitignored — 🟢 OK

`.gitignore` covers `dist/`, `.next/`, `build/`, `*.tsbuildinfo`. Local `packages/mnemosyne/dist/` and `packages/mnemosyne/tsconfig.tsbuildinfo` are present but untracked. Verified.

### 5.e · Package exports map — 🟠 P1

`packages/mnemosyne/package.json:8-11`:

```json
"exports": {
  ".": "./src/index.ts",
  "./schema": "./src/schema.ts",
  "./tools": "./src/tools/index.ts"
}
```

`./src/schema.ts` does NOT exist (`ls packages/mnemosyne/src/` shows no `schema.ts`). `./src/tools/index.ts` does NOT exist either.

Any consumer that does `import {...} from "@orchester/mnemosyne/schema"` or `"@orchester/mnemosyne/tools"` will fail at module resolution. `apps/web/lib/agent-runtime.ts:4` only imports from `"@orchester/mnemosyne"` (the `"."` entry, which resolves to `src/index.ts` and works), so nothing is broken today, but the manifest is lying.

**Fix**: either delete the dead `./schema` + `./tools` entries from `package.json` (recommended for v1.0), or create the corresponding files. Since the package is consumed only via the root barrel, removal is the lowest-risk option.

---

## 6. DOCUMENTATION

### 6.a · Plan checkboxes — 🟢 OK

`grep -cE "^\s*-\s*\[x\]" docs/specs/plans/2026-05-24-mnemosyne-implementation-plan.md` → 169 ticked.
`grep -cE "^\s*-\s*\[ \]" ...` → 15 unticked. Inspection of each unticked entry:

- 5 are pre-flight checklist items (`Repo at ~/dev/orchester`, `pnpm install runs clean`, etc.) — operator setup, not implementation tasks. Acceptable.
- 4 are `**Step N: Push** _(deferred — controller batch-pushes...)_` — intentional per plan execution conventions.
- 6 are post-v1.0 "Verification Checklist (after v1.0 ships)" items — also acceptable (audit-time vs. ship-time concerns).

Sampled 5 ticked tasks (1.2, 1.4, 2.4, 4.2, 7.4) — each maps to a real artifact (migration file, code module, test file). Verified.

### 6.b · Spec ↔ code consistency — 🟢 OK (for 3 sampled)

1. Spec §2.1 `mnemo_fact.kind CHECK ('preference','trait','event','relationship','skill','concern','other')` ↔ migration 0017 line 15 ↔ drizzle `mnemoFacts.kind` enum (schema/mnemosyne.ts:44). All three match.
2. Spec §3 9 verbs ↔ verbs.ts ↔ migration 0020 CHECK ↔ drizzle (schema/mnemosyne.ts:158-170). All four match.
3. Spec §4 citation `extractor_prompt_version` + `judge_relation_id` ↔ migration 0021 lines 14-15 ↔ drizzle `mnemoCitations.extractorPromptVersion, judgeRelationId` (schema/mnemosyne.ts:219-221). All match.

### 6.c · ADR 0020 — 🟡 P2

Spec §23 explicitly mandates the creation of `docs/adr/0020-mnemosyne-memory-architecture.md`. `ls docs/adr/` lists 0001 through 0019 plus the README — **no 0020 file exists**. The Mnemosyne v1.0 work landed without the ADR the spec requires.

**Fix**: write `docs/adr/0020-mnemosyne-memory-architecture.md` covering:

- Decision: build Mnemosyne as `packages/mnemosyne`, supersede Brain Core v1.1.
- Status: Accepted; Date 2026-05-24.
- Rationale, trade-offs, reversibility (§23 enumerates the body).
- Update `docs/adr/README.md` to add row `0020`.

Safe to apply standalone (pure documentation).

---

## 7. KNOWN OUTSTANDING ISSUES (carried from earlier audits / diagnostics)

### 7.a · ADR-0010 documentation drift — 🟡 P2 (linked to P0 1.b)

`docs/adr/0010-rls-force-defense-in-depth.md:19` claims "the application connects as a normal role (`orchester_app`)". No such role exists in the database (`SELECT rolname FROM pg_roles` returns `orchester, app_user, cron_admin, read_only_audit`). Likely an unrelated documentation drift but it directly contradicts the deployed state.

**Fix as part of 1.b's PR**: update ADR-0010 to reference `app_user` (the actual role) AFTER the connection role is changed in the deploy compose. Until then, the ADR is aspirational.

### 7.b · Phase 0 audit follow-ups — 🟢 OK

The Phase 0 provider audit (`2026-05-24-mnemosyne-provider-audit.md`) lists 9 FIX items (FIX-001 through FIX-009). Plan task 1.9 confirms all 9 applied via commit `122a559` + later commits. No remaining BLOCKING items. Verified.

### 7.c · `phase-e-followups.md` — out of scope

`docs/specs/audits/phase-e-followups.md` exists from the prior tenant-hardening track. Not Mnemosyne-related. Skipping.

---

## Top 5 P0/P1 issues (one-line summaries)

1. 🔴 **P0** — Prod `DATABASE_URL` connects as `orchester` SUPERUSER+BYPASSRLS; RLS+FORCE Pattern A is bypassed for the entire app. (§1.b)
2. 🟠 **P1** — `apps/web` GDPR watchdog suite flakes under concurrent run (10s hook timeout); passes in isolation. (§4.b)
3. 🟠 **P1** — Spec §5 hybrid retrieval over `mnemo_*` tables is not implemented; only `brain_fact` recall exists. (§3.§5)
4. 🟠 **P1** — `packages/mnemosyne/package.json` `exports` map references non-existent `./schema` and `./tools` paths. (§5.e)
5. 🟡 **P2** — `audit-invariants.sh` doesn't scan `packages/mnemosyne/`; future LLM calls will skip spend-cap/metering guard silently. (§5.b)

## Total findings by severity

- 🔴 P0: **1** (1.b / 1.i, single root cause)
- 🟠 P1: **3** (4.b watchdog flake, 3.§5 hybrid recall, 5.e package.json exports)
- 🟡 P2: **7** (1.f mnemosyne audit-invariants gap, 1.g PII unwired, 2.e dead code, 2.f barrel incompleteness, 3.§2.1 GIST index, 3.§17 mnemo.\* RBAC, 3.§26 L3 cache unused, 3.§32 PII unwired, 3.§39 mode helper dead, 5.c tsbuildinfo tracked, 5.b audit-invariants gap, 6.c missing ADR 0020, 7.a ADR-0010 drift) — some overlap; counted by unique fix unit.
- 🟢 OK: 14 verified-clean items (RLS schema, provider hardcodes, SQL injection, audit chain wiring for brain, audit-invariants pass, memory protocol injection, typescript strict, `any` usage, silent failures, lint, plan checkboxes, spec/code consistency, migrations applied, 4 primitives presence).

## Recommended ordering

1. P0 §1.b — write a deploy-time PR that switches `DATABASE_URL` to `app_user`, adds a `pg_roles` startup assertion in `packages/db/src/client.ts`, and updates ADR-0010 + creates ADR-0021 to record the change.
2. P1 §5.e — drop dead `exports` entries OR create the files referenced. (5-line change.)
3. P1 §3.§5 — either port the hybrid recall to mnemosyne or demote §5 in the spec. (Pick one; document the choice.)
4. P1 §4.b — bump GDPR watchdog suite `hookTimeout` to 30s.
5. P2 cleanups (§5.b, §3.§17 mnemo.\* RBAC, §6.c ADR 0020, §3.§2.1 GIST indexes, §5.c tsbuildinfo, §1.f audit-invariants gap) — small one-shot PRs each. Standalone-safe.
