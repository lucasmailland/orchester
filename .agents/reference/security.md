# Security — Orchester

> Estado actual + threat model + checklist para producción.

## Threat model

**Quién:** SaaS multi-tenant. Cada workspace ve SOLO su data. Roles: owner /
admin / editor / viewer.

**Qué protegemos (en orden de criticidad):**
1. **API keys de providers de IA** (Anthropic / OpenAI / Google / Azure) →
   robarlas = drain de cuotas + posibles cargos.
2. **Datos de conversaciones + KB** → contenido de empleados / clientes.
3. **Disponibilidad** → ataques de quema-cuota (test-chat hammering),
   webhook flood, DoS.
4. **Integridad** → role escalation, eliminar workspace ajeno.

**Adversarios contemplados:**
- User logged-in con rol bajo (viewer/editor) intentando escalar
- Atacante externo sin auth probando los webhooks públicos
- Operador con acceso a logs queriendo extraer secretos
- DB dump exfiltrado

## Layers actuales

### 1. Storage de secretos

| Secreto | Dónde vive | Cómo se protege |
| --- | --- | --- |
| `ENCRYPTION_SECRET` | env var del proceso | Required (64-char hex). Producción: secret manager. |
| `BETTER_AUTH_SECRET` | env var del proceso | Required. Producción: rotar el placeholder dev. |
| `DATABASE_URL` | env var del proceso | Connection string completa con creds. |
| API keys de providers | DB tabla `ai_provider.api_key` | Cifradas con AES-256-GCM (12-byte IV + 16-byte auth tag) usando `ENCRYPTION_SECRET`. |
| `channel.credentials_encrypted` | DB | Mismo esquema (Telegram bot token, Slack signing secret + bot token) |
| Session tokens | DB tabla `session` | better-auth, cookie HttpOnly + SameSite=Lax |

**Implementación encryption:** `apps/web/lib/encryption.ts`. Formato:
`base64(iv):base64(authTag):base64(ciphertext)`. Si alguien tampera el
ciphertext, el `authTag` no valida y `decrypt` lanza. Test cubre esto.

### 2. Authentication + Authorization

**better-auth** con sessions DB-backed:
- Cookie `__Secure-better-auth.session_token` en HTTPS, `better-auth.session_token` en local.
- HttpOnly + SameSite=Lax (CSRF parcial).
- Rotación natural por expiración server-side.

**Authorization:** cada endpoint llama `getCurrentSession()` + `getCurrentWorkspace()`.
La membership check (`workspace_member` row) es la barrera de tenancy. Para
acciones sensibles también se chequea el role:

```ts
if (ws.role !== "owner" && ws.role !== "admin") {
  return NextResponse.json({ error: "Insufficient role" }, { status: 403 });
}
```

**Endpoints con role-check enforced:**
- `PATCH /api/workspaces/[id]` → owner/admin
- `DELETE /api/workspaces/[id]` → **owner only** + slug confirmation
- `PATCH /api/workspace-members` → owner/admin (último-owner-protection)
- `DELETE /api/workspace-members` → owner/admin (no se puede borrar owner)
- `POST/DELETE /api/invites` → owner/admin
- `PATCH /api/channels/[id]` con `body.credentials` → owner/admin (implícito)
- `POST /api/providers` → owner/admin (implícito por `getCurrentWorkspace`)

### 3. Rate limiting

In-memory token bucket en `lib/rate-limit.ts`. Helpers:
- `rateLimit(key, opts)` → low-level
- `enforceRateLimit(key, opts)` → devuelve `429` listo o `null`
- `RATE_LIMITS.LLM_HEAVY` = 30 req/min (cara — quema cuota provider)
- `RATE_LIMITS.MUTATION` = 120 req/min
- `RATE_LIMITS.WEBHOOK` = 600 req/min

**Endpoints con rate-limit aplicado:**
- `POST /api/v1/agents` (público con API key) → 60 req/min/workspace
- `POST /api/v1/flows` (público con API key) → 60 req/min/workspace
- `POST /api/agents/[id]/test-chat` → 30 req/min/(workspace,user) — LLM-heavy
- `POST /api/conversations/[id]/reply` → 120 req/min/(workspace,user)

