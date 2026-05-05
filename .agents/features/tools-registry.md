# Tools Registry

**File:** `apps/web/lib/tools.ts`

**Owner:** agents / tools
**Status:** stable (5 built-ins) + custom tools in DB

## Purpose
Built-in tool definitions that agents can call when they need to interact
with the world (compute, fetch URLs, search knowledge, trigger flows).

## Planning (initial design)

### Built-in tools (5)
| Tool | Purpose | Input |
|---|---|---|
| `current_time` | ISO + formatted time, optional IANA timezone | `{ timezone? }` |
| `calculator` | Safe arithmetic (+ − × ÷ % parens) — shunting-yard, no JS evaluator | `{ expression }` |
| `http_request` | Public-only HTTP call. Private IPs blocked. | `{ url, method, headers?, body? }` |
| `flow_call` | Invoke another workspace flow | `{ flowId, input? }` |
| `knowledge_search` | RAG search via pgvector cosine | `{ kbId, query, topK? }` |

### Public API
- `getToolDefinitions(enabledIds)` → `ToolDefinition[]` for the LLM
- `executeTool(name, input, ctx)` → executes server-side, returns the output

### Decisions & trade-offs
- **Calculator is shunting-yard arithmetic only**, not JS code execution.
  Zero RCE risk.
- **HTTP blocks private IPs** (`127.*`, `10.*`, `192.168.*`, `172.16-31.*`,
  localhost, 0.0.0.0). Trade-off: agents can't call internal services
  directly; workaround is to expose them via `flow_call`.
- **Custom tools** live in `agent_tool` table (workspace-scoped) — schema
  exists, registration flow not yet UI-driven.

## Execution (changelog — newest first)

### 2026-04-28 — knowledge_search added
- Tool calls `embed()` then pgvector cosine search.
- Returns `{ results: [{ id, docId, ordinal, text, docTitle, score }] }`.

### 2026-04-26 — initial 4 tools
- current_time, calculator, http_request, flow_call.

## Performance notes
- `executeTool` is awaited per call. The router loops up to 5 times.
- HTTP timeout: 30 s default (configurable per call).

## Open issues / TODO
- Tool: `web_search` (Tavily / Brave / SerpAPI).
- Tool: `email_send` (Resend wrapper).
- Tool: `slack_post`.
- Custom tool builder UI (data model exists).
- Per-tool rate limit + quota enforcement.
