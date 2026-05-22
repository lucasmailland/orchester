# MCP Server

**Route(s):** `POST /api/mcp`
**File(s):** `apps/web/lib/mcp/server.ts`, `apps/web/app/api/mcp/route.ts`,
`apps/web/lib/mcp/stdio-bridge.mjs`
**Owner:** integrations

## Purpose
Expone el workspace como un servidor MCP (Model Context Protocol) para que
cualquier cliente — Claude Desktop, Gemini, Cursor — opere agentes,
conversaciones, knowledge y flujos vía HTTP o stdio, autenticado con una API key.

## Planning (initial design)

### Goals
- Conectividad estándar (MCP) hacia adentro de Orchester, sin SDK propietario.
- Reutilizar la lógica existente (`runAgent`, `executeFlow`, `knowledge_search`)
  sin duplicar.
- Auth y multi-tenancy con el sistema de API keys ya existente.

### Transport / API surface
- **HTTP (Streamable HTTP):** `POST /api/mcp`, JSON-RPC 2.0. Métodos:
  `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
  `protocolVersion: 2025-06-18`. Soporta batch (cap 20). GET → 405 (POST-only).
- **stdio bridge:** `lib/mcp/stdio-bridge.mjs` proxea stdio↔HTTP (clientes
  locales). Env `ORCHESTER_URL` + `ORCHESTER_API_KEY`. Fetch con timeout 120s.

### Auth
- `Authorization: Bearer ok_live_…` → `authenticateApiKey()` → `{ workspaceId,
  keyId, scopes }`. Toda query scopea por `workspaceId`.
- `canWrite()` = allowlist: no-readonly Y (sin scopes ⇒ full legacy, O algún
  scope `*:write`/`write`). Tools de escritura requieren write.
- Rate limit por `workspaceId:keyId` (120 burst / 2 rps).

### Tools (catálogo)
| Tool | Access | Backed by |
|------|--------|-----------|
| list_agents | read | agents table |
| chat_with_agent | write | `runAgent()` |
| list_conversations / get_conversation | read | conversations/messages |
| search_knowledge | read | `executeTool("knowledge_search")` |
| list_knowledge_bases | read | knowledge_base table |
| list_flows / run_flow | read / write | `executeFlow()` |
| list_employees | read | employees table |
| create_agent | write | agents insert (status=draft) |

### Decisions & trade-offs
- **JSON-RPC a mano (sin `@modelcontextprotocol/sdk`):** evita dependencia
  pesada y problemas de bundling; el protocolo es simple.
- **Sólo `tools`** por ahora (no `resources`/`prompts`).
- **Reusa funciones de dominio** → cero divergencia con el comportamiento del
  producto.

## Execution (changelog — newest first)

### 2026-05-21 — initial implementation + security hardening
- Creado `lib/mcp/server.ts` (catálogo + ejecutor), `app/api/mcp/route.ts`
  (transporte JSON-RPC), `lib/mcp/stdio-bridge.mjs` (bridge local).
- 10 tools (ver tabla). Doc pública en `/docs/mcp`.
- **Seguridad (audit):** `canWrite()` pasó de blocklist (`!includes("readonly")`,
  que dejaba escribir a keys `["agents:read"]`) a allowlist por `*:write`;
  `executeFlow()` ahora scopea por workspace (cerró IDOR de `run_flow`);
  rate-limit por key (no sólo workspace); batch cap 20; timeout 120s en el bridge.
- Verificado e2e: initialize/tools.list/tools.call OK, 401 sin auth,
  create_agent persiste.

## Open issues / TODO
- Exponer `resources` (ej. documentos de KB) y `prompts`.
- Paginación en `tools/list` (hoy estático).
- Scopes más granulares por tool (hoy read/write binario).
- SSE streaming de `chat_with_agent` (hoy respuesta completa).
