-- Reverse migration 0043_mnemo_relation_provenance.sql
--
-- Drop the index BEFORE the column — older Postgres versions don't
-- cascade an index drop on a column drop, and explicit ordering keeps
-- the down migration portable across PG versions.

DROP INDEX IF EXISTS idx_mnemo_relation_provenance;

ALTER TABLE mnemo_relation
  DROP COLUMN IF EXISTS provenance;
