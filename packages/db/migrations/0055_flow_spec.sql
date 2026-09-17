-- packages/db/migrations/0055_flow_spec.sql
--
-- Long-form, versioned flow documentation. Both columns are nullable, so the
-- migration is safe to apply before the application that reads them starts.
ALTER TABLE flow ADD COLUMN IF NOT EXISTS spec text;
ALTER TABLE flow_version ADD COLUMN IF NOT EXISTS spec text;
