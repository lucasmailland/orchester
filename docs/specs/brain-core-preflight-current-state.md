# Brain Core Pre-flight: Current Memory State

Captured: 2026-05-24, branch: `sub-spec-1/tenant-hardening`, tag `tenant-hardening-v1.2`+v1.3 fixes in flight.

## Summary

- 4 tables directly involved: `agent_memory`, `knowledge_base`, `knowledge_doc`, `knowledge_chunk`
- 2 supporting schema tables with memory-adjacent columns: `conversation` (summary), `agent` (tools, teamId)
- 6 lib modules: `memory.ts`, `memory-compaction.ts`, `embeddings.ts`, `knowledge-search.ts`, `tools.ts`, `agent-runtime.ts`
- 1 channels router (`lib/channels/router.ts`) that triggers memory reads on every inbound turn
- 1 API route: `GET/POST/DELETE /api/agents/[id]/memory`
- 1 UI component: `MemoryPanel.tsx`
- 0 worker jobs touch memory or embeddings (worker handles flows, webhooks, retention, audit only)

---

## Schema Map

### `agent_memory` — `packages/db/src/schema/knowledge.ts:88`

| Column          | Type                           | Notes                                                             |
| --------------- | ------------------------------ | ----------------------------------------------------------------- |
| id              | text PK                        | cuid2                                                             |
| agent_id        | text NOT NULL                  | For team-scope rows, set to `"team:<teamId>"` string prefix       |
| workspace_id    | text NOT NULL FK→workspace     | cascade delete                                                    |
| conversation_id | text nullable                  | scoped to conversation rows                                       |
| employee_id     | text nullable                  | scoped to employee rows                                           |
| team_id         | text nullable                  | populated only for scope=team                                     |
| scope           | text NOT NULL default "global" | enum: global/conversation/employee/team (not a PG enum, raw text) |
| data            | jsonb default `{}`             | flat key→value bag                                                |
| updated_at      | timestamp NOT NULL             | manually updated on upsert                                        |

No unique index declared. The upsert is implemented with a manual read-then-write in `findRow`, creating a potential race condition under concurrent tool calls.

No vector column. Memory is pure key/value, no embeddings.

### `knowledge_base` — `packages/db/src/schema/knowledge.ts:36`

| Column             | Type                                           | Notes                |
| ------------------ | ---------------------------------------------- | -------------------- |
| id                 | text PK                                        |                      |
| workspace_id       | text NOT NULL FK→workspace                     | cascade              |
| name               | text NOT NULL                                  |                      |
| description        | text                                           |                      |
| embedding_model    | text NOT NULL default "text-embedding-3-small" |                      |
| embedding_provider | text NOT NULL default "openai"                 | openai/google/voyage |
| chunk_size         | integer NOT NULL default 800                   |                      |
| chunk_overlap      | integer NOT NULL default 100                   |                      |

Index: `idx_kb_workspace_id ON knowledge_base(workspace_id)`

### `knowledge_doc` — `packages/db/src/schema/knowledge.ts:51`

| Column       | Type                                          | Notes                                  |
| ------------ | --------------------------------------------- | -------------------------------------- |
| id           | text PK                                       |                                        |
| kb_id        | text NOT NULL FK→knowledge_base               | cascade                                |
| workspace_id | text NOT NULL FK→workspace                    | cascade                                |
| status       | kb_doc_status enum NOT NULL default "pending" | pending/parsing/embedding/ready/failed |
| chunk_count  | integer NOT NULL default 0                    |                                        |

Index: `idx_kb_doc_kb_id ON knowledge_doc(kb_id)`

### `knowledge_chunk` — `packages/db/src/schema/knowledge.ts:70`

| Column       | Type                            | Notes                                         |
| ------------ | ------------------------------- | --------------------------------------------- |
| id           | text PK                         |                                               |
| doc_id       | text NOT NULL FK→knowledge_doc  | cascade                                       |
| kb_id        | text NOT NULL FK→knowledge_base | cascade                                       |
| workspace_id | text NOT NULL FK→workspace      | cascade                                       |
| ordinal      | integer NOT NULL                | position within doc                           |
| text         | text NOT NULL                   | raw chunk content                             |
| embedding    | vector(1536) nullable           | pgvector custom type, normalized to 1536 dims |
| metadata     | jsonb default `{}`              |                                               |

