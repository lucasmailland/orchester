-- Idempotent: run on a fresh production DB after `drizzle-kit push`.
-- Adds the 28 hot indices + HNSW for RAG vector search.

-- Hot FK indices on workspace-scoped tables
CREATE INDEX IF NOT EXISTS idx_agent_workspace_id ON agent(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_team_id ON agent(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_status ON agent(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_conversation_workspace_id ON conversation(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversation_started_at ON conversation(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_agent_id ON conversation(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversation_status ON conversation(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_conversation_external ON conversation(channel_id, external_id);
CREATE INDEX IF NOT EXISTS idx_conversation_employee_id ON conversation(employee_id);

CREATE INDEX IF NOT EXISTS idx_message_conversation_id ON message(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_created_at ON message(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_team_workspace_id ON team(workspace_id);
CREATE INDEX IF NOT EXISTS idx_channel_workspace_id ON channel(workspace_id);
CREATE INDEX IF NOT EXISTS idx_employee_workspace_id ON employee(workspace_id);

CREATE INDEX IF NOT EXISTS idx_flow_workspace_id ON flow(workspace_id);
CREATE INDEX IF NOT EXISTS idx_flow_run_flow_id ON flow_run(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_run_started_at ON flow_run(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_run_step_run_id ON flow_run_step(run_id);

CREATE INDEX IF NOT EXISTS idx_kb_workspace_id ON knowledge_base(workspace_id);
CREATE INDEX IF NOT EXISTS idx_kb_doc_kb_id ON knowledge_doc(kb_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunk_kb_id ON knowledge_chunk(kb_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunk_doc_id ON knowledge_chunk(doc_id);

CREATE INDEX IF NOT EXISTS idx_audit_workspace_id ON audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_workspace_id ON usage_event(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apikey_hash ON api_key(hashed_key);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON "session"(user_id);
CREATE INDEX IF NOT EXISTS idx_session_token ON "session"(token);
CREATE INDEX IF NOT EXISTS idx_workspace_member_user ON workspace_member(user_id);

-- HNSW for RAG vector search (pgvector)
CREATE INDEX IF NOT EXISTS idx_kb_chunk_embedding_hnsw
  ON knowledge_chunk USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ANALYZE;
