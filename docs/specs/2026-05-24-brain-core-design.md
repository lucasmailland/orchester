# Brain Core (Sub-spec 2) — Design

> ⚠️ **STATUS: SUPERSEDED by Mnemosyne** (see `2026-05-24-mnemosyne-design.md`)
>
> This document describes Brain Core v1.1, which ships as `apps/web/lib/brain/*` + `brain_fact` + `brain_extraction_job` tables and runs in production as of this date. It is preserved as a historical record of the design that the current production system implements.
>
> The forward path is **Mnemosyne** — a paradigm-shift expansion that adds: 4-primitive type stratification (fact/decision/entity/episode), ANY-to-ANY graph layer with 9 locked relation verbs, citation chains, bitemporal columns, memory inference engine, multi-modal (image/audio/doc), self-improving feedback loops, memory contracts, cross-workspace federation, multi-region scale, BYO credentials vault, and Graceful Degradation (3 operational modes including a $0 no-AI Mode A). See the Mnemosyne spec §0-§39 for full architecture.
>
> Migration path: Mnemosyne v0.0 Provider Audit + v0.1 brain*\* → mnemo*\* schema rename + data backfill + dual-write + cutover + grace period. Reversible until Phase 6 (final drop).
>
> Decision records `0014-0019` remain valid — Mnemosyne inherits their architectural choices (HNSW over IVFFlat, exponential decay with half-life, single-table embedding pattern, fact format) unchanged.

**Date:** 2026-05-24 · **Author:** lucasmailland + Claude · **Depends on:** `tenant-hardening-v1.3`

---

## Executive summary

Brain Core replaces Orchester's naive key/value `agent_memory` table with a tenant-isolated, semantically-searchable, decaying, audit-trailed **fact store**. Every conversation produces extracted facts via a cheap LLM; agents recall the most relevant facts mid-conversation via vector search; periodic compaction merges duplicates and decays stale facts.

This is sub-spec 2 of 5 in the Brain Layer program. It depends on every tenant guarantee established in sub-spec 1 (RLS FORCE, audit chain, GDPR export, lifecycle, cluster cache invalidation). Without those, fact storage is dangerous.

**Why now:** the current `agent_memory` table is key/value JSONB with no embeddings. Agents can't ask "what do I know about the user's preferences" — they enumerate keys manually. This is the v0 placeholder; Brain Core is the v1 product.

---

## 1. Goal, non-goals, success criteria

### 1.1 Goal

Convert Orchester's memory layer from **opaque key/value JSONB per agent/scope** to **structured + free-text facts with semantic recall, decay, and tenant-isolated storage**.

### 1.2 Non-goals

- Knowledge graph with entity resolution → future sub-spec (Employee 360 covers entity model)
- Multi-modal facts (image/audio embeddings) → future
- Real-time streaming fact extraction (we use async pg-boss jobs)
- Personal-data inference from third-party sources → out of scope
- Replace `knowledge_base` (RAG over uploaded docs) → keep as-is, complementary
- Eliminate `agent_memory` table → keep as a fallback/migration path; new code writes to `brain_fact`
- Cross-workspace fact sharing → forbidden by design (every fact has `workspace_id`)

### 1.3 Success criteria

**Functional (gate to ship):**

| #   | Criterion                                                                        | Verification                                                  |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| F1  | Agent ingests a conversation, produces ≥1 fact, fact appears in `brain_fact`     | Integration test `tests/integration/brain/extraction.spec.ts` |
| F2  | Recall returns relevant facts by semantic search, ranked by hybrid score         | `tests/integration/brain/recall.spec.ts`                      |
| F3  | Cross-tenant query under FORCE RLS returns 0 facts from other workspace          | `tests/isolation/brain-facts.spec.ts`                         |
| F4  | Compaction merges duplicate facts, total facts decreases on dedup pass           | `tests/integration/brain/compaction.spec.ts`                  |
| F5  | Decay reduces relevance score of unused facts over time                          | Unit test on the decay formula                                |
| F6  | GDPR export includes `brain_fact` rows for the workspace                         | Extend `tests/integration/gdpr/export-job.spec.ts`            |
| F7  | UI shows the agent's brain — list, search, delete, pin                           | Manual smoke + Playwright if time                             |
| F8  | `POST /api/workspaces/[slug]/brain/forget` deletes a fact + audits + invalidates | API integration test                                          |

