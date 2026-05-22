# Flow Builder

**Routes:**
- List: `/[locale]/flows` (inside shell)
- Builder: `/[locale]/flows/[id]` (full-screen)

**Files:**
- `apps/web/app/[locale]/(shell)/flows/{page,FlowsListClient}.tsx`
- `apps/web/app/[locale]/flows/[id]/page.tsx`
- `apps/web/components/flows/FlowBuilder.tsx` (canvas + toolbar + panels)
- `apps/web/components/flows/NodePalette.tsx` (registry-driven, searchable)
- `apps/web/components/flows/inspector/InspectorForm.tsx` (auto-generated from registry)
- `apps/web/components/flows/CopilotPanel.tsx` (AI build/explain/review)
- `apps/web/components/flows/FlowRunsPanel.tsx`
- `apps/web/components/flows/nodes/{TriggerNode,AgentNode,ConditionNode,HttpNode,SimpleNode}.tsx`
- `apps/web/lib/flows/{node-registry,field-types,copilot-tools,validate,layout}.ts`
- `apps/web/lib/flow-engine.ts` (server executor)
- `apps/web/app/api/flows/{...}` (CRUD + run + run-stream + copilot + webhooks + schedules + versions)
- `apps/web/app/api/webhooks/[secret]/route.ts` (public trigger)
- `apps/web/app/api/flow-templates/route.ts`

**Owner:** flows
**Status:** stable

## Architecture: declarative node registry
`lib/flows/node-registry.ts` is the **single source of truth**. Each node
declares its engine type, category, icon, accent, trilingual title/summary, and
typed fields (`lib/flows/field-types.ts`). The palette, the auto-generated
inspector, the copilot's catalogue and the validator all derive from it. Adding
a node = one registry entry (+ an executor in `flow-engine.ts` if new). UI copy
is plain-language for non-technical users; technical fields hide under
"Avanzado".

## Purpose
Visual workflow builder. Drag nodes onto a canvas, connect them, and
the server-side engine executes the graph (run-on-demand, via webhook,
or via schedule).

## Planning (initial design)

### Goals
- Competitive with n8n / Make / Zapier for AI-first flows.
- Handle complex orchestration: loops, parallel, try/catch, conditional
  branching, sub-flows, code blocks.
- Easy to debug: per-step input/output trace, errors visible.

### User flows
1. `/flows` lists all flows with status.
2. "Nuevo flujo" creates with optional `templateId`.
3. Builder opens with auto-save (2 s debounce).
4. Add steps from the searchable NodePalette (6 categories) or ask the Copilot.
5. Click a step → auto-generated InspectorForm on the right (plain-language).
6. Variables panel (toggle) for typed initial flow vars.
7. Run manually → live per-node state + Run Inspector (SSE run-stream).
8. Revisión panel validates the flow; auto-layout tidies it; undo/redo via Cmd+Z.
9. Configure webhook or schedule for autonomous runs.

### Data
**Tables:** `flow`, `flow_run`, `flow_run_step`, `flow_version`,
`flow_webhook`, `flow_schedule`, `flow_template`.

**API endpoints:**
- `GET/POST /api/flows`
- `GET/PATCH/DELETE /api/flows/[id]`
- `POST /api/flows/[id]/run`
- `POST /api/flows/[id]/run-stream` — SSE live execution events
- `POST /api/flows/[id]/copilot` — AI build/explain/review
- `GET /api/flows/[id]/runs`
- `GET /api/flow-runs/[id]` (run + steps)
- `GET/POST /api/flows/[id]/webhooks` + `[wid]` (PATCH/DELETE)
- `GET/POST /api/flows/[id]/schedules` + `[wid]`
- `GET/POST /api/flows/[id]/versions` + `[vid]/restore`
- `POST /api/webhooks/[secret]` — public trigger (HMAC optional)
- `GET /api/flow-templates`

### Node types (engine + UI)
| Type | Purpose |
|---|---|
| `trigger` | Entry point (manual/webhook/schedule/conversation) |
| `agent` | Invoke an agent — pass `agentId`, `message` template, `outputVar` |
| `condition` | true/false branch with `{{var}} op value` |
| `switch` | multi-branch by `expression` matching `cases[].value` |
| `http` | GET/POST/PUT/PATCH/DELETE with auth (Bearer/Basic/API-key), retry, timeout |
| `transform` | Set a variable from a template |
| `delay` | Sleep N ms (capped at 60 s) |
| `notify` | Log message + channel (Slack/email/webhook integration WIP) |
| `code` | Real JS in a `node:vm` sandbox (returns object merged into vars) |
| `loop_for_each` | Iterate over an array (`items` template); `body` handle |
| `parallel` | Run all child branches concurrently |
| `try_catch` | `try` and `catch` source handles |
| `subflow` | Invoke another flow + merge output back |
| `wait_human` | Pause for human approval (stub) |
| `kb_search` | Semantic search over a knowledge base |
| `integration` | Run a connector action (`integrationId::action` + input) |
| `spreadsheet` | Excel-style formula (formulajs) in a vm sandbox |
| `note` | No-op visual comment / sticky note |