Indexes:

- `idx_kb_chunk_kb_id`
- `idx_kb_chunk_doc_id`
- `idx_kb_chunk_embedding_hnsw ON knowledge_chunk USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`

### `conversation` (memory-adjacent) — `packages/db/src/schema/core.ts:115`

Columns relevant to memory: `summary text` (stores compacted conversation summary), `message_count integer` (triggers compaction threshold check).

---

## Library Inventory

### `apps/web/lib/memory.ts`

- `MemoryScope` — `"global" | "conversation" | "employee" | "team"`
- `MemoryRecord` — `{ id, scope, data, conversationId|null, employeeId|null, teamId|null, updatedAt }`
- `getRelevantMemories(q, tx?)` — up to 4 indexed lookups (global, conversation, employee, team via `resolveAgentTeam`)
- `setMemory(q + {scope, key, value}, tx?)` — read-modify-write, not atomic
- `removeMemory(q + {scope, key?}, tx?)` — removes one key from JSONB or deletes entire row
- `listMemoryRows(agentId, workspaceId, tx?)` — all rows for agent
- `formatMemoriesAsPromptBlock(records)` — Markdown `## Memory` block

Call sites of `getRelevantMemories`:

1. `lib/channels/router.ts:366` — every inbound conversational turn
2. `lib/channels/router.ts:500` — after `agent_handoff` to re-inject new agent's memories
3. `lib/tools.ts:483` — `memory_get` tool handler

### `apps/web/lib/memory-compaction.ts`

- `compactHistory(args)` — rolling-window compaction. Default keepLastN=10 (min 4). When `conv.length > keepLastN`: summarizes via agent's own model at `temperature=0.2, maxTokens=600`. Folds existing `conversation.summary` for incremental compression. Persists to `conversation.summary`. Counts against workspace spend cap.

Called by `buildConversationContext` in `router.ts:357` on every turn.

### `apps/web/lib/embeddings.ts`

- `embed(workspaceId, provider, model, texts[], tx?)` — looks up `ai_provider`, dispatches to `embedOpenAI` or `embedGoogle`. All vectors normalized to `vector(1536)` via `normalizeTo1536` (truncate or zero-pad).
- `defaultEmbeddingModel(provider)` — `text-embedding-3-small` (openai), `text-embedding-004` (google), `voyage-3` (voyage)

**Gaps:**

- `voyage` provider has no implementation, throws at line 70
- No caching — every call is live HTTP
- Cost tracking missing — `embed()` does NOT call `recordAiUsage`

### `apps/web/lib/knowledge-search.ts`

- `searchKnowledgeBase(workspaceId, kbId, query, topK=5, tx?)` — embeds query, runs pgvector cosine via `<=>` operator. No re-ranking, no BM25 hybrid, no threshold filter.

---

## Embedding Infrastructure

- Provider resolution: workspace-level `ai_provider` rows
- Normalization: all vectors stored as `vector(1536)` (zero-padded if shorter — quality degradation)
- Index: HNSW with `m=16, ef_construction=64` on `knowledge_chunk.embedding`
- No embedding cache
- No embedding for `agent_memory`
- Voyage support: listed but throws at runtime

---

## Recall Flow

**On-demand (tool call) trace when agent calls `memory_get`:**

1. Agent loop receives tool call `name="memory_get"`
2. `executeTool` → `getRelevantMemories(baseQ, ctx.tx)` returns rows across all 4 scopes
3. Filtered by requested scope, returns `{ scope, data: filtered[0]?.data ?? {} }`
4. Wrapped via `wrapUntrusted(JSON.stringify(out), "tool_memory_get")` before history

**Passive injection (every turn):**

1. `buildConversationContext` calls `getRelevantMemories` with `{ agentId, workspaceId, conversationId, employeeId }`
2. Up to 4 rows returned (one per applicable scope)
3. `formatMemoriesAsPromptBlock` → Markdown bullets
4. Wrapped → appended to `agent.systemPrompt`

---

## Compaction Flow

Trigger: every inbound turn via `buildConversationContext` → `compactHistory` — `router.ts:357`

Steps:

1. Load full message history filtered to `user|assistant`
2. If `count <= keepLastN`: return verbatim + cached summary
3. If over: `toSummarize = conv[0..len-keep]`, `recent = conv[len-keep..]`
4. Call `llmCall` to summarize
5. Persist summary to `conversation.summary`
6. Return `[summary, ...recent]`

Cost billed via `assertWithinSpend` + `recordAiUsage`. Fallback to truncation on LLM failure.

---

## UI Surface

`apps/web/components/agents/studio/MemoryPanel.tsx`:

- Fetches via `GET /api/agents/[id]/memory`
- Per-key delete + add form (scope/key/value)
- **Gap**: `team` scope absent from UI scope picker (line 141)
- **Bug**: `listMemoryRows` query at `lib/memory.ts:194` uses `WHERE agent_id = $agentId` — team rows stored as `agentId = "team:<teamId>"` never match

---

## Gaps and Tech Debt

1. **No unique index on `agent_memory`** — race condition on concurrent upserts
2. **Voyage provider stub** — listed but throws at runtime
3. **Embedding costs not metered** — `embed()` doesn't call `recordAiUsage`
4. **Zero-padding distorts similarity** — Google (768d) and Voyage (1024d) padded to 1536d
5. **No semantic search for agent memory** — pure key/value, no embedding column
6. **No embedding cache** — every `knowledge_search` re-embeds query over HTTP
7. **`memory_get` returns the full data bag** — no targeted retrieval by key or semantic query
8. **`team` scope absent from UI** — operators can't manage team-scoped memory
9. **`listMemoryRows` blind to team rows** — query never matches `"team:*"` agent_id prefix
10. **Compaction fires every turn** — loads full message history even when below threshold
11. **No retention policy for `agent_memory`** — memory accumulates indefinitely

---

## Brain Core Implications

| Finding                                        | Decision                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `agent_memory` is key/value JSONB, no vectors  | **Extend**: add `embedding vector(1536)` + HNSW index for semantic recall           |
| No unique index on `agent_memory`              | **Fix**: add `UNIQUE (workspace_id, agent_id, scope, conversation_id, employee_id)` |
| `getRelevantMemories` passive injection        | **Keep**: works; extend with ANN retrieval                                          |
| `formatMemoriesAsPromptBlock` Markdown bullets | **Keep** initially; replace with semantic-ranked injection post-embedding           |
| `compactHistory` rolling window                | **Keep**: proven; make strategy pluggable                                           |
| `conversation.summary` cache                   | **Keep**: no changes                                                                |
| Voyage provider stub                           | **Delete** or **Complete**                                                          |
| Embedding cost not metered                     | **Extend**: add `recordAiUsage` in `embed()`                                        |
| Zero-padding                                   | **Replace**: store native dims per model OR single-provider                         |
| No embedding cache                             | **Extend**: in-process LRU cache keyed by `(workspaceId, model, sha256(text))`      |
| `knowledge_search` cosine only                 | **Extend**: score threshold + optional BM25 hybrid                                  |
| `team` scope missing from UI                   | **Extend**: add to picker + fix `listMemoryRows`                                    |
| Worker has no memory jobs                      | **Extend**: async embedding job for memory rows                                     |
| No memory retention                            | **Add**: `agent_memory` cleanup in retention sweeper                                |

---

## Essential Files

- `apps/web/lib/memory.ts` — all memory CRUD + scope resolution
- `apps/web/lib/memory-compaction.ts` — rolling-window compaction
- `apps/web/lib/embeddings.ts` — embed() + provider dispatch
- `apps/web/lib/knowledge-search.ts` — pgvector ANN search
- `apps/web/lib/tools.ts` — `memory_set/get/remove`, `knowledge_search` tools
- `apps/web/lib/agent-runtime.ts` — tool loop + `wrapUntrusted`
- `apps/web/lib/channels/router.ts` — `buildConversationContext` (injection + compaction every turn)
- `packages/db/src/schema/knowledge.ts` — `agent_memory` + KB tables
- `packages/db/src/schema/core.ts` — `conversations.summary`
- `packages/db/sql/init-indices.sql` — HNSW index on `knowledge_chunk.embedding`
- `apps/web/app/api/agents/[id]/memory/route.ts` — REST API
- `apps/web/components/agents/studio/MemoryPanel.tsx` — UI
- `apps/web/worker/index.ts` — confirms no memory jobs exist today
