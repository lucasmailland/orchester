# Integrations Framework

**Route(s):** `/[locale]/(shell)/integrations`, `GET/POST /api/integrations`,
`POST/PATCH/DELETE /api/integrations/[id]`
**File(s):** `apps/web/lib/integrations/{registry,store}.ts`,
`apps/web/components/integrations/IntegrationsClient.tsx`,
`packages/db/src/schema/integrations.ts`, `apps/web/lib/net-guard.ts`
**Owner:** integrations

## Purpose
Conectar servicios de terceros por workspace con credenciales encriptadas, y
exponer sus acciones como tools que los agentes pueden ejecutar.

## Planning (initial design)

### Data model
- `workspace_integration`: `{ type, name, configEncrypted (AES-256-GCM), meta,
  enabled, status, lastError, lastTestedAt }`. Credenciales **nunca** se exponen
  al cliente; `listIntegrations()` devuelve sólo metadata.

### Connector contract (`lib/integrations/registry.ts`)
`{ id, name, description, category, authType, fields[], test(config), actions{} }`.
Cada `action` = `{ description, inputSchema, run(config, input) }`.

### Connectors implementados (reales)
| id | auth | acciones |
|----|------|----------|
| stripe | secret key | get_balance, list_customers, list_invoices |
| notion | integration token | search, query_database |
| postgres | connection string | query (READ ONLY tx + statement_timeout 10s) |
| resend | api key | send_email |
| http | bearer opcional | request |
| slack | bot token | post_message |
| google | OAuth (scaffold) | — (requiere consent) |

### Exposición a agentes
Tool `run_integration(integrationId, action, input)` en `lib/tools.ts` →
`runIntegrationAction()` resuelve credenciales server-side y ejecuta la acción.

### API surface
- `GET /api/integrations` → `{ catalog, configured }`.
- `POST /api/integrations` `{type,name,config}` → crea + testea.
- `POST /api/integrations/[id] {action:"test"}` → re-testea.
- `PATCH /api/integrations/[id]` → actualiza. `DELETE` → elimina.

### Decisions & trade-offs
- **Token-based primero:** funcionan sin que el operador registre apps OAuth.
  Google queda scaffolded (necesita consent flow).
- **Encriptación at-rest** (AES-256-GCM, `lib/encryption`) — nunca plaintext.
- **`pnpm override postgres@3.4.9`** para evitar doble instancia de drizzle-orm
  al agregar `postgres` a `apps/web`.

## Execution (changelog — newest first)

### 2026-05-21 — initial implementation + security hardening
- Tabla `workspace_integration`; registry + store + UI (modal de configuración,
  test en vivo, badges de estado, editar/borrar) reemplazando los placeholders
  "Próximamente".
- 6 connectors reales + Google scaffold. Tool `run_integration` para agentes.
- `integration.connected` dispara webhook saliente al conectar OK.
- **Seguridad (audit):**
  - SSRF: `assertPublicUrl`/`assertPublicDbHost` (`lib/net-guard.ts`) en
    connector HTTP y Postgres — bloquea loopback/RFC1918/link-local.
  - Postgres: ejecución en transacción `READ ONLY` + `statement_timeout 10s`
    (defensa más allá del regex; bloquea escritura y `pg_sleep` DoS).
- Verificado: conectar HTTP → encripta → test real (API externa → 200 →
  "connected") → persiste; SSRF a 169.254.169.254/localhost → 400.

## Open issues / TODO
- OAuth consent flow real para Google Workspace (Calendar/Drive/Gmail).
- Más connectors: HubSpot, Salesforce, Zendesk, Sheets.
- Rotación/expiración de credenciales y health-check periódico.
- DNS-rebinding en SSRF (hoy valida host literal, no IP resuelta).
