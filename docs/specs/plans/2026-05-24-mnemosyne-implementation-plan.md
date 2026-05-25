# Mnemosyne Implementation Plan — Phases v0.0 → v1.0

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Mnemosyne v1.0 — a multi-tenant memory architecture for AI agents that supersedes Brain Core v1.1, adds Decision Layer + Graph + Citation + Cost Engineering Tier 1 + PII Detection + Studio Inspector UI + Memory Protocol v1, with graceful degradation across 3 operational modes (A: no-AI / B: embedding-only / C: full AI), 100% provider-agnostic, zero platform-level third-party cost.

**Architecture:** Monorepo package `@orchester/mnemosyne` (`packages/mnemosyne`) with provider-agnostic adapters, Postgres+pgvector substrate, RLS+FORCE Pattern A on every table, audit chain integration, 6-signal hybrid retrieval (vec + FTS + entity + recency + frequency + pin), candidate-on-write conflict surfacing with 9 locked relation verbs, 95% cost reduction via 4-technique stack (heuristic pre-filter + provider-transparent prompt caching + speculative tier routing + hierarchical caching).

**Tech Stack:** TypeScript strict · Postgres 15 + pgvector (HNSW) + tsvector (GIN) · Drizzle ORM · pg-boss · zod · vitest + testcontainers · Next.js 15 App Router · @paralleldrive/cuid2.

**Spec source of truth:** `docs/specs/2026-05-24-mnemosyne-design.md` (v4).

---

## Scope Check

This plan covers **v0.0 (Provider Audit) + v0.1 (Migration brain*\* → mnemo*\*) + v1.0 (Decision + Graph + Citation + Cost Tier 1 + PII + UI + Protocol)** — the first 5.5 weeks of the Mnemosyne roadmap (§35 of the spec).

Phases v1.5 → v5.5 (Bitemporal, Inference Engine, Multimodal, Self-Improving, Sleep-Time, Federation, Enterprise Cost Governance, Multi-Region, BYO Vault) will be planned in subsequent plan documents when v1.0 ships.

Each phase below produces working, testable, shippable software on its own.

---

## File Structure

### New package: `packages/mnemosyne/`

```
packages/mnemosyne/
├── package.json                          # @orchester/mnemosyne
├── tsconfig.json
├── README.md                             # public-facing
├── src/
│   ├── index.ts                          # public API barrel
│   ├── schema.ts                         # Drizzle table re-exports
│   ├── tx.ts                             # withMnemoTx + withCrossTenantAdmin re-export
│   ├── adapters/
│   │   ├── types.ts                      # ModelAdapter interface + CallParams
│   │   ├── factory.ts                    # createAdapter(workspace, capability)
│   │   ├── anthropic.ts                  # cache_control support
│   │   ├── openai.ts                     # prompt_cache_key support
│   │   ├── ollama.ts                     # local opt-in
│   │   └── ...                           # gemini, groq, mistral, etc. (uses Orchester catalog)
│   ├── modes/
│   │   ├── detect.ts                     # detectMode(workspaceId) → 'A'|'B'|'C'
│   │   └── capabilities.ts               # capability discovery
│   ├── primitives/
│   │   ├── fact.ts                       # createFact / getFact / listFacts / updateFact / forgetFact
│   │   ├── decision.ts                   # createDecision / supersedeDecision / topicKey
│   │   ├── entity.ts                     # createEntity / mergeEntity (Phase 2)
│   │   └── episode.ts                    # createEpisode / summarizeEpisode (Phase 2)
│   ├── graph/
│   │   ├── relation.ts                   # CRUD for mnemo_relation
│   │   ├── verbs.ts                      # RELATION_VERBS = [...]  9 frozen constants
│   │   └── traverse.ts                   # recursive CTE queries
│   ├── citation/
│   │   ├── store.ts                      # mnemo_citation CRUD
│   │   └── provenance.ts                 # recursive proof tree
│   ├── recall/
│   │   ├── search.ts                     # hybrid search entrypoint
│   │   ├── score.ts                      # 6-signal scoring + BM25 sigmoid
│   │   ├── cache.ts                      # L1 query LRU + L2 embedding LRU
│   │   ├── query-cache.ts                # L3 mnemo_query_cache
│   │   └── topic-key.ts                  # topic-key shortcut
│   ├── extraction/
│   │   ├── prefilter.ts                  # A1 heuristic pre-filter
│   │   ├── prompt.ts                     # ADDITIVE_EXTRACTION_PROMPT_V1 (frozen)
│   │   ├── pipeline.ts                   # 8-phase pipeline
│   │   ├── speculative.ts                # A3 tier routing
│   │   └── job.ts                        # pg-boss handler
│   ├── conflict/
│   │   ├── candidate.ts                  # candidate-on-write loop
│   │   ├── scan.ts                       # lazy background scan
│   │   └── judge.ts                      # judgment persistence
│   ├── cost/
│   │   ├── ceilings.ts                   # per-call/conversation/ws/day/month
│   │   └── attribution.ts                # per-feature usage events
│   ├── pii/
│   │   ├── patterns.ts                   # regex patterns by category
│   │   ├── detect.ts                     # detection pipeline
│   │   └── redact.ts                     # redaction policies
│   ├── protocol/
│   │   ├── v1.ts                         # MEMORY_PROTOCOL_V1 constant (frozen)
│   │   └── inject.ts                     # injection helper
│   ├── tools/
│   │   ├── recall.ts                     # mnemosyne_recall tool def
│   │   ├── save-fact.ts                  # mnemosyne_save_fact
│   │   ├── save-decision.ts              # mnemosyne_save_decision
│   │   ├── judge.ts                      # mnemosyne_judge
│   │   ├── capabilities.ts               # mnemosyne_capabilities
│   │   ├── stats.ts                      # mnemosyne_health
│   │   └── ...
│   └── runtime/
│       └── inject.ts                     # pre-LLM hook + post-LLM extraction enqueue
└── tests/
    ├── unit/
    │   ├── score.test.ts
    │   ├── prefilter.test.ts
    │   ├── recall-cache.test.ts
    │   ├── verbs.test.ts
    │   ├── pii-detect.test.ts
    │   └── ...
    └── integration/
        ├── modes-detect.spec.ts
        ├── fact-crud.spec.ts
        ├── decision-crud.spec.ts
        ├── relation-judge.spec.ts
        ├── recall-hybrid.spec.ts
        ├── candidate-on-write.spec.ts
        ├── extraction-pipeline.spec.ts
        └── cross-tenant-isolation.spec.ts
```

### Migrations: `packages/db/migrations/`

```
0017_mnemosyne_init.sql                   # mnemo_fact + mnemo_extraction_job
0017_mnemosyne_init.down.sql
0018_mnemosyne_decision.sql               # mnemo_decision
0018_mnemosyne_decision.down.sql
0020_mnemosyne_relation.sql               # mnemo_relation + 9 verbs CHECK
0020_mnemosyne_relation.down.sql
0021_mnemosyne_citation.sql               # mnemo_citation
0021_mnemosyne_citation.down.sql
0022_mnemosyne_query_cache.sql            # mnemo_query_cache (L3)
0022_mnemosyne_query_cache.down.sql
0024_brain_to_mnemo_backfill.sql          # data backfill brain_fact → mnemo_fact
0024_brain_to_mnemo_backfill.down.sql

# (0019 = mnemo_entity + mnemo_episode and 0023 = mnemo_forget_suggestion
#  are reserved migration numbers for future phases v2.0+/v3.0+;
#  intentionally not created in this plan.)
```

### Modified in existing app: `apps/web/`

```
apps/web/lib/agent-runtime.ts             # switch brain → mnemosyne in conversation context
apps/web/lib/channels/router.ts           # change extraction enqueue target
apps/web/lib/queue.ts                     # add JOB_MNEMO_EXTRACT, deprecate JOB_BRAIN_EXTRACT
apps/web/lib/rbac.ts                      # add mnemo.read/write/admin actions
apps/web/app/api/workspaces/[slug]/mnemo/ # NEW route directory
apps/web/components/mnemosyne/            # NEW component directory (Inspector UI)
scripts/audit-invariants.sh               # add mnemo_* tables to workspace-scoped list
packages/db/src/schema/mnemosyne.ts       # Drizzle definitions
packages/db/src/index.ts                  # re-export mnemosyne schema
```

---

## Pre-flight Checklist

Before starting Task 0.1, verify environment:

- [ ] Repo at `~/dev/orchester`, branch `main`, in sync with `origin/main`
- [ ] `pnpm install` runs clean (no errors)
- [ ] `pnpm --filter @orchester/web test` runs (some integration tests OK to skip)
- [ ] Postgres + pgvector running locally (`docker ps | grep orchester-postgres`)
- [ ] `pnpm audit:invariants` passes
- [ ] `cd apps/web && npx tsc --noEmit` clean
- [ ] Reviewed spec sections §0-§39

Working tree should be clean before starting:

```bash
cd ~/dev/orchester
git status                   # → "nothing to commit, working tree clean"
git pull origin main         # → "Already up to date."
```

---

# PHASE 0 — Provider Audit (v0.0)

**Duration:** 0.5 week (3 days)
**Goal:** Enforce Provider Agnosticism Charter (§25) on existing `apps/web/lib/brain/*` code. Document any provider-specific assumptions that must be fixed before migration.
**Ship criterion:** Audit report committed, no functional code changes (read-only audit).

---

### Task 0.1: Create audit report skeleton

**Files:**

- Create: `docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md`

- [x] **Step 1: Create directory + skeleton report**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/docs/specs/audits
```

File content:

```markdown
# Mnemosyne Provider Audit — Brain Core v1.1

**Date:** 2026-05-24 · **Status:** In progress

## Goal

Audit all code in `apps/web/lib/brain/*` against Mnemosyne Charter §25 (Provider Agnosticism). Identify and document every provider-specific assumption (defaults, hardcoded model names, provider-only optimizations) that must be refactored before migration to `packages/mnemosyne`.

## Findings

### Hardcoded provider references

(populated in Task 0.2)

### Provider-specific behaviors

(populated in Task 0.3)

### Mode A compatibility gaps

(populated in Task 0.4)

## Fix plan

