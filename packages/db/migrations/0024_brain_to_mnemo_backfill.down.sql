-- Reverse migration 0024_brain_to_mnemo_backfill.sql
-- Only deletes rows that were inserted by this backfill (identifiable by mfact_/mext_ prefix
-- and presence in brain_*).
DELETE FROM mnemo_fact WHERE id LIKE 'mfact_%' AND EXISTS (
  SELECT 1 FROM brain_fact WHERE id = 'bfact_' || substring(mnemo_fact.id from 7)
);
DELETE FROM mnemo_extraction_job WHERE id LIKE 'mext_%' AND EXISTS (
  SELECT 1 FROM brain_extraction_job WHERE id = 'bext_' || substring(mnemo_extraction_job.id from 6)
);
