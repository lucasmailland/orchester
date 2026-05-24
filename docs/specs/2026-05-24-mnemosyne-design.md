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
  extractor_model         text,                  -- "claude-haiku-4-5"
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
      "extracted_by": {"model": "claude-haiku-4-5", "prompt_version": "v1"},
      "extracted_at": "2026-05-24T10:00:00Z"
    }
  ],
  "judgments": [
    {
      "relation_id": "mrel_abc",
      "relation": "supersedes",
      "target_memory_id": "mfact_old",
      "judged_by": {"model": "claude-sonnet-4-6", "actor": "llm_judge"},
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

| Metric                | Target                  | Strategy                                        |
| --------------------- | ----------------------- | ----------------------------------------------- |
| p50 recall latency    | < 80ms                  | L1 LRU + HNSW + parallel embed                  |
| p99 recall latency    | < 400ms                 | overfetch budget cap + worker concurrency       |
| p50 extraction job    | < 3s                    | batch embed + provider streaming                |
| p99 extraction job    | < 15s                   | model fallback (Haiku → Sonnet on retry)        |
| Recall cache hit rate | > 60%                   | workspace-LRU + LISTEN/NOTIFY invalidation      |
| Memory health score   | > 80 (median)           | scoring weights + drift alerting                |
| Cost per 1k recalls   | < $0.50                 | cheap embed model + cached + over-fetch capped  |
| Cost per extraction   | < $0.005                | Haiku-tier model + max 5 facts cap + 600 tokens |
| Storage growth        | < 100 MB / 10k memories | dedup + compaction + grace-deleted purge        |

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

**End of design.** Ready for review + writing-plans skill invocation.