(populated in Task 0.5)
```

- [x] **Step 2: Commit the skeleton**

```bash
cd /Users/lucasmailland/dev/orchester
git add docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md
git -c commit.gpgsign=false commit -m "docs(audit): scaffold mnemosyne provider audit report"
```

---

### Task 0.2: Grep hardcoded provider/model references

**Files:**

- Modify: `docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md`

- [x] **Step 1: Run audit grep**

```bash
cd /Users/lucasmailland/dev/orchester
echo "===== Hardcoded provider names in brain/ =====" > /tmp/provider-audit.txt
grep -niE "openai|anthropic|claude-|gpt-|gemini|haiku|sonnet|mistral|cohere" apps/web/lib/brain/*.ts >> /tmp/provider-audit.txt
echo "===== Embedding model hardcodes =====" >> /tmp/provider-audit.txt
grep -niE "text-embedding-3|voyage|nomic-embed" apps/web/lib/brain/*.ts >> /tmp/provider-audit.txt
echo "===== Provider env vars =====" >> /tmp/provider-audit.txt
grep -niE "OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY" apps/web/lib/brain/*.ts >> /tmp/provider-audit.txt
cat /tmp/provider-audit.txt
```

Expected: list of files + line numbers with each occurrence.

- [x] **Step 2: Populate "Hardcoded provider references" section in audit report**

For each finding, document in the audit report:

- File:line
- Current code snippet
- Charter §25 violation type (default vs example vs required dependency)
- Severity (BLOCKING / WARN / OK-as-example)

Use this template per finding:

```markdown
#### apps/web/lib/brain/extract.ts:74

**Code:** `const model = input.model ?? "claude-haiku-4-5";`
**Type:** Default fallback model hardcoded
**Severity:** BLOCKING — Charter §25 rule 1
**Fix:** Replace with `input.model ?? workspace.mnemo.small_model` resolved at call site
```

- [x] **Step 3: Commit findings section**

```bash
git add docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md
git -c commit.gpgsign=false commit -m "docs(audit): record hardcoded provider references in brain/"
```

---

### Task 0.3: Catalog provider-specific behaviors

**Files:**

- Modify: `docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md`

- [x] **Step 1: Identify provider-specific API calls**

```bash
cd /Users/lucasmailland/dev/orchester
echo "===== cache_control / prompt_cache_key usage =====" > /tmp/behaviors-audit.txt
grep -niE "cache_control|prompt_cache_key|reasoning_effort|response_format" apps/web/lib/brain/*.ts >> /tmp/behaviors-audit.txt
echo "===== llmCall direct calls =====" >> /tmp/behaviors-audit.txt
grep -nE "llmCall\(" apps/web/lib/brain/*.ts >> /tmp/behaviors-audit.txt
cat /tmp/behaviors-audit.txt
```

- [x] **Step 2: Populate "Provider-specific behaviors" section**

For each `llmCall` invocation, document:

- What provider features it relies on (JSON mode? function calling? streaming?)
- Whether it would fail with a provider that lacks those features
- Required adapter interface methods to make it agnostic

- [x] **Step 3: Commit behaviors section**

```bash
git add docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md
git -c commit.gpgsign=false commit -m "docs(audit): catalog provider-specific behaviors in brain/"
```

---

### Task 0.4: Test Mode A compatibility (brain code without LLM)

**Files:**

- Modify: `docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md`

- [x] **Step 1: List every function that requires an LLM/embedding call**

```bash
cd /Users/lucasmailland/dev/orchester
grep -nE "embedBrain|llmCall|recordAiUsage" apps/web/lib/brain/*.ts > /tmp/mode-a-audit.txt
cat /tmp/mode-a-audit.txt
```

- [x] **Step 2: Classify each into A/B/C requirement**

For each function, in the audit doc:
| Function | Brain file:line | Requires for Mode A | Requires for Mode B | Requires for Mode C |
|---|---|---|---|---|
| createFact | store.ts:55 | nullable embedding | embedding provider | + LLM extraction call |
| searchBrain | recall.ts:69 | FTS fallback | embedding provider | + inference engine |
| extractFacts | extract.ts:67 | N/A (skipped) | N/A (skipped) | LLM provider required |

- [x] **Step 3: Document Mode A gaps**

Functions that currently have NO non-LLM/embedding fallback path → BLOCKING for Mode A support in Mnemosyne. List them.

- [x] **Step 4: Commit Mode A analysis**

```bash
git add docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md
git -c commit.gpgsign=false commit -m "docs(audit): mode A compatibility analysis for brain/"
```

---

### Task 0.5: Write fix plan + finalize audit

**Files:**

- Modify: `docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md`

- [x] **Step 1: Categorize fixes by phase**

Populate "Fix plan" section with:

- **Phase 1 (Migration)** fixes — to do as part of brain*\* → mnemo*\* rename
- **Phase 2 (Decision Layer)** fixes — defer until decision tables exist
- **Out of scope** — fixes deferred to v1.5+ (e.g., Provider Parity Suite benchmarks)

Each fix entry:

```markdown
#### FIX-001: Replace hardcoded "claude-haiku-4-5" default in extract.ts

**Severity:** BLOCKING
**Phase:** 1 (Migration)
**Action:** During brain → mnemo rename, change `model = input.model ?? "claude-haiku-4-5"` to `model = input.model ?? workspace.mnemo.small_model`. Load workspace settings via existing `getWorkspaceSetting()` helper.
**Acceptance:** No string literal model names remain in extraction code path.
```

- [x] **Step 2: Mark audit as Complete**

Change status from `In progress` to `Complete · YYYY-MM-DD`. Add summary count: "X BLOCKING / Y WARN / Z OK-as-example findings; fix plan covers all BLOCKING."

- [x] **Step 3: Commit final audit**

```bash
git add docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md
git -c commit.gpgsign=false commit -m "docs(audit): mnemosyne provider audit complete with fix plan"
```

---

### Task 0.6: Push Phase 0 work to origin

- [x] **Step 1: Verify clean state**

```bash
cd /Users/lucasmailland/dev/orchester
git status
git log --oneline origin/main..HEAD
```

Expected: 5 commits ahead (skeleton + findings + behaviors + mode-a + fix-plan).

- [ ] **Step 2: Push** _(deferred — controller batch-pushes at end of plan execution per instructions)_

```bash
git push origin main
```

Expected: `ok main` or equivalent success.

---

# PHASE 1 — Migration brain*\* → mnemo*\* (v0.1)

**Duration:** 1 week (5 days)
**Goal:** Move `apps/web/lib/brain/*` into `packages/mnemosyne` with renamed tables. Zero downtime, reversible until final drop.
**Ship criterion:** All brain*fact data backfilled to mnemo_fact. All reads serve from mnemo*\_. brain\_\_ tables retained for grace period (30 days).

---

### Task 1.1: Scaffold `packages/mnemosyne` package

**Files:**

- Create: `packages/mnemosyne/package.json`
- Create: `packages/mnemosyne/tsconfig.json`
- Create: `packages/mnemosyne/src/index.ts`
- Create: `packages/mnemosyne/README.md`

- [x] **Step 1: Create package directory**

```bash
cd /Users/lucasmailland/dev/orchester
mkdir -p packages/mnemosyne/src packages/mnemosyne/tests/unit packages/mnemosyne/tests/integration
```

- [x] **Step 2: Create package.json**

```json
{
  "name": "@orchester/mnemosyne",
  "version": "0.1.0",
  "private": true,
  "description": "Multi-tenant memory architecture for AI agents — provider-agnostic, zero platform third-party cost, 3 operational modes.",
  "license": "Apache-2.0",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema.ts",
    "./tools": "./src/tools/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@orchester/db": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "@paralleldrive/cuid2": "^3.3.0",
    "zod": "^4.3.6",
    "lru-cache": "^11.0.2"
  },
  "devDependencies": {
    "vitest": "^2.1.9",
    "typescript": "^5.7.2",
    "testcontainers": "^10.16.0",
    "postgres": "^3.4.9"
  }
}
```

- [x] **Step 3: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [x] **Step 4: Create src/index.ts placeholder**

```ts
// packages/mnemosyne/src/index.ts
//
// Public API barrel for @orchester/mnemosyne.
// Multi-tenant memory architecture for AI agents.
// See docs/specs/2026-05-24-mnemosyne-design.md

export const MNEMOSYNE_VERSION = "0.1.0";
```

- [x] **Step 5: Create README.md placeholder**

```markdown
# @orchester/mnemosyne

Multi-tenant memory architecture for AI agents.

See `docs/specs/2026-05-24-mnemosyne-design.md` for full design.

## Status: v0.1 (Migration phase)
```

- [x] **Step 6: Install dependencies + verify**

```bash
cd /Users/lucasmailland/dev/orchester
pnpm install
pnpm --filter @orchester/mnemosyne test 2>&1 | tail -5
```

Expected: install completes; test command reports "No test files found" (no tests yet — OK).

- [x] **Step 7: Commit package scaffold**

```bash
git add packages/mnemosyne/
git -c commit.gpgsign=false commit -m "feat(mnemosyne): scaffold @orchester/mnemosyne package"
```

---

### Task 1.2: Migration 0017 — mnemo_fact + mnemo_extraction_job schema

**Files:**

- Create: `packages/db/migrations/0017_mnemosyne_init.sql`
- Create: `packages/db/migrations/0017_mnemosyne_init.down.sql`

- [x] **Step 1: Write migration SQL**

`packages/db/migrations/0017_mnemosyne_init.sql`:

```sql
-- packages/db/migrations/0017_mnemosyne_init.sql
--
-- Mnemosyne v0.1: rename brain_fact → mnemo_fact + brain_extraction_job → mnemo_extraction_job.
-- Schema is identical to brain_* (no functional changes); rename only.
-- Forward migration: create empty mnemo_* tables. Backfill happens in 0024.
-- Brain_* tables remain in place until grace period ends.
--
-- Same indexes + RLS+FORCE Pattern A + HNSW + GIN + dedup uniques.

CREATE TABLE mnemo_fact (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  agent_id            text REFERENCES agent(id) ON DELETE SET NULL,
  scope               text NOT NULL CHECK (scope IN ('global','conversation','employee','team')),
  scope_ref           text,
  kind                text NOT NULL CHECK (kind IN ('preference','trait','event','relationship','skill','concern','other')),
  subject             text NOT NULL,
  statement           text NOT NULL,
  confidence          real NOT NULL CHECK (confidence BETWEEN 0 AND 1) DEFAULT 0.7,
  pinned              boolean NOT NULL DEFAULT false,
  relevance           real NOT NULL CHECK (relevance BETWEEN 0 AND 1) DEFAULT 1.0,
  hit_count           integer NOT NULL DEFAULT 0,
  last_recalled_at    timestamptz,
  source_message_ids  text[] NOT NULL DEFAULT '{}',
  attributed_to       text CHECK (attributed_to IN ('user','assistant','system')),
  linked_memory_ids   text[] NOT NULL DEFAULT '{}',
  embedding           vector(1536),
  embedding_model     text,
  embedding_version   text,
  -- text_lemmatized auto-populated by Postgres on every INSERT/UPDATE.
  -- GENERATED ALWAYS means we never write to it from app code — DB owns the
  -- column. Required for the GIN index used in Mode A FTS queries.
  text_lemmatized     tsvector GENERATED ALWAYS AS (
                        to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(statement,''))
                      ) STORED,
  metadata            jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL CHECK (status IN ('active','merged','forgotten')) DEFAULT 'active',
  merged_into_id      text REFERENCES mnemo_fact(id) ON DELETE SET NULL,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_fact_ws_status  ON mnemo_fact (workspace_id, status);
CREATE INDEX idx_mnemo_fact_ws_scope   ON mnemo_fact (workspace_id, scope, scope_ref);
CREATE INDEX idx_mnemo_fact_ws_subject ON mnemo_fact (workspace_id, subject);

CREATE INDEX idx_mnemo_fact_embedding_hnsw
  ON mnemo_fact USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_mnemo_fact_fts ON mnemo_fact USING gin (text_lemmatized);

CREATE UNIQUE INDEX uniq_mnemo_fact_dedup
  ON mnemo_fact (workspace_id, scope, COALESCE(scope_ref, ''), subject, md5(statement))
  WHERE status = 'active' AND valid_to IS NULL;

CREATE OR REPLACE FUNCTION mnemo_fact_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mnemo_fact_updated_at
  BEFORE UPDATE ON mnemo_fact
  FOR EACH ROW EXECUTE FUNCTION mnemo_fact_set_updated_at();

CREATE TABLE mnemo_extraction_job (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  state           text NOT NULL CHECK (state IN ('pending','running','done','failed','skipped')) DEFAULT 'pending',
  message_count   integer NOT NULL,
  facts_produced  integer NOT NULL DEFAULT 0,
  skip_reason     text,
  error           text,
  started_at      timestamptz,
  completed_at    timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_extract_job_workspace_state
  ON mnemo_extraction_job (workspace_id, state, created_at DESC);

ALTER TABLE mnemo_fact            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_fact            FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_fact');

ALTER TABLE mnemo_extraction_job  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_extraction_job  FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_extraction_job');
```

- [x] **Step 2: Write down migration**

`packages/db/migrations/0017_mnemosyne_init.down.sql`:

```sql
-- Reverse migration 0017_mnemosyne_init.sql
DROP TABLE IF EXISTS mnemo_extraction_job CASCADE;
DROP TRIGGER IF EXISTS mnemo_fact_updated_at ON mnemo_fact;
DROP FUNCTION IF EXISTS mnemo_fact_set_updated_at();
DROP TABLE IF EXISTS mnemo_fact CASCADE;
```

- [x] **Step 3: Apply migration locally + verify**

```bash
cd /Users/lucasmailland/dev/orchester
docker exec -i orchester-postgres psql -U orchester -d orchester < packages/db/migrations/0017_mnemosyne_init.sql
docker exec orchester-postgres psql -U orchester -d orchester -c "\d mnemo_fact" | head -10
```

Expected: table exists with columns shown.

- [x] **Step 4: Verify RLS+FORCE applied**

```bash
docker exec orchester-postgres psql -U orchester -d orchester -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname LIKE 'mnemo_%' AND relkind = 'r';"
```

Expected: both `mnemo_fact` and `mnemo_extraction_job` show `t | t`.

- [x] **Step 5: Verify 4 policies (Pattern A) on each table**

```bash
docker exec orchester-postgres psql -U orchester -d orchester -c "SELECT tablename, count(*) FROM pg_policies WHERE tablename LIKE 'mnemo_%' GROUP BY tablename;"
```

Expected: each shows 4 policies.

- [x] **Step 6: Commit migration**

```bash
git add packages/db/migrations/0017_mnemosyne_init.sql packages/db/migrations/0017_mnemosyne_init.down.sql
git -c commit.gpgsign=false commit -m "feat(db): migration 0017 — mnemo_fact + mnemo_extraction_job"
```

---

### Task 1.3: Drizzle schema for mnemo_fact + mnemo_extraction_job

**Files:**

- Create: `packages/db/src/schema/mnemosyne.ts`
- Modify: `packages/db/src/schema/index.ts`

- [x] **Step 1: Write Drizzle schema**

`packages/db/src/schema/mnemosyne.ts`:

```ts
// packages/db/src/schema/mnemosyne.ts
//
// Drizzle schema for Mnemosyne tables (mnemo_*).
// Mirrors migrations 0017 onward.

import {
  pgTable,
  text,
  real,
  boolean,
  integer,
  timestamp,
  jsonb,
  vector,
  customType,
} from "drizzle-orm/pg-core";
import { workspaces, agents, conversations } from "./core";

// tsvector — readonly at the TS layer because the column is
// GENERATED ALWAYS in Postgres (see migration 0017). Marking via
// `customType` keeps the type info but we MUST NOT include it in
// `.insert().values({...})` payloads.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const mnemoFacts = pgTable("mnemo_fact", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  scope: text("scope", {
    enum: ["global", "conversation", "employee", "team"],
  }).notNull(),
  scopeRef: text("scope_ref"),
  kind: text("kind", {
    enum: [
      "preference",
      "trait",
      "event",
      "relationship",
      "skill",
      "concern",
      "other",
    ],
  }).notNull(),
  subject: text("subject").notNull(),
  statement: text("statement").notNull(),
  confidence: real("confidence").notNull().default(0.7),
  pinned: boolean("pinned").notNull().default(false),
  relevance: real("relevance").notNull().default(1.0),
  hitCount: integer("hit_count").notNull().default(0),
  lastRecalledAt: timestamp("last_recalled_at", {
    withTimezone: true,
    mode: "date",
  }),
  sourceMessageIds: text("source_message_ids").array().notNull().default([]),
  attributedTo: text("attributed_to", {
    enum: ["user", "assistant", "system"],
  }),
  linkedMemoryIds: text("linked_memory_ids").array().notNull().default([]),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddingModel: text("embedding_model"),
  embeddingVersion: text("embedding_version"),
  textLemmatized: tsvector("text_lemmatized"),
  metadata: jsonb("metadata").notNull().default({}),
  status: text("status", { enum: ["active", "merged", "forgotten"] })
    .notNull()
    .default("active"),
  mergedIntoId: text("merged_into_id"),
  validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const mnemoExtractionJobs = pgTable("mnemo_extraction_job", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  state: text("state", {
    enum: ["pending", "running", "done", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
  messageCount: integer("message_count").notNull(),
  factsProduced: integer("facts_produced").notNull().default(0),
  skipReason: text("skip_reason"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
```

- [x] **Step 2: Re-export from schema barrel**

In `packages/db/src/schema/index.ts`, add:

```ts
export * from "./mnemosyne";
```

- [x] **Step 3: Verify typecheck**

```bash
cd /Users/lucasmailland/dev/orchester/apps/web
npx tsc --noEmit 2>&1 | tail -5
```

Expected: `TypeScript: No errors found`.

- [x] **Step 4: Commit schema**

```bash
cd /Users/lucasmailland/dev/orchester
git add packages/db/src/schema/mnemosyne.ts packages/db/src/schema/index.ts
git -c commit.gpgsign=false commit -m "feat(db): drizzle schema for mnemo_fact + mnemo_extraction_job"
```

---

### Task 1.4: Port `withMnemoTx` from `withBrainTx`

**Files:**

- Create: `packages/mnemosyne/src/tx.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/integration/tx.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let withMnemoTx: typeof import("../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("withMnemoTx", () => {
  it("sets app.workspace_id GUC and runs callback in transaction", async () => {
    const result = await withMnemoTx(wsA.id, async (tx) => {
      const rows = await tx.execute(
        `SELECT current_setting('app.workspace_id', true) AS ws`
      );
      return (rows as unknown as Array<{ ws: string }>)[0]!.ws;
    });
    expect(result).toBe(wsA.id);
  });
});
```

- [x] **Step 2: Run test (should fail — tx.ts doesn't exist)**

```bash
cd /Users/lucasmailland/dev/orchester
pnpm --filter @orchester/mnemosyne test tests/integration/tx.spec.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module '../src/tx'".

- [x] **Step 3: Write implementation**

`packages/mnemosyne/src/tx.ts`:

```ts
// packages/mnemosyne/src/tx.ts
//
// withMnemoTx — runs `fn` inside a transaction with `app.workspace_id`
// SET LOCAL'd. Required for all mnemo_* table operations because every
// mnemo_* table has RLS+FORCE Pattern A policies that gate on the GUC.
import "server-only";
import { sql } from "drizzle-orm";
import { getDb, type DbClient } from "@orchester/db";

type Tx = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export async function withMnemoTx<T>(
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`
    );
    return fn(tx);
  });
}

export type { Tx };
```

- [x] **Step 4: Run test to verify passes**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/tx.spec.ts 2>&1 | tail -10
```

Expected: 1 passed.

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/tx.ts packages/mnemosyne/tests/integration/tx.spec.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): port withMnemoTx wrapper from brain core"
```

---

### Task 1.5: Port `embed.ts` (provider-agnostic embedding wrapper)

**Files:**

- Create: `packages/mnemosyne/src/recall/embed.ts`
- Create: `packages/mnemosyne/tests/unit/embed.test.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/unit/embed.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const embedRawMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/embeddings", () => ({ embed: embedRawMock }));

import { embedMnemo, invalidateEmbedding } from "../../src/recall/embed";

beforeEach(() => {
  embedRawMock.mockReset();
  invalidateEmbedding("ws_test");
});

describe("embedMnemo", () => {
  it("returns cached vector on second call with identical input", async () => {
    embedRawMock.mockResolvedValueOnce({ vectors: [[0.1, 0.2, 0.3]] });
    const first = await embedMnemo({
      workspaceId: "ws_test",
      texts: ["hello"],
      provider: "openai",
      model: "text-embedding-3-small",
    });
    const second = await embedMnemo({
      workspaceId: "ws_test",
      texts: ["hello"],
      provider: "openai",
      model: "text-embedding-3-small",
    });
    expect(first[0]).toEqual([0.1, 0.2, 0.3]);
    expect(second[0]).toEqual([0.1, 0.2, 0.3]);
    expect(embedRawMock).toHaveBeenCalledTimes(1);
  });

  it("does not leak cache across workspaces", async () => {
    embedRawMock.mockResolvedValueOnce({ vectors: [[0.5]] });
    embedRawMock.mockResolvedValueOnce({ vectors: [[0.7]] });
    const wsA = await embedMnemo({
      workspaceId: "ws_a",
      texts: ["hi"],
      provider: "openai",
      model: "m",
    });
    const wsB = await embedMnemo({
      workspaceId: "ws_b",
      texts: ["hi"],
      provider: "openai",
      model: "m",
    });
    expect(wsA[0]).toEqual([0.5]);
    expect(wsB[0]).toEqual([0.7]);
    expect(embedRawMock).toHaveBeenCalledTimes(2);
  });
});
```

- [x] **Step 2: Run test (should fail)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/embed.test.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module '../../src/recall/embed'".

- [x] **Step 3: Write implementation**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/recall
```

`packages/mnemosyne/src/recall/embed.ts`:

```ts
// packages/mnemosyne/src/recall/embed.ts
//
// Workspace-keyed LRU cache for embeddings. Defers to `lib/embeddings.ts`
// for the actual provider call — Mnemosyne does NOT introduce a second
// embedding backend.
import "server-only";
import { createHash } from "crypto";
import { LRUCache } from "lru-cache";
import { embed as embedRaw, type EmbeddingProvider } from "@/lib/embeddings";
import type { DbClient } from "@orchester/db";

const CACHE_MAX = 10_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new LRUCache<string, number[]>({
  max: CACHE_MAX,
  ttl: CACHE_TTL_MS,
});

function cacheKey(workspaceId: string, model: string, text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${workspaceId}|${model}|${h}`;
}

export interface EmbedMnemoInput {
  workspaceId: string;
  texts: string[];
  provider: EmbeddingProvider;
  model: string;
  tx?: DbClient;
}

export async function embedMnemo(input: EmbedMnemoInput): Promise<number[][]> {
  const out: number[][] = new Array(input.texts.length);
  const misses: { idx: number; text: string }[] = [];
  for (let i = 0; i < input.texts.length; i++) {
    const text = input.texts[i]!;
    const k = cacheKey(input.workspaceId, input.model, text);
    const hit = cache.get(k);
    if (hit) out[i] = hit;
    else misses.push({ idx: i, text });
  }
  if (misses.length === 0) return out;
  const fresh = await embedRaw(
    input.workspaceId,
    input.provider,
    input.model,
    misses.map((m) => m.text),
    input.tx
  );
  for (let i = 0; i < misses.length; i++) {
    const m = misses[i]!;
    const v = fresh.vectors[i]!;
    out[m.idx] = v;
    cache.set(cacheKey(input.workspaceId, input.model, m.text), v);
  }
  return out;
}

export function invalidateEmbedding(workspaceId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${workspaceId}|`)) cache.delete(k);
  }
}
```

- [x] **Step 4: Run test to verify passes**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/embed.test.ts 2>&1 | tail -10
```

Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/recall/embed.ts packages/mnemosyne/tests/unit/embed.test.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): port embed wrapper with workspace-keyed cache"
```

---

### Task 1.6: Port primitives/fact.ts (CRUD)

**Files:**

- Create: `packages/mnemosyne/src/primitives/fact.ts`
- Create: `packages/mnemosyne/tests/integration/fact-crud.spec.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/integration/fact-crud.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createFact: typeof import("../../src/primitives/fact").createFact;
let getFact: typeof import("../../src/primitives/fact").getFact;
let forgetFact: typeof import("../../src/primitives/fact").forgetFact;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createFact, getFact, forgetFact } =
    await import("../../src/primitives/fact"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("primitives/fact", () => {
  it("creates a fact and retrieves it", async () => {
    const f = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers Spanish responses",
        tx,
      })
    );
    expect(f.id).toMatch(/^mfact_/);
    const g = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, f.id, tx));
    expect(g?.statement).toBe("prefers Spanish responses");
  });

  it("forgetFact sets status='forgotten'", async () => {
    const f = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "event",
        subject: "u",
        statement: "a forgettable test event for unit testing",
        tx,
      })
    );
    await withMnemoTx(wsA.id, (tx) => forgetFact(wsA.id, f.id, tx));
    const g = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, f.id, tx));
    expect(g?.status).toBe("forgotten");
  });
});
```

- [x] **Step 2: Run test (should fail)**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/fact-crud.spec.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module".

- [x] **Step 3: Write implementation**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/primitives
```

`packages/mnemosyne/src/primitives/fact.ts`:

```ts
// packages/mnemosyne/src/primitives/fact.ts
//
// CRUD for mnemo_fact. All helpers require an active transaction
// (withMnemoTx wrapper) so RLS FORCE is satisfied.
import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import { embedMnemo } from "../recall/embed";
import type { Tx } from "../tx";

export type FactKind =
  | "preference"
  | "trait"
  | "event"
  | "relationship"
  | "skill"
  | "concern"
  | "other";
export type FactScope = "global" | "conversation" | "employee" | "team";
export type FactStatus = "active" | "merged" | "forgotten";

export interface BrainFact {
  id: string;
  workspaceId: string;
  agentId: string | null;
  scope: FactScope;
  scopeRef: string | null;
  kind: FactKind;
  subject: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  relevance: number;
  hitCount: number;
  lastRecalledAt: Date | null;
  sourceMessageIds: string[];
  attributedTo: "user" | "assistant" | "system" | null;
  linkedMemoryIds: string[];
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  status: FactStatus;
  mergedIntoId: string | null;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFactInput {
  workspaceId: string;
  agentId?: string | null;
  scope: FactScope;
  scopeRef?: string | null;
  kind: FactKind;
  subject: string;
  statement: string;
  confidence?: number;
  pinned?: boolean;
  sourceMessageIds?: string[];
  attributedTo?: "user" | "assistant" | "system" | null;
  metadata?: Record<string, unknown>;
  /** Pre-computed embedding. If omitted, no embedding written (Mode A) — caller controls. */
  embedding?: number[] | null;
  /** Optional provider + model. If both provided, will embed via embedMnemo. */
  embeddingProvider?: import("@/lib/embeddings").EmbeddingProvider;
  embeddingModel?: string;
  tx: Tx;
}