**Limitación conocida:** in-memory single-node. Si escalás a >1 réplica web,
cada una tiene su bucket → un atacante dispara N veces por réplica. Para
multi-node, swap a Upstash Redis o memcached.

### 4. Headers de seguridad

Configurados en `next.config.ts` (`async headers()`):

| Header | Valor | Por qué |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Evita MIME sniffing |
| `X-Frame-Options` | `SAMEORIGIN` | No embedeable en iframes ajenos |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | No leak de URL completa cross-site |
| `Permissions-Policy` | `camera=() microphone=() geolocation=()` | Nada de sensors |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Forzar HTTPS 2 años |
| `Content-Security-Policy` | ver next.config | Whitelist de orígenes para scripts/styles/connect |

**CSP whitelist `connect-src`:** `'self'`, `api.anthropic.com`, `api.openai.com`,
`generativelanguage.googleapis.com`, `slack.com`, `api.telegram.org`. Si
agregás un provider nuevo, hay que agregarlo acá.

Caddyfile (deploy OSS) repite estos headers como defense-in-depth.

### 5. Audit log

Tabla `audit_log`. Acciones logueadas hoy:
- `invite.create`, `invite.revoke`
- `workspace.update`, `workspace.delete`
- `member.role_change`, `member.remove`
- `provider.create`, `provider.update`

Cada entry guarda `userId`, `workspaceId`, `before`, `after`, `ip`, `userAgent`.
**Nunca se loguea la API key**, sólo `apiKeyMasked` (`sk-a••••AAAA`).

### 6. Sanitization de logs

`lib/safe-log.ts`: `safeLogError()` redacta patrones que parecen secretos
antes de mandar a stdout:
- `sk-ant-...`, `sk-proj-...`, `sk-...` (Anthropic/OpenAI)
- `AIza...` (Google)
- `xox[bp]-...` (Slack)
- `Bearer ...`, `Basic ...`
- `postgres://user:pass@...`
- JWTs (`eyJ...`)

Se aplica en `webhooks-out`, `memory-compaction`. **Pendiente** aplicar en
todos los `console.error` que tocan provider responses.

### 7. SQL injection

Drizzle ORM parameteriza todo. Cero string-concat en queries. Si tenés
que hacer `sql\`...\``, usá `sql<T>\`SELECT ... WHERE x = ${value}\`` —
drizzle bindea, no concatena.

## Checklist para producción

- [ ] Generar `BETTER_AUTH_SECRET` real (`openssl rand -base64 32`)
- [ ] Generar `ENCRYPTION_SECRET` real (`openssl rand -hex 32`)
- [ ] Mover ambos secrets a un secret manager (Doppler / Vault / Fly secrets / AWS SM)
- [ ] DB con TLS (no `?sslmode=disable`)
- [ ] Reverse proxy con TLS (Caddy lo hace solo)
- [ ] Backups de DB + MinIO encriptados at-rest
- [ ] Monitoring de runs failed (`/api/audit-logs?action=workspace.delete`)
- [ ] Alertas en `429` rates altos
- [ ] Rotación de API keys de providers (cada 90 días)
- [ ] Si vas multi-node: swap rate-limit in-memory por Redis
- [ ] Si tu workspace tiene compliance: agregar `audit.log` para más acciones (KB doc create/delete, conversation takeover, agent edit)
- [ ] Habilitar `output: standalone` (✅ ya está) para minimizar surface en runtime

## Limitaciones conocidas

1. **Rate-limit single-node** — bucket no compartido entre réplicas.
2. **CSP con `unsafe-inline` en script-src** — Next.js + framer-motion + recharts
   emiten inline. Endurecible cuando se migre a CSP nonce.
3. **Sin 2FA** — better-auth lo soporta pero no está habilitado.
4. **Webhooks salientes sin retry-with-jitter** — usan exponential backoff
   básico de 3 intentos. Si tu endpoint falla, se pierden eventos.
5. **No hay revocación de session forzada por user** — better-auth tiene
   `revokeSession`, no está expuesto en UI.

## Reportar vulnerabilidades

Reportá a `security@orchester.io` con detalles. Si es high-severity,
respondemos en 24h. Programa de bug bounty: TBD.
