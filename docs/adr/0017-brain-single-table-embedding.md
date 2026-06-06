# ADR-017 — Brain Core storage: single table with embedding column

Date: 2026-05-24 · Status: Superseded by ADR-020 (Mnemosyne) on 2026-05-24, fully retired on 2026-06-05 (Phase 3 cut-over)

## Context

Two structures considered:

1. Separate `brain_fact` (metadata) + `brain_fact_embedding` (vector + FK)
2. Single `brain_fact` with embedding column

Pattern 1 lets you store facts without computing embeddings yet
(embedding job catches up async). Pattern 2 is simpler.

## Decision

Single `brain_fact` table with `embedding vector(1536)` nullable. HNSW
index `WHERE embedding IS NOT NULL` indirectly via partial-index
behavior of pgvector. Extraction always computes the embedding before
INSERT so the column is rarely null in practice.

## Consequences

**Positive:** no join needed for recall. One row, one read. RLS policy
is identical (workspace_id on the row, no second-table policy needed).

**Negative:** if we ever want to re-embed every fact (model change),
it's a wider UPDATE. Acceptable — that's a rare operation.

**Revisit when:** we add multi-modal embeddings (image + audio per
fact). At that point a separate `brain_fact_embedding` table indexed
by `(fact_id, modality)` becomes natural.
