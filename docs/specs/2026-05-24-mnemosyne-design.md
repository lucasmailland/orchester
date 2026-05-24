# Mnemosyne — Memory Architecture for AI Agents

> **Status**: Draft · **Date**: 2026-05-24 · **Author**: Lucas Mailland + Claude
> **Supersedes**: Brain Core v1.1 (`apps/web/lib/brain/*` + `brain_fact` / `brain_extraction_job`)
> **Distribution**: `packages/mnemosyne` (monorepo package) · NPM `@orchester/mnemosyne`
> **License**: Apache 2.0 + DCO

A memory layer for AI agents that aspires to be a paradigm shift in agentization. Combines and surpasses Engram (decision tracking + conflict surfacing), Mem0 (V3 extraction pipeline + hybrid retrieval), Letta/MemGPT (temporal layering), Zep/Graphiti (knowledge graph + bitemporal), and Cognee (entity linking) — fused into a single Postgres-native system with multi-tenant RLS+FORCE, audit hash chain, spend caps, GDPR export, and five paradigm-shift features that no OSS competitor has.

---

## 0. Vision + Scope

### 0.1 The "antes y después" thesis

Today, agent memory is **fragmented**: Engram does decisions but not personalization; Mem0 does personalization but dropped graph from OSS; Letta does context management but not multi-tenant; Zep does temporal graph but not at scale with RLS; Cognee does ontology but not real-time. **No single OSS system gives an AI agent the full memory substrate it needs to be reliable longitudinally.**

Mnemosyne is that substrate. Six layers, twelve tables, four primitives, one graph, bitemporal everywhere, multi-tenant by construction. Built once, used by Orchester and anyone else who needs the most complete AI memory available.

### 0.2 Competitive landscape (honest)

| System                     | Strength                                                            | Fatal gap (vs Mnemosyne)                                                         |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Engram**                 | Decision tracking + 6 locked relation verbs + agent-curated quality | Single-user, SQLite local, no auto-extraction, no graph, no decay                |
| **Mem0 OSS**               | V3 extraction pipeline (LoCoMo 71→91) + hybrid scoring + 18 LLMs    | App-layer filter only (no RLS), graph dropped, no audit chain, no spend tracking |
| **Letta/MemGPT**           | Working-memory paging + agent state checkpoints                     | No multi-tenant, no graph, no conflict surfacing                                 |
| **Zep/Graphiti**           | Temporal knowledge graph + bitemporal                               | Single-tenant, ops-heavy (Neo4j), no audit chain                                 |
| **Cognee**                 | Ontology + entity extraction                                        | Heavy stack, no agent contract, opinionated framework lock-in                    |
| **Brain Core v1.1** (ours) | Multi-tenant RLS+FORCE + audit chain + decay + 5-signal scoring     | Only facts (no decisions/entities/episodes), no graph, no conflict surfacing     |

### 0.3 What Mnemosyne adds that nobody has

1. **Provenance chains** — every memory traces back to source messages + prompt version + extractor model + judgment chain. Recursive proof tree on demand.
2. **Bitemporal multi-actor** — `valid_from / valid_to` on every primitive + `mnemo_relation` allows multiple judgments without UNIQUE constraint.
3. **Knowledge graph with RLS+FORCE** — first OSS that does this.
4. **Self-improving feedback loops** — bandit learning over recall scoring weights, retrained during sleep-time compute.
5. **Memory introspection by the agent** — agent reasons about its own memory via `mem_introspect / mem_diff / mem_health / mem_confidence`.
6. **Memory contracts** between agents — explicit memory packages negotiated on handoff.
7. **Memory health score** + dashboard — measurable quality 0-100.
8. **Embedding migration without re-embed** — multi-version embeddings with lazy upgrade.
9. **Memory protocol versioned** as a code artifact, not a markdown wiki page.
10. **Cross-workspace federation** with permission scopes.
11. **Provider Agnosticism** as architectural mandate — zero vendor lock-in, zero platform-level third-party costs, $0 in pure self-host via Ollama + fastembed-rs + whisper.cpp. See **§25 Provider Agnosticism Charter**.
12. **95% cost reduction via 8 agnostic techniques** (pre-filter + speculative tier + hierarchical cache + lazy embeddings + budget caps + batched extraction + local-first + opportunistic adapter caching). See **§26 Cost Engineering**.

---

## 1. Architecture Overview

```
┌───────────────────────────────────────────────────────────────────┐
│  Layer 6: Memory Protocol (versioned artifact)                    │
│    - Agent contract: triggers, self-check, retrieval policy       │
│    - MEMORY_PROTOCOL_VERSION constant — bump invalidates extractions │
└───────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────┼─────────────────────────────────────┐
│  Layer 5: Agent Surface                                           │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│    │ MCP Tools    │  │ REST API     │  │ Runtime Hooks        │  │
│    │ (4 eager     │  │ (admin + ops)│  │ (auto-inject context)│  │
│    │  + 15 deferred)                                          │  │
│    └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────┼─────────────────────────────────────┘
                              │
┌─────────────────────────────┼─────────────────────────────────────┐
│  Layer 4: Cognitive Operations                                    │
│    Extraction · Retrieval · Conflict surfacing · Feedback · Sleep │
└─────────────────────────────┼─────────────────────────────────────┘
                              │
┌─────────────────────────────┼─────────────────────────────────────┐
│  Layer 3: Graph + Citation Overlay                                │
│    mnemo_relation (ANY-to-ANY, 9 verbs, multi-actor)              │
│    mnemo_citation (memory → source messages + prompt version)     │
└─────────────────────────────┼─────────────────────────────────────┘
                              │
┌─────────────────────────────┼─────────────────────────────────────┐
│  Layer 2: Type-stratified Primitives                              │
│    mnemo_fact · mnemo_decision · mnemo_entity · mnemo_episode     │
│    (all bitemporal, all RLS+FORCE, all with embeddings + FTS)     │
└─────────────────────────────┼─────────────────────────────────────┘
                              │
┌─────────────────────────────┼─────────────────────────────────────┐
│  Layer 1: Substrate                                               │
│    Postgres 15 + pgvector (HNSW) + ts_vector (GIN)                │
│    RLS+FORCE Pattern A · audit chain · spend cap · GDPR           │
└───────────────────────────────────────────────────────────────────┘
```

### 1.1 Data flow (typical conversation turn)

1. **User message arrives** → channel router persists it
2. **Pre-LLM hook** → `searchMnemosyne({query, scope, topK: 5})` → injects top hits into system prompt
3. **Agent responds**
4. **Post-LLM hook** → `enqueueMnemoExtract({conversationId, messageCount})` via pg-boss singleton-keyed job
5. **Extraction worker (background)** → V3 pipeline 8 phases → facts + decisions + entities written + citations linked
6. **Lazy conflict scan (cron 1h)** → semantic similarity over new memories → opens `pending` relations
7. **Sleep-time compute (nightly)** → merge similar / forget low-recall / refresh embeddings / retrain weights

### 1.2 Threading model

- **Read path**: stateless, pooled. Recall hits L1 (workspace LRU 60s TTL) + L2 (cluster cache via LISTEN/NOTIFY) before DB.
- **Write path**: serialized per `(workspaceId, conversationId)` via pg-boss `singletonKey` to prevent duplicate extraction.
- **Cross-tenant operations**: always inside `withCrossTenantAdmin(...)` with audit-enforced `cron_admin` role.

---

## 2. Type-Stratified Primitives

Four primitives, each with its own table optimized for its lifecycle. All inherit: `id`, `workspace_id`, `embedding vector(1536)`, `text_lemmatized tsvector` (GIN-indexed for BM25), `valid_from` / `valid_to` (bitemporal), `metadata jsonb`, `status`, `created_at`, `updated_at`. All have RLS+FORCE Pattern A (4 policies: select/insert/update/delete, all gated by `current_setting('app.workspace_id')`).

### 2.1 `mnemo_fact` — "what we know about the user/company/team"

```sql
CREATE TABLE mnemo_fact (
  id                  text PRIMARY KEY,            -- "mfact_<cuid2>"
  workspace_id        text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  agent_id            text REFERENCES agent(id) ON DELETE SET NULL,
  scope               text NOT NULL CHECK (scope IN
                        ('global','conversation','employee','team')),
  scope_ref           text,
  kind                text NOT NULL CHECK (kind IN
                        ('preference','trait','event','relationship','skill','concern','other')),
  subject             text NOT NULL,
  statement           text NOT NULL,
  confidence          real NOT NULL CHECK (confidence BETWEEN 0 AND 1) DEFAULT 0.7,
  pinned              boolean NOT NULL DEFAULT false,
  relevance           real NOT NULL CHECK (relevance BETWEEN 0 AND 1) DEFAULT 1.0,
  hit_count           integer NOT NULL DEFAULT 0,
  last_recalled_at    timestamptz,
  source_message_ids  text[] NOT NULL DEFAULT '{}',
  attributed_to       text CHECK (attributed_to IN ('user','assistant','system')),
  linked_memory_ids   text[] NOT NULL DEFAULT '{}',  -- M0-style, but FK-enforced via mnemo_relation
  embedding           vector(1536),
  embedding_model     text,                          -- for migration
  embedding_version   text,
  text_lemmatized     tsvector,                      -- BM25 substrate
  metadata            jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL CHECK (status IN ('active','merged','forgotten')) DEFAULT 'active',
  merged_into_id      text REFERENCES mnemo_fact(id) ON DELETE SET NULL,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mnemo_fact_ws_status ON mnemo_fact (workspace_id, status);
CREATE INDEX idx_mnemo_fact_ws_scope ON mnemo_fact (workspace_id, scope, scope_ref);
CREATE INDEX idx_mnemo_fact_ws_subject ON mnemo_fact (workspace_id, subject);
CREATE INDEX idx_mnemo_fact_embedding ON mnemo_fact USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_mnemo_fact_fts ON mnemo_fact USING gin (text_lemmatized);
CREATE INDEX idx_mnemo_fact_valid ON mnemo_fact USING gist (tstzrange(valid_from, valid_to));
CREATE UNIQUE INDEX uniq_mnemo_fact_dedup
  ON mnemo_fact (workspace_id, scope, COALESCE(scope_ref, ''), subject, md5(statement))
  WHERE status = 'active' AND valid_to IS NULL;
```

### 2.2 `mnemo_decision` — "what we decided / architecture / policy"

```sql
CREATE TABLE mnemo_decision (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  agent_id            text REFERENCES agent(id) ON DELETE SET NULL,
  conversation_id     text REFERENCES conversation(id) ON DELETE SET NULL,
  kind                text NOT NULL CHECK (kind IN
                        ('decision','architecture','policy','process','bugfix',
                         'learning','discovery','config')),
  title               text NOT NULL,
  body                text NOT NULL,
  topic_key           text,                              -- "billing/refund-policy"
  revision_count      integer NOT NULL DEFAULT 1,
  normalized_hash     text NOT NULL,                     -- md5(title+body+kind+topic_key)
  decided_by_user_id  text REFERENCES "user"(id) ON DELETE SET NULL,
  embedding           vector(1536),
  embedding_model     text,
  embedding_version   text,
  text_lemmatized     tsvector,
  status              text NOT NULL CHECK (status IN ('active','superseded','withdrawn')) DEFAULT 'active',
  superseded_by_id    text REFERENCES mnemo_decision(id) ON DELETE SET NULL,
  metadata            jsonb NOT NULL DEFAULT '{}',
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Indexes mirror mnemo_fact pattern
CREATE UNIQUE INDEX uniq_mnemo_decision_topic
  ON mnemo_decision (workspace_id, topic_key)
  WHERE topic_key IS NOT NULL AND status = 'active' AND valid_to IS NULL;
```

The `topic_key` shortcut from Engram: if a search query contains `/` (e.g., `architecture/auth-model`), we do a direct lookup with rank `-1000` so it sorts to top. Topic upsert: `mnemo.decision.save({topic_key})` increments `revision_count` on conflict.

### 2.3 `mnemo_entity` — knowledge graph nodes (people, projects, places)

```sql
CREATE TABLE mnemo_entity (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN
                        ('person','project','place','concept','event','document','organization','product')),
  canonical_name      text NOT NULL,
  aliases             text[] NOT NULL DEFAULT '{}',
  embedding           vector(1536),
  attributes          jsonb NOT NULL DEFAULT '{}',
  linked_memory_ids   text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL CHECK (status IN ('active','merged','forgotten')) DEFAULT 'active',
  merged_into_id      text REFERENCES mnemo_entity(id) ON DELETE SET NULL,
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uniq_mnemo_entity_canonical
  ON mnemo_entity (workspace_id, kind, lower(canonical_name))
  WHERE status = 'active' AND valid_to IS NULL;
```

Entity extraction uses a combination of spaCy-ish NER (regex + capitalization heuristics in JS) for high-recall + LLM-based extraction for high-precision. Run in batch during the extraction job (Phase 7).

### 2.4 `mnemo_episode` — bounded conversation/session/task records

```sql
CREATE TABLE mnemo_episode (
  id                       text PRIMARY KEY,
  workspace_id             text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_id          text REFERENCES conversation(id) ON DELETE SET NULL,
  started_at               timestamptz NOT NULL,
  ended_at                 timestamptz,
  goal                     text,
  summary                  text,
  outcome                  text CHECK (outcome IN ('success','partial','abandoned','blocked','open')),
  participant_user_ids     text[] NOT NULL DEFAULT '{}',
  participant_agent_ids    text[] NOT NULL DEFAULT '{}',
  message_count            integer NOT NULL DEFAULT 0,
  embedding                vector(1536),
  text_lemmatized          tsvector,
  metadata                 jsonb NOT NULL DEFAULT '{}',
  valid_from               timestamptz NOT NULL DEFAULT now(),
  valid_to                 timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
```

