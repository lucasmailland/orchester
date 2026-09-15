-- Reverse of 0038_conversation_sensitivity.sql
ALTER TABLE conversation
  DROP COLUMN IF EXISTS memory_learning_paused;