Registry node ids differ from engine types only for triggers
(`trigger_manual/message/schedule/webhook` all map to engine `trigger` via
`fixedConfig.triggerKind`). Nodes carry `data.nodeId` so palette/inspector/engine
agree.

### Decisions & trade-offs
- **Engine is synchronous within a single API call.** Long flows can hit
  serverless timeouts. Phase 6 will move to a queue (BullMQ or pg-boss).
- **Code node now runs real JS** in a `node:vm` sandbox (1 s timeout, no
  `require`/globals). Not a hard security boundary — acceptable because flow code
  is authored by the workspace owner. Legacy mini-DSL kept as `source` fallback.
- **Variables are flat per run** (no nesting/scoping). Simpler mental model.
- **Auto-save 2 s debounce** — never lose work, but hits the API often.
- **Smoothstep edges** for tree edges, bezier for agent-agent chains.

## Execution (changelog — newest first)

### 2026-05-22 — "Person-first" UX wave
- **Rich per-node docs** (`lib/flows/node-docs.ts`): what it's for, when it's
  ideal, a tip — in the inspector ("¿Cómo funciona este paso?"), palette
  tooltips, and the copilot's catalogue.
- **Auto-connect on add** + **drag-and-drop** from palette. Adding a step while
  one is selected wires it (right default handle) and places it to the right.
- **Labeled branch handles** on canvas (new `nodes/BranchNode.tsx`): condition
  Sí/No, try_catch Intentar/Si falla, loop Por cada uno/Al terminar, switch
  Siguiente. Fixes loop/try_catch which previously rendered the wrong handles.
- **Visual data picker**: clickable chips insert `{{var}}` so users never type
  the templating syntax. Available data = flow vars + each step's default output.
- **Run form** instead of raw JSON (JSON kept as advanced toggle).
- **Inline validation badges** (⚠️) on problematic steps, live.
- **Copilot preview**: proposal card with Reemplazar / Sumar al flujo / Descartar.
- **Templates gallery** in the empty state (`lib/flows/templates.ts`) + node
  cards show a live one-line config summary.

### 2026-05-22 — Flow Builder revamp
- **Declarative node registry** drives a registry-driven searchable
  `NodePalette` and an auto-generated `InspectorForm` (label + help + example +
  Avanzado accordion + dependsOn). Replaced the hand-written sidebar + inspector.
- **AI Copilot** (`CopilotPanel` + `/api/flows/[id]/copilot`): describe a flow
  (+ optional API URL) and it builds the whole graph via function-calling
  (`set_flow`), validated/positioned by a pure `buildGraphFromSpec`. Also offers
  "explain this flow" and "review for errors" quick actions.
- **Bigger node library:** kb_search, integration (reuse connectors), spreadsheet
  (formulajs), note, plus reconciled field keys across all nodes.
- **Live observability:** Run button consumes the SSE `run-stream`; nodes light
  up live (running/ok/fail rings) and a Run Inspector lists steps with
  plain-language errors.
- **Authoring productivity:** plain-language validation panel (`validate.ts`),
  one-click auto-layout (`layout.ts`), undo/redo (Cmd/Ctrl+Z) with history
  snapshots, guided empty-canvas state.
- All new copy is plain-language; locale fixed to `es` via `LOCALE` (registry is
  trilingual es/en/pt-BR, ready to switch).

### 2026-04-29 — Phase 2 pro
- Added 7 new node types: switch, code, loop_for_each, parallel, try_catch,
  subflow, wait_human.
- HTTP node: Bearer/Basic/API-key auth, retries with backoff, abort/timeout.
- 4 new tables: flow_version, flow_webhook (HMAC), flow_schedule (cron),
  flow_template.
- 8 new API routes (webhooks, schedules, versions, templates).
- Sidebar grouped: AI / Lógica / Datos / Acciones.
- Variables panel toggle, auto-save 2 s.

### 2026-04-28 — initial flow builder
- @xyflow/react canvas, 7 base node types, sidebar, inspector, runs panel.
- Engine with depth-50 cycle guard, structured per-step persistence.

## Performance notes
- Engine: each step inserts/updates `flow_run_step` — cost is O(steps).
- HTTP node uses AbortController for timeouts.
- Auto-save coalesces via 2 s debounce.
- `/api/flow-templates` returns public + workspace templates (~10 rows).

## Open issues / TODO
- Move execution to a queue (BullMQ + Redis or pg-boss). Today long flows can
  exceed 60 s serverless limit (the SSE run-stream holds the request open).
- Visual debugger: step-by-step replay with vars panel highlighting.
- ~~SSE streaming for runs.~~ Done via `/run-stream` (2026-05-22).
- Copilot: let it edit an existing flow incrementally (today `set_flow` replaces
  the whole graph) and optionally probe the given API URL (SSRF-guarded).
- Copy-paste / duplicate nodes; sticky-note styling for the `note` node.
- Real notify integrations (Slack, Resend email, Twilio SMS).
- Cron worker (today schedules are stored but no worker triggers them yet).
- Subflow: pass scoped variables instead of merging the entire context.
