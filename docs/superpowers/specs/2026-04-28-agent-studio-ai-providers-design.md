# Agent Studio & AI Providers — Design Spec

**Date:** 2026-04-28  
**Scope:** Phase 1 + Phase 2 of Orchester v2  
**Goal:** Replace the basic agent modal with a professional full-page Agent Studio with AI-assisted prompt creation, version history, live test chat, and multi-provider model support (Anthropic, OpenAI, Google AI, Azure OpenAI).

---

## 1. Context & Current State

- Agents are currently created/edited via a small modal (`AgentFormModal.tsx`) with basic fields: name, role, system prompt (plain textarea), model (3 hardcoded Claude models), status, and team.
- No AI-assisted prompt creation, no version history, no live test, no multi-provider support.
- The `config` jsonb field on `agents` exists but is unused.
- Settings page exists and follows a `SectionCard` pattern with well-structured UI.
- DB uses Drizzle ORM + PostgreSQL with `drizzle-kit migrate` for migrations.

---

## 2. What We're Building

### 2A. AI Providers (settings)
A new section in `/settings` that lets workspace admins configure API keys for AI providers. Once connected, models from those providers appear in all agent editors.

### 2B. Agent Studio (full-page editor)
A new route `/agents/[id]` — a split-pane professional editor:
- **Left 60%:** Configuration (prompt editor, model picker, parameters, version history)
- **Right 40%:** Live test chat with the agent using current config

### 2C. Prompt Generator
A wizard modal accessible from Agent Studio. User describes what they want in plain language → the system calls the best available LLM → returns 2–3 professional prompt variations to choose from.

### 2D. Template Library
A modal with 20+ categorized professional system prompt templates (Sales, Support, HR, IT, Legal, Finance, Operations).

---

## 3. Data Model Changes

### New table: `ai_provider`

```typescript
export const aiProviderTypeEnum = pgEnum("ai_provider_type", [
  "anthropic", "openai", "google", "azure_openai"
]);

export const aiProviders = pgTable("ai_provider", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: aiProviderTypeEnum("provider").notNull(),
  apiKey: text("api_key").notNull(),         // AES-256-GCM encrypted
  enabled: boolean("enabled").notNull().default(true),
  modelsJson: jsonb("models_json")
    .$type<Array<{ id: string; name: string; contextWindow: number; tier: "fast" | "smart" | "powerful" }>>()
    .default([]),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestStatus: text("last_test_status"),  // "ok" | "error"
  lastTestError: text("last_test_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [unique().on(t.workspaceId, t.provider)]);  // one key per provider per workspace
```

### New table: `agent_version`

```typescript
export const agentVersions = pgTable("agent_version", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model").notNull(),
  temperature: numeric("temperature", { precision: 3, scale: 2 }),
  maxTokens: integer("max_tokens"),
  label: text("label"),   // optional: "v1 - Initial", "v2 - After testing"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

### Updated table: `agents`

Add two columns:
- `temperature numeric(3,2)` — default `0.7`
- `max_tokens integer` — default `null` (use provider default)

---

## 4. Encryption Utility

File: `apps/web/lib/encryption.ts`

- AES-256-GCM symmetric encryption using `ENCRYPTION_SECRET` env var (32-byte hex string).
- Exports: `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string`.
- Format: `iv:authTag:ciphertext` as base64 joined with `:`.
- Used only by AI provider API routes (server-side only, never client-side).

---

## 5. API Routes

### AI Providers

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/providers` | List all providers for workspace (keys masked) |
| `POST` | `/api/providers` | Upsert provider (create or update key) |
| `POST` | `/api/providers/[id]/test` | Test connection + discover models |
| `DELETE` | `/api/providers/[id]` | Remove provider |

**Provider test logic** (`POST /api/providers/[id]/test`):
- Decrypts key, calls provider's models endpoint:
  - Anthropic: `GET https://api.anthropic.com/v1/models`
  - OpenAI: `GET https://api.openai.com/v1/models`
  - Google: `GET https://generativelanguage.googleapis.com/v1beta/models`
  - Azure: `GET https://{endpoint}/openai/deployments`
- Maps response to `ModelInfo[]`, stores in `modelsJson`, updates `lastTestedAt` and `lastTestStatus`.
- Returns `{ ok: true, models: ModelInfo[] }` or `{ ok: false, error: string }`.

