-- PERF-10: covering index for the dashboard token aggregation
-- (sum(message.tokens_used) for a workspace's conversations over a date range,
--  joined message -> conversation, grouped by day / agent — lib/db-queries.ts).
-- INCLUDE keeps tokens_used in the index so the grouped sum is index-only and
-- doesn't heap-fetch every message row in the 30d window.
CREATE INDEX IF NOT EXISTS idx_message_conv_created_tokens
  ON "message" ("conversation_id", "created_at") INCLUDE ("tokens_used");

-- PERF-10 / CONV-9: GIN index for the conversation tag filter (jsonb @>).
-- Without it the tag containment filter seq-scans the conversation table.
CREATE INDEX IF NOT EXISTS idx_conversation_tags_gin
  ON "conversation" USING gin ("tags");
