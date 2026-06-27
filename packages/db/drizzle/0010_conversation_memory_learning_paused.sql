-- Add memory_learning_paused to conversation table.
-- TS schema (migration 0038 comment) declares this NOT NULL default false.
ALTER TABLE "conversation"
  ADD COLUMN IF NOT EXISTS "memory_learning_paused" boolean NOT NULL DEFAULT false;