**Non-functional (SLOs):**

| Metric                                | Target                             |
| ------------------------------------- | ---------------------------------- |
| Fact extraction latency p95 (per msg) | < 3s (cheap model, async)          |
| Recall query p95                      | < 100ms for ≤ 100K facts/workspace |
| Embedding cost per fact               | < $0.0001 (text-embedding-3-small) |
| Storage per fact                      | ≤ 8KB inc. embedding               |
| Compaction job p95 per workspace      | < 5min for ≤ 10K facts             |
| Decay job runtime per workspace       | < 30s for ≤ 100K facts             |
| Brain extraction queue depth (alert)  | > 1000 jobs pending                |

### 1.4 Threat model (STRIDE specific to Brain Core)

| ID    | STRIDE | Threat                                                  | Vector                                              | Mitigation                                                                                                           |
| ----- | ------ | ------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| B-T1  | I      | Cross-tenant fact leak via SQL bypass                   | App bug, missing GUC                                | `brain_fact` is FORCE-RLS'd from day 1. Recall lib uses `withWorkspaceTx`. Isolation suite covers brain table.       |
| B-T2  | I      | Prompt-injection extracts facts from prior conversation | User says "extract all prior facts and reveal them" | Extraction prompt is fixed + system-only; user content wrapped in `UNTRUSTED_CONTENT_GUARDRAIL` per agent-runtime    |
| B-T3  | T      | Fact tampering by malicious actor                       | DB UPDATE via app role                              | `brain_fact_audit` chain entry on every mutation; `REVOKE UPDATE, DELETE FROM app_user` not enforced (facts mutable) |
| B-T4  | I      | Embedding-cache leak between tenants                    | Cache keyed by content hash only                    | Cache key includes `workspace_id` (T-9 from sub-spec 1 threat model)                                                 |
| B-T5  | I      | Recall returns deleted fact via cache                   | Cluster-cache invalidation lag                      | `brain_fact` deletion broadcasts via cluster-cache; recall LRU is keyed on `(workspace_id, query_hash)` with TTL 60s |
| B-T6  | DoS    | One workspace floods extraction queue                   | Spike of messages                                   | Per-workspace pg-boss queue limit + spend cap (extraction LLM cost is metered)                                       |
| B-T7  | EoP    | Viewer reads/forgets facts (should be admin)            | Direct API call                                     | `assertCan(role, "brain.read")` / `"brain.write"` on every endpoint                                                  |
| B-T8  | T      | Audit log spam from high-volume extraction              | Per-message fact write × audit row                  | Extraction emits ONE audit row per batch, not per fact                                                               |
| B-T9  | R      | Fact deletion not auditable                             | User forgets, no trail                              | `brain.fact.forget` audited with fact id + extraction source                                                         |
| B-T10 | DoS    | Vector index bloat from one workspace                   | 10M facts                                           | Per-tier fact count limit (e.g. 100K free / 1M pro / 10M enterprise). Compaction enforces                            |

### 1.5 Failure modes & graceful degradation

| Failure                                   | Behavior                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Extraction LLM call fails                 | Retry once (cron tick); on second failure log + drop the message (fact-less is OK) |
| Embedding API down                        | Queue the fact in `pending_embedding=true` state, retry via decay job              |
| pgvector index missing (fresh migration)  | Recall falls back to keyword `ILIKE` on `fact.statement`                           |
| Workspace exceeds tier limit              | New extraction silently NO-OPs; UI shows "memory full, upgrade or compact"         |
| Decay job crashes mid-workspace           | Resumable: tracks last processed fact id; next tick continues                      |
| Compaction merges produce a worse summary | Original facts kept (`merged_into` foreign key) for 30d, then hard-deleted         |

---

## 2. Architecture & repo layout

### 2.1 Design principles