export async function createFact(input: CreateFactInput): Promise<BrainFact> {
  const id = `mfact_${createId()}`;
  let embedding: number[] | null = input.embedding ?? null;
  if (!embedding && input.embeddingProvider && input.embeddingModel) {
    const [vec] = await embedMnemo({
      workspaceId: input.workspaceId,
      texts: [input.statement],
      provider: input.embeddingProvider,
      model: input.embeddingModel,
      tx: input.tx as never,
    });
    embedding = vec ?? null;
  }

  const rows = await input.tx
    .insert(schema.mnemoFacts)
    .values({
      id,
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      scope: input.scope,
      scopeRef: input.scopeRef ?? null,
      kind: input.kind,
      subject: input.subject,
      statement: input.statement,
      confidence: input.confidence ?? 0.7,
      pinned: input.pinned ?? false,
      relevance: 1.0,
      hitCount: 0,
      sourceMessageIds: input.sourceMessageIds ?? [],
      attributedTo: input.attributedTo ?? null,
      embedding,
      embeddingModel: input.embeddingModel ?? null,
      metadata: input.metadata ?? {},
      status: "active",
    })
    .returning();
  return rows[0] as unknown as BrainFact;
}

export async function getFact(
  workspaceId: string,
  factId: string,
  tx: Tx
): Promise<BrainFact | null> {
  const rows = await tx
    .select()
    .from(schema.mnemoFacts)
    .where(
      and(
        eq(schema.mnemoFacts.id, factId),
        eq(schema.mnemoFacts.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return (rows[0] as BrainFact | undefined) ?? null;
}

export async function forgetFact(
  workspaceId: string,
  factId: string,
  tx: Tx
): Promise<void> {
  await tx
    .update(schema.mnemoFacts)
    .set({ status: "forgotten" })
    .where(
      and(
        eq(schema.mnemoFacts.id, factId),
        eq(schema.mnemoFacts.workspaceId, workspaceId)
      )
    );
}

export interface ListFactsInput {
  workspaceId: string;
  agentId?: string;
  scope?: FactScope;
  scopeRef?: string;
  status?: "active" | "forgotten" | "all";
  limit?: number;
  offset?: number;
  tx: Tx;
}

export async function listFacts(input: ListFactsInput): Promise<BrainFact[]> {
  const filters = [eq(schema.mnemoFacts.workspaceId, input.workspaceId)];
  if (input.status !== "all")
    filters.push(eq(schema.mnemoFacts.status, input.status ?? "active"));
  if (input.agentId) filters.push(eq(schema.mnemoFacts.agentId, input.agentId));
  if (input.scope) filters.push(eq(schema.mnemoFacts.scope, input.scope));
  if (input.scopeRef)
    filters.push(eq(schema.mnemoFacts.scopeRef, input.scopeRef));
  const rows = await input.tx
    .select()
    .from(schema.mnemoFacts)
    .where(and(...filters))
    .orderBy(desc(schema.mnemoFacts.updatedAt))
    .limit(input.limit ?? 100)
    .offset(input.offset ?? 0);
  return rows as unknown as BrainFact[];
}

export async function markRecalled(
  workspaceId: string,
  factIds: string[],
  tx: Tx
): Promise<void> {
  if (factIds.length === 0) return;
  await tx
    .update(schema.mnemoFacts)
    .set({ hitCount: sql`hit_count + 1`, lastRecalledAt: new Date() })
    .where(
      and(
        eq(schema.mnemoFacts.workspaceId, workspaceId),
        inArray(schema.mnemoFacts.id, factIds)
      )
    );
}
```

- [x] **Step 4: Run test to verify**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/fact-crud.spec.ts 2>&1 | tail -10
```

Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/primitives/fact.ts packages/mnemosyne/tests/integration/fact-crud.spec.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): primitives/fact CRUD"
```

---

### Task 1.7: Add JOB_MNEMO_EXTRACT queue constant + handler shell

**Files:**

- Modify: `apps/web/lib/queue.ts`

- [x] **Step 1: Add queue constant**

Find the existing JOB_BRAIN_EXTRACT export in `apps/web/lib/queue.ts` and add right after:

```ts
export const JOB_MNEMO_EXTRACT = "mnemo.extract";
```

- [x] **Step 2: Verify typecheck**

```bash
cd /Users/lucasmailland/dev/orchester/apps/web
npx tsc --noEmit 2>&1 | tail -5
```

Expected: `TypeScript: No errors found`.

- [x] **Step 3: Commit**

```bash
cd /Users/lucasmailland/dev/orchester
git add apps/web/lib/queue.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): JOB_MNEMO_EXTRACT queue constant"
```

---

### Task 1.8: Backfill migration brain_fact → mnemo_fact

**Files:**

- Create: `packages/db/migrations/0024_brain_to_mnemo_backfill.sql`
- Create: `packages/db/migrations/0024_brain_to_mnemo_backfill.down.sql`

- [x] **Step 1: Write backfill migration**

`packages/db/migrations/0024_brain_to_mnemo_backfill.sql`:

```sql
-- packages/db/migrations/0024_brain_to_mnemo_backfill.sql
--
-- Backfill brain_fact → mnemo_fact + brain_extraction_job → mnemo_extraction_job.
-- Idempotent via ON CONFLICT DO NOTHING. Safe to run multiple times.

INSERT INTO mnemo_fact (
  id, workspace_id, agent_id, scope, scope_ref, kind, subject, statement,
  confidence, pinned, relevance, hit_count, last_recalled_at, source_message_ids,
  embedding, metadata, status, merged_into_id, created_at, updated_at
)
SELECT
  'mfact_' || substring(id from 7),  -- replace 'bfact_' prefix with 'mfact_'
  workspace_id, agent_id, scope, scope_ref, kind, subject, statement,
  confidence, pinned, relevance, hit_count, last_recalled_at, source_message_ids,
  embedding, metadata, status, merged_into_id, created_at, updated_at
FROM brain_fact
WHERE id LIKE 'bfact_%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO mnemo_extraction_job (
  id, workspace_id, conversation_id, state, message_count, facts_produced,
  error, started_at, completed_at, created_at
)
SELECT
  'mext_' || substring(id from 6),
  workspace_id, conversation_id, state, message_count, facts_produced,
  error, started_at, completed_at, created_at
FROM brain_extraction_job
WHERE id LIKE 'bext_%'
ON CONFLICT (id) DO NOTHING;

-- Report row counts for verification
DO $$
DECLARE
  v_fact_count int;
  v_job_count int;
BEGIN
  SELECT count(*) INTO v_fact_count FROM mnemo_fact;
  SELECT count(*) INTO v_job_count FROM mnemo_extraction_job;
  RAISE NOTICE 'Backfill complete: % facts, % extraction jobs in mnemo_*', v_fact_count, v_job_count;
