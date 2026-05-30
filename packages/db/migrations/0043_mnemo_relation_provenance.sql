-- packages/db/migrations/0043_mnemo_relation_provenance.sql
--
-- Mnemosyne v1.1 #11 — edge provenance column on `mnemo_relation`.
--
-- Distinguishes edges the LLM derived (the v1.0 status quo — every
-- existing row, and every new row emitted by the extractor / judge)
-- from edges synthesized programmatically by the system itself (alias
-- merges, coreference resolution, deterministic dedup output). The
-- distinction matters for two consumers:
--   • the graph-expansion stage in `recall/search.ts`, which now
--     applies a smaller decay to heuristic edges (they're less
--     trustworthy than an LLM-attested edge);
--   • future audit dashboards / replay jobs that want to filter
--     "show me every heuristic edge for workspace W" without
--     scanning the whole relation table.
--
-- Why text (not enum)?
--   We deliberately model provenance as free text rather than a
--   pg_enum. The only value the system writes today is 'heuristic',
--   but the open-ended space is intentional — v1.2/v1.3 will likely
--   add 'import' (third-party graph ingestion) and 'rule' (declarative
--   rule firings) and we'd rather grow the column than ship an ALTER
--   TYPE … ADD VALUE per release. The application layer (`createRelation`
--   in `packages/mnemosyne/src/graph/relation.ts`) is the chokepoint
--   that gates what values land on disk.
--
-- Why NULL = LLM-derived (and not the literal string 'llm')?
--   The vast majority of rows are LLM-derived (~99% in production
--   workspaces today). Encoding the common case as NULL keeps storage
--   bounded (TOAST-free, no per-row overhead beyond the null bitmap)
--   and lets us define a partial index that ONLY tracks the rare
--   heuristic rows — see below.
--
-- Why a PARTIAL index?
--   The expected access pattern is "give me all heuristic edges in
--   workspace W" (audit) or "filter out heuristic edges from this
--   recall result" (per-edge decay logic, which can also use the
--   `provenance` projection directly). Both queries are happiest with
--   an index that skips the dominant NULL rows entirely. A full
--   `(workspace_id, provenance)` index would bloat by ~99% with NULL
--   entries that never participate in a query.
--
-- Rollback: the .down.sql drops the index first, then the column.
-- Order matters — the index references the column, so DROP COLUMN
-- without dropping the index first would error in older Postgres
-- versions (modern PG cascades, but explicit DROP keeps the down
-- migration portable).
--
-- Locking: ADD COLUMN ... DEFAULT NULL is a metadata-only op on PG ≥ 11
-- (no table rewrite). CREATE INDEX (no CONCURRENTLY) takes ACCESS
-- EXCLUSIVE for the duration. Safe in v1.1 because the partial index
-- over `provenance IS NOT NULL` starts empty (no heuristic edges yet)
-- so the build is instant. If a heuristic backfill populates millions
-- of rows before this migration reaches a production tenant, split the
-- index step into a separate `CREATE INDEX CONCURRENTLY` outside the
-- migration transaction.

ALTER TABLE mnemo_relation
  ADD COLUMN IF NOT EXISTS provenance text DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_mnemo_relation_provenance
  ON mnemo_relation (workspace_id, provenance)
  WHERE provenance IS NOT NULL;
