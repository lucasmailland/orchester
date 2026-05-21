# MCP Server, Integrations Framework & Webhooks — Design Spec

> **Status:** Implemented & security-audited (2026-05-21)
> **Scope:** Tres subsistemas de conectividad para que Orchester se integre con
> el ecosistema externo: (1) un MCP server propio, (2) un framework de
> integraciones de terceros, (3) webhooks entrantes/salientes completos.

---

## 1. Objetivo

Que cualquier cliente o empresa pueda conectarse a Orchester y que los agentes
de Orchester puedan operar servicios externos:

- **Hacia adentro (MCP):** Claude Desktop, Gemini, Cursor, etc. se conectan al
  workspace vía MCP y operan agentes, conversaciones, knowledge y flujos.
- **Hacia afuera (Integrations):** los agentes ejecutan acciones en Stripe,
  Notion, Postgres, Resend, Slack, HTTP/REST.
- **Eventos (Webhooks):** entrega saliente firmada de eventos del workspace y
  recepción entrante para disparar flujos.

---

## 2. MCP Server

### 2.1 Transporte
- **HTTP (Streamable HTTP):** `POST /api/mcp`, JSON-RPC 2.0. Métodos:
  `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
  Soporta batches (cap 20). `protocolVersion: 2025-06-18`.
- **stdio bridge:** `lib/mcp/stdio-bridge.mjs` proxya stdio↔HTTP para clientes
  locales (Claude Desktop clásico). Timeout de 120s en el fetch.

### 2.2 Auth & autorización
- `Authorization: Bearer ok_live_…` → `authenticateApiKey()` resuelve
  `{ workspaceId, keyId, scopes }`.
- Toda query SQL filtra por `workspaceId`. Funciones delegadas (`loadAgent`,
  `executeFlow`, `knowledge_search`) también scopean por workspace.
- **Escritura (allowlist):** `canWrite()` = no-readonly Y (sin scopes ⇒ full
  legacy, O algún scope `*:write`). Tools de escritura: `chat_with_agent`,
  `run_flow`, `create_agent`.
- Rate-limit por `workspaceId:keyId` (120 burst / 2 rps).

### 2.3 Tools (10)
`list_agents`, `chat_with_agent`, `list_conversations`, `get_conversation`,
`search_knowledge`, `list_knowledge_bases`, `list_flows`, `run_flow`,
`list_employees`, `create_agent`. Reusan `runAgent`, `executeFlow`,
`executeTool("knowledge_search")` — sin lógica duplicada.

### 2.4 Archivos
`lib/mcp/server.ts` (catálogo + ejecutor), `app/api/mcp/route.ts` (transporte),
`lib/mcp/stdio-bridge.mjs` (bridge local).

---

## 3. Integrations Framework

### 3.1 Modelo
- Tabla `workspace_integration`: `type`, `name`, `configEncrypted`
  (AES-256-GCM vía `lib/encryption`), `meta` (no sensible), `status`,
  `lastError`. Credenciales **nunca** se exponen al cliente; `listIntegrations()`
  devuelve sólo metadata.
- Connector (`lib/integrations/registry.ts`): `fields`, `test()`, `actions`.
- Store (`lib/integrations/store.ts`): upsert encriptado + test real, run action.

### 3.2 Connectors implementados (reales)
| Connector | Auth | Acciones |
|-----------|------|----------|
| Stripe | secret key | get_balance, list_customers, list_invoices |
| Notion | integration token | search, query_database |
| Postgres | connection string | query (READ ONLY tx + statement_timeout 10s) |
| Resend | api key | send_email |
| HTTP/REST | bearer opcional | request |
| Slack | bot token | post_message |
| Google Workspace | OAuth (scaffold) | — (requiere completar consent) |

### 3.3 Exposición a agentes
Tool `run_integration(integrationId, action, input)` en `lib/tools.ts` ejecuta
cualquier acción de una integración conectada, resolviendo credenciales
server-side.

### 3.4 Seguridad
- **SSRF:** `assertPublicUrl` / `assertPublicDbHost` (`lib/net-guard.ts`) bloquean
  loopback, RFC1918, link-local (metadata cloud) en HTTP y Postgres.
- **Postgres read-only:** doble defensa — regex (SELECT/WITH only) + transacción
  `READ ONLY` con `statement_timeout`.

---

## 4. Webhooks

### 4.1 Salientes
- `outbound_webhook` (url, secret, events) + `webhook_deliveries` (log).
- `dispatchEvent()` firma HMAC-SHA256, reintenta 3× con backoff+jitter, registra
  cada entrega. `failureCount` incremental para auto-disable futuro.
- Catálogo de 14 eventos (`WEBHOOK_EVENTS`). SSRF-guard en create/edit/deliver.
- API: `GET/POST /api/webhooks-out`, `PATCH/DELETE/POST(test) /[id]`,
  `GET /[id]/deliveries`, `GET /events`. UI con botón "Probar".

### 4.2 Entrantes
- `POST /api/webhooks/[secret]` dispara un flow con el payload.
- HMAC opcional **timing-safe** (`crypto.timingSafeEqual`).
- Rate-limit por secret (60/min) + cap de body 1MB.
- Forwarda sólo headers de una whitelist segura (no Authorization/Cookie).

---

## 5. Decisiones clave

1. **JSON-RPC a mano (sin SDK MCP):** evita una dependencia pesada y problemas de
   bundling en Edge/Node; el protocolo es simple.
2. **Connectors token-based primero:** funcionan sin que el operador registre
   apps OAuth. OAuth (Google) queda scaffolded.
3. **`pnpm override postgres@3.4.9`:** evita doble instancia de drizzle-orm al
   agregar `postgres` a `apps/web`.
4. **Defensa en profundidad en Postgres:** regex + transacción read-only, porque
   una regex sola es evadible.

---

## 6. Auditoría de seguridad (2026-05-21)

Code-review en paralelo de las 3 piezas. Hallazgos confirmados y corregidos:

- **CRÍTICO** MCP write-gate blocklist → allowlist.
- **CRÍTICO** webhook inbound HMAC `!==` → timing-safe.
- **CRÍTICO** webhook inbound sin rate-limit → 60/min + body cap.
- **ALTO** `run_flow` IDOR → `executeFlow` scopea por workspace.
- **ALTO** SSRF salientes/connectors → `net-guard`.
- **ALTO** `failureCount` estancado → incremental.
- **ALTO** headers filtrados al flow → whitelist.
- **ALTO** Postgres regex-only → READ ONLY tx + timeout.

Falsos positivos descartados: `chat_with_agent`/`search_knowledge` ya scopean por
workspace; `protocolVersion 2025-06-18` es válido.

---

## 7. Pendiente / no-objetivos

- OAuth consent flow real para Google Workspace (hoy scaffold).
- Entrega de webhooks vía cola en background (hoy inline best-effort).
- DNS-rebinding en SSRF (el guard valida host literal, no IP resuelta).
- MCP `tools/list` paginado y `resources`/`prompts` (sólo `tools` por ahora).
