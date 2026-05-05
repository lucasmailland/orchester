# Flow Builder

**Routes:**
- List: `/[locale]/flows` (inside shell)
- Builder: `/[locale]/flows/[id]` (full-screen)

**Files:**
- `apps/web/app/[locale]/(shell)/flows/{page,FlowsListClient}.tsx`
- `apps/web/app/[locale]/flows/[id]/page.tsx`
- `apps/web/components/flows/FlowBuilder.tsx` (canvas + sidebar + inspector + variables panel)
- `apps/web/components/flows/FlowRunsPanel.tsx`
- `apps/web/components/flows/nodes/{TriggerNode,AgentNode,ConditionNode,HttpNode,SimpleNode}.tsx`
- `apps/web/lib/flow-engine.ts` (server executor)
- `apps/web/app/api/flows/{...}` (CRUD + run + runs + webhooks + schedules + versions)
- `apps/web/app/api/webhooks/[secret]/route.ts` (public trigger)
- `apps/web/app/api/flow-templates/route.ts`

**Owner:** flows
**Status:** stable (engine), beta (visual debugger)

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
4. Drag from left sidebar (4 groups: AI / Logic / Data / Actions).
5. Connect nodes; click a node opens its Inspector on the right.
6. Variables panel (toggle) for typed initial flow vars.
7. Run manually → results in FlowRunsPanel.
8. Configure webhook or schedule for autonomous runs.

### Data
**Tables:** `flow`, `flow_run`, `flow_run_step`, `flow_version`,
`flow_webhook`, `flow_schedule`, `flow_template`.

**API endpoints:**
- `GET/POST /api/flows`
- `GET/PATCH/DELETE /api/flows/[id]`
- `POST /api/flows/[id]/run`
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
| `code` | Tiny DSL: `set <var> = <expr>` (sandboxed, no JS eval) |
| `loop_for_each` | Iterate over an array variable; `body` handle defines body |
| `parallel` | Run all child branches concurrently |
| `try_catch` | `try` and `catch` source handles |
| `subflow` | Invoke another flow + merge output back |
| `wait_human` | Pause for human approval (stub) |

### Decisions & trade-offs
- **Engine is synchronous within a single API call.** Long flows can hit
  serverless timeouts. Phase 6 will move to a queue (BullMQ or pg-boss).
- **Code node is a mini-DSL, not full JS.** Trade-off: limited expressiveness
  vs zero RCE risk.
- **Variables are flat per run** (no nesting/scoping). Simpler mental model.
- **Auto-save 2 s debounce** — never lose work, but hits the API often.
- **Smoothstep edges** for tree edges, bezier for agent-agent chains.

## Execution (changelog — newest first)

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
  exceed 60 s serverless limit.
- Visual debugger: step-by-step replay with vars panel highlighting.
- SSE streaming for runs panel (currently polls).
- Real notify integrations (Slack, Resend email, Twilio SMS).
- Cron worker (today schedules are stored but no worker triggers them yet).
- Subflow: pass scoped variables instead of merging the entire context.