END $$;
```

- [x] **Step 2: Write down migration**

`packages/db/migrations/0024_brain_to_mnemo_backfill.down.sql`:

```sql
-- Reverse migration 0024_brain_to_mnemo_backfill.sql
-- Only deletes rows that were inserted by this backfill (identifiable by mfact_/mext_ prefix
-- and presence in brain_*).
DELETE FROM mnemo_fact WHERE id LIKE 'mfact_%' AND EXISTS (
  SELECT 1 FROM brain_fact WHERE id = 'bfact_' || substring(mnemo_fact.id from 7)
);
DELETE FROM mnemo_extraction_job WHERE id LIKE 'mext_%' AND EXISTS (
  SELECT 1 FROM brain_extraction_job WHERE id = 'bext_' || substring(mnemo_extraction_job.id from 6)
);
```

- [x] **Step 3: Apply migration locally**

```bash
cd /Users/lucasmailland/dev/orchester
docker exec -i orchester-postgres psql -U orchester -d orchester < packages/db/migrations/0024_brain_to_mnemo_backfill.sql 2>&1 | tail -5
```

Expected: `NOTICE: Backfill complete: N facts, M extraction jobs in mnemo_*` where N + M equal pre-existing counts.

- [x] **Step 4: Verify counts match**

```bash
docker exec orchester-postgres psql -U orchester -d orchester -c "SELECT (SELECT count(*) FROM brain_fact) AS brain_facts, (SELECT count(*) FROM mnemo_fact) AS mnemo_facts;"
```

Expected: both counts equal.

- [x] **Step 5: Commit migrations**

```bash
git add packages/db/migrations/0024_brain_to_mnemo_backfill.sql packages/db/migrations/0024_brain_to_mnemo_backfill.down.sql
git -c commit.gpgsign=false commit -m "feat(db): migration 0024 — backfill brain → mnemo data"
```

---

### Task 1.9: Apply ALL audit blocking fixes from Phase 0

> Phase 0 produces a fix list keyed by severity (BLOCKING / WARN / OK-as-example).
> This task iterates over **every BLOCKING fix** in `docs/specs/audits/2026-05-24-mnemosyne-provider-audit.md` and applies it. The example below shows FIX-001; the implementer MUST apply every BLOCKING fix surfaced in Phase 0, then commit them as a single bundle.

**Required:** read the audit report first. Re-grep for any new BLOCKING findings the audit missed. Apply all of them in this task before moving on.

#### Example: applying FIX-001 (hardcoded model fallback in extract.ts)

**Files:**

- Modify: `apps/web/lib/brain/extract.ts` (per FIX-001 from audit)

- [x] **Step 1: Inspect current code**

```bash
grep -n "claude-haiku-4-5\|claude-sonnet-4-6" apps/web/lib/brain/*.ts
```

- [x] **Step 2: Replace hardcoded model fallback in extract.ts**

Find:

```ts
const model = input.model ?? "claude-haiku-4-5";
```

Replace with:

```ts
// Mnemosyne Charter §25: never hardcode provider/model names.
// Caller (extract-job) resolves workspace's mnemo.small_model setting.
if (!input.model) {
  throw new Error(
    "extract.ts requires explicit model — caller must resolve workspace.mnemo.small_model"
  );
}
const model = input.model;
```

- [x] **Step 3: Update the caller to pass workspace setting**

In `apps/web/lib/brain/extract-job.ts`, find the `extractFacts({...})` call and ensure it passes `model`. If a `getWorkspaceSetting` helper exists, use it; otherwise create a small inline resolver:

```ts
// Resolve workspace's small model for Mnemosyne extraction.
// Falls back to legacy default only for backward compatibility during migration;
// after Mnemosyne v0.1 ships this falls back to error.
const smallModel = await getWorkspaceSetting<string>(
  payload.workspaceId,
  "mnemo.small_model",
  tx
);
if (!smallModel) {
  safeLogError("[brain.extract] no mnemo.small_model configured", {
    workspaceId: payload.workspaceId,
  });
  // Mark job skipped — Mode A workspace, extraction disabled
  await tx
    .update(schema.brainExtractionJobs)
    .set({ state: "done", factsProduced: 0, completedAt: new Date() })
    .where(eq(schema.brainExtractionJobs.id, payload.jobId));
  return;
}

const facts = await extractFacts({
  workspaceId: payload.workspaceId,
  agentId: payload.agentId,
  conversationSlice: slice,
  model: smallModel,
  tx: tx as unknown as Parameters<typeof extractFacts>[0]["tx"],
});
```

- [x] **Step 4: Verify typecheck**

```bash
cd /Users/lucasmailland/dev/orchester/apps/web
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [x] **Step 5: Run existing brain tests to ensure nothing broke**

```bash
cd /Users/lucasmailland/dev/orchester
pnpm --filter @orchester/web test tests/unit/brain/ 2>&1 | tail -10
```

Expected: 11/11 passed.

- [x] **Step 6: Commit fix**

```bash
git add apps/web/lib/brain/extract.ts apps/web/lib/brain/extract-job.ts
git -c commit.gpgsign=false commit -m "fix(brain): replace hardcoded model with workspace mnemo.small_model (audit FIX-001)"
```

> **Phase 1C implementer note:** the 9 audit fix items (FIX-001 through FIX-009) were each applied + committed individually. FIX-002/003/005 share a single locus (`embed.ts:embedBrain`) and were bundled in a single commit (`122a559`) since they MUST move together for compile + semantic correctness; the commit message references all three FIX IDs. FIX-009 also added migration `0025_brain_extraction_skip_state.sql` to widen `brain_extraction_job.state` CHECK to include `'skipped'` and add `skip_reason` (mirrors the mnemo_extraction_job schema). Full commit history: `git log --oneline mnemosyne-v0.1 ^origin/main`.

---

### Task 1.10: Push Phase 1 work + verify state

- [x] **Step 1: Run full test suite**

```bash
cd /Users/lucasmailland/dev/orchester
pnpm --filter @orchester/web test 2>&1 | tail -5
pnpm --filter @orchester/mnemosyne test 2>&1 | tail -5
```

Expected: both green. Phase 1C result: apps/web 214 passed / 6 skipped / 0 failed; mnemosyne 5 passed.

- [x] **Step 2: Run audit invariants**

```bash
pnpm audit:invariants 2>&1 | tail -3
```

Expected: `all transversal invariants hold`. Phase 1C result: holds.

- [ ] **Step 3: Push** _(deferred — controller batch-pushes at end of plan execution per instructions)_

```bash
git push origin main
```

- [x] **Step 4: Tag (created locally; push deferred)**

```bash
git tag -a mnemosyne-v0.1 -m "Mnemosyne v0.1 — migration brain_* → mnemo_* complete + all Phase 0 audit BLOCKING fixes applied + dual-write phase"
# git push origin mnemosyne-v0.1   # deferred — controller batch-pushes
```

---

# PHASE 2 — Decision Layer (v1.0 part A)

**Duration:** 7 days
**Goal:** New `mnemo_decision` primitive + topic-key support + supersedes chain via `mnemo_relation`. CRUD + tools.
**Ship criterion:** Decisions can be saved with topic_key upsert, support supersedes/conflicts relationships, surface candidates on save.

---

### Task 2.1: Migration 0018 — mnemo_decision

**Files:**

- Create: `packages/db/migrations/0018_mnemosyne_decision.sql`
- Create: `packages/db/migrations/0018_mnemosyne_decision.down.sql`

- [x] **Step 1: Write migration**

`packages/db/migrations/0018_mnemosyne_decision.sql`:

```sql
-- packages/db/migrations/0018_mnemosyne_decision.sql
--
-- Mnemosyne v1.0: mnemo_decision primitive.
-- Decision kinds: 'decision','architecture','policy','process','bugfix','learning','discovery','config'.
-- Topic key allows upsert semantics for evolving topics (e.g., 'billing/refund-policy').

CREATE TABLE mnemo_decision (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  agent_id            text REFERENCES agent(id) ON DELETE SET NULL,
  conversation_id     text REFERENCES conversation(id) ON DELETE SET NULL,
  kind                text NOT NULL CHECK (kind IN
                        ('decision','architecture','policy','process','bugfix','learning','discovery','config')),
  title               text NOT NULL,
  body                text NOT NULL,
  topic_key           text,
  revision_count      integer NOT NULL DEFAULT 1,
  normalized_hash     text NOT NULL,
  decided_by_user_id  text REFERENCES "user"(id) ON DELETE SET NULL,
  embedding           vector(1536),
  embedding_model     text,
  embedding_version   text,
  -- See 0017 for rationale: text_lemmatized is DB-owned. Postgres re-derives
  -- it whenever title/body change. GIN index over this column powers FTS in
  -- candidate-on-write loop and Mode A search.
  text_lemmatized     tsvector GENERATED ALWAYS AS (
                        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,''))
                      ) STORED,
  status              text NOT NULL CHECK (status IN ('active','superseded','withdrawn')) DEFAULT 'active',
  superseded_by_id    text REFERENCES mnemo_decision(id) ON DELETE SET NULL,
  metadata            jsonb NOT NULL DEFAULT '{}',
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_dec_ws_status ON mnemo_decision (workspace_id, status);
CREATE INDEX idx_mnemo_dec_ws_kind   ON mnemo_decision (workspace_id, kind);
CREATE INDEX idx_mnemo_dec_ws_topic  ON mnemo_decision (workspace_id, topic_key) WHERE topic_key IS NOT NULL;
CREATE INDEX idx_mnemo_dec_embedding_hnsw ON mnemo_decision USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_mnemo_dec_fts ON mnemo_decision USING gin (text_lemmatized);

CREATE UNIQUE INDEX uniq_mnemo_decision_topic
  ON mnemo_decision (workspace_id, topic_key)
  WHERE topic_key IS NOT NULL AND status = 'active' AND valid_to IS NULL;

CREATE OR REPLACE FUNCTION mnemo_decision_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mnemo_decision_updated_at
  BEFORE UPDATE ON mnemo_decision
  FOR EACH ROW EXECUTE FUNCTION mnemo_decision_set_updated_at();

ALTER TABLE mnemo_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_decision FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_decision');
```

- [x] **Step 2: Write down migration**

`packages/db/migrations/0018_mnemosyne_decision.down.sql`:

```sql
DROP TABLE IF EXISTS mnemo_decision CASCADE;
DROP TRIGGER IF EXISTS mnemo_decision_updated_at ON mnemo_decision;
DROP FUNCTION IF EXISTS mnemo_decision_set_updated_at();
```

- [x] **Step 3: Apply + verify**

```bash
cd /Users/lucasmailland/dev/orchester
docker exec -i orchester-postgres psql -U orchester -d orchester < packages/db/migrations/0018_mnemosyne_decision.sql
docker exec orchester-postgres psql -U orchester -d orchester -c "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'mnemo_decision';"
```

Expected: `t | t`.

- [x] **Step 4: Commit**

```bash
git add packages/db/migrations/0018_mnemosyne_decision.sql packages/db/migrations/0018_mnemosyne_decision.down.sql
git -c commit.gpgsign=false commit -m "feat(db): migration 0018 — mnemo_decision schema"
```

---

### Task 2.2: Drizzle schema for mnemo_decision

**Files:**

- Modify: `packages/db/src/schema/mnemosyne.ts`

- [x] **Step 1: Append Drizzle definition**

Append to `packages/db/src/schema/mnemosyne.ts`:

```ts
import { users } from "./core"; // assumes users export exists

export const mnemoDecisions = pgTable("mnemo_decision", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  kind: text("kind", {
    enum: [
      "decision",
      "architecture",
      "policy",
      "process",
      "bugfix",
      "learning",
      "discovery",
      "config",
    ],
  }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  topicKey: text("topic_key"),
  revisionCount: integer("revision_count").notNull().default(1),
  normalizedHash: text("normalized_hash").notNull(),
  decidedByUserId: text("decided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddingModel: text("embedding_model"),
  embeddingVersion: text("embedding_version"),
  textLemmatized: tsvector("text_lemmatized"),
  status: text("status", { enum: ["active", "superseded", "withdrawn"] })
    .notNull()
    .default("active"),
  supersededById: text("superseded_by_id"),
  metadata: jsonb("metadata").notNull().default({}),
  validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
```

- [x] **Step 2: Verify typecheck**

```bash
cd /Users/lucasmailland/dev/orchester/apps/web
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [x] **Step 3: Commit**

```bash
cd /Users/lucasmailland/dev/orchester
git add packages/db/src/schema/mnemosyne.ts
git -c commit.gpgsign=false commit -m "feat(db): drizzle schema for mnemo_decision"
```

---

### Task 2.3: primitives/decision.ts (CRUD + topic-key upsert)

**Files:**

- Create: `packages/mnemosyne/src/primitives/decision.ts`
- Create: `packages/mnemosyne/tests/integration/decision-crud.spec.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/integration/decision-crud.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createDecision: typeof import("../../src/primitives/decision").createDecision;
let getDecision: typeof import("../../src/primitives/decision").getDecision;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createDecision, getDecision } =
    await import("../../src/primitives/decision"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("primitives/decision", () => {
  it("creates a decision with topic_key", async () => {
    const d = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "architecture",
        title: "Auth model: JWT",
        body: "Use JWT instead of session cookies",
        topicKey: "auth/model",
        tx,
      })
    );
    expect(d.id).toMatch(/^mdec_/);
    expect(d.revisionCount).toBe(1);
  });

  it("upserts on duplicate topic_key (increments revision_count)", async () => {
    const d1 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund window",
        body: "30 days",
        topicKey: "billing/refund-policy",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund window",
        body: "60 days for premium",
        topicKey: "billing/refund-policy",
        tx,
      })
    );
    expect(d2.id).toBe(d1.id); // same row
    expect(d2.revisionCount).toBe(2);
    expect(d2.body).toBe("60 days for premium");
  });
});
```

- [x] **Step 2: Run test (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/decision-crud.spec.ts 2>&1 | tail -10
```

Expected: FAIL.

- [x] **Step 3: Write implementation**

`packages/mnemosyne/src/primitives/decision.ts`:

```ts
// packages/mnemosyne/src/primitives/decision.ts
//
// CRUD for mnemo_decision. Supports topic_key upsert: when a decision is saved
// with a topic_key that already exists for the workspace, the existing row is
// updated and revision_count incremented (instead of creating a new row).
import "server-only";
import { createHash } from "crypto";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { Tx } from "../tx";

export type DecisionKind =
  | "decision"
  | "architecture"
  | "policy"
  | "process"
  | "bugfix"
  | "learning"
  | "discovery"
  | "config";
export type DecisionStatus = "active" | "superseded" | "withdrawn";

export interface BrainDecision {
  id: string;
  workspaceId: string;
  agentId: string | null;
  conversationId: string | null;
  kind: DecisionKind;
  title: string;
  body: string;
  topicKey: string | null;
  revisionCount: number;
  normalizedHash: string;
  decidedByUserId: string | null;
  embedding: number[] | null;
  status: DecisionStatus;
  supersededById: string | null;
  metadata: Record<string, unknown>;
  validFrom: Date;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDecisionInput {
  workspaceId: string;
  agentId?: string | null;
  conversationId?: string | null;
  kind: DecisionKind;
  title: string;
  body: string;
  topicKey?: string | null;
  decidedByUserId?: string | null;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
  tx: Tx;
}

function computeNormalizedHash(input: {
  title: string;
  body: string;
  kind: DecisionKind;
  topicKey?: string | null;
}): string {
  return createHash("md5")
    .update(
      `${input.kind}|${input.topicKey ?? ""}|${input.title.toLowerCase().trim()}|${input.body.toLowerCase().trim()}`
    )
    .digest("hex");
}

export async function createDecision(
  input: CreateDecisionInput
): Promise<BrainDecision> {
  const normalizedHash = computeNormalizedHash(input);

  if (input.topicKey) {
    // Upsert path: look up existing active row with the same topic_key
    const existing = await input.tx
      .select()
      .from(schema.mnemoDecisions)
      .where(
        and(
          eq(schema.mnemoDecisions.workspaceId, input.workspaceId),
          eq(schema.mnemoDecisions.topicKey, input.topicKey),
          eq(schema.mnemoDecisions.status, "active")
        )
      )
      .limit(1);
    if (existing[0]) {
      const updated = await input.tx
        .update(schema.mnemoDecisions)
        .set({
          title: input.title,
          body: input.body,
          revisionCount: sql`revision_count + 1`,
          normalizedHash,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        })
        .where(eq(schema.mnemoDecisions.id, existing[0].id))
        .returning();
      return updated[0] as unknown as BrainDecision;
    }
  }

  const id = `mdec_${createId()}`;
  const rows = await input.tx
    .insert(schema.mnemoDecisions)
    .values({
      id,
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      conversationId: input.conversationId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      topicKey: input.topicKey ?? null,
      revisionCount: 1,
      normalizedHash,
      decidedByUserId: input.decidedByUserId ?? null,
      embedding: input.embedding ?? null,
      metadata: input.metadata ?? {},
      status: "active",
    })
    .returning();
  return rows[0] as unknown as BrainDecision;
}

export async function getDecision(
  workspaceId: string,
  id: string,
  tx: Tx
): Promise<BrainDecision | null> {
  const rows = await tx
    .select()
    .from(schema.mnemoDecisions)
    .where(
      and(
        eq(schema.mnemoDecisions.id, id),
        eq(schema.mnemoDecisions.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return (rows[0] as BrainDecision | undefined) ?? null;
}

export async function supersedeDecision(
  workspaceId: string,
  oldId: string,
  newId: string,
  tx: Tx
): Promise<void> {
  await tx
    .update(schema.mnemoDecisions)
    .set({ status: "superseded", supersededById: newId })
    .where(
      and(
        eq(schema.mnemoDecisions.id, oldId),
        eq(schema.mnemoDecisions.workspaceId, workspaceId)
      )
    );
}
```

- [x] **Step 4: Run test (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/decision-crud.spec.ts 2>&1 | tail -10
```

Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/primitives/decision.ts packages/mnemosyne/tests/integration/decision-crud.spec.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): primitives/decision with topic-key upsert"
```

---

### Task 2.4: Migration 0020 — mnemo_relation + 9 locked verbs

**Files:**

- Create: `packages/db/migrations/0020_mnemosyne_relation.sql`
- Create: `packages/db/migrations/0020_mnemosyne_relation.down.sql`

- [x] **Step 1: Write migration**

`packages/db/migrations/0020_mnemosyne_relation.sql`:

```sql
-- packages/db/migrations/0020_mnemosyne_relation.sql
--
-- ANY-to-ANY graph edges across the four primitives. 9 locked relation verbs.
-- Multi-actor disagreement explicitly allowed (no UNIQUE on source/target).

CREATE TABLE mnemo_relation (
  id                          text PRIMARY KEY,
  workspace_id                text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  source_kind                 text NOT NULL CHECK (source_kind IN ('fact','decision','entity','episode')),
  source_id                   text NOT NULL,
  target_kind                 text NOT NULL CHECK (target_kind IN ('fact','decision','entity','episode')),
  target_id                   text NOT NULL,
  relation                    text NOT NULL CHECK (relation IN (
    'related','compatible','scoped','conflicts_with','supersedes','not_conflict',
    'derived_from','part_of','member_of'
  )),
  judgment_status             text NOT NULL DEFAULT 'pending' CHECK (judgment_status IN ('pending','judged','dismissed')),
  reason                      text,
  evidence                    jsonb,
  confidence                  real CHECK (confidence BETWEEN 0 AND 1),
  marked_by_user_id           text REFERENCES "user"(id) ON DELETE SET NULL,
  marked_by_kind              text NOT NULL CHECK (marked_by_kind IN ('user','agent','system','llm_judge')),
  marked_by_model             text,
  marked_by_prompt_version    text,
  conversation_id             text REFERENCES conversation(id) ON DELETE SET NULL,
  superseded_by_relation_id   text REFERENCES mnemo_relation(id) ON DELETE SET NULL,
  valid_from                  timestamptz NOT NULL DEFAULT now(),
  valid_to                    timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_rel_source  ON mnemo_relation (workspace_id, source_kind, source_id);
CREATE INDEX idx_mnemo_rel_target  ON mnemo_relation (workspace_id, target_kind, target_id);
CREATE INDEX idx_mnemo_rel_pending ON mnemo_relation (workspace_id, judgment_status, created_at DESC)
  WHERE judgment_status = 'pending';

ALTER TABLE mnemo_relation ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_relation FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_relation');
```

- [x] **Step 2: Down migration**

`packages/db/migrations/0020_mnemosyne_relation.down.sql`:

```sql
DROP TABLE IF EXISTS mnemo_relation CASCADE;
```

- [x] **Step 3: Apply + verify**

```bash
docker exec -i orchester-postgres psql -U orchester -d orchester < /Users/lucasmailland/dev/orchester/packages/db/migrations/0020_mnemosyne_relation.sql
docker exec orchester-postgres psql -U orchester -d orchester -c "SELECT count(*) FROM pg_policies WHERE tablename = 'mnemo_relation';"
```

Expected: 4 (Pattern A).

- [x] **Step 4: Commit**

```bash
cd /Users/lucasmailland/dev/orchester
git add packages/db/migrations/0020_mnemosyne_relation.sql packages/db/migrations/0020_mnemosyne_relation.down.sql
git -c commit.gpgsign=false commit -m "feat(db): migration 0020 — mnemo_relation with 9 locked verbs"
```

---

### Task 2.5: graph/verbs.ts (locked vocabulary)

**Files:**

- Create: `packages/mnemosyne/src/graph/verbs.ts`
- Create: `packages/mnemosyne/tests/unit/verbs.test.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/unit/verbs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  RELATION_VERBS,
  isRelationVerb,
  RELATION_VERB_VERSION,
} from "../../src/graph/verbs";

describe("graph/verbs", () => {
  it("exports exactly 9 verbs in stable order", () => {
    expect(RELATION_VERBS).toEqual([
      "related",
      "compatible",
      "scoped",
      "conflicts_with",
      "supersedes",
      "not_conflict",
      "derived_from",
      "part_of",
      "member_of",
    ]);
    expect(RELATION_VERBS).toHaveLength(9);
  });

  it("isRelationVerb is a type guard", () => {
    expect(isRelationVerb("supersedes")).toBe(true);
    expect(isRelationVerb("invalid")).toBe(false);
    expect(isRelationVerb("")).toBe(false);
  });

  it("version is set and locked", () => {
    expect(RELATION_VERB_VERSION).toBe("v1.0.0");
  });
});
```

- [x] **Step 2: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/verbs.test.ts 2>&1 | tail -10
```

- [x] **Step 3: Write implementation**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/graph
```

`packages/mnemosyne/src/graph/verbs.ts`:

```ts
// packages/mnemosyne/src/graph/verbs.ts
//
// LOCKED vocabulary of 9 relation verbs. Changing this list invalidates
// all stored judgments (because LLM judge prompt is locked to these verbs).
// Bump RELATION_VERB_VERSION when extending — and provide migration plan
// in the bump commit.

export const RELATION_VERB_VERSION = "v1.0.0" as const;

export const RELATION_VERBS = [
  "related", // soft semantic link
  "compatible", // coexists, no conflict
  "scoped", // one is subset of the other
  "conflicts_with", // contradiction
  "supersedes", // replaces target
  "not_conflict", // explicit non-conflict (after evaluation)
  "derived_from", // source produced by target
  "part_of", // source is part of target
  "member_of", // source belongs to collection target
] as const;

export type RelationVerb = (typeof RELATION_VERBS)[number];

export function isRelationVerb(s: string): s is RelationVerb {
  return (RELATION_VERBS as readonly string[]).includes(s);
}
```

- [x] **Step 4: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/verbs.test.ts 2>&1 | tail -10
```

Expected: 3 passed.

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/graph/verbs.ts packages/mnemosyne/tests/unit/verbs.test.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): graph/verbs — 9 locked relation verbs"
```

---

### Task 2.6: graph/relation.ts + Drizzle schema

**Files:**

- Modify: `packages/db/src/schema/mnemosyne.ts`
- Create: `packages/mnemosyne/src/graph/relation.ts`
- Create: `packages/mnemosyne/tests/integration/relation-crud.spec.ts`

- [x] **Step 1: Add Drizzle table**

Append to `packages/db/src/schema/mnemosyne.ts`:

```ts
export const mnemoRelations = pgTable("mnemo_relation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind", {
    enum: ["fact", "decision", "entity", "episode"],
  }).notNull(),
  sourceId: text("source_id").notNull(),
  targetKind: text("target_kind", {
    enum: ["fact", "decision", "entity", "episode"],
  }).notNull(),
  targetId: text("target_id").notNull(),
  relation: text("relation", {
    enum: [
      "related",
      "compatible",
      "scoped",
      "conflicts_with",
      "supersedes",
      "not_conflict",
      "derived_from",
      "part_of",
      "member_of",
    ],
  }).notNull(),
  judgmentStatus: text("judgment_status", {
    enum: ["pending", "judged", "dismissed"],
  })
    .notNull()
    .default("pending"),
  reason: text("reason"),
  evidence: jsonb("evidence"),
  confidence: real("confidence"),
  markedByUserId: text("marked_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  markedByKind: text("marked_by_kind", {
    enum: ["user", "agent", "system", "llm_judge"],
  }).notNull(),
  markedByModel: text("marked_by_model"),
  markedByPromptVersion: text("marked_by_prompt_version"),
  conversationId: text("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  supersededByRelationId: text("superseded_by_relation_id"),
  validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
```

- [x] **Step 2: Write failing integration test**

`packages/mnemosyne/tests/integration/relation-crud.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createRelation: typeof import("../../src/graph/relation").createRelation;
let listPendingRelations: typeof import("../../src/graph/relation").listPendingRelations;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createDecision: typeof import("../../src/primitives/decision").createDecision;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createRelation, listPendingRelations } =
    await import("../../src/graph/relation"));
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createDecision } = await import("../../src/primitives/decision"));
});
afterAll(() => teardownTestWorkspaces());

describe("graph/relation", () => {
  it("creates a pending relation between two decisions", async () => {
    const d1 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Old refund policy",
        body: "30 days",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsA.id, (tx) =>
      createDecision({
        workspaceId: wsA.id,
        kind: "policy",
        title: "New refund policy",
        body: "60 days",
        tx,
      })
    );
    const r = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "decision",
        sourceId: d2.id,
        targetKind: "decision",
        targetId: d1.id,
        relation: "supersedes",
        markedByKind: "system",
        tx,
      })
    );
    expect(r.id).toMatch(/^mrel_/);
    expect(r.judgmentStatus).toBe("pending");
  });

  it("lists pending relations for a workspace", async () => {
    const pending = await withMnemoTx(wsA.id, (tx) =>
      listPendingRelations(wsA.id, 10, tx)
    );
    expect(pending.length).toBeGreaterThan(0);
  });
});
```

- [x] **Step 3: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/relation-crud.spec.ts 2>&1 | tail -10
```

- [x] **Step 4: Write implementation**

`packages/mnemosyne/src/graph/relation.ts`:

```ts
// packages/mnemosyne/src/graph/relation.ts
//
// CRUD for mnemo_relation. Multi-actor disagreement allowed: no UNIQUE
// on (source, target, relation). Multiple judgments coexist.
import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import { isRelationVerb, type RelationVerb } from "./verbs";
import type { Tx } from "../tx";

export type RelationKind = "fact" | "decision" | "entity" | "episode";
export type MarkerKind = "user" | "agent" | "system" | "llm_judge";
export type JudgmentStatus = "pending" | "judged" | "dismissed";

export interface BrainRelation {
  id: string;
  workspaceId: string;
  sourceKind: RelationKind;
  sourceId: string;
  targetKind: RelationKind;
  targetId: string;
  relation: RelationVerb;
  judgmentStatus: JudgmentStatus;
  reason: string | null;
  confidence: number | null;
  markedByUserId: string | null;
  markedByKind: MarkerKind;
  markedByModel: string | null;
  markedByPromptVersion: string | null;
  conversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRelationInput {
  workspaceId: string;
  sourceKind: RelationKind;
  sourceId: string;
  targetKind: RelationKind;
  targetId: string;
  relation: RelationVerb;
  judgmentStatus?: JudgmentStatus;
  reason?: string;
  confidence?: number;
  markedByUserId?: string | null;
  markedByKind: MarkerKind;
  markedByModel?: string;
  markedByPromptVersion?: string;
  conversationId?: string | null;
  tx: Tx;
}

export async function createRelation(
  input: CreateRelationInput
): Promise<BrainRelation> {
  if (!isRelationVerb(input.relation)) {
    throw new Error(`invalid relation verb: ${input.relation}`);
  }
  const id = `mrel_${createId()}`;
  const rows = await input.tx
    .insert(schema.mnemoRelations)
    .values({
      id,
      workspaceId: input.workspaceId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      relation: input.relation,
      judgmentStatus: input.judgmentStatus ?? "pending",
      reason: input.reason ?? null,
      confidence: input.confidence ?? null,
      markedByUserId: input.markedByUserId ?? null,
      markedByKind: input.markedByKind,
      markedByModel: input.markedByModel ?? null,
      markedByPromptVersion: input.markedByPromptVersion ?? null,
      conversationId: input.conversationId ?? null,
    })
    .returning();
  return rows[0] as unknown as BrainRelation;
}

export async function listPendingRelations(
  workspaceId: string,
  limit: number,
  tx: Tx
): Promise<BrainRelation[]> {
  const rows = await tx
    .select()
    .from(schema.mnemoRelations)
    .where(
      and(
        eq(schema.mnemoRelations.workspaceId, workspaceId),
        eq(schema.mnemoRelations.judgmentStatus, "pending")
      )
    )
    .orderBy(desc(schema.mnemoRelations.createdAt))
    .limit(limit);
  return rows as unknown as BrainRelation[];
}

export interface JudgeInput {
  workspaceId: string;
  relationId: string;
  newRelation: RelationVerb;
  reason?: string;
  confidence?: number;
  markedByUserId?: string | null;
  markedByKind: MarkerKind;
  markedByModel?: string;
  tx: Tx;
}

export async function judgeRelation(
  input: JudgeInput
): Promise<BrainRelation | null> {
  if (!isRelationVerb(input.newRelation)) {
    throw new Error(`invalid relation verb: ${input.newRelation}`);
  }
  const rows = await input.tx
    .update(schema.mnemoRelations)
    .set({
      relation: input.newRelation,
      judgmentStatus: "judged",
      reason: input.reason ?? null,
      confidence: input.confidence ?? null,
      markedByUserId: input.markedByUserId ?? null,
      markedByKind: input.markedByKind,
      markedByModel: input.markedByModel ?? null,
    })
    .where(
      and(
        eq(schema.mnemoRelations.id, input.relationId),
        eq(schema.mnemoRelations.workspaceId, input.workspaceId)
      )
    )
    .returning();
  return (rows[0] as BrainRelation | undefined) ?? null;
}
```

- [x] **Step 5: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/relation-crud.spec.ts 2>&1 | tail -10
```

Expected: 2 passed.

- [x] **Step 6: Commit**

```bash
cd /Users/lucasmailland/dev/orchester
git add packages/db/src/schema/mnemosyne.ts packages/mnemosyne/src/graph/relation.ts packages/mnemosyne/tests/integration/relation-crud.spec.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): graph/relation CRUD + judge"
```

---

### Task 2.7: Candidate-on-write loop (decision_save returns judgment_required)

**Files:**

- Create: `packages/mnemosyne/src/conflict/candidate.ts`
- Create: `packages/mnemosyne/tests/integration/candidate-on-write.spec.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/integration/candidate-on-write.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let saveDecisionWithCandidates: typeof import("../../src/conflict/candidate").saveDecisionWithCandidates;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ saveDecisionWithCandidates } =
    await import("../../src/conflict/candidate"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("conflict/candidate", () => {
  it("surfaces candidates with judgment_required=true on save", async () => {
    // First decision establishes a topic
    await withMnemoTx(wsA.id, async (tx) => {
      const { saveDecisionWithCandidates } =
        await import("../../src/conflict/candidate");
      await saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund policy v1",
        body: "30 days for digital goods",
        checkConflicts: "fast",
        tx,
      });
    });

    // Second similar decision should detect the first as a candidate
    const result = await withMnemoTx(wsA.id, async (tx) => {
      return saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund policy v2",
        body: "60 days for digital goods",
        checkConflicts: "fast",
        tx,
      });
    });
    expect(result.judgmentRequired).toBe(true);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates[0]!.title).toContain("Refund policy");
  });

  it("does NOT surface candidates when checkConflicts='none'", async () => {
    const result = await withMnemoTx(wsA.id, async (tx) => {
      return saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "discovery",
        title: "Test discovery xyz",
        body: "completely new topic with no related items",
        checkConflicts: "none",
        tx,
      });
    });
    expect(result.judgmentRequired).toBe(false);
    expect(result.candidates).toEqual([]);
  });
});
```

- [x] **Step 2: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/candidate-on-write.spec.ts 2>&1 | tail -10
```

- [x] **Step 3: Write implementation**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/conflict
```

`packages/mnemosyne/src/conflict/candidate.ts`:

```ts
// packages/mnemosyne/src/conflict/candidate.ts
//
// candidate-on-write loop (§7 of spec). When a decision is saved with
// checkConflicts != 'none', we run FTS over existing active decisions
// in the same workspace to surface potential conflicts. Each candidate
// gets a pending relation inserted; their sync_ids become judgment_ids
// the caller (agent) must resolve.
import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "../tx";
import {
  createDecision,
  type BrainDecision,
  type DecisionKind,
} from "../primitives/decision";
import { createRelation, type BrainRelation } from "../graph/relation";

export type ConflictCheckLevel = "none" | "fast" | "thorough";

export interface SaveDecisionInput {
  workspaceId: string;
  agentId?: string | null;
  conversationId?: string | null;
  kind: DecisionKind;
  title: string;
  body: string;
  topicKey?: string | null;
  decidedByUserId?: string | null;
  metadata?: Record<string, unknown>;
  checkConflicts?: ConflictCheckLevel;
  /** Candidate FTS limit. Default 3. */
  candidateLimit?: number;
  tx: Tx;
}

