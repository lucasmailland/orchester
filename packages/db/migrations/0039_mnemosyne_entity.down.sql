-- Reverse migration 0039_mnemosyne_entity.sql
--
-- Drop in reverse order: fact column + its partial index first, then
-- the entity table (with its policies + indexes + grants implicit in
-- the DROP TABLE CASCADE).

DROP INDEX IF EXISTS idx_mnemo_fact_entity;

ALTER TABLE mnemo_fact
  DROP COLUMN IF EXISTS entity_id;

DROP POLICY IF EXISTS mnemo_entity_delete ON mnemo_entity;
DROP POLICY IF EXISTS mnemo_entity_update ON mnemo_entity;
DROP POLICY IF EXISTS mnemo_entity_insert ON mnemo_entity;
DROP POLICY IF EXISTS mnemo_entity_select ON mnemo_entity;

DROP INDEX IF EXISTS idx_mnemo_entity_kind;
DROP INDEX IF EXISTS idx_mnemo_entity_aliases;
DROP INDEX IF EXISTS idx_mnemo_entity_workspace;

DROP TABLE IF EXISTS mnemo_entity;
