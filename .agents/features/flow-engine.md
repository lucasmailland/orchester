# Flow Engine

**File:** `apps/web/lib/flow-engine.ts`
**Owner:** flows
**Status:** stable

## Purpose
Server-side executor for visual flows built in the Flow Builder. Walks the
node graph, dispatches each node type, persists per-step traces, and emits
a final `flow_run` row.

## Planning (initial design)

### Public API
```ts
executeFlow({ flowId, workspaceId, triggerSource, input })
  → { runId, status: "succeeded" | "failed", error? }
```

### Algorithm
1. Load flow with nodes + edges from DB.
2. Find `trigger` node — that's the entry point.
3. Insert `flow_run` row with status=running.
4. Build initial context = `{ ...flow.variables, ...input }`.
5. `runFromNode(start)`:
   - Insert `flow_run_step` row.
   - Dispatch by `node.type` (see below).
   - Update step row with output / status.
   - For each outgoing edge (filtered by node's chosen `sourceHandle`),
     recurse with `depth+1`.
6. Mark run succeeded / failed.

### Depth limit
Max recursion depth = 100. Cycles produce `Flow exceeded max depth (100)`.

### Node dispatch
- `trigger` — pass-through.
- `agent` — invoke `llmCall()` with the agent's prompt + tools, store output.
- `condition` — `evaluateCondition()` true/false → choose `sourceHandle`.
- `switch` — interpolate `expression`, match `cases[].value` → handle.
- `http` — fetch with auth + retries + timeout.
- `transform` — set a variable from a template.
- `delay` — `setTimeout` capped at 60 s.
- `notify` — record-only (channel integration future).
- `code` — real JS in a `node:vm` sandbox (`runUserJs`); legacy mini-DSL fallback.
- `loop_for_each` — iterate `items` template (resolved to a real array), run `body` per item.
- `parallel` — run all child branches with `Promise.all`.
- `try_catch` — `try`/`catch` source handles; on error feed `errorVar`.
- `subflow` — call `executeFlow()` recursively, merge output.
- `wait_human` — set `_pendingApproval`, mark step paused.
- `kb_search` — semantic search over a knowledge base (`searchKnowledgeBase`).
- `integration` — run a connector action (`integrationId::action` + `input`).
- `spreadsheet` — evaluate an Excel-style formula via formulajs in a vm sandbox.
- `note` — no-op visual comment.

### Decisions & trade-offs
- **Single-process synchronous execution.** Long flows hit serverless 60 s
  timeouts. Phase 6 will move to BullMQ or pg-boss.
- **Code node is a tiny DSL**, not JS evaluation. Zero RCE risk; trade-off:
  limited expressiveness.
- **Variables are flat per run.** No nested scopes. Subflow merges entire
  output back into parent ctx.
- **HTTP retries with exponential backoff** (200 ms × 2^attempt).
- **wait_human is a stub** — no real pause/resume worker yet.

## Execution (changelog — newest first)

### 2026-05-22 — Flow Builder revamp (registry + copilot + observability)
- **Node registry** (`lib/flows/node-registry.ts`) is now the single source of
  truth for the palette, the auto-generated inspector and the copilot. Each
  node declares engine type + trilingual copy + typed fields.
- **4 new node executors:** `kb_search` (semantic search via shared
  `lib/knowledge-search.ts`), `integration` (reuses the connector framework via
  `runIntegrationAction`), `spreadsheet` (Excel-style formulas via
  `@formulajs/formulajs` in a `node:vm` sandbox), `note` (no-op comment).
- **Field-key reconciliation:** executors now read the registry field keys
  (`prompt`, `left/op/right`, `value`, `template`, `duration`, `items`,
  `instructions`, `code`, `formula`) with legacy fallbacks. New helpers
  `resolveValue`, `deepInterpolate`, `parseDuration`.
- **Code node now runs real JavaScript** in a `node:vm` sandbox (`runUserJs`):
  receives `input`, returns an object merged into variables. 1 s timeout, no
  `require`/globals. The old mini-DSL remains as a `source` fallback.
- **Live observability:** `executeFlow` accepts `onEvent` (threaded via
  `RunContext.emit`) emitting `run_start`/`step_start`/`step_finish`/`run_finish`.
  New SSE endpoint `app/api/flows/[id]/run-stream` streams them so the canvas
  lights up per-node live and a Run Inspector lists steps with plain-language
  errors.
- **Enum:** `flow_node_type` extended with `kb_search`, `integration`,
  `spreadsheet`, `note` (applied via `ALTER TYPE ... ADD VALUE`).
- All user-facing engine error messages rewritten in plain Spanish.

### 2026-04-29 — Phase 2 pro
- 7 new node types (switch, code, loop_for_each, parallel, try_catch, subflow,
  wait_human).
- HTTP node: Bearer/Basic/API-key auth + retries + AbortController timeout.
- Depth limit 50 → 100; subflow output merge.

### 2026-04-28 — initial engine
- Trigger/agent/condition/http/transform/delay/notify/end nodes.
- Per-step persistence with input/output.

## Performance notes
- Each step costs 1 INSERT + 1 UPDATE on `flow_run_step`.
- Flow with 50 nodes, all in series: ~50 round-trips. With indices, ~500 ms
  baseline + LLM time.
- Use `parallel` for independent fan-outs.

## Open issues / TODO
- Async execution via BullMQ or pg-boss (CRITICAL for production). The SSE
  run-stream keeps the request open for the whole run — fine locally, but long
  flows still risk serverless timeouts.
- Visual debugger: pause at breakpoint, inspect ctx.
- ~~SSE streaming of run progress to the UI.~~ Done (2026-05-22).
- Idempotency keys for webhook-triggered runs.
- Cron worker that picks up `flow_schedule` rows and triggers runs.
- `node:vm` is not a hard security boundary; acceptable because flow code is
  authored by the workspace owner. Revisit if flows become shareable/runnable
  across tenants.