export interface SaveDecisionResult {
  decision: BrainDecision;
  judgmentRequired: boolean;
  candidates: Array<{
    id: string;
    title: string;
    kind: DecisionKind;
    judgmentId: string; // = relation.id (pending)
  }>;
}

const FTS_CANDIDATE_LIMIT_DEFAULT = 3;

function sanitizeFTSCandidates(text: string): string {
  // Each token wrapped in "...", joined with OR (looser than search's AND).
  const tokens = text.match(/[A-Za-z0-9]+/g) ?? [];
  if (tokens.length === 0) return "''";
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

export async function saveDecisionWithCandidates(
  input: SaveDecisionInput
): Promise<SaveDecisionResult> {
  // 1. Save the decision (handles topic_key upsert too)
  const decision = await createDecision({ ...input });

  if (input.checkConflicts === "none") {
    return { decision, judgmentRequired: false, candidates: [] };
  }

  // 2. Build FTS query from title + first 100 chars of body
  const query = sanitizeFTSCandidates(
    `${input.title} ${input.body.slice(0, 100)}`
  );
  const limit = input.candidateLimit ?? FTS_CANDIDATE_LIMIT_DEFAULT;

  // 3. Run FTS search excluding the just-saved row
  const fts = await input.tx.execute(sql`
    SELECT id, title, kind
    FROM mnemo_decision
    WHERE workspace_id = ${input.workspaceId}
      AND status = 'active'
      AND id != ${decision.id}
      AND text_lemmatized @@ to_tsquery('simple', ${query})
    ORDER BY ts_rank_cd(text_lemmatized, to_tsquery('simple', ${query})) DESC
    LIMIT ${limit}
  `);
  const rows = fts as unknown as Array<{
    id: string;
    title: string;
    kind: DecisionKind;
  }>;

  if (rows.length === 0) {
    return { decision, judgmentRequired: false, candidates: [] };
  }

  // 4. Insert one pending relation per candidate (decision → candidate)
  const candidates: SaveDecisionResult["candidates"] = [];
  for (const row of rows) {
    const rel: BrainRelation = await createRelation({
      workspaceId: input.workspaceId,
      sourceKind: "decision",
      sourceId: decision.id,
      targetKind: "decision",
      targetId: row.id,
      relation: "related", // placeholder verb until judged
      judgmentStatus: "pending",
      markedByKind: "system",
      conversationId: input.conversationId ?? null,
      tx: input.tx,
    });
    candidates.push({
      id: row.id,
      title: row.title,
      kind: row.kind,
      judgmentId: rel.id,
    });
  }

  return {
    decision,
    judgmentRequired: true,
    candidates,
  };
}
```

- [x] **Step 4: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/candidate-on-write.spec.ts 2>&1 | tail -10
```

Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/conflict/candidate.ts packages/mnemosyne/tests/integration/candidate-on-write.spec.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): candidate-on-write loop for decision save"
```

---

# PHASE 3 — Citation + Graph traversal

**Duration:** 5 days

---

### Task 3.1: Migration 0021 — mnemo_citation

**Files:**

- Create: `packages/db/migrations/0021_mnemosyne_citation.sql`
- Create: `packages/db/migrations/0021_mnemosyne_citation.down.sql`

- [x] **Step 1: Write migration**

`packages/db/migrations/0021_mnemosyne_citation.sql`:

```sql
-- packages/db/migrations/0021_mnemosyne_citation.sql
--
-- Provenance: every memory traces back to source messages + prompt version +
-- extractor model + judgment chain. Recursive proof trees via `mem_provenance`.