Episodes are written on conversation close (or on explicit `mnemo.episode.summarize()` tool call). They link back to the conversation but live independently — useful for cross-conversation reasoning ("what tasks has this user closed in the last 3 months").

---

## 3. Graph Layer — `mnemo_relation`

ANY-to-ANY edges across the four primitives. Locked vocabulary of 9 relation verbs. Multi-actor disagreement explicitly allowed (no UNIQUE on source/target).

```sql
CREATE TABLE mnemo_relation (
  id                       text PRIMARY KEY,
  workspace_id             text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  source_kind              text NOT NULL CHECK (source_kind IN ('fact','decision','entity','episode')),
  source_id                text NOT NULL,
  target_kind              text NOT NULL CHECK (target_kind IN ('fact','decision','entity','episode')),
  target_id                text NOT NULL,
  relation                 text NOT NULL CHECK (relation IN (
                             'related',          -- soft semantic link
                             'compatible',       -- coexists, no conflict
                             'scoped',           -- one is subset of the other
                             'conflicts_with',   -- contradiction
                             'supersedes',       -- replaces target
                             'not_conflict',     -- explicit non-conflict (after evaluation)
                             'derived_from',     -- source produced by target
                             'part_of',          -- source is a part/component of target
                             'member_of'         -- source belongs to a collection target
                           )),
  judgment_status          text NOT NULL DEFAULT 'pending'
                             CHECK (judgment_status IN ('pending','judged','dismissed')),
  reason                   text,
  evidence                 jsonb,
  confidence               real CHECK (confidence BETWEEN 0 AND 1),
  marked_by_user_id        text REFERENCES "user"(id) ON DELETE SET NULL,
  marked_by_kind           text NOT NULL CHECK (marked_by_kind IN ('user','agent','system','llm_judge')),
  marked_by_model          text,
  marked_by_prompt_version text,
  conversation_id          text REFERENCES conversation(id) ON DELETE SET NULL,
  superseded_by_relation_id text REFERENCES mnemo_relation(id) ON DELETE SET NULL,
  valid_from               timestamptz NOT NULL DEFAULT now(),
  valid_to                 timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
  -- NO UNIQUE on (source_kind, source_id, target_kind, target_id, relation)
  -- → multi-actor disagreement allowed; later resolution via consensus aggregation
);
CREATE INDEX idx_mnemo_rel_source ON mnemo_relation (workspace_id, source_kind, source_id);
CREATE INDEX idx_mnemo_rel_target ON mnemo_relation (workspace_id, target_kind, target_id);
CREATE INDEX idx_mnemo_rel_pending ON mnemo_relation (workspace_id, judgment_status, created_at DESC)
  WHERE judgment_status = 'pending';
```

### 3.1 Recursive traversal

```sql
-- "Show me all memories that supersede or are superseded by fact mfact_abc"
WITH RECURSIVE chain AS (
  SELECT source_kind, source_id, target_kind, target_id, relation, 0 AS depth
  FROM mnemo_relation
  WHERE workspace_id = $1
    AND (source_id = 'mfact_abc' OR target_id = 'mfact_abc')
    AND relation IN ('supersedes', 'conflicts_with')
  UNION ALL
  SELECT r.source_kind, r.source_id, r.target_kind, r.target_id, r.relation, c.depth + 1
  FROM mnemo_relation r
  JOIN chain c ON (r.source_id = c.target_id OR r.target_id = c.source_id)
  WHERE r.workspace_id = $1 AND c.depth < 5
)
SELECT * FROM chain;
```

### 3.2 Consensus aggregation (when multiple judgments exist)

```sql
-- "What's the consensus relation between mfact_abc and mfact_xyz?"
SELECT relation, count(*) AS votes, avg(confidence) AS avg_confidence
FROM mnemo_relation
WHERE workspace_id = $1
  AND source_id = 'mfact_abc' AND target_id = 'mfact_xyz'
  AND judgment_status = 'judged'
GROUP BY relation
ORDER BY votes DESC, avg_confidence DESC
LIMIT 1;
```

---

## 4. Citation + Provenance — `mnemo_citation`

Every extracted memory traces back to **source messages + prompt version + extractor model + chain of judgments**. Recursive proof trees on demand.

```sql
CREATE TABLE mnemo_citation (
  id                      text PRIMARY KEY,
  workspace_id            text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  memory_kind             text NOT NULL CHECK (memory_kind IN ('fact','decision','entity','episode')),
  memory_id               text NOT NULL,
  source_kind             text NOT NULL CHECK (source_kind IN
                            ('message','document','tool_call','llm_extraction','user_edit','agent_save','imported')),
  source_id               text,                  -- message_id, tool_call_id, etc.
  extractor_model         text,                  -- e.g. workspace mnemo.small_model
  extractor_prompt_version text,                 -- "v1"
  judge_model             text,
  judge_relation_id       text REFERENCES mnemo_relation(id) ON DELETE SET NULL,
  evidence_excerpt        text,                  -- the actual quote / snippet (truncated)
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mnemo_cit_memory ON mnemo_citation (workspace_id, memory_kind, memory_id);
CREATE INDEX idx_mnemo_cit_source ON mnemo_citation (workspace_id, source_kind, source_id);
```

### 4.1 Provenance API

Tool `mem_provenance(memory_id)` returns a recursive tree:

```json
{
  "memory_id": "mfact_abc",
  "statement": "User prefers Spanish-language responses",
  "citations": [
    {
      "source": {"kind": "message", "id": "msg_xyz", "excerpt": "...por favor en español"},
      "extracted_by": {"model": "<workspace.small_model>", "prompt_version": "v1"},
      "extracted_at": "2026-05-24T10:00:00Z"
    }
  ],
  "judgments": [
    {
      "relation_id": "mrel_abc",
      "relation": "supersedes",
      "target_memory_id": "mfact_old",
      "judged_by": {"model": "<workspace.large_model>", "actor": "llm_judge"},
      "reason": "Newer preference, explicit language switch"
    }
  ],
  "derived_from": []  -- recursive: memories this one was derived from
}
```

This enables **explainable AI** for agent actions ("the agent answered in Spanish because of memory mfact_abc, which was extracted from message msg_xyz at 10:00, and was confirmed by judgment mrel_abc against the prior memory mfact_old").

---

## 5. Hybrid Retrieval — Six-signal scoring

```
score = 0.40 * semantic       (pgvector cosine, top_k * 4 over-fetch)
      + 0.20 * bm25            (Postgres FTS with sigmoid normalization)
      + 0.10 * entity_boost    (linked entities match query entities)
      + 0.10 * recency         (true half-life: exp(-LN2 * Δt / 30d))
      + 0.10 * frequency       (log(1 + hit_count) / log(100))
      + 0.05 * relevance       (decay-adjusted, true half-life)
      + 0.05 * pin_bonus       (1.0 if pinned else 0.0)
```

