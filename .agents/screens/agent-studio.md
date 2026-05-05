# Agent Studio

**Route:** `/[locale]/agents/[id]` (full-screen, OUTSIDE the shell layout)
**Files:**
- `apps/web/app/[locale]/agents/[id]/page.tsx` (server)
- `apps/web/components/agents/studio/AgentStudio.tsx` (client orchestrator)
- `apps/web/components/agents/studio/{PromptEditor,ModelPicker,TestChat,VersionHistory,PromptGeneratorModal,TemplatePickerModal,AgentConfigPanel}.tsx`
- `apps/web/components/agents/studio/{promptQuality,templates}.ts`
- `apps/web/app/api/agents/[id]/{route,test-chat,generate-prompt,versions}/...`

**Owner:** agents
**Status:** stable

## Purpose
Full-screen IDE-like surface to design, configure, version, and live-test a
single agent. Replaces the old "agent edit modal".

## Planning (initial design)

### Goals
- One screen has everything: prompt, model, tools, variables, knowledge,
  test chat, version history.
- Agent kind toggle: `conversational` (LLM with tools) or `flow` (driven by
  a Flow Builder pipeline).
- 60/40 split — config left, live test right.

### User flows
1. From `/agents`, click any agent card → lands here.
2. Edit prompt or click ✨ Generate (calls `/api/agents/[id]/generate-prompt`).
3. Pick model from ModelPicker (only providers configured in Settings).
4. Tweak temperature / maxTokens / kind / tools / variables.
5. Test chat in the right pane uses the unsaved config — iterate.
6. Hit Save → PATCH `/api/agents/[id]` with full payload.
7. Tab "Versions" → snapshot/restore.

### Data
- DB tables: `agent`, `agent_version`, `ai_provider`, `agent_memory`.
- API endpoints:
  - `GET /api/agents/[id]` — load full config
  - `PATCH /api/agents/[id]` — save (all fields)
  - `POST /api/agents/[id]/test-chat` — live test, uses CURRENT (unsaved) config
  - `POST /api/agents/[id]/generate-prompt` — AI-generated 3 variations
  - `GET/POST /api/agents/[id]/versions` — list + snapshot
  - `POST /api/agents/[id]/versions/[vid]/restore`

### Components
**AgentStudio (split-pane orchestrator)**
- Header: avatar, name, role, kind badge, Save button.
- Left tabs: `Prompt + Modelo` (PromptEditor + ModelPicker + sliders),
  `Avanzado` (AgentConfigPanel: kind, flowId, tools, variables, greeting,
  fallback, starters, branding, maxTurns, responseFormat, outputSchema),
  `Versiones` (VersionHistory).
- Right: `TestChat` always visible; passes the **unsaved** prompt+model+vars+tools.

**PromptEditor**
- Textarea + bottom toolbar with character/token count + quality score.
- Quality is a heuristic 0-100 (length, action verbs, examples, variables).

**ModelPicker**
- Multi-provider grouped dropdown. Reads `/api/providers` to know what's
  configured. Each model shows tier (fast/smart/powerful) and context window.

**TestChat**
- Multi-turn chat. Tracks tokens used. Renders tool calls with collapsible
  details. Shows flowRunId when agent is `kind=flow`.

**PromptGeneratorModal**
- 3-step wizard: describe → tone+context → pick variation.

**TemplatePickerModal**
- 10 templates (Sales/Support/HR/IT/Legal/Finance/Operations).

### Decisions & trade-offs
- Test chat uses the LIVE (unsaved) config so users can iterate without
  committing changes. The trade-off: changing models mid-conversation can
  produce confusing behavior — that's documented in the UI.
- Output JSON schema is validated on save (parses the textarea, errors via toast).
- Tool calls are looped server-side (max 5 iterations) inside `/test-chat`.

## Execution (changelog — newest first)

### 2026-05-04 — Phase 1 finish
- Added `AgentConfigPanel` with kind, flowId, tools, variables, greeting,
  fallback, starters, avatar, color, maxTurns, responseFormat, outputSchema.
- TestChat now passes variables + tools and renders tool-call traces.
- llm-call.ts gained Anthropic tool_use block support.

### 2026-04-28 — initial Studio
- Split-pane layout, PromptEditor with quality, ModelPicker grouped by provider,
  TestChat, VersionHistory, generator wizard, templates library.
- Routes /agents/[id] outside (shell) so it's full-screen.

## Performance notes
- Load is `await db.select().from(agents).where(...).limit(1)` — single indexed
  query, ~5 ms.
- Test chat latency is dominated by the upstream LLM, not us.
- Quality score is computed in a `useMemo` — cheap.

## Open issues / TODO
- Streaming for test-chat responses (currently buffered).
- Knowledge base picker in AgentConfigPanel (data layer ready, UI missing).
- Voice (TTS/STT) for agents.
- Eval suite tab (run a battery of test inputs).
