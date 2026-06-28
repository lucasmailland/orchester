-- 0013_mcp_server.sql — MCP client (KNOW-7)
-- Adds the mcp_server table so workspaces can connect third-party MCP servers
-- and have their tools proxied into the agent runtime.
CREATE TYPE "mcp_transport" AS ENUM ('http');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mcp_server" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "transport" "mcp_transport" NOT NULL DEFAULT 'http',
  "url" text NOT NULL,
  "auth_header_encrypted" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_tested_at" timestamp,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

-- RLS: follow the same Pattern A as agent_tool, ai_provider, etc.
DO $$ BEGIN PERFORM apply_pattern_a('mcp_server'); END $$;