**GET /api/providers response:** api keys are replaced with `"••••••••"` (never sent to client).

### Agent Studio endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/agents/[id]` | Get single agent with full config |
| `POST` | `/api/agents/[id]/generate-prompt` | AI-assisted prompt generation |
| `POST` | `/api/agents/[id]/test-chat` | Send test message to agent |
| `GET` | `/api/agents/[id]/versions` | List version history |
| `POST` | `/api/agents/[id]/versions` | Save current config as named version |
| `POST` | `/api/agents/[id]/versions/[vid]/restore` | Restore a version |

**POST /api/agents/[id]/generate-prompt** body:
```typescript
{
  description: string;    // "I need an agent that qualifies sales leads..."
  tone: "professional" | "friendly" | "formal" | "direct";
  context?: {
    companyName?: string;
    industry?: string;
    extraDetails?: string;
  };
}
```
Response: `{ variations: string[] }` — 2–3 prompt options.

Provider priority for prompt generation: Anthropic → OpenAI → Google → error if none configured.

**POST /api/agents/[id]/test-chat** body:
```typescript
{
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  systemPrompt: string;   // current (unsaved) prompt — test uses live editor value
  model: string;
  temperature?: number;
  maxTokens?: number;
}
```
Response: `{ content: string; tokensUsed: number; model: string }`.

Routes to provider based on model prefix: `claude-*` → Anthropic, `gpt-*` / `o1-*` / `o3-*` → OpenAI, `gemini-*` → Google, `azure-*` → Azure OpenAI.

---

## 6. File Structure

```
packages/db/src/schema/
  core.ts               — add temperature, maxTokens to agents
  ai-providers.ts       — new: ai_provider + agent_version tables
  index.ts              — re-export new tables

apps/web/
  lib/
    encryption.ts       — AES-256-GCM encrypt/decrypt
    providers.ts        — getAvailableModels(), routeToProvider()

  app/api/
    providers/
      route.ts          — GET list, POST upsert
      [id]/
        route.ts        — DELETE
        test/route.ts   — POST test+discover

    agents/
      [id]/
        route.ts        — add GET handler
        generate-prompt/route.ts
        test-chat/route.ts
        versions/
          route.ts      — GET list, POST save version
          [vid]/restore/route.ts

  app/[locale]/(shell)/agents/
    page.tsx            — existing list (update: clicking agent → navigate to studio)
    [id]/page.tsx       — NEW: Agent Studio page (server component, fetches agent)

  components/agents/
    AgentFormModal.tsx  — keep for quick-create only (narrow modal, no studio features)
    AgentsPageClient.tsx — update: card click → router.push to studio
    studio/
      AgentStudio.tsx      — main split-pane client component
      PromptEditor.tsx     — rich textarea + quality score + toolbar
      ModelPicker.tsx      — multi-provider grouped model selector
      TestChat.tsx         — live chat panel (right pane)
      PromptGeneratorModal.tsx  — AI prompt wizard
      TemplatePickerModal.tsx   — template library
      VersionHistory.tsx        — version list + restore

  components/settings/
    SettingsClient.tsx    — add AIProvidersSection import
    AIProvidersSection.tsx — new: provider cards with key + test
```

---

## 7. Component Designs

### AgentStudio

Top-level layout:
```
┌─────────────────────────────────────────────────────────┐
│  ← Agentes   [Agent Name]  [Team Badge]  [Status]  [Save]│
├─────────────────────────────────┬───────────────────────┤
│  Tabs: Config | Versiones       │  Test Chat            │
│                                 │                       │
│  Name / Role fields             │  [System prompt used] │
│                                 │  ─────────────────   │
│  PromptEditor                   │  User: Hello...       │
│  [✨ Generate] [📚 Templates]   │  Agent: Hi, I'm...   │
│                                 │  ─────────────────   │
│  ModelPicker                    │  [Type a message...]  │
│  Temperature slider             │                       │
│  Max tokens input               │  Tokens: 234 used     │
└─────────────────────────────────┴───────────────────────┘
```

### PromptEditor