Weights sum to 1.0. Each signal is normalized to [0, 1] before linear combination. Threshold gates **only the semantic component** before fusion (per Mem0 V3 — boosting alone shouldn't surface a memory whose semantic score is below floor).

### 5.1 BM25 sigmoid normalization (Mem0 V3 fork)

```ts
function normalizeBM25(rawScore: number, queryWordCount: number): number {
  const [midpoint, steepness] =
    queryWordCount <= 3
      ? [5.0, 0.7]
      : queryWordCount <= 6
        ? [7.0, 0.6]
        : queryWordCount <= 9
          ? [9.0, 0.5]
          : queryWordCount <= 15
            ? [10.0, 0.5]
            : [12.0, 0.5];
  return 1 / (1 + Math.exp(-steepness * (rawScore - midpoint)));
}
```

### 5.2 Entity boost with spread attenuation

For each entity in the query (extracted via lightweight regex NER):

```
boost = similarity_to_entity * 0.5 * memory_count_weight
where memory_count_weight = 1.0 / (1.0 + 0.001 * (num_linked_memories - 1)^2)
```

An entity linked to 100 memories gets weaker boost than one linked to 5 — prevents popular entities from dominating recall.

### 5.3 Topic-key shortcut (Engram fork)

If query contains `/`, do direct lookup `WHERE topic_key = $query` AND assign rank `-1000` (sorts to top). Useful for namespaced queries like `architecture/auth-model`.

### 5.4 Rerank pluggable

Optional Cohere / Voyage / Jina / local cross-encoder reranker on top of fused score. Default `rerank: false`. Workspace can BYO via credential.

### 5.5 Bitemporal filter

```ts
search({ asOf: "2026-01-01T00:00:00Z" }); // "what did the system know at time T"
// → WHERE valid_from <= $asOf AND (valid_to IS NULL OR valid_to > $asOf)
```

---

## 6. Extraction Pipeline — V3-port

Eight phases, single LLM call, ADD-only. Forked from Mem0 V3 `ADDITIVE_EXTRACTION_PROMPT` (Apache 2.0) with Orchester customizations.

### 6.1 Phases

| #   | Phase                     | Detail                                                                                                          |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0   | Session scope build       | `scope_string = "workspace=W&conversation=C&agent=A"` (sorted, deterministic)                                   |
| 1   | Existing memory retrieval | Embed `parsed_messages`; semantic search top-10 for "Existing Memories" prompt section                          |
| 2   | LLM extraction            | Single call with `ADDITIVE_EXTRACTION_PROMPT_V1` + UUID→integer mapping anti-hallucination                      |
| 3   | Batch embed               | All extracted statements in one batch call (provider-batched)                                                   |
| 4   | Hash dedup                | md5 of statement against existing + within-batch                                                                |
| 5   | Type-route persistence    | Each output routed to `mnemo_fact` / `mnemo_decision` / `mnemo_entity` / `mnemo_episode` based on `output.type` |
| 6   | Citation linking          | Each memory → `mnemo_citation` row with source_message_ids + prompt_version + extractor_model                   |
| 7   | Entity batch              | Extract entities from all new memories; merge with existing entity store via similarity ≥ 0.95                  |
| 8   | Save messages buffer      | Append to rolling 10-message buffer per `scope_string`                                                          |

### 6.2 Customizations vs Mem0 V3

- Output includes `kind` (our 7 fact kinds + 8 decision kinds + 8 entity kinds + outcome enum for episodes)
- Output includes `confidence` (0-1 explicit)
- Output includes `attributed_to` (user/assistant/system) — Mem0 has this, we make it required
- `linked_memory_ids` populated by LLM (relations created later by judge)
- `topic_key` suggested if relevant (decision only)
- UUID→integer mapping for both source memories AND in-batch new memories

### 6.3 Prompt versioning

```ts
// packages/mnemosyne/src/extraction/prompts.ts
export const EXTRACTION_PROMPT_VERSION = "v1.0.0"; // bump = invalidate stored extractions
export const ADDITIVE_EXTRACTION_PROMPT_V1 = `...`; // 470+ lines, frozen
```

Every `mnemo_citation` records `extractor_prompt_version`. When we bump to `v1.1.0`, old extractions stay (with their old version tag) but new extractions use the new prompt. Optional re-extract via `sleep-time` cron.

### 6.4 Cost ceiling

Every extraction is gated by `assertWithinSpend(workspaceId, tx)` before the LLM call. After, `recordAiUsage` writes `costUsd` to the workspace ledger. Workspace can configure max extraction cost per conversation (`mnemo.max_extraction_cost_usd`, default $0.05).

---

## 7. Conflict Surfacing

Hybrid trigger: lazy by default, eager opt-in, per-kind rules.

### 7.1 Eager path — Candidate-on-write (Engram-style)

```ts
mnemo.decision.save({
  workspaceId, kind: "architecture", title, body,
  check_conflicts: "thorough"  // 'none' | 'fast' | 'thorough'
})
// Returns:
{
  decision: { id: "mdec_abc", ... },
  judgment_required: true,
  candidates: [
    { id: "mdec_xyz", title: "...", similarity: 0.87, judgment_id: "mrel_pending_1" },
    ...
  ],
  message: "CONFLICT REVIEW PENDING — call mnemosyne_judge(judgment_id, relation) for each candidate"
}
```

The agent **must** call `mnemosyne_judge` per candidate before continuing (when `judgment_required: true`).

### 7.2 Lazy path — Background semantic scan

`mnemo-conflict-scan` cron (hourly) iterates new memories (last hour) and runs:

```sql
SELECT ... FROM mnemo_decision d1, mnemo_decision d2
WHERE d1.created_at > $cutoff
  AND d1.workspace_id = d2.workspace_id
  AND d1.id != d2.id
  AND (1.0 - (d1.embedding <=> d2.embedding)) > 0.85
  AND d1.kind = d2.kind
```

Opens `pending` relations. Agent or human can review via `/api/workspaces/:slug/mnemo/conflicts` admin route.

### 7.3 Rules per kind

```ts
const CONFLICT_RULES = {
  fact: { default: "fast" }, // light candidate check on save
  decision: {
    architecture: "thorough", // always full conflict scan
    policy: "thorough",
    preference: "fast",
    discovery: "lazy", // background only
  },
  entity: { default: "fast" },
  episode: { default: "lazy" }, // episodes don't conflict
} as const;
```

### 7.4 Locked relation vocabulary + frozen prompt

```ts
export const RELATION_VERBS = [
  "related",
  "compatible",
  "scoped",
  "conflicts_with",
  "supersedes",
  "not_conflict",
  "derived_from",
  "part_of",
  "member_of",
] as const;
export const JUDGE_PROMPT_VERSION = "v1.0.0"; // bump = invalidate stored verdicts
export const JUDGE_PROMPT_V1 = `...`; // intentionally frozen
```

---

## 8. Self-Improving Feedback Loops

### 8.1 Signal capture

```sql
CREATE TABLE mnemo_feedback_event (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  memory_kind         text NOT NULL,
  memory_id           text NOT NULL,
  conversation_id     text REFERENCES conversation(id),
  signal              text NOT NULL CHECK (signal IN (
                        'recalled',           -- memory surfaced in recall result
                        'ignored',            -- recalled but agent didn't cite
                        'cited',              -- agent used in response
                        'user_thumbs_up',     -- explicit user positive
                        'user_thumbs_down',   -- explicit user negative
                        'user_edit',          -- user fixed the memory
                        'user_forget',        -- user deleted
                        'retry',              -- user asked again (suggests bad recall)
                        'redirect'            -- user changed subject (bad recall)
                      )),
  weight              real NOT NULL DEFAULT 1.0,
  metadata            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

Signals are written by runtime hooks (recalled/ignored/cited), user UI actions (thumbs/edit/forget), and conversation analysis (retry/redirect detected from message patterns).

### 8.2 Bandit learning on scoring weights

Per-workspace, the 6 scoring weights `{semantic, bm25, entity, recency, frequency, pin}` are stored in `workspace_settings.mnemo_recall_weights`. Sleep-time cron weekly runs a multi-armed bandit (Thompson sampling) to find the weight vector that maximizes `cited` and minimizes `ignored + redirect + retry`.

```ts
// Pseudo-code
function retrain(workspaceId) {
  const candidates = generateWeightVariants(currentWeights, (n = 8));
  const performance = candidates.map((w) =>
    simulateRecall(w, recent7DaysFeedback)
  );
  const winner = thompsonSample(performance);
  if (winner.score > currentScore * 1.05) {
    // 5% improvement threshold
    updateWeights(workspaceId, winner.weights);
    auditLog("mnemo.weights.updated", {
      old: currentWeights,
      new: winner.weights,
    });
  }
}
```

Always preserves `weights[i] >= 0` and `sum(weights) = 1.0`. Audit-logged per update.

### 8.3 Per-workspace optimization

Workspaces have different domain characteristics. A workspace dominated by technical decisions might weight `bm25` higher (exact terms matter). A workspace dominated by user preferences might weight `recency` higher (preferences evolve). The bandit converges to the per-workspace optimum.

Default weights for new workspaces are global-best-known (computed from anonymized cross-workspace averages, opt-in).

---

## 9. Memory Introspection Tools (agent self-reasoning)

Five tools the agent uses to reason ABOUT its own memory:

### 9.1 `mem_introspect(question)`

Agent asks: _"Do I have memories about X?"_ / _"What's my confidence in fact Y?"_ / _"Is decision Z still current?"_. Returns structured answer with citations.

```ts
mnemosyne_introspect({ question: "Do I have any conflicting decisions about refund policy?" })
// →
{
  answer: "Yes, I have 2 active decisions and 1 superseded one on this topic.",
  memories: [
    { id: "mdec_abc", title: "Refund within 30 days", status: "superseded" },
    { id: "mdec_xyz", title: "Refund within 60 days for premium users", status: "active" },
    { id: "mdec_jkl", title: "No refunds on digital goods", status: "active" }
  ],
  relations: [
    { source: "mdec_xyz", target: "mdec_abc", relation: "supersedes", confidence: 0.95 }
  ],
  potential_conflicts: [
    { a: "mdec_xyz", b: "mdec_jkl", reason: "scope_overlap_undefined" }
  ]
}
```

### 9.2 `mem_diff(t1, t2)`

_"What did I learn between January and February?"_. Returns memories created/updated/forgotten in the time window with bitemporal accuracy.

### 9.3 `mem_health()`

Returns workspace memory health snapshot:

```ts
{
  score: 87,
  coverage: 0.92,           // % conversations with extractions
  freshness: 0.78,          // avg relevance after decay
  contradiction_rate: 0.03, // pending relations / total
  recall_quality: 0.81,     // % hits with score > 0.7
  cost_efficiency: 0.94,    // $/recall vs target
  warnings: ["3 decisions marked architecture have no judgments"]
}
```

### 9.4 `mem_confidence(memory_id)`

Returns the agent's current confidence in a memory, computed from `confidence` field + decay + judgment chain + recency of supporting evidence.

### 9.5 `mem_provenance(memory_id)`

Returns recursive proof tree (see §4.1).

---

## 10. Memory Contracts — Inter-Agent Handoffs

When agent A hands off conversation to agent B, they negotiate an explicit memory package.

```sql
CREATE TABLE mnemo_contract (
  id                  text PRIMARY KEY,
  workspace_id        text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  from_agent_id       text NOT NULL REFERENCES agent(id),
  to_agent_id         text NOT NULL REFERENCES agent(id),
  conversation_id     text REFERENCES conversation(id),
  package             jsonb NOT NULL,           -- { facts: [ids], decisions: [ids], entities: [ids], scope: 'conversation' | 'workspace' }
  permissions         text NOT NULL CHECK (permissions IN ('read_only','read_write','read_with_writeback')),
  ratified_at         timestamptz,
  expires_at          timestamptz,
  ratification_status text NOT NULL DEFAULT 'pending' CHECK (ratification_status IN ('pending','ratified','rejected','expired')),
  audit_chain_seq     bigint,                   -- references audit_log.seq for traceability
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

Use case: customer support agent (`agent-sofia`) escalates to specialist (`agent-elena`). Sofia builds a `memory_package` of: facts about the customer, decisions made in this conversation, relevant entities. Elena ratifies (or rejects with reason). Audit-logged.

```ts
mnemosyne_contract_create({
  from: "agent-sofia",
  to: "agent-elena",
  conversation_id: "conv_abc",
  package: {
    facts: ["mfact_user_lang", "mfact_premium_tier"],
    decisions: ["mdec_recent_complaint"],
    entities: ["ment_user_xyz", "ment_product_abc"],
    scope: "conversation",
  },
  permissions: "read_with_writeback",
  expires_in_hours: 24,
});
```

---

## 11. Sleep-Time Compute — "Dreaming"

Background cron at 03:30 UTC daily. Five operations:

| Op                     | Detail                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Merge similar**      | Cosine ≥ 0.92 same-subject pairs in `mnemo_fact` → merge older into newer (already in Brain Core)                                                                                            |
| **Forget low-recall**  | Facts with `hit_count = 0` AND `relevance < 0.1` AND `last_recalled_at IS NULL` for > 60 days → suggest forget (write `mnemo_forget_suggestion` row, requires human approval before applied) |
| **Pattern extraction** | LLM-driven scan of recent conversations → propose new abstract facts (e.g., "user often asks about billing in mornings")                                                                     |
| **Embedding refresh**  | If embedding model has been bumped (config version changed), batch re-embed N oldest memories per night                                                                                      |
| **Weight retrain**     | Run bandit learning over last 7 days of feedback events; update workspace scoring weights if winner beats current by 5%+                                                                     |

Resource-budgeted: max 1 hour of compute per workspace per night. Skipped on workspaces with `mnemo.dreaming_enabled = false` (default `true`).

---

## 12. Cross-Workspace Federation

Workspace A can share memories with workspace B with explicit permission scopes.

```sql
CREATE TABLE mnemo_share_grant (
  id                   text PRIMARY KEY,
  from_workspace_id    text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  to_workspace_id      text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  kind_filter          text[] NOT NULL,         -- which memory kinds shareable
  scope_filter         jsonb,                   -- e.g. {"subject": "company_X", "tags": ["public"]}
  permissions          text NOT NULL CHECK (permissions IN ('read_only','read_write')),
  granted_by_user_id   text NOT NULL REFERENCES "user"(id),
  approved_by_user_id  text REFERENCES "user"(id),     -- to-side approval
  status               text NOT NULL CHECK (status IN ('pending','active','revoked','expired')) DEFAULT 'pending',
  expires_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
```

Recall queries can opt-in to federated search:

```ts
mnemosyne_search({ query, workspaceId: "wsB", federated: true });
// → searches wsB's memories + any wsA memories shared via active grant
```

### 12.1 Mutation log + deferred apply (future)

For when workspaces live on different Postgres clusters (multi-region):

```sql
CREATE TABLE mnemo_mutation_log (
  seq          bigserial PRIMARY KEY,
  workspace_id text NOT NULL,
  entity       text NOT NULL,                  -- 'fact' | 'decision' | 'relation' | ...
  op           text NOT NULL CHECK (op IN ('insert','update','delete')),
  payload      jsonb NOT NULL,
  source       text NOT NULL DEFAULT 'local',
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  acked_at     timestamptz
);

CREATE TABLE mnemo_deferred_apply (
  sync_id        text PRIMARY KEY,
  workspace_id   text NOT NULL,
  entity         text NOT NULL,
  payload        jsonb NOT NULL,
  retry_count    integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'deferred' CHECK (status IN ('deferred','applied','dead')),
  last_error     text,
  first_seen_at  timestamptz NOT NULL DEFAULT now()
);
```

Phase v3.5 — not in v1.

---

## 13. Memory Protocol (Versioned Artifact)

The agent's contract with Mnemosyne — what to save, what to search, when. Lives in code as a frozen artifact:

```ts
// packages/mnemosyne/src/protocol/v1.ts
export const MEMORY_PROTOCOL_VERSION = "v1.0.0";
export const MEMORY_PROTOCOL_V1 = `
# Memory Protocol v1.0.0

You have a long-term memory system (Mnemosyne). Use it:

## CORE TOOLS (always available)
- mnemosyne_recall(query, topK)        — search memories
- mnemosyne_save_fact(...)             — record a fact
- mnemosyne_save_decision(...)         — record an architectural/policy decision
- mnemosyne_judge(judgment_id, relation, reason) — resolve a pending conflict

## TRIGGERS — save IMMEDIATELY when you observe:
- A durable preference: "I prefer X" → save_fact(kind=preference)
- A new trait: "Lucas is left-handed" → save_fact(kind=trait)
- A decision made: "We'll use OAuth not sessions" → save_decision(kind=architecture)
- A bugfix learned: "Don't pass null to X, it crashes" → save_decision(kind=bugfix)
- An event: "Lucas changed jobs to Y" → save_fact(kind=event)
- A new entity mentioned: "Daisy from Acme" → entities extracted automatically

## DO NOT SAVE
- Greetings, time-of-day chitchat
- Information already in the agent's system prompt
- Information you're unsure about (confidence < 0.5)

## SEARCH on first message of session that references project/feature/topic.
## SELF-CHECK after every assistant turn: "Did I learn / decide / observe something durable? If yes → save NOW."

## CONFLICT REVIEW
When a save returns judgment_required: true:
- For each candidate, call mnemosyne_judge with one of 9 verbs
- If unsure, use 'related' with confidence < 0.7 — humans will review
- For architecture/policy decisions: always confidence >= 0.85 or ask user

## SESSION CLOSE
Before saying "done", call mnemosyne_save_episode_summary with:
- Goal · Discoveries · Decisions · Next Steps
`;
```

Versioning: bumping `MEMORY_PROTOCOL_VERSION` is a breaking change. Stored extractions tagged with their protocol version remain. Migration scripts can optionally re-extract under new protocol.

Injection: `agent-runtime.ts` includes `MEMORY_PROTOCOL_V1` in every agent's system prompt (sandwiched between agent-specific prompt and tool definitions).

---

## 14. Agent Surface — Tools + API + Hooks

### 14.1 MCP Tools (4 core eager + 15 deferred)

**Core eager** (always loaded into context):

1. `mnemosyne_recall(query, topK?, scope?, asOf?)` — hybrid search
2. `mnemosyne_save_fact({kind, subject, statement, confidence?, attributed_to?})` — write fact
3. `mnemosyne_save_decision({kind, title, body, topic_key?, check_conflicts?})` — write decision
4. `mnemosyne_judge(judgment_id, relation, reason?, confidence?)` — resolve conflict

**Deferred** (loaded via ToolSearch on demand): 5. `mnemosyne_save_entity({kind, canonical_name, aliases?, attributes?})` 6. `mnemosyne_save_episode_summary({goal, discoveries, accomplished, next_steps})` 7. `mnemosyne_search_topic(topic_key)` 8. `mnemosyne_get_memory(memory_id)` 9. `mnemosyne_update_memory(memory_id, patch)` 10. `mnemosyne_forget_memory(memory_id, reason?)` 11. `mnemosyne_compare(memory_id_a, memory_id_b, model?)` — LLM-driven proactive verdict 12. `mnemosyne_timeline(memory_id, before?, after?)` — chronological context 13. `mnemosyne_introspect(question)` — agent self-reasoning 14. `mnemosyne_diff(t1, t2)` — memory delta 15. `mnemosyne_health()` — workspace health snapshot 16. `mnemosyne_confidence(memory_id)` — current confidence 17. `mnemosyne_provenance(memory_id)` — proof tree 18. `mnemosyne_contract_create({to_agent, package, permissions})` — inter-agent handoff 19. `mnemosyne_doctor()` — health checks

### 14.2 REST API

```
/api/workspaces/:slug/mnemo/
  facts/         GET POST                       — list, create
  facts/:id      GET PATCH DELETE
  decisions/     GET POST
  decisions/:id  GET PATCH DELETE
  entities/      GET POST
  entities/:id   GET PATCH DELETE
  episodes/      GET POST
  episodes/:id   GET PATCH DELETE
  relations/     GET POST
  relations/:id  GET PATCH DELETE
  search         POST { query, topK, ... }
  introspect     POST { question }
  diff           POST { from, to }
  health         GET
  doctor         GET                            — health checks (envelope)
  conflicts      GET                            — pending judgments queue
  conflicts/judge POST { judgment_id, relation, reason }
  contracts      GET POST
  share-grants   GET POST PATCH DELETE
  export         GET (GDPR)
  stats          GET
```

All routes: RBAC gated (`mnemo.read` / `mnemo.write` / `mnemo.admin`), lifecycle gated (suspended/deleted), tx-wrapped (`withMnemoTx`), audit logged.

### 14.3 Runtime hooks (agent-runtime auto-injection)

```ts
// In lib/agent-runtime.ts buildConversationContext()
const hits = await mnemosyne.recall({
  workspaceId,
  query: lastUserMessage.content.slice(0, 500),
  topK: 5,
  agentId,
});
if (hits.length > 0) {
  systemPromptBlocks.push(wrapMemoryBlock(formatHits(hits)));
}
```

After turn:

```ts
void mnemosyne.enqueueExtraction({
  workspaceId,
  conversationId,
  agentId,
  messageCount,
});
```

---

## 15. Embedding Migration — Multi-version

Each memory stores `(embedding, embedding_model, embedding_version, last_embedded_at)`. When the global default model bumps:

- Old memories keep their embeddings (still searchable, but at lower quality vs new memories indexed with the new model).
- New memories use the new model.
- **Lazy re-embed on retrieve**: when recall happens, if the query is embedded with model V2 but a top candidate has V1 embedding, the candidate's V1 embedding is mapped to V2 via a precomputed projection matrix (computed once per model pair from a sample of overlapping documents). Result: gradual migration without downtime.
- **Background re-embed**: sleep-time compute prioritizes re-embedding memories with high `hit_count` (most important to upgrade).

This is unique to Mnemosyne — no competitor supports zero-downtime embedding migration.

---

## 16. Observability + Health

### 16.1 Distributed tracing

Every `mnemo.*` operation emits OpenTelemetry spans with: `workspace_id`, `operation`, `duration_ms`, `cache_hit`, `result_count`, `cost_usd`. Compatible with Datadog APM / Jaeger / Tempo.

### 16.2 Memory health score

Computed every 6 hours per workspace, written to `workspace_settings.mnemo_health_snapshot`:

```ts
score_0_100 = round(
  0.2 * coverage + // % conversations with successful extractions
    0.15 * freshness + // avg relevance after decay
    0.15 * recall_quality + // % hits with score > 0.7
    0.15 * (1 - contradiction_rate) +
    0.1 * cost_efficiency +
    0.1 * judgment_completion + // % pending relations < 24h old
    0.1 * provenance_completeness +
    0.05 * embedding_freshness // % memories with current embedding version
);
```

Visible in admin UI. Compared cross-workspace (anonymized, opt-in).

### 16.3 Drift detection

- Embedding drift: monitor avg cosine between newly extracted memories and their citation sources. Alert if drops > 5% (suggests prompt or model regression).
- Prompt drift: monitor extraction count per conversation, alert if drops > 20% (prompt may have stopped extracting).

### 16.4 Doctor checks

```ts
const DOCTOR_CHECKS = [
  "rls_force_enabled_on_all_tables",
  "audit_chain_valid_in_last_24h",
  "extraction_jobs_not_stuck",
  "pending_relations_under_threshold",
  "embedding_model_consistent",
  "no_orphan_citations",
  "no_orphan_relations",
  "memory_protocol_version_matches_runtime",
  "spend_cap_not_exceeded",
  "decay_cron_ran_in_last_25h",
] as const;
```

Each returns `{ status: 'ok'|'warning'|'error', detail, evidence, safe_next_step }`.

---

## 17. Security: RLS + RBAC + Spend Cap + Audit

### 17.1 RLS+FORCE Pattern A on every table

All 12 tables FORCED. Policies gated by `current_setting('app.workspace_id')`. App helper `withMnemoTx(workspaceId, fn)` sets the GUC via `SET LOCAL` inside a transaction.

### 17.2 RBAC actions

```ts
"mnemo.read"; // viewer+
"mnemo.write"; // editor+
"mnemo.admin"; // admin only — share grants, contracts, weight tuning, reset
```

### 17.3 Audit chain integration

Every mutation calls `appendAudit` (fire-and-forget) for per-record ops, `appendAuditSync` (awaited) for workspace lifecycle ops (share grants, contracts, weight retraining).

Actions logged:

- `mnemo.fact.{create,update,forget}`
- `mnemo.decision.{create,update,supersede,withdraw}`
- `mnemo.entity.{create,update,merge,forget}`
- `mnemo.episode.{create,update}`
- `mnemo.relation.{create,judge,dismiss}`
- `mnemo.contract.{create,ratify,reject,expire}`
- `mnemo.share_grant.{create,approve,revoke}`
- `mnemo.weights.updated` (sync — audit critical)
- `mnemo.protocol_version.bumped` (sync)

### 17.4 Spend cap

Every operation that calls an LLM (extraction, judge, compare, introspect, sleep-time) gates via `assertWithinSpend(workspaceId, tx)` BEFORE and records `recordAiUsage(...)` AFTER. Enforced by `audit-invariants.sh` CI guard.

### 17.5 GDPR export

`mnemo.export(userId | workspaceId)` returns a tarball of all memory rows where the subject relates to the user (resolved via `subject` field + `participant_*` arrays + citations).

---

## 18. Performance + Scale Targets

| Metric                | Target                  | Strategy                                                                      |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| p50 recall latency    | < 80ms                  | L1 LRU + HNSW + parallel embed                                                |
| p99 recall latency    | < 400ms                 | overfetch budget cap + worker concurrency                                     |
| p50 extraction job    | < 3s                    | batch embed + provider streaming                                              |
| p99 extraction job    | < 15s                   | model fallback (workspace small → large on retry)                             |
| Recall cache hit rate | > 60%                   | workspace-LRU + LISTEN/NOTIFY invalidation                                    |
| Memory health score   | > 80 (median)           | scoring weights + drift alerting                                              |
| Cost per 1k recalls   | < $0.50                 | cheap embed model + cached + over-fetch capped                                |
| Cost per extraction   | < $0.005                | workspace small model + max 5 facts cap + 600 tok (or $0 in Ollama self-host) |
| Storage growth        | < 100 MB / 10k memories | dedup + compaction + grace-deleted purge                                      |

Scale ceiling: tested up to 1M memories per workspace before HNSW needs sharding. Multi-region: deferred to v3.5 via mutation log + deferred apply.

---

## 19. Testing Strategy

### 19.1 Unit tests

- Decay formula (true half-life, edge cases)
- BM25 sigmoid normalization (boundary values)
- Score fusion (all signals zero, all signals max)
- Bitemporal range overlap
- Entity boost spread attenuation
- Bandit Thompson sampling determinism (seeded)

### 19.2 Integration tests (testcontainer)

- Extraction → fact + citation written
- Conflict scan → pending relation created
- Judge → relation resolved + audit logged
- Cross-workspace isolation (workspace A cannot see workspace B's memories)
- RLS+FORCE prevents bypass via direct query
- Spend cap blocks extraction when exceeded
- Audit chain valid after N writes
- Embedding migration: V1 embedding retrievable after model bump

### 19.3 Invariant tests (continuous)

- RLS leak probe: query as `app_user` with no GUC → must return 0 rows
- Audit chain integrity: hash chain verify cron
- Spend cap bypass detection: any LLM call without preceding `assertWithinSpend` in same file → CI fail
- Workspace*id presence: any new mnemo*\* table must have workspace_id column → CI lint

### 19.4 E2E (real LLM)

- Full conversation → extraction → recall → cited → user thumbs → feedback loop
- Inter-agent handoff with memory contract
- Bitemporal query: "what did the agent know at T?"
- Provenance proof tree

---

## 20. Roadmap

| Phase                                            | Duration | Scope                                                                                                                                                      | Deliverable                                |
| ------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **v0.1 — Migration**                             | 1 week   | Rename brain*\* → mnemo*\*, move to `packages/mnemosyne`, backfill data, update routes                                                                     | Migration deployed, no feature regressions |
| **v1.0 — Decision + Graph + Citation**           | 3 weeks  | `mnemo_decision`, `mnemo_relation`, `mnemo_citation`. Candidate-on-write loop. 9 locked verbs. Topic-key shortcut. Hybrid retrieval (vec+FTS+entity boost) | Tag `mnemosyne-v1.0`                       |
| **v1.5 — Bitemporal + Extraction V3**            | 2 weeks  | `valid_from / valid_to` on all primitives. Fork Mem0 V3 prompt. UUID→int trick. `attributed_to`. Language detection                                        | Tag `mnemosyne-v1.5`                       |
| **v2.0 — Entities + KG**                         | 3 weeks  | `mnemo_entity`, entity extraction in pipeline, entity boost in recall, recursive CTE traversal                                                             | Tag `mnemosyne-v2.0`                       |
| **v2.5 — Episodes + Memory Protocol**            | 1 week   | `mnemo_episode`, memory protocol v1 artifact, runtime injection, tool profiles                                                                             | Tag `mnemosyne-v2.5`                       |
| **v3.0 — Introspection + Feedback + Sleep-Time** | 4 weeks  | Introspection tools, `mnemo_feedback_event`, bandit learning, sleep-time cron                                                                              | Tag `mnemosyne-v3.0`                       |
| **v3.5 — Federation + Contracts**                | 3 weeks  | `mnemo_contract`, `mnemo_share_grant`, mutation log + deferred apply                                                                                       | Tag `mnemosyne-v3.5`                       |
| **v4.0 — Observability + Health Dashboard**      | 2 weeks  | OpenTelemetry traces, memory health score, drift detection, admin dashboard                                                                                | Tag `mnemosyne-v4.0`                       |

**Total: ~19 weeks** for full vision. **v1.0 (closing Engram gap + adding hybrid retrieval) shippable in 4 weeks** — that's the MVP that already surpasses anything OSS.

---

## 21. Migration Plan — brain*\* → mnemo*\*

### Phase 0 — Preparation (no downtime)

1. Create `packages/mnemosyne` scaffolding
2. Copy current Brain Core code into package, rename exports
3. Add Drizzle schema for all 12 mnemo*\* tables (alongside existing brain*\*)
4. Migrations: create new tables empty + RLS+FORCE policies

### Phase 1 — Dual write (1 day)

1. Update `extract-job.ts` to write to BOTH `brain_fact` AND `mnemo_fact` for new extractions
2. Verify counts match in test workspace

### Phase 2 — Backfill (cron, no downtime)

```sql
INSERT INTO mnemo_fact (id, workspace_id, ..., embedding, text_lemmatized, valid_from, ...)
SELECT id, workspace_id, ..., embedding, to_tsvector(statement), created_at, ...
FROM brain_fact;
```

Run in batches of 10k, verify integrity after each batch.

### Phase 3 — Cutover reads (1 day)

1. Update `recall.ts` to read from `mnemo_fact` (still dual-writing)
2. Monitor recall results to ensure parity

### Phase 4 — Stop brain\_\* writes

1. Remove dual write
2. Mark `brain_*` tables as deprecated

### Phase 5 — Grace period (30 days)

1. `brain_*` tables kept read-only as fallback
2. After 30 days clean, run final integrity check + drop

### Phase 6 — Drop brain\_\*

```sql
DROP TABLE brain_fact CASCADE;
DROP TABLE brain_extraction_job CASCADE;
```

Total migration time: ~4 weeks (with grace period). Zero-downtime, reversible until Phase 6.

---

## 22. Open Questions

1. **OQ-1: spaCy-equivalent in JS for entity extraction**. Mem0 uses Python spaCy. Options for JS: (a) `compromise.js` (lightweight, lower accuracy), (b) `wink-nlp` (better but heavier), (c) LLM-only extraction (highest quality, highest cost), (d) BYO via worker subprocess (complexity). Lean: (c) LLM-only in v1, evaluate (b) for v2 cost reduction.

2. **OQ-2: Cross-model embedding projection matrix**. Computing the projection from V1→V2 requires a calibration sample. How big? When to refresh? Lean: 10k sampled memory pairs, refreshed quarterly.

3. **OQ-3: Anonymized cross-workspace weight benchmarks**. Opt-in telemetry to compute global-best-known starting weights for new workspaces. Privacy review needed. Lean: defer to v3.5.

4. **OQ-4: GraphQL endpoint for graph queries?** REST works for fact CRUD but graph queries naturally suit GraphQL. Lean: defer; recursive CTE in SQL works for v1-v3.

5. **OQ-5: Memory feedback UI for end users**. Letting users browse/edit/forget their memories via web UI raises GDPR/privacy considerations. Lean: ship admin-only browse in v1; user-facing UI is v3+.

6. **OQ-6: Multilingual extraction language tag**. Mem0 V3 has `use_input_language` flag. Should we auto-detect or require explicit? Lean: auto-detect via `franc-min` library + fallback to workspace default.

---

## 23. ADR Reference

**To create**: `docs/adr/0020-mnemosyne-memory-architecture.md` — short ADR documenting:

- Decision: build Mnemosyne as `packages/mnemosyne`, supersede Brain Core v1.1
- Rationale: combine Engram + Mem0 + Letta + Zep best parts; add 10 paradigm-shift features no OSS has
- Trade-offs: 12 tables vs 2 (Brain Core), 19-week roadmap vs incremental Brain Core v2
- Reversibility: full (data backfill + grace period; can roll back to brain\_\* until Phase 6)

**Supersedes**: nothing currently. Brain Core v1.1 is implemented in `apps/web/lib/brain/*` but not as an ADR.

**References**:

- Engram deep-dive analysis: this session (Brain Decision Layer pre-work)
- Mem0 V3 audit: this session (extraction pipeline study)
- ADR 0003: Postgres-only — preserved (Mnemosyne uses only Postgres + pgvector)
- ADR 0014: Workspace owner trigger — compatible
- ADR 0019: Brain exponential decay — supersedes (Mnemosyne extends with bitemporal + per-kind decay)

---

## 24. Success Criteria

Mnemosyne is successful when:

1. ✅ Orchester agents demonstrably get smarter about each customer over time, measurable via cited memory rate per conversation
2. ✅ External OSS contributors can adopt `@orchester/mnemosyne` standalone (post-v3.0 spin-out)
3. ✅ Recall p50 < 80ms at 100k memories/workspace
4. ✅ Memory health score median > 80 across all production workspaces
5. ✅ Zero RLS leak incidents (continuous probing)
6. ✅ Audit chain remains valid (continuous verification)
7. ✅ Spend per memory operation tracked end-to-end, within workspace cap
8. ✅ At least one paradigm-shift feature (introspection / contracts / federation / dreaming) cited by external community as influential
9. ✅ At minimum, beats Mem0 OSS on LoCoMo benchmark (Mem0 V3 achieves 91.6 — target Mnemosyne v3.0 ≥ 93)
10. ✅ Documented in conferences / blog posts as "the reference architecture for AI agent memory"

---

---

## 25. Provider Agnosticism Charter

**Status**: Mandatory · Applies to ALL Mnemosyne code, configuration, and roadmap decisions.

Mnemosyne is OSS substrate. **No platform-level third-party cost. No vendor lock-in.** Every operation must work with ANY provider the workspace chooses, including 100% local (Ollama / fastembed / whisper.cpp).

### 25.1 Hard rules

1. **No operation requires a specific provider.** Mnemosyne core never branches on `provider === "anthropic"`. Provider-specific optimizations live in adapter layer behind capability detection.
2. **No platform feature costs the operator anything beyond Postgres hosting.** No SaaS dependencies for queue / cache / vector / observability / messaging.
3. **AI is BYO per workspace.** Workspace configures providers via Orchester's existing 88-adapter catalog.
4. **All adapter optimizations are opportunistic.** If provider supports prompt caching → adapter uses it transparently. If not → adapter no-ops. Call signature is identical.
5. **Self-host default = zero AI cost.** Ollama (LLM) + Ollama `nomic-embed-text` (embed) + `fastembed-rs` cross-encoder (rerank) shipped pre-configured.
6. **Provider catalog is workspace-scoped, tier-routed**: `mnemo.small_model`, `mnemo.large_model`, `mnemo.embedding_model`, `mnemo.rerank_model`. Each can be a different provider.

### 25.2 Explicit exclusions

- ❌ Anthropic prompt caching as REQUIRED — only opportunistic when adapter reports `supportsPromptCaching: true`
- ❌ Specific embedding model as REQUIRED default
- ❌ Cloud vector stores (Pinecone, Qdrant Cloud, Weaviate Cloud)
- ❌ Cloud queue (SQS, Redis Cloud, RabbitMQ Cloud)
- ❌ Cloud cache (Redis Cloud, Memcached Cloud)
- ❌ Cloud observability (Datadog APM, NewRelic, Honeycomb) — OTel exporter to optional BYO backend
- ❌ Required reranker provider (Cohere, Voyage, Jina) — opt-in BYO only; default is local cross-encoder

### 25.3 Capability interface

```ts
// packages/mnemosyne/src/adapters/types.ts
export interface ModelAdapter {
  readonly providerId: string;

  call(params: CallParams): Promise<CallResult>;
  callBatched(params: CallParams[]): Promise<CallResult[]>;
  embed(texts: string[]): Promise<number[][]>;

  // Capability flags — Mnemosyne opportunistically optimizes
  supportsPromptCaching(): boolean;
  supportsJSONMode(): boolean;
  supportsBatchedCompletion(): boolean;
  supportsBatchedEmbedding(): boolean;

  // Cost reporting (for spend cap + observability + Pareto dashboard)
  costPer1MTokens(): { input: number; output: number };
  costPer1MEmbeddings(): number;
}

export interface CallParams {
  workspaceId: string;
  systemPrompt: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  cacheableBlocks?: string[]; // Mnemosyne marks; adapter decides if it uses them
  costCeiling?: number; // hard fail if estimated cost exceeds
}
```

### 25.4 Recommended Provider Catalog (workspace UI guidance)

When a workspace owner first configures Mnemosyne, the UI shows recommended providers with live cost estimates calculated from `costPer1MTokens()`. **Defaults bias toward cheap-and-good models** so customers don't accidentally pick expensive defaults.

**Small model (extraction + judging)** — REQUIRED:

| Recommendation         | Provider             | Est. cost/mo | Strengths                        |
| ---------------------- | -------------------- | ------------ | -------------------------------- |
| ⭐ Most cost-effective | `gemini-flash-2.0`   | $0.82        | Cheap, fast, reliable JSON       |
| 🚀 Fastest             | `groq/llama-3.3-70b` | $1.11        | 700 tok/s, free tier available   |
| 💎 Most reliable       | `gpt-4o-mini`        | $1.58        | Best JSON mode, mature ecosystem |
| 🧠 Best reasoning      | `deepseek-v3`        | $2.79        | Strong for the price             |
| 🇪🇺 EU-resident         | `mistral-small-2410` | $1.72        | EU data residency                |
| 💰 Premium             | `claude-haiku-4-5`   | $12          | Best instruction-following       |

Plus: any other provider via Orchester's 88-adapter catalog (OpenRouter, Cohere, Together, Fireworks, Anyscale, etc.) or custom OpenAI-compatible endpoint.

**Large model (optional retry escalation)**: defaults to "None — skip escalation" for cost. Customer can pick `gemini-pro-2.5`, `gpt-4o`, `claude-sonnet-4-6`, or any other.

**Embedding model** — REQUIRED:

| Recommendation          | Provider                        | Est. cost/mo            |
| ----------------------- | ------------------------------- | ----------------------- |
| ⭐ Cheapest viable      | `openai/text-embedding-3-small` | $0.05                   |
| 🌍 Free tier            | `jina-embeddings-v3`            | $0 (10M tokens/mo free) |
| 🎯 Best quality cheap   | `voyage-3-lite`                 | $0.04                   |
| 💪 Best quality premium | `voyage-3` / `cohere-embed-v3`  | $0.20                   |

**Rerank model** — OPTIONAL (skipped by default for cost). Customer enables only if recall quality demands it.

### 25.5 Demo mode + Free tier auto-detection

If workspace owner has configured providers with public free tiers (Groq free, Jina free, Gemini free tier with daily quota), Mnemosyne automatically routes operations through them when within quota. Display banner: _"Running on free tier — $0 cost. Upgrade providers to scale."_

Free tiers as of May 2026:

- **Groq**: 14400 requests/day on llama-3.3-70b
- **Gemini**: 1500 requests/day on flash-2.0 (free tier API key)
- **Jina embeddings**: 10M tokens/month
- **Together AI**: $1 credit on signup
- **Cohere**: 1000 calls/month trial

A demo workspace can run entirely on free tiers up to thresholds. Mnemosyne tracks per-provider quotas + alerts when crossing 80%.

### 25.6 BYO cost calculator (live in Inspector UI)

The Studio Memory Inspector (§31) renders a live calculator:

```
┌─ Current month estimate ────────────────────────────┐
│ Workspace: acme-prod                                 │
│ Provider stack: gemini-flash-2.0 + openai-3-small    │
│                                                       │
│ Conversations this month:    1,247                   │
│ Extractions triggered:         284 (77% skipped)    │
│ Recalls served:              4,512                   │
│   ↳ from cache (free):       2,189 (49%)            │
│                                                       │
│ Spend breakdown:                                     │
│   Extraction LLM:      $0.66                         │
│   Recall (no LLM):     $0.00                         │
│   Embedding:           $0.04                         │
│   ─────────────────────                              │
│   Total month-to-date: $0.70                         │
│   Projected month-end: $0.95                         │
│                                                       │
│ vs Mem0 OSS equivalent: $3.80 (75% savings)         │
│ vs Engram equivalent:    $4.20                       │
└──────────────────────────────────────────────────────┘
```

Updated in real-time. Per-workspace + per-namespace + organization-rollup views.

---

## 26. Cost Engineering (Tier 1) — 95% reduction, fully agnostic

Eight techniques. All pure code or adapter-level. **Total estimated reduction: 95% vs spec baseline, 100% provider-agnostic.**

### 26.1 Heuristic pre-filter (A1) — saves ~80% of extraction calls

Before any LLM call, run a pure-code classifier:

```ts
function shouldExtract(messages: Message[]): { yes: boolean; reason: string } {
  const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
  if (totalChars < 80) return { yes: false, reason: "too_short" };

  const allShort = messages.every((m) => m.content.length < 30);
  if (allShort) return { yes: false, reason: "all_short_messages" };

  const contentTokens = extractContentTokens(messages);
  if (contentTokens.length < 10)
    return { yes: false, reason: "no_content_tokens" };

  // Positive indicators (any match → yes)
  const indicators = [
    /\b(prefer|like|love|hate|need|want|always|never|usually)\b/i,
    /\b(decided|will|going to|plan to|chose|adopted)\b/i,
    /\b(at|in|from|works for|lives in|located)\b/i,
    /\b(my (name|email|phone|address|company|team|role))\b/i,
    /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/, // proper nouns
  ];
  const positive = indicators.some((re) =>
    messages.some((m) => re.test(m.content))
  );
  return {
    yes: positive,
    reason: positive ? "indicator_match" : "no_indicator",
  };
}
```

Logged to `mnemo_extraction_job.metadata.skip_reason` when skipped.

### 26.2 Provider-transparent prompt caching (A2) — opportunistic 30-50% bonus

Mnemosyne passes `cacheableBlocks: [SYSTEM_PROMPT, EXAMPLES_BLOCK]` on every call. Adapter checks its own `supportsPromptCaching()`:

- **Anthropic adapter**: applies `cache_control: { type: 'ephemeral' }` headers
- **OpenAI adapter**: uses `prompt_cache_key`
- **Ollama / local adapters**: no-op (caching implicit via model loading)
- **All other providers**: no-op

Provider-agnostic by design — call signature is identical. Mnemosyne never branches on provider id.

### 26.3 Speculative tier routing (A3) — ~40% additional reduction

```ts
// Workspace config
mnemo.small_model; // e.g., "ollama/llama3.2-3b" or "anthropic/claude-haiku-4-5"
mnemo.large_model; // e.g., "ollama/llama3.3-70b" or "anthropic/claude-sonnet-4-6"
mnemo.embedding_model;
mnemo.rerank_model;
```

Extraction pipeline:

1. Small model first with 1-token probe: _"Is this conversation worth extracting facts from? (yes/no)"_
2. If "no" → skip. If "yes" → small model does extraction.
3. Schema validation. On failure → escalate to large model retry.

### 26.4 BYO cloud API as default + Optional local inference (advanced)

**Critical operational note**: running local LLMs (Ollama 3B+) on cloud-hosted Orchester would require dedicated GPU per instance ($350-$2000/mo per server). That's operator-borne cost that violates §25 Charter rule #2 (zero platform-level third-party cost). **Local inference is NOT the default. It is an opt-in advanced configuration.**

**DEFAULT (both cloud-hosted and self-host)**: Workspace MUST configure at minimum `mnemo.small_model` with a BYO API key. UI shows recommended models with live cost estimate (see §25.4).

**Recommended cheap defaults (May 2026 pricing, per active workspace ~30k turns/mo)**:

- `gemini-flash-2.0` → **$0.82/mo** (cheapest viable) ⭐
- `groq/llama-3.3-70b` → $1.11/mo (fastest: 700 tok/s)
- `gpt-4o-mini` → $1.58/mo (most reliable JSON)
- `deepseek-v3` → $2.79/mo (capable for the price)
- `claude-haiku-4-5` → $12/mo (premium)

**OPT-IN LOCAL (advanced operators only)**:

- Operator sets `MNEMO_LOCAL_INFERENCE_ENABLED=true` env flag at instance level
- Customer configures workspace models pointing at `ollama/...` or `whisper.cpp`
- **Customer responsible for compute** — their own host, their own GPU
- Documented use cases: homelab self-host, on-prem zero-trust requirements, air-gapped deployments, customers with idle GPU capacity

**Never auto-enabled. Never assumed available on cloud-hosted Orchester.** The install script offers Ollama setup as an OPTIONAL step with explicit warning about compute requirements.

### 26.5 Batched extraction window (A5) — 30% extra

pg-boss singleton-keyed job with debounce. New turn → reset 60s timer. Fires on timer expiry OR N=5 turns. Single LLM call for joined messages.

### 26.6 Memory budget cap per workspace (A6)

```ts
mnemo.max_memories_per_kind: { fact: 10000, decision: 5000, entity: 5000, episode: 2000 }
mnemo.max_extraction_cost_usd_per_conversation: 0.05
mnemo.max_total_cost_usd_per_day: 10
mnemo.kill_switch_on_daily_exceed: true
```

On `max_memories_per_kind` exceeded → sleep-time aggressive forget (lowest `relevance * (1 + hit_count)`). On `max_total_cost_usd_per_day` → halt all Mnemosyne LLM ops until next day.

### 26.7 Hierarchical caching (A7) — 50% recall reduction

| Layer                       | Storage                      | TTL | Key                           | Hit saves                |
| --------------------------- | ---------------------------- | --- | ----------------------------- | ------------------------ |
| L1 — Query LRU              | In-process (5k entries)      | 60s | (ws, query_hash, scope, topK) | Full recall + embed + DB |
| L2 — Embedding LRU          | In-process (10k entries)     | 1h  | (ws, model, text_hash)        | Embedding API call       |
| L3 — Semantic-similar query | Postgres `mnemo_query_cache` | 24h | Closest query cosine > 0.95   | Full recall + embed      |
| L4 — Cluster invalidation   | LISTEN/NOTIFY                | N/A | workspace_id                  | Cross-replica freshness  |

L3: `mnemo_query_cache(query_embedding, result_ids, workspace_id, last_used_at)`. New queries embed first, check L3 — if cosine > 0.95 with recent query → reuse results. All in Postgres, no Redis.

### 26.8 Lazy embeddings on hot path (A8)

Asymmetric write/read:

- **On write**: `embedding = NULL`, `embedding_status = 'pending'`
- **On read**: if memory matches via BM25 alone and is pending → embed lazily on the side, include in results without semantic score
- **Sleep-time**: nightly job embeds all pending

Most memories never get hit → never embedded → free.

### 26.9 Cost projection — real BYO providers (30k turns/month active workspace)

After A1+A3+A7 optimizations (80% pre-filter + 50% speculative + 50% cache hit = ~3000 effective LLM extractions/mo, 12k effective recalls/mo):

| Workspace BYO configuration             | Extraction | Recall | Embed | **Total/mo** |
| --------------------------------------- | ---------- | ------ | ----- | ------------ |
| **gemini-flash-2.0** + openai-3-small   | $0.77      | $0.00  | $0.05 | **$0.82** ⭐ |
| **groq/llama-3.3-70b** + openai-3-small | $1.06      | $0.00  | $0.05 | **$1.11**    |
| **gpt-4o-mini** + openai-3-small        | $1.53      | $0.00  | $0.05 | **$1.58**    |
| **mistral-small** + voyage-3-lite       | $1.68      | $0.00  | $0.04 | **$1.72**    |
| **deepseek-v3** + jina-free-tier        | $2.79      | $0.00  | $0.00 | **$2.79**    |
| **claude-haiku-4-5** + openai-3-small   | $12.00     | $0.00  | $0.05 | **$12.05**   |
| **Self-host Ollama** (customer's GPU)   | $0         | $0     | $0    | **$0\***     |

\* Customer's own hardware/cloud GPU compute. Platform operator pays $0.

**Critical: platform operator pays $0 for AI regardless of choice.** Customer's API key handles all usage.

Comparison vs OSS incumbents:

- **Mem0 OSS**: same provider choices, no pre-filter (5x calls), no hierarchical cache, no speculative tier → ~$4-8/mo equivalent
- **Engram**: no auto-extraction, agent-curated, but every turn includes save tool call → 2-3x more agent input tokens → ~$5-15/mo equivalent
- **Mnemosyne**: lowest TCO in OSS via stack of agnostic optimizations

---

## 27. Multi-modal Memory (C1)

Three media: image, audio, document. All provider-agnostic.

### 27.1 Image memories

```sql
ALTER TABLE mnemo_fact ADD COLUMN image_url text;
ALTER TABLE mnemo_fact ADD COLUMN image_embedding vector(768);  -- CLIP/SigLIP dim
ALTER TABLE mnemo_fact ADD COLUMN image_caption text;            -- LLM-generated
```

Provider: workspace's chosen multimodal model — OpenAI vision, Anthropic vision, Gemini vision, Ollama `llava`, local SigLIP, etc.

Cross-modal recall: text query embedded → searches both text and image embeddings (projected to shared space).

**Use cases**: browser extension agent (screenshot → memory), email agent (attachments → memories), voice agent (user-shared visual context).

### 27.2 Audio memories

```sql
CREATE TABLE mnemo_audio_memory (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  episode_id text REFERENCES mnemo_episode(id) ON DELETE SET NULL,
  audio_url text,
  duration_seconds real,
  transcript text,                          -- STT-extracted
  transcript_embedding vector(1536),
  voice_embedding vector(192),              -- speaker fingerprint
  speaker_id text,
  language text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

STT provider: workspace's chosen — OpenAI Whisper API, Deepgram, AssemblyAI, or local `whisper.cpp`. **Local whisper.cpp ships in self-host install for zero cost.**

**Use cases**: voice agent sessions, meeting bots with diarization, voice dictation.

### 27.3 Document memories

Bidirectional linkage to existing `knowledge_chunk` (KB schema preserved, not duplicated):

```sql
CREATE TABLE mnemo_document_link (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  memory_kind text NOT NULL CHECK (memory_kind IN ('fact','decision','entity','episode')),
  memory_id text NOT NULL,
  knowledge_chunk_id text NOT NULL REFERENCES knowledge_chunk(id) ON DELETE CASCADE,
  relevance real CHECK (relevance BETWEEN 0 AND 1),
  excerpt text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Memories can cite KB chunks. Recall optionally federates (`include_kb: true`) returning hits from both with unified ranking. Provenance shows KB chunks in proof trees.

### 27.4 Cross-modal search

```ts
mnemosyne.search({
  workspaceId,
  query: "the diagram about OAuth flow",
  modes: ["text", "image", "audio", "document"],
  topK: 5,
});
```

Unified ranking across modes via projected embeddings.

---

## 28. Memory Inference Engine (C2)

Memories alone are dead. The inference engine resolves implicit facts via graph traversal + attribute inheritance — turning memory into knowledge.

### 28.1 Implicit fact inference (example)

State:

- Fact: `subject=user, kind=trait, statement="works at Acme"`
- Entity: `kind=organization, canonical_name=Acme, attributes={industry: "fintech", type: "startup"}`

Query: _"What industry does the user work in?"_

```ts
mnemosyne.infer({
  workspaceId, question: "What industry does the user work in?", hops: 2
})
// →
{
  answer: "Fintech",
  confidence: 0.83,
  reasoning_path: [
    { hop: 1, source: "fact:user-works-at-Acme", relation: "subject_of" },
    { hop: 2, source: "entity:Acme", attribute: "industry=fintech" }
  ],
  citations: ["mfact_user_employer", "ment_acme"]
}
```

### 28.2 Temporal reasoning

```ts
mnemosyne.infer({
  question: "When did the user change jobs?",
  reasoning: "temporal",
});
// Detects facts with overlapping/closing valid ranges → "Between 2026-03-15 and 2026-03-22"
```

### 28.3 Contradiction reasoning

```ts
mnemosyne.infer({
  question: "Are there contradictions in my memory about refund policy?",
  scope: { topic_key: "billing/refund-policy" },
});
```

### 28.4 Implementation

1. Embed question + recall top-20 candidate memories (vector + FTS)
2. Build sub-graph: relations between candidates (1-2 hops)
3. Pass sub-graph + question to **workspace's small model** with locked structured prompt
4. Return answer + reasoning path + confidence

`INFERENCE_PROMPT_VERSION = "v1"`. Cost: ~$0.002 per inference (small model, ~300 tokens out, cached 5min).

**No other system has this**: requires graph + bitemporal + locked vocabulary together. Mnemosyne has all three.

---

## 29. Workflow + Skill Memory (C3 + C4)

### 29.1 Workflow memory

Every `flow_run` writes a `mnemo_episode` on completion:

```ts
{
  kind: "episode",
  goal: flow.description,
  summary: "Ran flow X with input Y, produced Z",
  outcome: "success" | "partial" | "blocked" | "abandoned",
  metadata: {
    flow_id, flow_version, duration_ms, cost_usd,
    failed_nodes: [...], succeeded_nodes: [...],
    error_messages: [...]
  }
}
```

Flow engine on start queries: _"Have I run this flow before? Any past failures to avoid?"_. Past episodes inform branching ("last time approach X failed at step 3 — try Y").

**Result: self-improving flows.**

### 29.2 Skill memory

Skills (catalog #34-58) stored as `mnemo_fact` with `kind="skill"`:

```ts
{
  kind: "skill",
  subject: "skill:" + skill_id,
  statement: skill.description,
  metadata: {
    capability_vector: number[],
    input_schema, output_schema,
    cost_estimate, success_rate, invocation_count,
    tags: string[]
  }
}
```

Capability search becomes a Mnemosyne recall:

```ts
mnemosyne.search({
  query: "I need to summarize a long PDF",
  filters: { kind: "skill" },
  topK: 3,
});
// → top-3 skills by capability vector similarity + success rate
```

Skill discovery is automatic — agent describes task, Mnemosyne returns relevant skills.

---

## 30. KB Linkage + Memory Namespaces (C5 + C6)

### 30.1 KB linkage

Mnemosyne ⇄ existing `knowledge_*` schema interoperate bidirectionally:

- **Memory cites KB**: `mnemo_citation.source_kind = 'document'`, `source_id = knowledge_chunk.id`
- **KB chunks federate into recall**: `include_kb: true` returns hits from both with unified ranking
- **Provenance includes KB** in recursive proof trees

No duplication. KB stays canonical for long-form docs. Mnemosyne stores facts derived with citations.

### 30.2 Memory namespaces

Permission-scoped sub-division within a workspace:

```sql
CREATE TABLE mnemo_namespace (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  parent_namespace_id text REFERENCES mnemo_namespace(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mnemo_fact ADD COLUMN namespace_id text REFERENCES mnemo_namespace(id);
ALTER TABLE mnemo_decision ADD COLUMN namespace_id text REFERENCES mnemo_namespace(id);
ALTER TABLE mnemo_entity ADD COLUMN namespace_id text REFERENCES mnemo_namespace(id);
ALTER TABLE mnemo_episode ADD COLUMN namespace_id text REFERENCES mnemo_namespace(id);
```

**Use cases**: enterprise multi-team (engineering/sales/support), multi-product, compliance tiers (public/internal/restricted).

RLS additive: workspace_id AND namespace_id permissions. RBAC: `mnemo.namespace:<name>:read`.

---

## 31. Studio Memory Inspector UI (D1)

Admin UI: `/orchester/admin/mnemosyne/`.

### 31.1 Views

| View                 | Purpose                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Dashboard            | Health score 0-100, kind distribution, decay curve, recent extractions, pending conflicts |
| Memory browser       | Filterable table + bitemporal slider ("show as of date")                                  |
| Memory detail        | Full content + provenance proof tree + relations graph + edit history                     |
| Conflicts queue      | Pending relations, bulk-resolve UI, per-conflict diff                                     |
| Search playground    | Live recall with score breakdown per signal visible per hit                               |
| Inference playground | Test inference engine with reasoning path visualization                                   |
| Settings             | Providers per tier, budget caps, namespace management, RBAC                               |

### 31.2 Privacy actions

- "Forget" per memory (audit-logged)
- Bulk forget by subject (GDPR Article 17)
- Export workspace memory (GDPR Article 15)
- Memory access log (who viewed what when)

---

## 32. PII Detection Layer (D10)

Mandatory privacy guard. Phase 8.5 of extraction (after extraction, before persist).

### 32.1 Detection

1. **Regex layer**: emails, phone, SSN, credit cards, IPs, API keys
2. **NER layer**: person names, org names, locations
3. **LLM layer** (optional, high-confidence): workspace's small model scores PII risk 0-1

Attached to memory:

```ts
metadata.pii: { detected: true, categories: ["email", "phone"], risk_score: 0.85, detected_at: timestamp }
```

### 32.2 Actions (per-category workspace config)

- **WARN** — store but flag in UI (default)
- **REDACT** — replace tokens with `[REDACTED-<category>]` before persist
- **REJECT** — skip extraction entirely, audit log

Default new workspace: `email/phone → WARN`, `ssn/credit_card → REDACT`, `api_key → REJECT`.

### 32.3 Compliance

Audit log per PII detection. Provenance shows PII detection step. Export includes PII flag for GDPR right-of-access.

---

## 33. Continuous Benchmark CI (B1)

### 33.1 Benchmarks shipped

- **LoCoMo** — target Mnemosyne v3.0 ≥ 92 (Mem0 V3: 91.6)
- **LongMemEval** — target ≥ 95 (Mem0 V3: 94.8)
- **BEAM-1M / BEAM-10M** — target ≥ Mem0 V3 baselines
- **Orchester Synthetic 1k** — 1000 conversations with curated ground-truth (custom)
- **Provider Parity Suite** — same benchmark across {OpenAI, Anthropic, Gemini, Ollama-local, Together} → measures agnosticism quality

### 33.2 CI integration

Every PR touching `packages/mnemosyne/`:

1. Spins up testcontainer Postgres + local Ollama
2. Runs each benchmark with Ollama-local (cost = $0)
3. Compares against baseline (`benchmarks/baseline.json`)
4. Fails PR if any benchmark drops > 2%
5. Posts comment with delta

Quarterly: runs with cloud providers, results published.

### 33.3 Public dashboard

`https://mnemosyne.dev/benchmarks` (post spin-out): live benchmark scores per release. Reproducibility kit: `git clone + docker compose up + npm run bench` reproduces all numbers locally.

---

## 34. Deterministic Replay (B2)

Research-grade reproducibility:

- **Fixed prompt versions**: `EXTRACTION_PROMPT_VERSION`, `JUDGE_PROMPT_VERSION`, `INFERENCE_PROMPT_VERSION` const-locked
- **Temperature 0** for all Mnemosyne LLM calls
- **Seeded UUIDs**: `mnemo_seed = hash(workspaceId, conversationId, messageIds)`
- **Recorded responses** (dev mode): replay tests use cached LLM responses

Same input + same state + same prompt versions → bit-identical output. Critical for benchmarks, test stability, debugging, migration validation.

---

## 35. Revised Roadmap v2 (Tier 1 incorporated)

| Phase                                                                       | Duration | Scope                                                                                                                              |
| --------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **v0.0 — Provider Audit**                                                   | 0.5 wk   | Audit existing brain\_\* for provider-specific assumptions. Refactor to use workspace catalog. Charter §25 enforced.               |
| **v0.1 — Migration**                                                        | 1 wk     | brain*\* → mnemo*\*, move to `packages/mnemosyne`                                                                                  |
| **v1.0 — Decision + Graph + Citation + Cost Engineering + PII + UI v0**     | 4 wk     | All v1.0 features + Cost engineering §26 (A1+A2+A3+A7) **integrated from day 1** + PII detection §32 + Inspector UI v0 (read-only) |
| **v1.5 — Bitemporal + Extraction V3 + Determinism + Benchmarks**            | 2 wk     | + Deterministic replay §34 + Benchmark CI scaffold §33                                                                             |
| **v2.0 — Entities + KG + Inference Engine + Workflow Memory**               | 4 wk     | + Inference engine §28 + Workflow memory §29.1                                                                                     |
| **v2.5 — Episodes + Memory Protocol + Skill Memory + KB Linkage**           | 2 wk     | + Skill memory §29.2 + KB linkage §30.1                                                                                            |
| **v3.0 — Introspection + Feedback + Sleep-Time + Multi-modal + Namespaces** | 5 wk     | + Multi-modal §27 + Memory namespaces §30.2 + Provider failover §36.4                                                              |
| **v3.5 — Federation + Contracts + Inspector v1**                            | 3 wk     | + Inspector UI v1 (edit/audit/forget) + Lazy embeddings §26.8                                                                      |
| **v4.0 — Observability + Reference Apps + Public Benchmark**                | 3 wk     | + Public benchmark dashboard §33.3 + 3 reference apps                                                                              |

**Total: ~25 weeks** (was 19 pre-Tier 1).
**v1.0 ships in 4 weeks** with cost engineering integrated → already surpasses every OSS competitor on cost AND quality.

### Enterprise tier additions (deferred phases)

| Phase                                             | Duration | Scope                                                                                                                                    |
| ------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **v3.x — Local inference opt-in**                 | 1 wk     | Optional Ollama/whisper.cpp installation docs, Docker compose recipes, GPU sizing guide. NOT default in any phase.                       |
| **v4.5 — Enterprise Cost Governance**             | 3 wk     | §36 multi-level ceilings + spend forecasting + per-feature attribution + provider failover + free-tier auto-arbitrage + showback exports |
| **v5.0 — Multi-region + Sharding**                | 4 wk     | §37 read replicas, pgvector sharding, capacity planning matrix, data residency, multi-region active-passive                              |
| **v5.5 — BYO Credentials Vault + Zero-Knowledge** | 2 wk     | §38 AES-256-GCM + CMEK + rotation flow + multi-key + zero-knowledge mode + audit chain                                                   |

**Total enterprise edition: ~35 weeks** for full vision including governance/scale/vault tier.

---

## 36. Enterprise Cost Governance

Production-grade cost controls. Every Mnemosyne operation passes through a multi-level ceiling system + observability + attribution layer.

### 36.1 Multi-level cost ceilings

Five enforcement levels, hierarchically:

```ts
interface CostCeilings {
  per_call_usd: number; // single LLM call max
  per_conversation_usd: number; // sum over conversation lifetime
  per_workspace_per_hour_usd: number;
  per_workspace_per_day_usd: number;
  per_workspace_per_month_usd: number;
  organization_total_per_day_usd?: number; // org-wide if multi-workspace
}
```

Each ceiling has 3 modes:

- **WARN** — emit metric + UI notification at threshold
- **THROTTLE** — slow down requests via queue backpressure
- **HARD_FAIL** — reject with `cost_ceiling_exceeded` error + audit log

Default policies for new workspaces:

- 50% threshold → WARN (email + UI badge)
- 80% → THROTTLE (queue depth +50%, lower priority)
- 100% → HARD_FAIL (no more LLM ops until reset)

### 36.2 Spend forecasting

Daily cron projects month-end spend based on rolling-7-day average + growth rate. Stored in `mnemo_spend_forecast` table:

```sql
CREATE TABLE mnemo_spend_forecast (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  forecast_date date NOT NULL,
  actual_mtd_usd numeric(10,4) NOT NULL,
  projected_month_end_usd numeric(10,4) NOT NULL,
  confidence_band_low_usd numeric(10,4),
  confidence_band_high_usd numeric(10,4),
  growth_rate_7d real,
  trigger_alerts text[],  -- ['50pct','80pct','100pct','anomaly']
  created_at timestamptz DEFAULT now()
);
```

Surfaced in UI banner: _"Projected month-end: $4.20 — 30% over budget. [Review]"_

Anomaly detection (variance > 3σ from rolling baseline) emits `anomaly_alert` action.

### 36.3 Per-feature cost attribution

Every `mnemo_usage_event` (extends existing `usage_event` schema) carries:

```ts
{
  feature: 'extraction' | 'recall' | 'inference' | 'judge' | 'compare' | 'compaction' | 'decay' | 'sleep_time',
  workspace_id, namespace_id?, conversation_id?, user_id?,
  model, provider, cost_usd,
  tokens_in, tokens_out,
  cache_hit: boolean,
  duration_ms,
  request_id  -- correlates with OTel trace
}
```

Dashboard splits cost by feature:

```
This month: $4.20 total
├─ Extraction:    $2.80 (66%)  — 12 conversations
├─ Recall:        $0.00 (0%)   — 412 hits, 60% cached
├─ Inference:     $0.85 (20%)  — 89 queries
├─ Judge:         $0.55 (13%)  — 22 verdicts
├─ Sleep-time:    $0.00 (0%)   — ran nightly
└─ Other:         $0.00
```

### 36.4 Provider failover + circuit breaker

Per-provider circuit breaker (Hystrix-style):

- 5 consecutive failures in 60s → OPEN circuit (rejects calls fast)
- 30s timeout → HALF_OPEN (one probe allowed)
- Probe success → CLOSED, normal traffic
- Probe fail → back to OPEN, exponential timeout (max 5 min)

Workspace can configure failover chain:

```ts
mnemo.failover_chain: [
  { model: "gemini-flash-2.0", weight: 1.0 },        // primary
  { model: "groq/llama-3.3-70b", weight: 1.0 },      // fallback 1
  { model: "openrouter/auto", weight: 0.5 },         // last resort
]
```

On primary OPEN → automatic failover to next in chain. Audit logged. Reverts when primary returns to CLOSED.

### 36.5 BYO key vault + rotation

See §38 for full spec. Per-workspace API keys stored encrypted AES-256-GCM + optional CMEK (BYO via AWS KMS / GCP KMS / Vault). Rotation flow: customer adds new key as `secondary`, system probes with secondary for 24h, on success promotes to `primary` and demotes old to `revoked` with grace window. Full audit trail.

### 36.6 Showback / chargeback export

CSV/JSON export of monthly costs for accounting systems:

```
/api/workspaces/:slug/mnemo/cost/export?format=csv&month=2026-05
```

Fields: workspace_id, namespace_id, feature, model, provider, requests, tokens_in, tokens_out, cost_usd, cache_hits, percentile_latencies.

Integration adapters for: QuickBooks, Xero, NetSuite, SAP, custom webhook.

### 36.7 Free tier auto-arbitrage

If multiple providers configured with free tiers, Mnemosyne routes operations through whichever still has quota. State tracked in `mnemo_provider_quota`:

```sql
CREATE TABLE mnemo_provider_quota (
  workspace_id text NOT NULL,
  provider_id text NOT NULL,
  daily_used_requests int DEFAULT 0,
  monthly_used_tokens bigint DEFAULT 0,
  daily_limit_requests int,
  monthly_limit_tokens bigint,
  last_reset_at timestamptz,
  PRIMARY KEY (workspace_id, provider_id)
);
```

Resets at provider's documented reset interval. UI shows "$0 spent today — Groq free tier (3,201/14,400 requests used)."

---

## 37. Scale + Multi-Region Operations

For deployments handling 10k+ workspaces or 100M+ memories.

### 37.1 Pgvector sharding strategy

At 10M+ memories per workspace, HNSW index size becomes problematic (RAM-heavy). Mnemosyne supports two scale-out modes:

**Vertical scale (default, recommended up to 5M memories/workspace)**:

- Single HNSW index per primitive table
- Tuning: `m=16, ef_construction=64` (current), bumpable to `m=32` for >1M memories
- Index rebuilt nightly via `REINDEX CONCURRENTLY`

**Horizontal partition (for 5M+ memories/workspace)**:

- Postgres declarative partitioning on `mnemo_fact` by `workspace_id` hash
- Partition count: 8 (default), configurable to 16 or 32 for largest workspaces
- HNSW index per partition (smaller, faster builds)
- Migration script: `mnemo migrate --partition-mode=hash --partitions=8`

Documented at deployment time. Automatic recommendation based on `mnemo_health.memory_count` thresholds.

### 37.2 Read replicas for recall

Recall is read-heavy (50:1 ratio). Mnemosyne supports Postgres read replicas:

```ts
// packages/mnemosyne/src/config/replicas.ts
mnemo.read_replicas: [
  { url: "postgres://replica1.region-a/...", region: "us-east" },
  { url: "postgres://replica2.region-b/...", region: "eu-west" },
]
mnemo.replica_lag_tolerance_ms: 500  // queries with `requireFresh: true` route to primary
```

Recall queries route to nearest replica (by region). Writes always go to primary. Mutations propagate via Postgres streaming replication. Replica lag visible in observability dashboard.

### 37.3 Connection pool sizing

Auto-tuned based on workspace count. Default formula:

```
pool_size = max(20, min(200, workspace_count / 50))
```

- 1k workspaces → 20 connections
- 10k workspaces → 200 connections
- 100k workspaces → 200 connections (capped, multi-region required)

Per-region pools. Connection lease tracking per request for noisy-neighbor detection.

### 37.4 Multi-region active-passive

```
        ┌────── Primary region (us-east) ──────┐
        │   Postgres write + recall            │
        │   pg-boss queue                      │
        │   Extraction workers                 │
        └──────────────────────────────────────┘
                       ↓ streaming replication
        ┌────── Replica region (eu-west) ──────┐
        │   Postgres read replica              │
        │   Recall serving                     │
        │   Workers idle (standby)             │
        └──────────────────────────────────────┘
```

Failover via `pg_promote()` + DNS swap. RTO: 5 min. RPO: < 5 sec (streaming lag).

Multi-region active-active deferred to v5.0 (requires mutation log + deferred apply §12.1 + conflict resolution policy).

### 37.5 Data residency declarations

Workspace setting `mnemo.data_residency: 'us' | 'eu' | 'asia' | 'workspace-pinned'`:

- `us` → all writes routed to US primary, replicas in US-only
- `eu` → EU primary, GDPR-compliant
- `workspace-pinned` → all replicas in same region as workspace (no cross-region replication)

Charter compliance: GDPR Article 44 (cross-border transfers), HIPAA, SOC2 CC6.7.

### 37.6 Capacity planning matrix

Documented per deployment tier. Operators consult this before sizing:

| Scale tier         | Workspaces | Total memories | Postgres size | Recommended hardware                                         |
| ------------------ | ---------- | -------------- | ------------- | ------------------------------------------------------------ |
| **Personal / Dev** | 1          | 10k            | 100 MB        | 2 vCPU, 4 GB RAM                                             |
| **Small team**     | 10         | 100k           | 1 GB          | 4 vCPU, 8 GB RAM                                             |
| **SMB**            | 100        | 1M             | 10 GB         | 8 vCPU, 32 GB RAM, NVMe                                      |
| **Enterprise**     | 1,000      | 10M            | 100 GB        | Postgres cluster, 4 vCPU/8 GB primary + 2 replicas           |
| **Mega**           | 10,000     | 100M           | 1 TB          | Sharded Postgres (8 partitions), 3-region, dedicated workers |
| **Hyperscale**     | 100,000+   | 1B+            | 10+ TB        | Custom architecture; consult team                            |

For each tier, expected p50/p99 latencies + monthly Postgres cost are tabulated.

### 37.7 Tenant isolation guarantees at scale

At 10k+ workspaces:

- RLS+FORCE still enforced — Postgres handles RLS at any scale
- Audit log integrity: continuous chain verification cron (verifies last 24h every hour)
- Cross-tenant probe tests run continuously in production (synthetic workspaces probe each other, alert on any leak)
- Per-workspace isolated connection pool optional (`mnemo.isolated_pool_per_workspace = true`) for highest-security customers

---

## 38. BYO Credentials Architecture

Customer API keys are the most sensitive secret in Mnemosyne. Full vault treatment.

### 38.1 Encryption at rest

- AES-256-GCM with per-workspace data encryption key (DEK)
- DEK encrypted with customer-master-key (CMK), supporting:
  - Default: Postgres `pgcrypto` with master key in env (`MNEMO_MASTER_KEY`)
  - Optional: BYO KMS — AWS KMS / GCP KMS / Vault Transit / Azure Key Vault
- Key version tracked → rotation without re-encrypting data

Schema:

```sql
CREATE TABLE mnemo_provider_credential (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider_id text NOT NULL,           -- 'openai', 'anthropic', etc.
  key_name text NOT NULL,              -- 'primary' | 'secondary' | 'rotation'
  encrypted_key bytea NOT NULL,        -- AES-256-GCM ciphertext
  encryption_key_version int NOT NULL, -- references workspace DEK version
  cmek_provider text,                  -- 'env' | 'aws-kms' | 'gcp-kms' | 'vault'
  cmek_key_id text,
  status text NOT NULL CHECK (status IN ('active','secondary','revoked','expired')),
  expires_at timestamptz,              -- optional rotation reminder
  last_used_at timestamptz,
  created_by_user_id text REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Audit table — append-only, hash-chained
CREATE TABLE mnemo_credential_audit (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  credential_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('create','rotate','revoke','use','export','probe')),
  actor_user_id text,
  metadata jsonb,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 38.2 Key rotation flow

1. Customer adds new key as `key_name='secondary'`, status='secondary'
2. System probes secondary with a no-op call (`embed("test")` or similar)
3. On success → 24h validation period (5% of traffic shifted to secondary)
4. On stable success → promote: secondary → primary, old primary → revoked (grace period 7 days)
5. After grace → hard delete (decryption key zeroed)

Customer initiates rotation via UI or API. Audit-logged at every transition.

### 38.3 Revocation

Customer can revoke any key:

- `status = 'revoked'` immediately
- All in-flight operations using that key fail with `credential_revoked`
- Audit-logged with reason
- Key material remains encrypted in DB for forensics until hard-delete after retention period (default 90 days)

### 38.4 Multi-key support

Workspace can have multiple keys per provider:

- `primary` — default for new requests
- `secondary` — used during rotation OR as failover
- `rotation` — being validated

Mnemosyne picks key based on request context (failover chain in §36.4).

### 38.5 Audit guarantees

Every credential operation appends to `mnemo_credential_audit` with hash chain (same pattern as existing `audit_log`). Tamper-evident. Verifiable via `mnemo doctor --check credential-audit-chain`.

Export for compliance:

```
/api/workspaces/:slug/mnemo/credentials/audit?from=<date>&to=<date>&format=csv
```

### 38.6 Zero-knowledge mode (extreme security customers)

Optional: customer can configure Mnemosyne with `MNEMO_ZERO_KNOWLEDGE_MODE=true`:

- API keys never persist in DB
- Customer's app injects key per-request via signed header
- Mnemosyne validates signature, uses key in-memory, never logs/stores
- Trade: customer must implement key delivery; no rotation UI

For air-gapped + high-security deployments. Documented but not default.

---

## 39. Operational Modes — Graceful Degradation

**Critical design property**: Mnemosyne does NOT require an LLM API token to function. It has three operational modes that customers pick based on compliance, cost, and capability needs. The DATABASE itself is the product — AI capabilities layer on top.

### 39.1 Three modes

| Mode                   | API keys required                                          | Cost/mo   | Best for                                                                                                                      |
| ---------------------- | ---------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **A — Database-only**  | None                                                       | **$0**    | Regulated/air-gapped, evaluation phase, customers who can't use external AI, structured note-taking, decision logs without AI |
| **B — Embedding-only** | embedding provider only (or local Ollama nomic-embed)      | $0–$0.05  | Privacy-conscious, cost-sensitive, hybrid recall without auto-extraction                                                      |
| **C — Full AI**        | small LLM + embedding (+ optional large/multimodal/rerank) | $0.82–$12 | Full intelligence: auto-extraction + inference + multi-modal + self-improving                                                 |

### 39.2 Capability matrix

| Capability                                   |     Mode A      |         Mode B         |      Mode C       |
| -------------------------------------------- | :-------------: | :--------------------: | :---------------: |
| **Storage + multi-tenant**                   |                 |                        |                   |
| CRUD facts / decisions / entities / episodes |       ✅        |           ✅           |        ✅         |
| RLS+FORCE Pattern A isolation                |       ✅        |           ✅           |        ✅         |
| Memory namespaces                            |       ✅        |           ✅           |        ✅         |
| Multi-region + read replicas                 |       ✅        |           ✅           |        ✅         |
| **Search + Graph**                           |                 |                        |                   |
| Lexical search (Postgres FTS / BM25)         |       ✅        |           ✅           |        ✅         |
| Topic-key shortcut                           |       ✅        |           ✅           |        ✅         |
| Graph traversal (recursive CTE)              |       ✅        |           ✅           |        ✅         |
| Bitemporal queries (`asOf`)                  |       ✅        |           ✅           |        ✅         |
| Manual relation create                       |       ✅        |           ✅           |        ✅         |
| Semantic search (pgvector cosine)            |       ❌        |           ✅           |        ✅         |
| Hybrid 6-signal scoring                      |       ❌        |           ✅           |        ✅         |
| Entity boost in recall                       |       ❌        |           ✅           |        ✅         |
| Cross-modal search                           |       ❌        |     ⚠️ image only      |        ✅         |
| **AI operations**                            |                 |                        |                   |
| Auto-extraction from conversations           |       ❌        |           ❌           |        ✅         |
| Conflict surfacing (candidate-on-write)      |       ❌        |    ⚠️ semantic only    |        ✅         |
| Conflict judge (LLM)                         |       ❌        |           ❌           |        ✅         |
| Inference engine (`mem_introspect`)          |       ❌        |           ❌           |        ✅         |
| Auto-summary of episodes                     |       ❌        |           ❌           |        ✅         |
| Suggest topic key                            |       ❌        |           ❌           |        ✅         |
| Multi-modal extraction (vision/STT)          |       ❌        |           ❌           |        ✅         |
| Self-improving feedback loops                |       ❌        |           ❌           |        ✅         |
| Sleep-time pattern extraction                |       ❌        | ⚠️ semantic merge only |        ✅         |
| **Operations + governance**                  |                 |                        |                   |
| Audit hash chain                             |       ✅        |           ✅           |        ✅         |
| Decay (time-based, no AI)                    |       ✅        |           ✅           |        ✅         |
| Compaction                                   | ✅ lexical only |  ✅ + semantic dedup   |  ✅ + LLM merge   |
| Cost ceilings + spend forecasting            | ✅ ($0 always)  |           ✅           |        ✅         |
| Provider failover circuit breaker            |       N/A       |     ✅ embed only      |      ✅ all       |
| BYO credentials vault                        |      empty      |       embed key        |     all keys      |
| GDPR export                                  |       ✅        |           ✅           |        ✅         |
| Memory health score                          | ✅ partial dims |  ✅ + recall quality   |   ✅ all 8 dims   |
| **Agent surface**                            |                 |                        |                   |
| MCP tools (CRUD subset)                      |       ✅        |           ✅           |        ✅         |
| Memory contracts (manual ratify)             |       ✅        |           ✅           | ✅ + auto-suggest |
| Memory introspection tools                   |       ❌        |           ❌           |        ✅         |
| Studio Inspector UI                          |       ✅        |           ✅           |        ✅         |

### 39.3 Auto-detection of active mode

Mnemosyne detects active mode at workspace boot + per-request:

```ts
// packages/mnemosyne/src/modes/detect.ts
export async function detectMode(
  workspaceId: string,
  tx: Tx
): Promise<MnemoMode> {
  const creds = await loadActiveCredentials(workspaceId, tx);
  const hasLLM = creds.some(
    (c) => c.provider_capability === "llm" && c.status === "active"
  );
  const hasEmbed = creds.some(
    (c) => c.provider_capability === "embedding" && c.status === "active"
  );
  if (hasLLM && hasEmbed) return "C";
  if (hasEmbed) return "B";
  return "A";
}
```

Cached for 5 min in workspace settings → revalidated on credential mutation. Per-request overridable for fallback testing.

### 39.4 Capability discovery (for agents + clients)

Tool `mnemosyne_capabilities()` returns:

```json
{
  "mode": "B",
  "available_tools": [
    "mnemosyne_recall",
    "mnemosyne_save_fact",
    "mnemosyne_save_decision",
    "mnemosyne_save_entity",
    "mnemosyne_save_episode_summary",
    "mnemosyne_search_topic",
    "mnemosyne_get_memory",
    "mnemosyne_update_memory",
    "mnemosyne_forget_memory",
    "mnemosyne_timeline",
    "mnemosyne_health"
  ],
  "unavailable_tools": [
    { "tool": "mnemosyne_judge", "reason": "no_llm_configured" },
    { "tool": "mnemosyne_compare", "reason": "no_llm_configured" },
    { "tool": "mnemosyne_introspect", "reason": "no_llm_configured" },
    {
      "tool": "mnemosyne_save_image_memory",
      "reason": "no_multimodal_configured"
    }
  ],
  "upgrade_hint": "Configure an LLM provider in workspace settings to enable AI operations.",
  "estimated_cost_per_mode": {
    "A_current": 0.0,
    "B": 0.05,
    "C_gemini_flash": 0.82,
    "C_gpt_4o_mini": 1.58
  }
}
```

The agent reads this at session start and adapts. Tools unavailable aren't exposed in MCP tool listing (clean no-op).

### 39.5 Tool degradation behavior

Tools that COULD work with degraded quality choose the best available path:

| Tool                     | Mode A                           | Mode B                                        | Mode C                           |
| ------------------------ | -------------------------------- | --------------------------------------------- | -------------------------------- |
| `mnemosyne_recall`       | FTS-only ranking                 | Hybrid (vec+FTS+entity+recency+frequency+pin) | Full hybrid + inference fallback |
| `mnemosyne_search_topic` | Direct topic_key lookup          | + semantic fuzzy match                        | + LLM query expansion            |
| `mnemosyne_save_*`       | Just persist                     | + auto-embed                                  | + auto-judge candidates          |
| `mnemosyne_health`       | Coverage/freshness/contradiction | + recall quality                              | + all 8 dimensions               |
| `mnemosyne_compaction`   | Lexical dedup only               | + semantic merge (cosine ≥ 0.92)              | + LLM merge for ambiguous        |

No tool errors in lower modes — they return degraded but useful results with `degraded_mode_reason` in response metadata.

### 39.6 Migration paths between modes (zero data loss, no downtime)

- **A → B** (add embedding key): Mode flips automatically. Background job `embed-existing-memories` runs at sleep-time. New writes embed lazily (§26.8). FTS continues serving until embeddings catch up.
- **B → C** (add LLM key): Mode flips. Auto-extraction starts on new conversations. Optional `re-extract-from-history` cron retro-processes recent N conversations (cost-bounded).
- **C → B** (revoke LLM): Auto-extraction halts cleanly — pending jobs marked `skipped: degraded_mode`. Recall keeps semantic. AI-derived metadata preserved.
- **B → A** (revoke embedding): FTS-only recall. Embeddings preserved in DB (NULL-tolerant queries).
- **Any direction**: non-destructive. Customer can move freely.

### 39.7 Schema supports all modes natively

Every AI-derived field is nullable. Tables don't require AI metadata to be useful:

```sql
embedding         vector(1536),    -- NULL in Mode A; populated in B/C
embedding_model   text,            -- NULL in Mode A
text_lemmatized   tsvector,        -- ALWAYS populated (pure code; Mode A FTS uses this)
confidence        real DEFAULT 0.7,-- DEFAULT in Mode A (manual saves)
attributed_to     text,            -- NULL in Mode A (no LLM)
linked_memory_ids text[] DEFAULT '{}'
```

Indexes:

- `idx_mnemo_fact_fts` (GIN) — used in ALL modes
- `idx_mnemo_fact_embedding_hnsw` — used in B/C only (empty in Mode A → query planner ignores)
- All other indexes mode-independent

### 39.8 Use cases per mode

**Mode A — picked by:**

- Regulated industries (healthcare, finance, gov) without AI approval
- Air-gapped deployments
- Initial evaluation (try Mnemosyne free)
- Structured decision logging (ADR-like tool)
- Personal knowledge management
- Compliance evidence trails

**Mode B — picked by:**

- Privacy-conscious customers (embeddings can stay local via Ollama)
- Cost-sensitive teams ($0.05/mo)
- Hybrid manual-save + semantic-search setups
- GDPR-strict (no LLM = no AI provider processes user data)

**Mode C — picked by:**

- Full agent memory (original Mnemosyne value proposition)
- Multi-modal apps (voice, browser ext, email agents)
- Self-improving systems
- Reasoning-heavy applications

### 39.9 Operator pricing matrix (1k active workspaces)

| Mode | Customer/workspace | Operator total        | TAM unlocked                                  |
| ---- | ------------------ | --------------------- | --------------------------------------------- |
| A    | $0                 | $0 + Postgres hosting | Regulated, air-gapped, evaluation, low-budget |
| B    | $0–0.05            | $0 + Postgres         | Privacy + cost-sensitive                      |
| C    | $0.82–12           | $0 + Postgres         | Full intelligence, multimodal, premium        |

**No mode burdens the operator with AI cost.** Platform-level cost is fixed and predictable.

### 39.10 UI mode picker (workspace creation)

```
Welcome to Mnemosyne. Pick how much AI you want:

┌─ Database mode (Free, recommended for evaluation) ─┐
│ • Structured memory with graph queries              │
│ • Lexical search, audit, multi-tenant               │
│ • No external API needed                            │
│ • Upgrade anytime, no data lost                     │
│ [ Start in DB mode ]                                │
└─────────────────────────────────────────────────────┘

┌─ Embedding mode (~$0.05/mo) ───────────────────────┐
│ • Everything in DB mode +                           │
│ • Semantic search via embeddings                    │
│ • Hybrid 6-signal scoring                           │
│ • Required: 1 embedding API key                     │
│ [ Configure embedding provider → ]                  │
└─────────────────────────────────────────────────────┘

┌─ Full AI mode ($0.82–12/mo) ────────────────────────┐
│ • Everything in Embedding mode +                    │
│ • Auto-extraction from conversations                │
│ • Inference engine + multi-modal                    │
│ • Self-improving memory                             │
│ • Required: LLM + embedding API keys                │
│ [ Configure providers → ]                           │
└─────────────────────────────────────────────────────┘
```

Customer can switch modes at any time. Data preserved across switches.

---

**End of design v4 (graceful degradation).** Provider-agnostic + zero platform third-party cost + 3 operational modes (Mode A no-AI fully functional + Mode B embedding-only + Mode C full AI) + multi-level cost governance + multi-region scale + BYO credential vault + zero-knowledge mode. Customer pays $0–$12/mo. Operator pays $0 for AI regardless. Ready for review + writing-plans skill invocation.