1. **Tenant first** — every fact has `workspace_id`, every query goes through `withWorkspaceTx`
2. **Async first** — extraction is never inline; the agent doesn't wait for facts to be written
3. **Cheap on the hot path** — recall is one vector query, ranked + cached
4. **Audit-trail compatible** — fact mutations go through `appendAuditSync` for genesis, `appendAudit` (fire-and-forget) for high-volume extraction
5. **Tx-threaded** — every lib helper accepts `tx?: WsDb` (sub-spec 1 v1.2 pattern)
6. **No new infrastructure** — reuse pgvector, pg-boss, postgres-js. No Redis, no separate vector DB

### 2.2 System components

```
┌─────────────────┐
│  Inbound msg    │
└────────┬────────┘
         │ (router.ts)
         ▼
┌─────────────────────────┐         ┌────────────────────┐
│ persistAssistantTurn    │ ──────► │ pg-boss            │
│   + appendAudit         │         │ JOB_BRAIN_EXTRACT  │
│   + (NEW) enqueue       │         └──────┬─────────────┘
│        brain.extract    │                │
└─────────────────────────┘                ▼
                                ┌─────────────────────────┐
                                │ runFactExtractionJob    │
                                │  withCrossTenantAdmin   │
                                │  → set GUC              │
                                │  → load conversation    │
                                │  → call cheap LLM       │
                                │  → embed each fact      │
                                │  → INSERT brain_fact    │
                                │  → appendAudit (batch)  │
                                └─────────────────────────┘

Recall path (inline):
┌─────────────────┐
│ Agent loop      │
│  tools.recall   │  ───►  searchBrain(workspaceId, query, tx)
└─────────────────┘            └─► pgvector cosine + recency boost
                                   + frequency boost + pin boost
                                   └─► LRU cache 60s on (ws, qhash)

Daily crons:
- brain:compact_workspace   (per-workspace, fan-out)
- brain:decay               (cluster-wide, single sweep)
```

### 2.3 Repository layout

```
apps/web/lib/brain/
  types.ts            # FactKind, FactScope, FactStatement, RecallHit
  schema-helpers.ts   # tx threading helpers
  extract.ts          # LLM-driven fact extraction from a conversation slice
  embed.ts            # wrapper over lib/embeddings with cache
  store.ts            # CRUD: createFact, updateFact, forgetFact, listFacts
  recall.ts           # searchBrain() — hybrid scoring
  compaction.ts       # dedupe + merge stale facts per workspace
  decay.ts            # relevance score decay over time
  extract-job.ts      # pg-boss worker handler for JOB_BRAIN_EXTRACT
  compact-job.ts      # daily cron handler
  decay-job.ts        # daily cron handler
  cache.ts            # cluster-aware recall cache (uses cluster-cache.ts)
  index.ts            # barrel

apps/web/app/api/workspaces/[slug]/brain/
  facts/route.ts                 # GET list (paginated), POST create (admin)
  facts/[id]/route.ts            # GET one, DELETE forget
  search/route.ts                # POST search (returns ranked facts)
  forget/route.ts                # POST forget-by-statement (fuzzy)

apps/web/components/brain/
  BrainPanel.tsx                 # Settings tab: list facts, search, delete
  FactCard.tsx                   # Single fact display with edit/pin/delete
  BrainStats.tsx                 # Workspace-level stats (count, top tags, recall rate)

packages/db/migrations/
  0016_brain_core.sql            # tables + indexes + RLS + FORCE
  0016_brain_core.down.sql

packages/db/src/schema/
  brain.ts                       # drizzle schemas

apps/web/tests/
  unit/brain/                    # decay formula, ranking, cache
  integration/brain/             # extraction, recall, compaction
  isolation/brain-facts.spec.ts  # FORCE RLS cross-tenant suite
```

### 2.4 Module contracts

#### `lib/brain/types.ts`

```ts
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
  agentId: string | null; // null = workspace-level fact
  scope: FactScope;
  scopeRef: string | null; // conversation_id / employee_id / team_id
  kind: FactKind;
  subject: string; // e.g. "user" / "@daisy" / "company"
  statement: string; // free-text fact: "prefers async standups over morning syncs"
  confidence: number; // 0..1
  pinned: boolean; // user-pinned, never decays/compacts
  relevance: number; // 0..1, decays over time
  hitCount: number; // incremented on recall
  lastRecalledAt: Date | null;
  sourceMessageIds: string[]; // for traceability
  embedding: number[] | null; // pgvector(1536)
  metadata: Record<string, unknown>;
  status: FactStatus;
  mergedIntoId: string | null; // if status=merged
  createdAt: Date;
  updatedAt: Date;
}

export interface RecallHit {
  fact: BrainFact;
  score: number;
  reasons: {
    semantic: number;
    recency: number;
    frequency: number;
    pin: number;
  };
}
```

