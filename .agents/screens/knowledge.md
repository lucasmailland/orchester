# Knowledge (RAG)

**Routes:**
- List: `/[locale]/knowledge`
- Detail: `/[locale]/knowledge/[id]`

**Files:**
- `apps/web/app/[locale]/(shell)/knowledge/{page,[id]/page}.tsx`
- `apps/web/components/knowledge/{KnowledgeListClient,KnowledgeDetailClient}.tsx`
- `apps/web/app/api/knowledge-bases/{route,[id]/route,[id]/docs/{route,[did]/route},[id]/search/route}.ts`
- `apps/web/lib/{embeddings,chunking}.ts`
- `apps/web/lib/tools.ts → knowledge_search` tool

**Owner:** knowledge / rag
**Status:** stable

## Purpose
RAG knowledge bases. Upload text or URL → chunk → embed → store in pgvector
→ agents semantically search via the `knowledge_search` tool.

## Planning (initial design)

### Goals
- Self-serve KB creation — pick provider (OpenAI 1536d or Google 768d), upload
  docs, agent calls `knowledge_search` to retrieve.
- Status visible per doc (parsing/embedding/ready/failed).
- Inline search tester so users see relevance scores before deploying.

### User flows
1. `/knowledge` → "Nueva base" → name + provider → Crear.
2. Detail page: upload doc by pasting text OR URL → indexes synchronously.
3. Tab "Probar búsqueda" → query → ranked chunks with score 0-1.
4. Configure an agent's tools to include `knowledge_search`; pass
   `kbId` in the tool call to scope.

### Data
**Tables:**
- `knowledge_base` — workspace-scoped, embedding model + chunk size config.
- `knowledge_doc` — title, source (text/url), status, chunkCount.
- `knowledge_chunk` — `vector(1536)` embedding + ordinal + text + metadata.
- `agent_memory` — per-agent persistent memory (scaffolded, not yet UI-driven).

**Endpoints:**
- `GET/POST /api/knowledge-bases`
- `GET/PATCH/DELETE /api/knowledge-bases/[id]`
- `GET/POST /api/knowledge-bases/[id]/docs`
- `DELETE /api/knowledge-bases/[id]/docs/[did]`
- `POST /api/knowledge-bases/[id]/search` (cosine via `<=>`)

### Components
- `KnowledgeListClient` — grid of KBs with create form.
- `KnowledgeDetailClient` — 2 tabs (Docs / Probar búsqueda) + upload form.

### Pipeline
```
Upload (text or URL)
  → fetch + crude HTML strip (URL only)
  → chunk (sentence-aware, default 800 chars + 100 overlap)
  → embed (OpenAI/Google batch)
  → normalize to 1536d (truncate or zero-pad)
  → INSERT INTO knowledge_chunk with embedding column
  → mark doc 'ready'
```

### Decisions & trade-offs
- **pgvector over Pinecone** — keeps everything in one DB, no extra service,
  no lock-in. We compiled `pgvector 0.8` from source for postgres@16.
- **All embeddings normalized to 1536d.** Trade-off: Google's 768d gets
  zero-padded (still works for cosine, marginal accuracy hit for the
  free model).
- **Synchronous ingest.** A 50-page PDF would block the request — limited
  to text/URL today. PDF/DOCX deferred until we have a job queue.
- **HTML strip is regex-based** — quick & dirty. For complex pages a real
  parser like cheerio would be better but adds bundle.

## Execution (changelog — newest first)

### 2026-04-28 — Phase 3 RAG
- Compiled pgvector 0.8 for postgres@16 from source.
- 4 new tables (knowledge_base, knowledge_doc, knowledge_chunk, agent_memory).
- embeddings.ts (OpenAI + Google), chunking.ts (sentence-aware splitter).
- 6 API routes (KB CRUD, docs CRUD, search).
- `knowledge_search` registered in tools registry — agents can RAG-search.
- /knowledge UI list + detail with upload + search tester.

## Performance notes
- Vector search uses pgvector `<=>` cosine. With <10k chunks, sub-50 ms.
- For >100k chunks, add an HNSW or IVFFlat index on `embedding`.
- Sync ingest is fine for ≤ a few KB of text. Multi-MB needs a queue.

## Open issues / TODO
- PDF/DOCX parsing (currently fails with helpful error).
- HNSW/IVFFlat index on `knowledge_chunk.embedding` once datasets grow.
- Citations: `knowledge_search` returns `[chunk:id]` markers; agents need
  prompting to cite.
- Memory UI (agent_memory schema exists, no page yet).
