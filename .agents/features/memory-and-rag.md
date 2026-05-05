# Memory + RAG

**Files:**
- `apps/web/lib/memory.ts` — agent memory (jsonb scoped bag)
- `apps/web/lib/memory-compaction.ts` — rolling-window history summarization
- `apps/web/lib/embeddings.ts` — multi-provider embeddings
- `apps/web/lib/chunking.ts` — sentence chunker + PDF/DOCX extraction
- `apps/web/lib/tools.ts` — `memory_get/set/remove` + `knowledge_search`
- `apps/web/app/api/agents/[id]/memory/route.ts`
- `apps/web/app/api/knowledge-bases/[id]/{docs,search}/route.ts`
- `apps/web/components/agents/studio/MemoryPanel.tsx`
- Schema: `agent_memory`, `knowledge_base`, `knowledge_doc`, `knowledge_chunk`

**Owner:** memory / rag
**Status:** all three layers in production: short-term (transcript), mid-term (summarization), long-term (memory + RAG)

## Purpose
Three-layer memory system so agents have **context that survives turns and conversations**, plus a vector knowledge base for grounded answers.

## Planning (initial design)

### Three layers

| Layer | Storage | Lifetime | Mechanism |
|---|---|---|---|
| **Short-term** (verbatim) | `message` table | full transcript | replayed every turn until threshold |
| **Mid-term** (summary) | `conversation.summary` | full conversation | rolling-window: keep last N, summarize older |
| **Long-term** (key/value) | `agent_memory` | global / employee / conversation | tools + auto-injection in system prompt |
| **Knowledge** (vector) | `knowledge_chunk.embedding` | until deleted | RAG via `knowledge_search` tool |

### Layer 1 — Verbatim transcript
The full `message` rows for a conversation are loaded on every inbound, then
passed through `compactHistory()` (Layer 2) before going to the LLM.

### Layer 2 — Rolling-window summarization
`compactHistory({ messages, keepLastN, model })`:
- If `messages.length <= keepLastN` (default 10) → replay verbatim + cached
  summary if any.
- Else → take everything older than the last `keepLastN`, send them to the
  agent's own provider with a strict summarizer system prompt, store the
  result in `conversation.summary`, and prepend it as a single
  `[Conversation summary so far]` message to the LLM.
- The summary is **incrementally extended**: new old turns are folded into
  the existing summary, not regenerated from scratch.

### Layer 3 — Agent memory
Three scopes:
- `global` — facts true across all users (e.g. "company holiday is on July 9").
- `employee` — facts about a specific employee/customer.
- `conversation` — short-lived, lives within a single thread.

**Tools registered for agents to use:**
- `memory_set({ scope, key, value })`
- `memory_get({ scope })`
- `memory_remove({ scope, key? })` (omit key → clear whole scope)

**Auto-injection:** before every LLM call, `getRelevantMemories()` fetches
the global + scoped memories, and `formatMemoriesAsPromptBlock()` appends a
Markdown `## Memory` block to the system prompt:

```
## Memory
### Things you always know
- company_holiday: July 9
### Things you know about this user
- preferred_language: English
- subscription_tier: pro
```

This means agents recall context **without having to explicitly call
`memory_get`** — the data is already in the prompt. They use
`memory_set` to write new facts.

### Layer 4 — RAG (vector)
- pgvector 0.8.2, `vector(1536)` column.
- HNSW index for cosine search: `idx_kb_chunk_embedding_hnsw`
  (`m=16, ef_construction=64`).
- Embedding providers: OpenAI `text-embedding-3-small` (1536d), Google
  `text-embedding-004` (768d zero-padded). Normalized to 1536d in
  `embeddings.ts → normalizeTo1536()`.
- Chunker: sentence-aware, default 800 chars + 100 overlap.
- **Document parsers**:
  - text / markdown / JSON → `Buffer.toString("utf-8")`
  - URL → fetch + crude HTML strip (or PDF/DOCX if upstream content-type)
  - **PDF** → `pdf-parse` library (extracts page text)
  - **DOCX** → `mammoth.extractRawText` (extracts raw text from .docx zip)
- Tool: `knowledge_search({ kbId, query, topK })` returns
  `{ results: [{ id, docId, ordinal, text, docTitle, score }] }`.

### Decisions & trade-offs
- **No vendor lock-in** for the vector store — pgvector keeps everything in
  one DB, no extra service.
- **Synchronous ingest** for now (not queued). Acceptable up to ~10MB docs.
  Phase 6+ moves to a worker.
- **Summarizer uses the agent's own model** — keeps provider config simple
  but spends some of the workspace's tokens on summarization.
- **Memory scope = unique row** — `(agentId, scope, conversationId?,
  employeeId?)` is the natural key. Storing as one jsonb bag per row keeps
  reads to ≤ 3 indexed lookups per request.
- **HNSW with `m=16, ef_construction=64`** — good speed/accuracy balance
  for ≤1M vectors. Can be re-tuned if recall drops.

## Execution (changelog — newest first)

### 2026-05-05 — Path A + B + C unified
- **Path A: Agent memory.** `lib/memory.ts` (CRUD + getRelevantMemories +
  formatMemoriesAsPromptBlock). 3 new tools. UI: `MemoryPanel` mounted in
  Agent Studio → Avanzado tab. Endpoint:
  `GET/POST/DELETE /api/agents/[id]/memory`.
- **Path B: Conversation summarization.** `lib/memory-compaction.ts`
  rolling-window with incremental summary extension. Wired into
  `lib/channels/router.ts` before the LLM call.
- **Path C: PDF/DOCX + HNSW.** Added `pdf-parse` and `mammoth`. Updated
  `chunking.ts → extractTextFromBuffer()`. KB docs endpoint accepts
  `multipart/form-data` (file upload) in addition to JSON. UI gets a
  "Subir PDF / DOCX" tab with a file input. **HNSW index** created on
  `knowledge_chunk.embedding`.

### 2026-04-28 — initial RAG (Phase 3)
- pgvector 0.8 + 4 tables.
- Embeddings + chunking lib.
- 6 API routes + UI list/detail.
- `knowledge_search` tool.

## Performance notes
- Memory lookup: 1-3 indexed point queries, sub-5 ms total.
- Memory injection adds ~50-300 tokens to the system prompt — negligible.
- Summarizer LLM call: 200-800 ms only when threshold crossed.
- HNSW search: O(log n), sub-10 ms even at 1M chunks.
- PDF parser: ~50 ms for 10-page PDF, scales linearly.

## Open issues / TODO
- Async ingest for very large docs (queue worker).
- Citations: `knowledge_search` returns `[chunk:id]` markers; agents need
  prompt nudges to actually cite.
- Memory garbage collection for `conversation` scope after conversation
  closes (today they linger).
- Per-memory-key TTL.
- Re-ranker between vector recall and final answer (Cohere or open-source).
- HNSW tuning automation: run benchmarks, pick `ef_search` per workload.