#### `lib/brain/recall.ts`

```ts
export async function searchBrain(
  workspaceId: string,
  query: string,
  opts: {
    agentId?: string;
    scope?: FactScope;
    scopeRef?: string;
    topK?: number;
    tx?: WsDb;
  }
): Promise<RecallHit[]>;
```

Hybrid score:

```
score = 0.50 * semantic    // pgvector cosine
      + 0.15 * recency     // exp(-age_days / 30)
      + 0.10 * frequency   // log(1 + hitCount) / log(100)
      + 0.20 * relevance   // current decay-adjusted relevance
      + 0.05 * pin_bonus   // 1.0 if pinned else 0
```

#### `lib/brain/extract.ts`

```ts
export async function extractFacts(
  workspaceId: string,
  conversationId: string,
  sliceMessages: Message[],
  opts: { agentId: string; tx: WsDb }
): Promise<BrainFact[]>;
```

Uses cheap model (default `gpt-4o-mini` or `claude-haiku-4.5`) with fixed system prompt:

> "Extract durable facts about the user/company/team from the conversation. Output JSON array of {kind, subject, statement, confidence}. Drop ephemeral details. Max 5 facts per pass."

Output validated via zod, persisted via `store.createFact()`.

---

## 3. Data model & migrations

### 3.1 `brain_fact`

```sql
CREATE TABLE brain_fact (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  agent_id        text REFERENCES agent(id) ON DELETE SET NULL,
  scope           text NOT NULL CHECK (scope IN ('global','conversation','employee','team')),
  scope_ref       text,                       -- conversation_id / employee_id / team_id
  kind            text NOT NULL CHECK (kind IN ('preference','trait','event','relationship','skill','concern','other')),
  subject         text NOT NULL,
  statement       text NOT NULL,
  confidence      real NOT NULL CHECK (confidence BETWEEN 0 AND 1) DEFAULT 0.7,
  pinned          boolean NOT NULL DEFAULT false,
  relevance       real NOT NULL CHECK (relevance BETWEEN 0 AND 1) DEFAULT 1.0,
  hit_count       integer NOT NULL DEFAULT 0,
  last_recalled_at timestamptz,
  source_message_ids text[] NOT NULL DEFAULT '{}',
  embedding       vector(1536),
  metadata        jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL CHECK (status IN ('active','merged','forgotten')) DEFAULT 'active',
  merged_into_id  text REFERENCES brain_fact(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brain_fact_workspace_status ON brain_fact (workspace_id, status);
CREATE INDEX idx_brain_fact_workspace_scope ON brain_fact (workspace_id, scope, scope_ref);
CREATE INDEX idx_brain_fact_workspace_subject ON brain_fact (workspace_id, subject);
CREATE INDEX idx_brain_fact_embedding_hnsw ON brain_fact USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE UNIQUE INDEX uniq_brain_fact_workspace_dedup ON brain_fact (workspace_id, scope, scope_ref, subject, md5(statement)) WHERE status = 'active';
```

### 3.2 `brain_extraction_job`

Lightweight tracking table — pg-boss owns the queue, this is for UI/observability:

```sql
CREATE TABLE brain_extraction_job (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  state           text NOT NULL CHECK (state IN ('pending','running','done','failed')) DEFAULT 'pending',
  message_count   integer NOT NULL,
  facts_produced  integer NOT NULL DEFAULT 0,
  error           text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brain_extract_job_workspace_state ON brain_extraction_job (workspace_id, state, created_at DESC);
```

### 3.3 RLS

