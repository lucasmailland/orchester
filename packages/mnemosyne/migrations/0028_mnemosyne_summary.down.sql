-- Reverse migration 0028_mnemosyne_summary.sql

REVOKE SELECT, INSERT, UPDATE, DELETE ON mnemo_summary FROM app_user;

DROP POLICY IF EXISTS mnemo_summary_delete ON mnemo_summary;
DROP POLICY IF EXISTS mnemo_summary_update ON mnemo_summary;
DROP POLICY IF EXISTS mnemo_summary_insert ON mnemo_summary;
DROP POLICY IF EXISTS mnemo_summary_select ON mnemo_summary;

DROP TRIGGER IF EXISTS mnemo_summary_updated_at ON mnemo_summary;
DROP FUNCTION IF EXISTS mnemo_summary_set_updated_at();

DROP INDEX IF EXISTS idx_mnemo_summary_expires;
DROP INDEX IF EXISTS idx_mnemo_summary_lookup;

DROP TABLE IF EXISTS mnemo_summary;