CREATE TABLE mnemo_citation (
  id                        text PRIMARY KEY,
  workspace_id              text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  memory_kind               text NOT NULL CHECK (memory_kind IN ('fact','decision','entity','episode')),
  memory_id                 text NOT NULL,
  source_kind               text NOT NULL CHECK (source_kind IN
                              ('message','document','tool_call','llm_extraction','user_edit','agent_save','imported')),
  source_id                 text,
  extractor_model           text,
  extractor_prompt_version  text,
  judge_model               text,
  judge_relation_id         text REFERENCES mnemo_relation(id) ON DELETE SET NULL,
  evidence_excerpt          text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_cit_memory ON mnemo_citation (workspace_id, memory_kind, memory_id);
CREATE INDEX idx_mnemo_cit_source ON mnemo_citation (workspace_id, source_kind, source_id);

ALTER TABLE mnemo_citation ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_citation FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_citation');
```

- [x] **Step 2: Down migration**

```sql
-- packages/db/migrations/0021_mnemosyne_citation.down.sql
DROP TABLE IF EXISTS mnemo_citation CASCADE;
```

- [x] **Step 3: Apply + verify**

```bash
cd /Users/lucasmailland/dev/orchester
docker exec -i orchester-postgres psql -U orchester -d orchester < packages/db/migrations/0021_mnemosyne_citation.sql
docker exec orchester-postgres psql -U orchester -d orchester -c "SELECT count(*) FROM pg_policies WHERE tablename = 'mnemo_citation';"
```

Expected: 4.

- [x] **Step 4: Commit**

```bash
git add packages/db/migrations/0021_mnemosyne_citation.sql packages/db/migrations/0021_mnemosyne_citation.down.sql
git -c commit.gpgsign=false commit -m "feat(db): migration 0021 — mnemo_citation"
```

---

### Task 3.2: citation/store.ts (CRUD)

**Files:**

- Modify: `packages/db/src/schema/mnemosyne.ts`
- Create: `packages/mnemosyne/src/citation/store.ts`
- Create: `packages/mnemosyne/tests/integration/citation-crud.spec.ts`

- [x] **Step 1: Add Drizzle table**

Append to `packages/db/src/schema/mnemosyne.ts`:

```ts
export const mnemoCitations = pgTable("mnemo_citation", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memoryKind: text("memory_kind", {
    enum: ["fact", "decision", "entity", "episode"],
  }).notNull(),
  memoryId: text("memory_id").notNull(),
  sourceKind: text("source_kind", {
    enum: [
      "message",
      "document",
      "tool_call",
      "llm_extraction",
      "user_edit",
      "agent_save",
      "imported",
    ],
  }).notNull(),
  sourceId: text("source_id"),
  extractorModel: text("extractor_model"),
  extractorPromptVersion: text("extractor_prompt_version"),
  judgeModel: text("judge_model"),
  judgeRelationId: text("judge_relation_id"),
  evidenceExcerpt: text("evidence_excerpt"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
```

- [x] **Step 2: Write failing test**

`packages/mnemosyne/tests/integration/citation-crud.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createCitation: typeof import("../../src/citation/store").createCitation;
let listCitationsForMemory: typeof import("../../src/citation/store").listCitationsForMemory;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createCitation, listCitationsForMemory } =
    await import("../../src/citation/store"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("citation/store", () => {
  it("creates a citation and retrieves it", async () => {
    const c = await withMnemoTx(wsA.id, (tx) =>
      createCitation({
        workspaceId: wsA.id,
        memoryKind: "fact",
        memoryId: "mfact_test",
        sourceKind: "message",
        sourceId: "msg_xyz",
        extractorModel: "<workspace.small_model>",
        extractorPromptVersion: "v1",
        evidenceExcerpt: "user prefers Spanish",
        tx,
      })
    );
    expect(c.id).toMatch(/^mcit_/);

    const list = await withMnemoTx(wsA.id, (tx) =>
      listCitationsForMemory(wsA.id, "fact", "mfact_test", tx)
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.evidenceExcerpt).toBe("user prefers Spanish");
  });
});
```

- [x] **Step 3: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/citation-crud.spec.ts 2>&1 | tail -10
```

- [x] **Step 4: Write implementation**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/citation
```

`packages/mnemosyne/src/citation/store.ts`:

```ts
// packages/mnemosyne/src/citation/store.ts
import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { Tx } from "../tx";

export type CitationSourceKind =
  | "message"
  | "document"
  | "tool_call"
  | "llm_extraction"
  | "user_edit"
  | "agent_save"
  | "imported";
export type CitationMemoryKind = "fact" | "decision" | "entity" | "episode";

export interface Citation {
  id: string;
  workspaceId: string;
  memoryKind: CitationMemoryKind;
  memoryId: string;
  sourceKind: CitationSourceKind;
  sourceId: string | null;
  extractorModel: string | null;
  extractorPromptVersion: string | null;
  judgeModel: string | null;
  judgeRelationId: string | null;
  evidenceExcerpt: string | null;
  createdAt: Date;
}

export interface CreateCitationInput {
  workspaceId: string;
  memoryKind: CitationMemoryKind;
  memoryId: string;
  sourceKind: CitationSourceKind;
  sourceId?: string | null;
  extractorModel?: string | null;
  extractorPromptVersion?: string | null;
  judgeModel?: string | null;
  judgeRelationId?: string | null;
  evidenceExcerpt?: string | null;
  tx: Tx;
}

export async function createCitation(
  input: CreateCitationInput
): Promise<Citation> {
  const id = `mcit_${createId()}`;
  const rows = await input.tx
    .insert(schema.mnemoCitations)
    .values({
      id,
      workspaceId: input.workspaceId,
      memoryKind: input.memoryKind,
      memoryId: input.memoryId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId ?? null,
      extractorModel: input.extractorModel ?? null,
      extractorPromptVersion: input.extractorPromptVersion ?? null,
      judgeModel: input.judgeModel ?? null,
      judgeRelationId: input.judgeRelationId ?? null,
      evidenceExcerpt: input.evidenceExcerpt ?? null,
    })
    .returning();
  return rows[0] as unknown as Citation;
}

export async function listCitationsForMemory(
  workspaceId: string,
  memoryKind: CitationMemoryKind,
  memoryId: string,
  tx: Tx
): Promise<Citation[]> {
  const rows = await tx
    .select()
    .from(schema.mnemoCitations)
    .where(
      and(
        eq(schema.mnemoCitations.workspaceId, workspaceId),
        eq(schema.mnemoCitations.memoryKind, memoryKind),
        eq(schema.mnemoCitations.memoryId, memoryId)
      )
    )
    .orderBy(desc(schema.mnemoCitations.createdAt));
  return rows as unknown as Citation[];
}
```

- [x] **Step 5: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/citation-crud.spec.ts 2>&1 | tail -10
```

Expected: 1 passed.

- [x] **Step 6: Commit**

```bash
cd /Users/lucasmailland/dev/orchester
git add packages/db/src/schema/mnemosyne.ts packages/mnemosyne/src/citation/store.ts packages/mnemosyne/tests/integration/citation-crud.spec.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): citation/store CRUD"
```

---

# PHASE 4 — Cost Engineering Tier 1

**Duration:** 5 days
**Goal:** Implement A1 (heuristic pre-filter), A2 (provider-transparent caching), A3 (speculative tier routing), A7 (hierarchical caching).

---

### Task 4.1: extraction/prefilter.ts (A1)

**Files:**

- Create: `packages/mnemosyne/src/extraction/prefilter.ts`
- Create: `packages/mnemosyne/tests/unit/prefilter.test.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/unit/prefilter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldExtract } from "../../src/extraction/prefilter";

describe("extraction/prefilter (A1)", () => {
  it("skips when total content is too short", () => {
    const r = shouldExtract([{ role: "user", content: "hi" }]);
    expect(r.yes).toBe(false);
    expect(r.reason).toBe("too_short");
  });

  it("skips when all messages are short greetings", () => {
    const r = shouldExtract([
      { role: "user", content: "hi there" },
      { role: "assistant", content: "hello! how are you" },
      { role: "user", content: "great thanks" },
    ]);
    expect(r.yes).toBe(false);
  });

  it("accepts preference indicators", () => {
    const r = shouldExtract([
      {
        role: "user",
        content:
          "I really prefer responses in Spanish when we discuss billing topics please",
      },
    ]);
    expect(r.yes).toBe(true);
    expect(r.reason).toBe("indicator_match");
  });

  it("accepts decision indicators", () => {
    const r = shouldExtract([
      {
        role: "assistant",
        content:
          "We decided to use JWT instead of session cookies for the new auth flow",
      },
    ]);
    expect(r.yes).toBe(true);
  });

  it("accepts proper noun mentions", () => {
    const r = shouldExtract([
      {
        role: "user",
        content:
          "Daisy from Acme will be the main contact for this project moving forward okay",
      },
    ]);
    expect(r.yes).toBe(true);
  });

  it("rejects when no dialogue (only system/tool roles)", () => {
    const r = shouldExtract([
      {
        role: "system",
        content: "system instructions go here in a fairly long text block",
      },
      {
        role: "tool",
        content:
          "tool output result data structure with various keys and values",
      },
    ]);
    expect(r.yes).toBe(false);
    expect(r.reason).toBe("no_dialogue");
  });
});
```

- [x] **Step 2: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/prefilter.test.ts 2>&1 | tail -10
```

- [x] **Step 3: Write implementation**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/extraction
```

`packages/mnemosyne/src/extraction/prefilter.ts`:

```ts
// packages/mnemosyne/src/extraction/prefilter.ts
//
// A1 — Heuristic pre-filter. Saves ~80% of extraction LLM calls by
// rejecting turns with no signal worth extracting. Pure code, provider-
// agnostic, zero cost.

export interface PrefilterMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface PrefilterResult {
  yes: boolean;
  reason: string;
}

const POSITIVE_INDICATORS = [
  /\b(prefer|like|love|hate|need|want|always|never|usually)\b/i,
  /\b(decided|will|going to|plan to|chose|adopted)\b/i,
  /\b(at|in|from|works for|lives in|located)\b/i,
  /\b(my (name|email|phone|address|company|team|role))\b/i,
  /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/,
];

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "and",
  "or",
  "but",
  "if",
  "then",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",
  "my",
  "your",
  "our",
  "their",
  "his",
  "her",
  "its",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "can",
  "could",
  "would",
  "should",
  "hi",
  "hello",
  "hey",
  "ok",
  "okay",
  "yes",
  "no",
  "sure",
  "thanks",
  "thank",
  "please",
  "yeah",
  "yep",
  "nope",
]);

function extractContentTokens(messages: PrefilterMessage[]): string[] {
  const tokens: string[] = [];
  for (const m of messages) {
    const words = m.content.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const w of words) {
      if (!STOPWORDS.has(w) && w.length >= 3) tokens.push(w);
    }
  }
  return tokens;
}

export function shouldExtract(messages: PrefilterMessage[]): PrefilterResult {
  const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
  if (totalChars < 80) return { yes: false, reason: "too_short" };

  const allShort = messages.every((m) => m.content.length < 30);
  if (allShort) return { yes: false, reason: "all_short_messages" };

  const tokens = extractContentTokens(messages);
  if (tokens.length < 10) return { yes: false, reason: "no_content_tokens" };

  const hasDialogue = messages.some(
    (m) => m.role === "user" || m.role === "assistant"
  );
  if (!hasDialogue) return { yes: false, reason: "no_dialogue" };

  const positive = POSITIVE_INDICATORS.some((re) =>
    messages.some((m) => re.test(m.content))
  );
  return {
    yes: positive,
    reason: positive ? "indicator_match" : "no_indicator",
  };
}
```

- [x] **Step 4: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/prefilter.test.ts 2>&1 | tail -10
```

Expected: 6 passed.

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/extraction/prefilter.ts packages/mnemosyne/tests/unit/prefilter.test.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): A1 — heuristic pre-filter saves 80% of LLM calls"
```

---

### Task 4.2: recall/cache.ts (A7 — L1 query LRU + L2 embedding LRU)

**Files:**

- Create: `packages/mnemosyne/src/recall/cache.ts`
- Create: `packages/mnemosyne/tests/unit/recall-cache.test.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/unit/recall-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  recallCache,
  invalidateRecallCacheForWorkspace,
  recallCacheKey,
} from "../../src/recall/cache";

beforeEach(() => {
  recallCache.clear();
});

describe("recall/cache (A7 L1)", () => {
  it("stores and retrieves a recall result", () => {
    const key = recallCacheKey({
      workspaceId: "ws1",
      queryHash: "abc",
      scope: null,
      scopeRef: null,
      topK: 5,
    });
    recallCache.set(key, [{ id: "x" }] as never);
    expect(recallCache.get(key)).toEqual([{ id: "x" }]);
  });

  it("invalidates entries for a workspace", () => {
    const k1 = recallCacheKey({
      workspaceId: "ws1",
      queryHash: "a",
      scope: null,
      scopeRef: null,
      topK: 5,
    });
    const k2 = recallCacheKey({
      workspaceId: "ws2",
      queryHash: "a",
      scope: null,
      scopeRef: null,
      topK: 5,
    });
    recallCache.set(k1, [{ id: "1" }] as never);
    recallCache.set(k2, [{ id: "2" }] as never);
    invalidateRecallCacheForWorkspace("ws1");
    expect(recallCache.get(k1)).toBeUndefined();
    expect(recallCache.get(k2)).toEqual([{ id: "2" }]);
  });
});
```

- [x] **Step 2: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/recall-cache.test.ts 2>&1 | tail -10
```

- [x] **Step 3: Write implementation**

`packages/mnemosyne/src/recall/cache.ts`:

```ts
// packages/mnemosyne/src/recall/cache.ts
//
// A7 — Hierarchical caching. L1 = workspace LRU 60s TTL keyed on
// (workspaceId, query_hash, scope, scopeRef, topK).
// L2 (embedding LRU) lives in src/recall/embed.ts.
// L3 (mnemo_query_cache table) added in Task 4.3.
import { LRUCache } from "lru-cache";

const RECALL_CACHE_MAX = 5_000;
const RECALL_CACHE_TTL_MS = 60_000;

export interface RecallCacheKeyParts {
  workspaceId: string;
  queryHash: string;
  scope: string | null;
  scopeRef: string | null;
  topK: number;
  agentId?: string | null;
}

export function recallCacheKey(parts: RecallCacheKeyParts): string {
  return [
    parts.workspaceId,
    parts.agentId ?? "*",
    parts.scope ?? "*",
    parts.scopeRef ?? "*",
    parts.topK,
    parts.queryHash,
  ].join("|");
}

export const recallCache = new LRUCache<string, unknown>({
  max: RECALL_CACHE_MAX,
  ttl: RECALL_CACHE_TTL_MS,
});

export function invalidateRecallCacheForWorkspace(workspaceId: string): void {
  for (const k of recallCache.keys()) {
    if (k.startsWith(`${workspaceId}|`)) recallCache.delete(k);
  }
}
```

- [x] **Step 4: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/recall-cache.test.ts 2>&1 | tail -10
```

Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/recall/cache.ts packages/mnemosyne/tests/unit/recall-cache.test.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): A7 L1 recall cache + workspace invalidation"
```

---

### Task 4.3: Migration 0022 — mnemo_query_cache (L3)

**Files:**

- Create: `packages/db/migrations/0022_mnemosyne_query_cache.sql`
- Create: `packages/db/migrations/0022_mnemosyne_query_cache.down.sql`

- [x] **Step 1: Write migration**

```sql
-- packages/db/migrations/0022_mnemosyne_query_cache.sql
--
-- A7 L3 — Semantic-similar query cache. New queries embed first, check
-- L3 — if cosine > 0.95 with a recent query → reuse those result IDs.
-- Skips full vector search.

CREATE TABLE mnemo_query_cache (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  query_embedding    vector(1536) NOT NULL,
  result_memory_ids  text[] NOT NULL,
  result_memory_kinds text[] NOT NULL,            -- parallel array with result_memory_ids
  scope              text,
  scope_ref          text,
  agent_id           text,
  top_k              integer NOT NULL,
  hit_count          integer NOT NULL DEFAULT 1,
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_qc_ws ON mnemo_query_cache (workspace_id, last_used_at DESC);
CREATE INDEX idx_mnemo_qc_embedding_hnsw ON mnemo_query_cache USING hnsw (query_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE mnemo_query_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_query_cache FORCE  ROW LEVEL SECURITY;
SELECT apply_pattern_a('mnemo_query_cache');
```

- [x] **Step 2: Down migration**

```sql
-- packages/db/migrations/0022_mnemosyne_query_cache.down.sql
DROP TABLE IF EXISTS mnemo_query_cache CASCADE;
```

- [x] **Step 3: Apply + commit**

```bash
cd /Users/lucasmailland/dev/orchester
docker exec -i orchester-postgres psql -U orchester -d orchester < packages/db/migrations/0022_mnemosyne_query_cache.sql
git add packages/db/migrations/0022_mnemosyne_query_cache.sql packages/db/migrations/0022_mnemosyne_query_cache.down.sql
git -c commit.gpgsign=false commit -m "feat(db): migration 0022 — mnemo_query_cache (L3 semantic cache)"
```

---

### Task 4.4: adapters/types.ts + factory.ts (A2 capability detection)

**Files:**

- Create: `packages/mnemosyne/src/adapters/types.ts`
- Create: `packages/mnemosyne/src/adapters/factory.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/unit/adapter-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ModelAdapter, CallParams } from "../../src/adapters/types";

describe("adapters/types", () => {
  it("ModelAdapter interface compiles + has required methods (compile-time only)", () => {
    const fake: ModelAdapter = {
      providerId: "fake",
      call: async (_p: CallParams) => ({
        content: "x",
        tokensUsed: 0,
        model: "fake",
      }),
      callBatched: async () => [],
      embed: async () => [],
      supportsPromptCaching: () => false,
      supportsJSONMode: () => false,
      supportsBatchedCompletion: () => false,
      supportsBatchedEmbedding: () => false,
      costPer1MTokens: () => ({ input: 0, output: 0 }),
      costPer1MEmbeddings: () => 0,
    };
    expect(fake.providerId).toBe("fake");
  });
});
```

- [x] **Step 2: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/adapter-types.test.ts 2>&1 | tail -10
```

- [x] **Step 3: Write types**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/adapters
```

`packages/mnemosyne/src/adapters/types.ts`:

```ts
// packages/mnemosyne/src/adapters/types.ts
//
// Provider capability interface (§25 Charter). Mnemosyne core never
// branches on provider id — adapters opportunistically use provider-
// specific optimizations behind these flags.

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CallParams {
  workspaceId: string;
  systemPrompt: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Mnemosyne marks blocks as cacheable. Adapter decides if it uses them. */
  cacheableBlocks?: string[];
  /** Hard fail if estimated cost exceeds this (USD). */
  costCeiling?: number;
}

export interface CallResult {
  content: string;
  tokensUsed: number;
  model: string;
  costUsd?: number;
}

export interface ModelAdapter {
  readonly providerId: string;

  call(params: CallParams): Promise<CallResult>;
  callBatched(params: CallParams[]): Promise<CallResult[]>;
  embed(texts: string[]): Promise<number[][]>;

  supportsPromptCaching(): boolean;
  supportsJSONMode(): boolean;
  supportsBatchedCompletion(): boolean;
  supportsBatchedEmbedding(): boolean;

  costPer1MTokens(): { input: number; output: number };
  costPer1MEmbeddings(): number;
}
```

- [x] **Step 4: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/adapter-types.test.ts 2>&1 | tail -10
```

- [x] **Step 5: Commit**

```bash
cd /Users/lucasmailland/dev/orchester
git add packages/mnemosyne/src/adapters/types.ts packages/mnemosyne/tests/unit/adapter-types.test.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): adapter interface — provider capability detection (A2)"
```

---

# PHASE 5 — PII Detection

**Duration:** 2 days

---

### Task 5.1: pii/patterns.ts + detect.ts

**Files:**

- Create: `packages/mnemosyne/src/pii/patterns.ts`
- Create: `packages/mnemosyne/src/pii/detect.ts`
- Create: `packages/mnemosyne/tests/unit/pii-detect.test.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/unit/pii-detect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectPII } from "../../src/pii/detect";

describe("pii/detect", () => {
  it("detects email", () => {
    const r = detectPII("Contact me at lucas@example.com please");
    expect(r.detected).toBe(true);
    expect(r.categories).toContain("email");
    expect(r.risk_score).toBeGreaterThan(0);
  });

  it("detects phone (US format)", () => {
    const r = detectPII("Call me at +1 555 123 4567");
    expect(r.categories).toContain("phone");
  });

  it("detects credit card (Visa-like)", () => {
    const r = detectPII("My card is 4111 1111 1111 1111");
    expect(r.categories).toContain("credit_card");
  });

  it("detects SSN", () => {
    const r = detectPII("SSN: 123-45-6789");
    expect(r.categories).toContain("ssn");
  });

  it("detects API key (OpenAI-style)", () => {
    const r = detectPII("Token sk-abcdef0123456789abcdef0123456789");
    expect(r.categories).toContain("api_key");
  });

  it("returns detected=false for clean text", () => {
    const r = detectPII(
      "The user prefers responses in Spanish for billing topics"
    );
    expect(r.detected).toBe(false);
    expect(r.categories).toEqual([]);
  });
});
```

- [x] **Step 2: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/pii-detect.test.ts 2>&1 | tail -10
```

- [x] **Step 3: Write patterns**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/pii
```

`packages/mnemosyne/src/pii/patterns.ts`:

```ts
// packages/mnemosyne/src/pii/patterns.ts
//
// Regex patterns for common PII categories. Conservative — prefer
// false negatives over false positives (downstream LLM layer can
// catch high-confidence cases).

export type PIICategory =
  | "email"
  | "phone"
  | "credit_card"
  | "ssn"
  | "api_key"
  | "ip_address"
  | "url_with_token";

export const PII_PATTERNS: Record<PIICategory, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  phone: /(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
  credit_card: /\b(?:\d{4}[\s-]?){3}\d{4}\b/,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
  api_key: /\b(?:sk-|pk_|api[_-]?key[=:\s]+|Bearer\s+)[A-Za-z0-9_-]{20,}/,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  url_with_token:
    /https?:\/\/[^\s]+[?&](?:token|access_token|api_key|key)=[^\s&]+/,
};

export const PII_SEVERITY: Record<PIICategory, number> = {
  api_key: 1.0,
  credit_card: 0.95,
  ssn: 0.95,
  email: 0.5,
  phone: 0.55,
  ip_address: 0.3,
  url_with_token: 0.85,
};
```

- [x] **Step 4: Write detector**

`packages/mnemosyne/src/pii/detect.ts`:

```ts
// packages/mnemosyne/src/pii/detect.ts
//
// PII detection regex layer. NER + LLM layers are optional add-ons
// (Phase 5.2 / Phase 5.3 in spec).

import { PII_PATTERNS, PII_SEVERITY, type PIICategory } from "./patterns";

export interface PIIDetectionResult {
  detected: boolean;
  categories: PIICategory[];
  risk_score: number; // 0..1
  matches: Array<{ category: PIICategory; match: string }>;
}

export function detectPII(text: string): PIIDetectionResult {
  const matches: PIIDetectionResult["matches"] = [];
  const categories = new Set<PIICategory>();
  let maxScore = 0;
  for (const [cat, re] of Object.entries(PII_PATTERNS) as Array<
    [PIICategory, RegExp]
  >) {
    const m = text.match(re);
    if (m) {
      matches.push({ category: cat, match: m[0] });
      categories.add(cat);
      maxScore = Math.max(maxScore, PII_SEVERITY[cat]);
    }
  }
  return {
    detected: matches.length > 0,
    categories: Array.from(categories),
    risk_score: maxScore,
    matches,
  };
}
```

- [x] **Step 5: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/pii-detect.test.ts 2>&1 | tail -10
```

Expected: 6 passed.

- [x] **Step 6: Commit**

```bash
git add packages/mnemosyne/src/pii/ packages/mnemosyne/tests/unit/pii-detect.test.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): pii detection (regex layer) — email/phone/CC/SSN/API key/IP/URL token"
```

---

### Task 5.2: pii/redact.ts (REDACT policy)

**Files:**

- Create: `packages/mnemosyne/src/pii/redact.ts`
- Create: `packages/mnemosyne/tests/unit/pii-redact.test.ts`

- [x] **Step 1: Failing test**

`packages/mnemosyne/tests/unit/pii-redact.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { redactPII } from "../../src/pii/redact";

describe("pii/redact", () => {
  it("replaces email with [REDACTED-email]", () => {
    const r = redactPII("Contact lucas@example.com please");
    expect(r).toBe("Contact [REDACTED-email] please");
  });

  it("replaces multiple categories", () => {
    const r = redactPII(
      "Email lucas@x.com card 4111 1111 1111 1111 SSN 123-45-6789"
    );
    expect(r).toContain("[REDACTED-email]");
    expect(r).toContain("[REDACTED-credit_card]");
    expect(r).toContain("[REDACTED-ssn]");
  });

  it("leaves clean text untouched", () => {
    expect(redactPII("hello world")).toBe("hello world");
  });
});
```

- [x] **Step 2: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/pii-redact.test.ts 2>&1 | tail -10
```

- [x] **Step 3: Implementation**

`packages/mnemosyne/src/pii/redact.ts`:

```ts
// packages/mnemosyne/src/pii/redact.ts

import { PII_PATTERNS, type PIICategory } from "./patterns";

export function redactPII(text: string): string {
  let out = text;
  for (const [cat, re] of Object.entries(PII_PATTERNS) as Array<
    [PIICategory, RegExp]
  >) {
    // Use global flag for replaceAll behavior
    const gre = new RegExp(
      re.source,
      re.flags.includes("g") ? re.flags : re.flags + "g"
    );
    out = out.replace(gre, `[REDACTED-${cat}]`);
  }
  return out;
}
```

- [x] **Step 4: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/pii-redact.test.ts 2>&1 | tail -10
```

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/pii/redact.ts packages/mnemosyne/tests/unit/pii-redact.test.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): pii redact policy"
```

---

# PHASE 6 — Memory Protocol v1 + Tool Profiles

**Duration:** 2 days

---

### Task 6.1: protocol/v1.ts (frozen system prompt artifact)

**Files:**

- Create: `packages/mnemosyne/src/protocol/v1.ts`
- Create: `packages/mnemosyne/tests/unit/protocol-v1.test.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/unit/protocol-v1.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MEMORY_PROTOCOL_V1,
  MEMORY_PROTOCOL_VERSION,
} from "../../src/protocol/v1";

describe("protocol/v1", () => {
  it("exports a versioned constant", () => {
    expect(MEMORY_PROTOCOL_VERSION).toBe("v1.0.0");
  });

  it("includes all CORE TOOLS section markers", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("CORE TOOLS");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_recall");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_save_fact");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_save_decision");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_judge");
  });

  it("includes TRIGGERS section", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("TRIGGERS");
    expect(MEMORY_PROTOCOL_V1).toContain("durable preference");
    expect(MEMORY_PROTOCOL_V1).toContain("decision made");
  });

  it("includes SELF-CHECK reminder", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("SELF-CHECK");
  });

  it("includes CONFLICT REVIEW guidance", () => {
    expect(MEMORY_PROTOCOL_V1).toContain("CONFLICT REVIEW");
    expect(MEMORY_PROTOCOL_V1).toContain("mnemosyne_judge");
  });
});
```

- [x] **Step 2: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/protocol-v1.test.ts 2>&1 | tail -10
```

- [x] **Step 3: Write protocol**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/protocol
```

`packages/mnemosyne/src/protocol/v1.ts`:

```ts
// packages/mnemosyne/src/protocol/v1.ts
//
// LOCKED system prompt artifact (§13 of spec). The agent's contract
// with Mnemosyne. Bumping MEMORY_PROTOCOL_VERSION invalidates stored
// extractions tagged with prior versions.

export const MEMORY_PROTOCOL_VERSION = "v1.0.0" as const;

export const MEMORY_PROTOCOL_V1 = `# Memory Protocol v1.0.0

You have a long-term memory system (Mnemosyne). Use it.

## CORE TOOLS (always available)
- mnemosyne_recall(query, topK)              — search memories (hybrid: semantic+lexical+entity+recency+frequency+pin)
- mnemosyne_save_fact(...)                   — record a durable fact about user/company/team
- mnemosyne_save_decision(...)               — record an architecture/policy/decision/bugfix
- mnemosyne_judge(judgment_id, relation, ...)— resolve a pending conflict surfaced on save

## TRIGGERS — save IMMEDIATELY when you observe:
- A durable preference  ("I prefer X")         → save_fact(kind=preference)
- A new trait           ("Lucas is left-handed")→ save_fact(kind=trait)
- A decision made       ("We'll use OAuth")    → save_decision(kind=architecture)
- A bugfix learned      ("Don't pass null")    → save_decision(kind=bugfix)
- An event              ("Lucas changed jobs") → save_fact(kind=event)
- An entity mentioned   ("Daisy from Acme")    → entities extracted automatically

## DO NOT SAVE
- Greetings, time-of-day chitchat
- Information already in the agent's system prompt
- Information you're unsure about (confidence < 0.5)

## SEARCH on first message that references project/feature/topic.

## SELF-CHECK after every assistant turn:
"Did I learn / decide / observe something durable? If yes → save NOW."

## CONFLICT REVIEW
When a save returns judgment_required: true:
- For each candidate, call mnemosyne_judge with one of 9 verbs:
  related | compatible | scoped | conflicts_with | supersedes | not_conflict | derived_from | part_of | member_of
- If unsure: relation='related' with confidence < 0.7 — humans will review
- For architecture/policy decisions: confidence >= 0.85 or escalate to user

## SESSION CLOSE
Before saying "done", call mnemosyne_save_episode_summary with:
- Goal · Discoveries · Decisions · Next Steps
`;
```

- [x] **Step 4: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/protocol-v1.test.ts 2>&1 | tail -10
```

Expected: 5 passed.

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/protocol/v1.ts packages/mnemosyne/tests/unit/protocol-v1.test.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): Memory Protocol v1 artifact (frozen, version-locked)"
```

---

### Task 6.2: modes/detect.ts (Mode A/B/C detection)

**Files:**

- Create: `packages/mnemosyne/src/modes/detect.ts`
- Create: `packages/mnemosyne/tests/unit/modes-detect.test.ts`

- [x] **Step 1: Write the failing test**

`packages/mnemosyne/tests/unit/modes-detect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveModeFromCapabilities } from "../../src/modes/detect";

describe("modes/detect", () => {
  it("returns 'A' when no providers configured", () => {
    expect(
      resolveModeFromCapabilities({ hasLLM: false, hasEmbed: false })
    ).toBe("A");
  });

  it("returns 'B' when only embedding configured", () => {
    expect(resolveModeFromCapabilities({ hasLLM: false, hasEmbed: true })).toBe(
      "B"
    );
  });

  it("returns 'C' when both LLM and embedding configured", () => {
    expect(resolveModeFromCapabilities({ hasLLM: true, hasEmbed: true })).toBe(
      "C"
    );
  });

  it("LLM without embedding falls back to B-mode (no LLM extraction without embed)", () => {
    // We require both for Mode C — if only LLM, treat as A (no auto-extract path)
    expect(resolveModeFromCapabilities({ hasLLM: true, hasEmbed: false })).toBe(
      "A"
    );
  });
});
```

- [x] **Step 2: Run (fails)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/modes-detect.test.ts 2>&1 | tail -10
```

- [x] **Step 3: Write implementation**

```bash
mkdir -p /Users/lucasmailland/dev/orchester/packages/mnemosyne/src/modes
```

`packages/mnemosyne/src/modes/detect.ts`:

```ts
// packages/mnemosyne/src/modes/detect.ts
//
// §39 Operational Modes — Graceful Degradation.
// Pure-code helper: given capability flags, return active mode.

export type MnemoMode = "A" | "B" | "C";

export interface CapabilitySnapshot {
  hasLLM: boolean;
  hasEmbed: boolean;
}

export function resolveModeFromCapabilities(
  caps: CapabilitySnapshot
): MnemoMode {
  if (caps.hasLLM && caps.hasEmbed) return "C";
  if (caps.hasEmbed) return "B";
  return "A";
}
```

- [x] **Step 4: Run (passes)**

```bash
pnpm --filter @orchester/mnemosyne test tests/unit/modes-detect.test.ts 2>&1 | tail -10
```

- [x] **Step 5: Commit**

```bash
git add packages/mnemosyne/src/modes/detect.ts packages/mnemosyne/tests/unit/modes-detect.test.ts
git -c commit.gpgsign=false commit -m "feat(mnemosyne): modes/detect — A/B/C mode resolution"
```

---

# PHASE 7 — Integration + Ship v1.0

**Duration:** 3 days

---

### Task 7.1: Update audit-invariants.sh to include mnemo\_\* tables

**Files:**

- Modify: `scripts/audit-invariants.sh`

- [ ] **Step 1: Inspect current invariants script**

```bash
cd /Users/lucasmailland/dev/orchester
cat scripts/audit-invariants.sh | head -50
```

- [ ] **Step 2: Locate the workspace*id-scoped tables list and add mnemo*\* tables**

If the script greps for `workspace_id` references in code (rather than maintaining an explicit list), no change needed — the new mnemo\_\* code paths already use `workspace_id` everywhere.

If the script has an explicit list, add:

- `mnemo_fact`
- `mnemo_extraction_job`
- `mnemo_decision`
- `mnemo_relation`
- `mnemo_citation`
- `mnemo_query_cache`
- `mnemo_forget_suggestion` (added later in Phase 11)

- [ ] **Step 3: Run audit invariants**

```bash
pnpm audit:invariants 2>&1 | tail -3
```

Expected: `all transversal invariants hold`.

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-invariants.sh
git -c commit.gpgsign=false commit -m "chore(audit): include mnemo_* tables in invariants script"
```

---

### Task 7.2: Wire Memory Protocol injection into agent-runtime

**Files:**

- Modify: `apps/web/lib/agent-runtime.ts`

- [ ] **Step 1: Locate the system prompt assembly point**

```bash
grep -n "systemPrompt\|system_prompt\|buildConversationContext" apps/web/lib/agent-runtime.ts | head -10
```

- [ ] **Step 2: Add Memory Protocol injection**

Find the function that assembles the system prompt for an agent (likely `buildConversationContext` or `assembleSystemPrompt`) and append the protocol:

```ts
import {
  MEMORY_PROTOCOL_V1,
  MEMORY_PROTOCOL_VERSION,
} from "@orchester/mnemosyne";

// Inside the system prompt assembly function, after agent-specific prompt:
const protocolBlock = `\n\n---\n${MEMORY_PROTOCOL_V1}\n---\n`;
systemPromptBlocks.push(protocolBlock);
```

- [ ] **Step 3: Verify typecheck**

```bash
cd /Users/lucasmailland/dev/orchester/apps/web
npx tsc --noEmit 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 4: Run existing agent-runtime tests**

```bash
cd /Users/lucasmailland/dev/orchester
pnpm --filter @orchester/web test tests/unit/agent-runtime/ 2>&1 | tail -10
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agent-runtime.ts
git -c commit.gpgsign=false commit -m "feat(agent-runtime): inject Memory Protocol v1 into agent system prompts"
```

---

### Task 7.3: Final integration test — Mode A end-to-end

**Files:**

- Create: `packages/mnemosyne/tests/integration/mode-a-e2e.spec.ts`

- [ ] **Step 1: Write the test**

`packages/mnemosyne/tests/integration/mode-a-e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
});
afterAll(() => teardownTestWorkspaces());