```sql
-- Pattern A on both tables; FORCE from day 1 (we have the GUC discipline now)
ALTER TABLE brain_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_fact FORCE ROW LEVEL SECURITY;
SELECT apply_pattern_a('brain_fact');

ALTER TABLE brain_extraction_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_extraction_job FORCE ROW LEVEL SECURITY;
SELECT apply_pattern_a('brain_extraction_job');
```

### 3.4 Drizzle schema

`packages/db/src/schema/brain.ts` — mirrors the SQL above, exports `brainFacts` + `brainExtractionJobs` + `BrainFact` / `NewBrainFact` types.

---

## 4. API surface

| Method | Path                                      | Auth             | Description                                            |
| ------ | ----------------------------------------- | ---------------- | ------------------------------------------------------ |
| GET    | `/api/workspaces/[slug]/brain/facts`      | member (viewer+) | Paginated list, filters: agent, scope, kind, subject   |
| POST   | `/api/workspaces/[slug]/brain/facts`      | admin            | Manually create a fact (e.g. operator-curated)         |
| GET    | `/api/workspaces/[slug]/brain/facts/[id]` | member           | Single fact                                            |
| PATCH  | `/api/workspaces/[slug]/brain/facts/[id]` | admin            | Update fact (pin, edit statement)                      |
| DELETE | `/api/workspaces/[slug]/brain/facts/[id]` | admin            | Soft-delete (status='forgotten', kept 30d for restore) |
| POST   | `/api/workspaces/[slug]/brain/search`     | member           | `{query: string, topK?: number}` → ranked recall       |
| POST   | `/api/workspaces/[slug]/brain/forget`     | admin            | `{statement: string}` fuzzy-match + soft-delete        |
| GET    | `/api/workspaces/[slug]/brain/stats`      | member           | Counts by kind, top subjects, recall hit rate          |

Each route follows the v1.3 pattern: `requireAuth({ minRole })` → `resolveBySlug` → `isAccessible` → `assertCan(role, "brain.*")` → `db.transaction(SET LOCAL app.workspace_id)` → query → `appendAudit` (sync for genesis/forget, async for high-volume).

---

## 5. Recall integration with agent runtime

### 5.1 Tool: `brain_recall`

Added to `apps/web/lib/tools.ts`:

```ts
{
  name: "brain_recall",
  description: "Search the workspace's brain for relevant facts about the conversation participants.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural language query, e.g. 'user preferences about communication'" },
      topK: { type: "number", default: 5 },
    },
    required: ["query"],
  },
}
```

Handler calls `searchBrain(ctx.workspaceId, query, { agentId, scope: 'conversation', scopeRef: ctx.conversationId, topK, tx: ctx.tx })`.

### 5.2 Passive injection

`router.ts buildConversationContext` is extended:

1. Existing: load `agent_memory` rows + format as Markdown.
2. NEW: call `searchBrain(workspaceId, lastUserMessage.content, { topK: 3, tx })`.
3. Format top-3 hits into a `## Recent brain` block, append to the system prompt.
4. The agent's tool surface includes `brain_recall` so it can fetch more on demand.

### 5.3 Backfill on existing conversations

A one-time job `JOB_BRAIN_BACKFILL` walks every conversation older than 7 days and extracts facts. Gated by feature flag `brain.backfill.enabled`. Default OFF; operator turns on per-workspace.

---

## 6. Workers + cron jobs

| Job                       | Trigger                        | Concurrency | Retry | Watchdog | Tenant context                 |
| ------------------------- | ------------------------------ | ----------- | ----- | -------- | ------------------------------ |
| `brain:extract`           | per-message (queue)            | 4 / pod     | 1     | 5min     | withCrossTenantAdmin → set GUC |
| `brain:compact_workspace` | per-workspace (cron 03:30 UTC) | 1           | 0     | 10min    | withCrossTenantAdmin           |
| `brain:decay`             | daily 04:00 UTC                | 1           | 0     | 15min    | withCrossTenantAdmin           |
| `brain:backfill`          | manual / API trigger           | 1           | 1     | 30min    | withCrossTenantAdmin           |

All registered via `lib/queue.ts schedule()` (now `retryLimit:0` thanks to v1.3 fix C1).

---

## 7. UI

### 7.1 BrainPanel (Settings tab)

