-- Reverse migration 0034_mnemosyne_episode.sql

REVOKE SELECT, INSERT, UPDATE, DELETE ON mnemo_episode FROM app_user;

DROP POLICY IF EXISTS mnemo_episode_delete ON mnemo_episode;
DROP POLICY IF EXISTS mnemo_episode_update ON mnemo_episode;
DROP POLICY IF EXISTS mnemo_episode_insert ON mnemo_episode;
DROP POLICY IF EXISTS mnemo_episode_select ON mnemo_episode;

DROP INDEX IF EXISTS idx_mnemo_episode_topics;
DROP INDEX IF EXISTS idx_mnemo_episode_workspace_occurred;

DROP TABLE IF EXISTS mnemo_episode;