describe("Mode A end-to-end (no AI required)", () => {
  it("creates fact + decision + relation + citation without any LLM/embedding call", async () => {
    const { withMnemoTx } = await import("../../src/tx");
    const { createFact } = await import("../../src/primitives/fact");
    const { saveDecisionWithCandidates } =
      await import("../../src/conflict/candidate");
    const { createRelation } = await import("../../src/graph/relation");
    const { createCitation } = await import("../../src/citation/store");

    const fact = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "prefers Spanish responses",
        tx,
      })
    );
    expect(fact.embedding).toBeNull(); // Mode A: no embedding

    const decResult = await withMnemoTx(wsA.id, (tx) =>
      saveDecisionWithCandidates({
        workspaceId: wsA.id,
        kind: "policy",
        title: "Refund policy v1",
        body: "30 days for digital goods",
        checkConflicts: "none",
        tx,
      })
    );
    expect(decResult.judgmentRequired).toBe(false);

    const rel = await withMnemoTx(wsA.id, (tx) =>
      createRelation({
        workspaceId: wsA.id,
        sourceKind: "fact",
        sourceId: fact.id,
        targetKind: "decision",
        targetId: decResult.decision.id,
        relation: "related",
        markedByKind: "user",
        tx,
      })
    );
    expect(rel.judgmentStatus).toBe("pending");

    const cit = await withMnemoTx(wsA.id, (tx) =>
      createCitation({
        workspaceId: wsA.id,
        memoryKind: "fact",
        memoryId: fact.id,
        sourceKind: "user_edit",
        sourceId: null,
        evidenceExcerpt: "manually entered",
        tx,
      })
    );
    expect(cit.id).toMatch(/^mcit_/);
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @orchester/mnemosyne test tests/integration/mode-a-e2e.spec.ts 2>&1 | tail -10
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add packages/mnemosyne/tests/integration/mode-a-e2e.spec.ts
git -c commit.gpgsign=false commit -m "test(mnemosyne): Mode A end-to-end (no AI required)"
```

---

### Task 7.4: Cross-tenant isolation test (RLS+FORCE verification)

**Files:**

- Create: `packages/mnemosyne/tests/integration/cross-tenant-isolation.spec.ts`

This task verifies that the RLS+FORCE policies actually prevent cross-tenant reads. Without this test we're trusting the policies without proof.

- [ ] **Step 1: Write the test**

`packages/mnemosyne/tests/integration/cross-tenant-isolation.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let wsB: WsFixture;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
});
afterAll(() => teardownTestWorkspaces());