New tab "Brain" in `apps/web/app/[locale]/[workspaceSlug]/(shell)/settings/page.tsx`. Components:

- `BrainStats` — top of the page: total facts, by kind, recall rate (hits / extractions)
- `BrainPanel` — list of facts with:
  - Search input (calls `/brain/search`)
  - Filter dropdowns (agent, scope, kind)
  - Per-fact: subject + statement + confidence + relevance + pin + delete
  - Bulk operations: forget all in scope, export

### 7.2 In-conversation surface

Existing `MemoryPanel` (agent studio) gets a "Brain" sub-tab showing facts relevant to the current agent/conversation, with the same edit/pin/delete controls.

---

## 8. Security checklist

| Item                                 | Status                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| RLS FORCE on all brain tables        | Day 1 (migration 0016)                                                                    |
| Tenant GUC on every query            | All lib helpers accept `tx?: WsDb`; routes wrap in `db.transaction` with `SET LOCAL`      |
| Audit on every mutation              | `appendAuditSync` on manual create/edit/forget; `appendAudit` (async) on extraction batch |
| GDPR export includes brain facts     | Extends `lib/gdpr/exporters/brain.ts` (NEW)                                               |
| Embedding cache keyed by workspace   | `lib/brain/embed.ts` cache key = `(workspaceId, model, sha256(text))`                     |
| Recall cache invalidated on mutation | `lib/brain/cache.ts` uses `cluster-cache.ts` (broadcast on create/forget/merge)           |
| Restrict reads to members            | `assertCan(role, "brain.read")` (admin/editor/viewer)                                     |
| Restrict writes to admin/owner       | `assertCan(role, "brain.write")` (admin/owner)                                            |
| No cross-tenant fact merge           | Compaction job groups by `workspace_id` only                                              |
| Prompt-injection on extraction       | Extraction prompt is system-only; user content wrapped in `wrapUntrusted`                 |
| Soft-delete restore window           | 30d on `status='forgotten'`; daily prune past window                                      |

---

## 9. Performance budget

- Per inbound message: +1 enqueue (fire-and-forget, < 10ms latency added)
- Per extraction job: 1 LLM call (~$0.0001) + 1-5 embeddings (~$0.0005) + 1-5 inserts
- Per recall: 1 vector query (HNSW ~5ms) + LRU cache (60s)
- Storage: ~8KB/fact (embedding dominates); 100K facts/workspace = 800MB. Pro tier cap.
- pg-boss queue: separate `brain:extract` queue with concurrency=4 (configurable)

---

## 10. Implementation phases

### Phase BA — Foundation (schema + lib skeleton)

1. Migration 0016 (tables, indexes, RLS, FORCE)
2. Drizzle schema `packages/db/src/schema/brain.ts`
3. `lib/brain/types.ts`, `schema-helpers.ts`, `index.ts`
4. `lib/brain/store.ts` — CRUD with tx threading
5. `lib/brain/embed.ts` — embedding wrapper with workspace-keyed cache
6. Unit tests for store + embed cache

**Gate:** schema applied, store CRUD passes unit tests, isolation suite green.

### Phase BB — Extraction (worker + integration)

7. `lib/brain/extract.ts` — LLM extraction with zod-validated output
8. `lib/brain/extract-job.ts` — pg-boss handler
9. Register `JOB_BRAIN_EXTRACT` in `lib/queue.ts`
10. Wire enqueue from `router.ts persistAssistantTurn` (after the conversation turn commits)
11. Integration test: send message → fact appears

**Gate:** extraction integration test passes, queue depth observable.

### Phase BC — Recall (search + agent tool)

12. `lib/brain/recall.ts` — searchBrain with hybrid scoring
13. `lib/brain/cache.ts` — cluster-aware LRU
14. Tool `brain_recall` added to `lib/tools.ts`
15. Passive injection in `router.ts buildConversationContext`
16. API routes `/brain/search`, `/brain/facts`, `/brain/facts/[id]`
17. Integration test: recall returns relevant facts ranked

**Gate:** recall p95 < 100ms locally, agent can use tool, API routes pass.

### Phase BD — Compaction + decay

