# AI Providers

**Files:**
- `apps/web/lib/providers.ts` — routing + connection test
- `apps/web/lib/llm-call.ts` — unified LLM call with tools
- `apps/web/lib/encryption.ts` — AES-256-GCM
- `apps/web/app/api/providers/{route,[id]/route,[id]/test/route}.ts`
- `apps/web/components/settings/AIProvidersSection.tsx`
- Schema: `packages/db/src/schema/ai-providers.ts`

**Owner:** providers / llm
**Status:** stable

## Purpose
Multi-provider LLM access. Workspace admins paste API keys for Anthropic,
OpenAI, Google AI, or Azure OpenAI. The system encrypts at rest, tests
connectivity, discovers available models, and routes every LLM call to the
right provider based on model prefix.

## Planning (initial design)

### Goals
- One workspace, many providers. Switch model per agent.
- Keys never leave the server. Stored encrypted (AES-256-GCM).
- Tool-calling supported for Anthropic (others: text-only for now).

### Routing rules (by model prefix)
- `claude-*` → Anthropic
- `gpt-*` / `o1-*` / `o3-*` / `o4-*` → OpenAI
- `gemini-*` → Google
- `azure/*` → Azure OpenAI

### Components
- `routeToProvider(model)` → `ProviderType | null`
- `defaultModelsFor(provider)` → curated list with name + tier + ctx window
- `testProviderConnection(provider, key, endpoint?)` → calls each provider's
  `/models` endpoint, returns available models.
- `llmCall({ workspaceId, model, systemPrompt, messages, temperature, maxTokens, tools? })` → unified result `{ content, tokensUsed, model, toolCalls? }`

### Tool-call protocol (Anthropic)
- Build messages with `tool_use` and `tool_result` blocks per Anthropic
  Messages API spec.
- `llmCall()` returns `toolCalls[]` if the model invoked tools.
- Caller (e.g. `lib/channels/router.ts` or `/test-chat`) executes each tool,
  feeds back a `tool_result` message, calls again. Loop max 5.

### Decisions & trade-offs
- **Keys are encrypted, never logged.** `apiKeyMasked` (`sk-a••••7890`) is the
  only client-visible representation.
- **Tool-calling only on Anthropic** for now — OpenAI Responses API differs;
  postponed.
- **No provider auto-fallback.** If you set `model: gpt-4o` and OpenAI key is
  missing, the call throws `ProviderNotConfiguredError`. Predictable.

## Execution (changelog — newest first)

### 2026-04-28 — Phase B
- AES-256-GCM encryption util with 12 unit tests.
- Anthropic tool_use block support.
- Connection test endpoint persists model list to `ai_provider.modelsJson`.

## Performance notes
- `getProviderKey()` is a single indexed query per LLM call. Cache could be
  added but provider keys change rarely; not worth it yet.
- Connection test calls upstream `/models` endpoints — 200-1000 ms typical.

## Open issues / TODO
- Tool-calling for OpenAI (Responses API) and Google (Function calling).
- Per-model config overrides at the agent level (already in schema, partial UI).
- Provider preference order for `pickAvailableModel` (currently fixed: anthropic
  → openai → google → azure).
