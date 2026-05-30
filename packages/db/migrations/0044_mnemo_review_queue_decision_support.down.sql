-- Reverse migration 0044_mnemo_review_queue_decision_support.sql
DROP INDEX IF EXISTS idx_mnemo_review_queue_decision_unresolved;
ALTER TABLE mnemo_review_queue DROP CONSTRAINT IF EXISTS mnemo_review_queue_source_check;
ALTER TABLE mnemo_review_queue DROP COLUMN IF EXISTS decision_id;
ALTER TABLE mnemo_review_queue ALTER COLUMN fact_id SET NOT NULL;
