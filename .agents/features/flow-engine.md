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
- `code` — mini-DSL `set <var> = <expr>` (sandboxed, no JS evaluator).
- `loop_for_each` — iterate array variable, run `body` sub-flow per item.
- `parallel` — run all child branches with `Promise.all`.
- `try_catch` — `try`/`catch` source handles; on error feed `errorVar`.
- `subflow` — call `executeFlow()` recursively, merge output.
- `wait_human` — set `_pendingApproval`, mark step paused.

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
- Async execution via BullMQ or pg-boss (CRITICAL for production).
- Visual debugger: pause at breakpoint, inspect ctx.
- SSE streaming of run progress to the UI.
- Idempotency keys for webhook-triggered runs.
- Cron worker that picks up `flow_schedule` rows and triggers runs.