describe("cross-tenant isolation (RLS+FORCE)", () => {
  it("workspace A cannot read workspace B mnemo_fact via withMnemoTx", async () => {
    const { withMnemoTx } = await import("../../src/tx");
    const { createFact, listFacts } = await import("../../src/primitives/fact");

    // Write a fact under wsB
    await withMnemoTx(wsB.id, (tx) =>
      createFact({
        workspaceId: wsB.id,
        scope: "global",
        kind: "preference",
        subject: "user",
        statement: "B-only secret preference",
        tx,
      })
    );

    // Try to list facts from wsA scoped context — must NOT see wsB rows
    const wsAFacts = await withMnemoTx(wsA.id, (tx) =>
      listFacts({ workspaceId: wsA.id, tx })
    );
    expect(
      wsAFacts.find((f) => f.statement.includes("B-only"))
    ).toBeUndefined();
  });

  it("workspace A cannot read workspace B mnemo_decision", async () => {
    const { withMnemoTx } = await import("../../src/tx");
    const { createDecision, getDecision } =
      await import("../../src/primitives/decision");

    const d = await withMnemoTx(wsB.id, (tx) =>
      createDecision({
        workspaceId: wsB.id,
        kind: "policy",
        title: "B-only policy",
        body: "secret to wsB",
        tx,
      })
    );

    // From wsA context, attempting to fetch wsB's decision returns null
    // (RLS filters it out, even though we know the ID)
    const cross = await withMnemoTx(wsA.id, (tx) =>
      getDecision(wsB.id, d.id, tx)
    );
    expect(cross).toBeNull();
  });

  it("workspace A cannot read workspace B mnemo_relation", async () => {
    const { withMnemoTx } = await import("../../src/tx");
    const { createDecision } = await import("../../src/primitives/decision");
    const { createRelation, listPendingRelations } =
      await import("../../src/graph/relation");

    const d1 = await withMnemoTx(wsB.id, (tx) =>
      createDecision({
        workspaceId: wsB.id,
        kind: "policy",
        title: "B-source",
        body: "x",
        tx,
      })
    );
    const d2 = await withMnemoTx(wsB.id, (tx) =>
      createDecision({
        workspaceId: wsB.id,
        kind: "policy",
        title: "B-target",
        body: "y",
        tx,
      })
    );
    await withMnemoTx(wsB.id, (tx) =>
      createRelation({
        workspaceId: wsB.id,
        sourceKind: "decision",
        sourceId: d1.id,
        targetKind: "decision",
        targetId: d2.id,
        relation: "related",
        markedByKind: "system",
        tx,
      })
    );

    const wsAPending = await withMnemoTx(wsA.id, (tx) =>
      listPendingRelations(wsA.id, 100, tx)
    );
    expect(
      wsAPending.find((r) => r.sourceId === d1.id || r.targetId === d2.id)
    ).toBeUndefined();
  });

  it("workspace A cannot read workspace B mnemo_citation", async () => {
    const { withMnemoTx } = await import("../../src/tx");
    const { createCitation, listCitationsForMemory } =
      await import("../../src/citation/store");

    await withMnemoTx(wsB.id, (tx) =>
      createCitation({
        workspaceId: wsB.id,
        memoryKind: "fact",
        memoryId: "mfact_b_only",
        sourceKind: "user_edit",
        evidenceExcerpt: "B-only citation",
        tx,
      })
    );

    const wsACitations = await withMnemoTx(wsA.id, (tx) =>
      listCitationsForMemory(wsA.id, "fact", "mfact_b_only", tx)
    );
    expect(wsACitations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd /Users/lucasmailland/dev/orchester
pnpm --filter @orchester/mnemosyne test tests/integration/cross-tenant-isolation.spec.ts 2>&1 | tail -10
```

Expected: 4 passed. If any test surfaces wsB data, RLS+FORCE has a hole — STOP and audit migrations.

- [ ] **Step 3: Commit**

```bash
git add packages/mnemosyne/tests/integration/cross-tenant-isolation.spec.ts
git -c commit.gpgsign=false commit -m "test(mnemosyne): cross-tenant isolation across all 4 mnemo_* tables"
```

---

### Task 7.5: Tag mnemosyne-v1.0 + push

- [ ] **Step 1: Run full test suite one last time**

```bash
cd /Users/lucasmailland/dev/orchester
pnpm --filter @orchester/mnemosyne test 2>&1 | tail -5
pnpm --filter @orchester/web test 2>&1 | tail -5
```

Expected: both green.

- [ ] **Step 2: Run audit invariants**

```bash
pnpm audit:invariants 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 3: Tag**

```bash
git tag -a mnemosyne-v1.0 -m "Mnemosyne v1.0 — Decision Layer + Graph + Citation + Cost Engineering Tier 1 + PII + Memory Protocol v1 + Mode A end-to-end working"
```

- [ ] **Step 4: Push everything**

```bash
git push origin main
git push origin mnemosyne-v1.0
```

Expected: both push succeed.

---

## Verification Checklist (after v1.0 ships)

- [ ] `pnpm --filter @orchester/mnemosyne test` → all green
- [ ] `pnpm --filter @orchester/web test` → no regressions
- [ ] `pnpm audit:invariants` → all hold
- [ ] `apps/web/lib/brain/*` still functions (dual-write phase)
- [ ] `mnemo_fact` row count equals `brain_fact` row count (backfill complete)
- [ ] All 19+ migrations applied successfully
- [ ] RLS+FORCE on every `mnemo_*` table (4 policies each)
- [ ] No hardcoded provider names in `packages/mnemosyne/src/**/*.ts`
- [ ] `MEMORY_PROTOCOL_V1` injected by agent-runtime into agent system prompts
- [ ] Memory Protocol references Mode A/B/C correctly

---

## Self-Review Pass (writing-plans skill requirement)

Run mentally:

**1. Spec coverage:**

- §0-§4 (Vision, Architecture, Primitives, Graph, Citation): ✅ Tasks 1.x + 2.x + 3.x
- §5 (Hybrid Retrieval): partial — full retrieval engine deferred to v1.5 (this plan covers candidate FTS only)
- §6 (Extraction): A1 pre-filter implemented (Task 4.1); full V3 pipeline deferred to v1.5
- §7 (Conflict Surfacing): ✅ Task 2.7 (candidate-on-write)
- §8-§12 (Self-Improving / Introspection / Contracts / Sleep-Time / Federation): deferred to v3.0+
- §13 (Memory Protocol): ✅ Task 6.1
- §14 (Agent Surface): partial — tools + REST API + Inspector UI deferred to subsequent tasks (will be added before mnemosyne-v1.0 ship — see "next plan iteration" note below)
- §15 (Embedding Migration): deferred to v3.0
- §16 (Observability): deferred to v4.0
- §17 (Security): ✅ inherited from existing Orchester (RLS+FORCE via Pattern A)
- §18 (Performance): no specific tasks; relies on HNSW+GIN indexes (created in migrations)
- §19 (Testing): ✅ unit + integration tests per task
- §20 (Roadmap): this plan covers v0.0 → v1.0
- §21 (Migration brain → mnemo): ✅ Tasks 1.x + 1.8
- §22-§24 (Open Questions / ADR / Success Criteria): documentation tasks — defer until v1.0 ships
- §25 (Provider Agnosticism Charter): ✅ Task 0.1-0.6 + Task 4.4
- §26 (Cost Engineering): A1+A7+L3 implemented (Tasks 4.1+4.2+4.3); A2 capability detection (Task 4.4); A3/A5/A8 deferred
- §27-§38 (Multi-modal / Inference / Contracts / Federation / Cost Gov / Scale / Vault): deferred to subsequent phases
- §39 (Operational Modes): ✅ Task 6.2

**Coverage gaps to address in NEXT plan iteration (v1.0 polish, ~1 week additional):**

- Full hybrid retrieval engine (§5) with all 6 signals
- mnemosyne_recall MCP tool definition + tool-profiles catalog (§14)
- REST API routes `/api/workspaces/:slug/mnemo/*` (§14)
- Studio Inspector UI v0 (§31) — basic browse-only
- Memory Protocol injection wired into actual agent-runtime hook (Task 7.2 below provides the integration pattern; subagent confirms the live function signature via grep before patching)

These items are scoped for the v1.0-polish plan that follows this plan's completion.

**2. Placeholder scan:** No "TBD", "TODO", "fill in" — all code blocks complete.

**3. Type consistency:**

- `FactKind`, `DecisionKind`, `RelationVerb`, `MnemoMode` defined once and re-exported consistently.
- `Tx` type alias consistent (defined in `src/tx.ts`, imported elsewhere).
- `BrainFact`, `BrainDecision`, `BrainRelation`, `Citation` interfaces stable across tasks.

---

## Execution Handoff

Plan complete and saved to `docs/specs/plans/2026-05-24-mnemosyne-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review per task (spec compliance + code quality), fast iteration. ~45 tasks across 7 phases.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batched with checkpoints for review.

Which approach?
