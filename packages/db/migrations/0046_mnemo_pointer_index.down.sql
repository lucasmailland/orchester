-- packages/db/migrations/0046_mnemo_pointer_index.down.sql
-- Reverses migration 0046 (pointer index table).

DROP INDEX IF EXISTS idx_mnemo_pointer_entity;
DROP INDEX IF EXISTS idx_mnemo_pointer_lookup;
DROP TABLE IF EXISTS mnemo_pointer;