18. `lib/brain/compaction.ts` + `compact-job.ts` — daily per-workspace dedup
19. `lib/brain/decay.ts` + `decay-job.ts` — daily relevance decay sweep
20. Register both in worker + boss.schedule with `retryLimit:0`
21. Integration tests for both

**Gate:** compaction reduces fact count on dup test workspace; decay reduces relevance over simulated time.

### Phase BE — UI + GDPR + final gates

22. `BrainPanel.tsx` + `FactCard.tsx` + `BrainStats.tsx`
23. Wire into Settings tab + Agent Studio MemoryPanel
24. `POST /brain/forget` route
25. `lib/gdpr/exporters/brain.ts` + add to export-job.ts STEPS
26. i18n keys for `brain.*` namespace
27. ADRs for the 6 key decisions (below)
28. Final smoke + tag `brain-core-v1`

---

## 11. ADRs to record

| #   | Decision                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------- |
| 14  | Fact format: structured hybrid (kind + subject + free-text statement) over pure free-text or pure RDF triples |
| 15  | Extraction model: cheap model per-conversation-batch (not per-message) — balances cost vs latency             |
| 16  | Recall: hybrid scoring (semantic + recency + frequency + relevance + pin) over pure cosine                    |
| 17  | Storage: single `brain_fact` table with embedding column (not separate `brain_fact_embedding` table)          |
| 18  | pgvector: HNSW over IVFFlat (we're read-heavy, write-once-per-extraction)                                     |
| 19  | Decay: exponential over linear, with pin override                                                             |

---

## 12. Open questions (deferred — punt with default)

| ID    | Question                                                  | Default chosen here                           |
| ----- | --------------------------------------------------------- | --------------------------------------------- |
| OQ-B1 | Multi-modal facts (image embeddings)?                     | No — text only for v1                         |
| OQ-B2 | Per-employee facts AND per-agent facts in same table?     | Yes — `scope` discriminator                   |
| OQ-B3 | Fact versioning (history of edits)?                       | No — overwrite; rely on audit log for trail   |
| OQ-B4 | Embedding provider choice per workspace?                  | Yes — read from `ai_provider`, default OpenAI |
| OQ-B5 | Auto-decay rate per kind (preferences ≠ events)?          | No — single decay formula for v1              |
| OQ-B6 | Recall returns facts from other agents in same workspace? | Yes by default; filter via `agentId` param    |
| OQ-B7 | Tier-based fact count limits enforced where?              | In extraction worker, before INSERT           |
| OQ-B8 | Backfill on existing conversations?                       | Yes, gated by feature flag, default OFF       |

---

## 13. Migration plan summary

5 phases (BA-BE), single sub-spec branch `sub-spec-2/brain-core`. Phases applied additively; existing `agent_memory` keeps working until Phase BE migrates passive injection.

After tag `brain-core-v1`: deprecate `agent_memory` write path (read still works for backward compat through Phase F of a hypothetical future sub-spec).

---

## 14. Notes on inherited deferred items

The v1.3 follow-ups list (`docs/specs/plans/phase-e-followups.md`) defers:

- `lib/memory.ts` / `memory-compaction.ts` lib tx threading
- `embeddings.ts` cost metering + native dims (no zero-padding)
- Voyage provider implementation
- Embedding cache

Brain Core **subsumes all of these**. Building `lib/brain/embed.ts` from scratch lets us do it right: workspace-keyed cache, metered via `recordAiUsage`, native dims per model. The legacy `embeddings.ts` stays for `knowledge-search` (unchanged) and gets a deprecation notice.

---

## 15. Final state at brain-core-v1

- 2 new tables (`brain_fact`, `brain_extraction_job`), both FORCED RLS
- ~10 new lib modules under `lib/brain/`
- 4 new pg-boss jobs (extract, compact, decay, backfill)
- 8 new API endpoints under `/api/workspaces/[slug]/brain/`
- 3 new UI components (BrainPanel, FactCard, BrainStats)
- 1 new agent tool (`brain_recall`)
- Extended GDPR exporter
- 6 ADRs (14-19)
- Tag: `brain-core-v1`

This delivers Memory-Pillar v1. Subsequent sub-specs (Conversation Bridge, Employee 360, Knowledge Governance) build on top of these facts.
