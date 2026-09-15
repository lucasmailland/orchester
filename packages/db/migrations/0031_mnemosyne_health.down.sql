-- Reverse migration 0031_mnemosyne_health.sql

REVOKE SELECT, INSERT, UPDATE, DELETE ON mnemo_health FROM app_user;

DROP POLICY IF EXISTS mnemo_health_delete ON mnemo_health;
DROP POLICY IF EXISTS mnemo_health_update ON mnemo_health;
DROP POLICY IF EXISTS mnemo_health_insert ON mnemo_health;
DROP POLICY IF EXISTS mnemo_health_select ON mnemo_health;

DROP INDEX IF EXISTS idx_mnemo_health_workspace;

DROP TABLE IF EXISTS mnemo_health;
