-- Reverse migration 0029_mnemosyne_archive.sql

REVOKE SELECT, INSERT, UPDATE, DELETE ON mnemo_fact_archive FROM app_user;

DROP POLICY IF EXISTS mnemo_fact_archive_delete ON mnemo_fact_archive;
DROP POLICY IF EXISTS mnemo_fact_archive_update ON mnemo_fact_archive;
DROP POLICY IF EXISTS mnemo_fact_archive_insert ON mnemo_fact_archive;
DROP POLICY IF EXISTS mnemo_fact_archive_select ON mnemo_fact_archive;

DROP INDEX IF EXISTS idx_mnemo_fact_archive_merged_into;
DROP INDEX IF EXISTS idx_mnemo_fact_archive_archived_at;
DROP INDEX IF EXISTS idx_mnemo_fact_archive_workspace;

DROP TABLE IF EXISTS mnemo_fact_archive;
