# Database Reference

> Drizzle schema lives in `packages/db/src/schema/`. Run `pnpm --filter @orchester/db push` to sync.

## Tables (28+)

### Auth (better-auth — `auth.ts`)
- `user` — id, email, name, image, onboardingCompleted, preferredLocale.
- `session` — token-based sessions stored in DB. Indices: `(userId)`, `(token)`.
- `account` — OAuth links.
- `verification` — email verification tokens.

### Workspaces (`workspaces.ts`)
- `workspace` — id, name, slug.
- `workspace_member` — user ↔ workspace with role (owner/admin/editor/viewer).

### Core (`core.ts`)
- `team` — workspace squads.
- `agent` — full schema:
  - kind (conversational | flow), flowId, tools jsonb, variables jsonb,
    greeting, fallback, starters jsonb, avatarUrl, color, maxTurns,
    responseFormat, outputSchema jsonb, temperature, maxTokens, model.
- `channel` — kind (widget | telegram | slack | whatsapp | email | api),
  agentId, secret, credentialsEncrypted (AES-256-GCM JSON), config.
- `employee` — name, email, area, managerId, assignedAgentIds[].
- `conversation` — workspaceId, channelId, employeeId, agentId, status, summary,
  messageCount, durationSeconds, externalId, customerName, customerEmail,
  tags[], csat, deflected, assignedToUserId, takenOverAt, startedAt, endedAt.
- `message` — conversationId, role, content, tokensUsed, fromOperator,
  authorUserId, metadata.
- `conversation_label` — workspace tags.

### AI Providers (`ai-providers.ts`)
- `ai_provider` — provider enum (anthropic|openai|google|azure_openai),
  apiKey (encrypted), endpoint, modelsJson, lastTestedAt, lastTestStatus.
- `agent_version` — snapshot of an agent's prompt+model+config.

### Flows (`flows.ts`)
- `flow` — name, status, trigger, triggerConfig, nodes jsonb, edges jsonb,
  variables jsonb, version, lastRunAt, enabled.
- `flow_run` — status, triggerSource, input, output, error, startedAt, completedAt.
- `flow_run_step` — runId, nodeId, nodeType, status, input, output, error.
- `flow_version` — version snapshot.
- `flow_webhook` — secret, hmacKey, enabled, triggerCount.
- `flow_schedule` — cron, timezone, nextRunAt.
- `flow_template` — public + workspace templates.

### Knowledge (`knowledge.ts`)
- `knowledge_base` — name, embeddingProvider, embeddingModel, chunkSize, chunkOverlap.
- `knowledge_doc` — kbId, title, source, status (pending/parsing/embedding/ready/failed), chunkCount.
- `knowledge_chunk` — docId, kbId, ordinal, text, **embedding `vector(1536)`** (pgvector).
- `agent_memory` — agentId, conversationId, employeeId, scope, data jsonb.

### Agent Tools (`agent-tools.ts`)
- `agent_tool` — workspace-scoped custom tool definitions.

### Production (`production.ts`)
- `audit_log` — workspaceId, userId, action, resource, resourceId, before/after, ip, userAgent.
- `workspace_invite` — email, role, token, status, expiresAt.
- `api_key` — hashedKey (sha256), prefix, scopes[], lastUsedAt, revokedAt.
- `outbound_webhook` — url, secret, events[], enabled, failureCount.
- `webhook_delivery` — webhookId, event, payload, status, responseStatus, attemptCount.
- `usage_event` — kind, amount, costUsd, agentId, flowId, metadata.
- `workspace_billing` — plan, stripeCustomerId, stripeSubscriptionId, stripePriceId, currentPeriodEnd, cancelAtPeriodEnd.

## Indices (28 hot ones — see [`perf.md`](./perf.md))

Every `workspace_id` FK is indexed. Composite indices for sorted-by-time
queries: `(workspace_id, started_at DESC)`, `(workspace_id, created_at DESC)`.

## Extensions
- `vector` (pgvector 0.8) — required for knowledge embeddings.

## Relationships (high-level)
```
workspace
├── workspace_member ── user (auth)
├── team
│   └── agent ── flow (when kind="flow")
│         ├── agent_version
│         ├── tools[] ── (built-in registry / agent_tool)
│         ├── conversation
│         │     └── message
│         └── usage_event
├── channel ── agent
├── employee ── agent (assignedAgentIds)
├── flow ── flow_run ── flow_run_step
│         ├── flow_version
│         ├── flow_webhook
│         └── flow_schedule
├── knowledge_base
│     └── knowledge_doc
│           └── knowledge_chunk (vector)
├── ai_provider (encrypted)
├── api_key (hashed)
├── outbound_webhook ── webhook_delivery
├── workspace_invite
├── audit_log
└── workspace_billing (Stripe)
```

## Adding a table
1. Add to the matching schema file under `packages/db/src/schema/`.
2. `pnpm --filter @orchester/db push` (or `generate` for migrations).
3. Add indices on FKs that will be filter columns.
4. Update this file with the new table + relationships.
5. Document in the matching screen/feature spec.
