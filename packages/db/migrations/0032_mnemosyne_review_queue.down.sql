-- Reverse migration 0032_mnemosyne_review_queue.sql

REVOKE SELECT, INSERT, UPDATE, DELETE ON mnemo_review_queue FROM app_user;

DROP POLICY IF EXISTS mnemo_review_queue_delete ON mnemo_review_queue;
DROP POLICY IF EXISTS mnemo_review_queue_update ON mnemo_review_queue;
DROP POLICY IF EXISTS mnemo_review_queue_insert ON mnemo_review_queue;
DROP POLICY IF EXISTS mnemo_review_queue_select ON mnemo_review_queue;

DROP INDEX IF EXISTS idx_mnemo_review_queue_workspace_unresolved;

DROP TABLE IF EXISTS mnemo_review_queue;