- `<textarea>` with monospace font for prompts
- Bottom toolbar: character count, estimated token count (~4 chars/token), quality score
- Quality score is a simple heuristic (0–100):
  - +30 if length > 200 chars
  - +20 if contains action verbs ("you are", "your job", "you must")
  - +20 if contains `{{` variables
  - +15 if length > 500 chars
  - +15 if contains examples or "for example"
- Quality badge: < 40 = Poor (red), 40–70 = Good (yellow), > 70 = Excellent (green)

### ModelPicker

- Dropdown/popover organized in groups:
  - **Anthropic** (if configured): Claude Sonnet 4.6, Claude Opus 4.7, Claude Haiku 4.5...
  - **OpenAI** (if configured): GPT-4o, GPT-4o-mini, o3, o3-mini...
  - **Google** (if configured): Gemini 1.5 Pro, Gemini 1.5 Flash, Gemini 2.0...
  - **Built-in (Anthropic)**: Always shown, uses workspace's Anthropic key or falls back to workspace default
- Each model shows: name, context window, cost tier badge (💨 Fast / 🧠 Smart / 🚀 Powerful)
- Models not available (provider not configured) shown grayed out with "Configure API key" tooltip

### PromptGeneratorModal

3-step wizard:
1. **Describe** — What does this agent do? (textarea, 50-500 chars)
2. **Customize** — Tone picker (4 options) + context fields (company name, industry)
3. **Pick** — Shows 2–3 generated variations, click to select, "Regenerate" option

### AIProvidersSection (in Settings)

- 4 provider cards in 2×2 grid: Anthropic, OpenAI, Google AI, Azure OpenAI
- Each card:
  - Provider logo (SVG inline) + name
  - Status badge: Not configured (gray) / Connected (green) / Error (red)
  - API key input (password type, show/hide toggle)
  - "Testear conexión" button → shows spinner → updates status + model list
  - Expandable model list (collapsed by default, "X modelos disponibles")
- "Guardar" button per card saves key via `POST /api/providers`

---

## 8. Navigation Changes

- `AgentsPageClient.tsx`: clicking an agent card calls `router.push(\`/${locale}/agents/${agent.id}\`)` instead of opening modal.
- "+ Nuevo Agente" button still opens the quick-create `AgentFormModal` (name + role + team + status only). After creation, redirects to the new agent's Studio page.
- Sidebar: no changes needed (Agentes link already exists).

---

## 9. i18n

Add keys to `es.json`, `en.json`, `pt-BR.json` under `agentStudio` and `settings.aiProviders` namespaces. All user-facing strings in components use `useTranslations`.

Key namespaces:
- `agentStudio.promptEditor.*` — quality labels, toolbar hints
- `agentStudio.modelPicker.*` — provider group labels, tier labels
- `agentStudio.generator.*` — wizard step labels
- `agentStudio.testChat.*` — chat UI labels
- `agentStudio.versions.*` — version history labels
- `settings.aiProviders.*` — provider card labels, test messages

---

## 10. Error Handling

- `test-chat` endpoint: if provider key not found → `401 { error: "PROVIDER_NOT_CONFIGURED" }`. Client shows inline message "Configura el proveedor en Ajustes".
- `generate-prompt`: same provider fallback, same error.
- Provider test failure: store error in `lastTestError`, return 200 with `{ ok: false, error: "..." }` (not a 5xx — the test itself succeeded, the provider rejected it).
- API key encryption: if `ENCRYPTION_SECRET` is not set, throw during startup with a clear message.

---

## 11. Environment Variables

Add to `.env.example`:
```
ENCRYPTION_SECRET=    # 32-byte hex string, generate with: openssl rand -hex 32
```

---

## 12. Testing Strategy

- **Unit:** `encryption.ts` encrypt/decrypt roundtrip; `providers.ts` model routing logic; quality score heuristic.
- **Integration:** API routes for providers (mock external API calls with `msw`); agent version save/restore.
- **E2E (manual):** Full Agent Studio flow from agents list → studio → generate prompt → test chat → save version → restore.

---

## 13. Out of Scope (future specs)

- Teams 2.0 (squads, team detail redesign) → Spec 2
- Organigrama 2.0 (interactive, Reactflow) → Spec 2
- Conversations enhancement (filter bar, detail drawer) → Spec 3
- Agent-to-agent orchestration (multi-agent pipelines)
- Webhook integrations from Studio
