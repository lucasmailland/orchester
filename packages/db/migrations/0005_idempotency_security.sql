-- packages/db/migrations/0005_idempotency_security.sql

CREATE TABLE idempotency_key (
  key text NOT NULL,
  workspace_id text,
  user_id text NOT NULL REFERENCES "user"(id),
  endpoint text NOT NULL,
  request_hash char(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (user_id, endpoint, key)
);
CREATE INDEX idx_idempotency_expires ON idempotency_key(expires_at);

CREATE TABLE security_event (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspace(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity text NOT NULL,
  actor_user_id text,
  actor_ip inet,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_security_event_workspace ON security_event(workspace_id, created_at DESC);
CREATE INDEX idx_security_event_type ON security_event(event_type, created_at DESC);
