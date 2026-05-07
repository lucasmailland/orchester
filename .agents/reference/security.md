# Security — Orchester

> Threat model + capas activas + checklist de prod + cómo responder a incidentes.
> Última actualización: 2026-05-07.

Esta no es una página de marketing. Lo que dice acá es lo que está
implementado y comiteado en `main`. Lo que falta o tiene caveats lo digo
explícito en cada sección.

---

## Threat model

**Producto:** SaaS multi-tenant. Cada workspace ve SOLO su data.
Roles: `owner` > `admin` > `editor` > `viewer`.

**Qué protegemos (en orden de criticidad):**

1. **API keys de providers de IA** (Anthropic / OpenAI / Google / Azure) →
   robarlas = drain de cuotas + posibles cargos $$$.
2. **Datos de conversaciones + KB** → contenido de empleados/clientes.
3. **Disponibilidad** → ataques de quema-cuota (test-chat hammering),
   webhook flood, DoS.
4. **Integridad** → role escalation, eliminar workspace ajeno.

**Adversarios contemplados:**

- User logged-in con rol bajo (viewer/editor) intentando escalar
- Atacante externo sin auth probando los webhooks públicos
- Operador con acceso a logs queriendo extraer secretos
- DB dump exfiltrado
- Device del user comprometido (usuario olvidó cerrar sesión)
- Commit accidental de secret en git

---

## Capas activas

### 1. Storage de secretos

| Secreto | Dónde vive | Cómo se protege |
| --- | --- | --- |
| `ENCRYPTION_SECRET` | env var del proceso | 64-char hex required. **Prod:** secret manager (Doppler/Vault/Fly secrets/AWS SM). |
| `BETTER_AUTH_SECRET` | env var | Required. **Prod:** rotar el placeholder dev (`openssl rand -base64 32`). |
| `DATABASE_URL` | env var | Connection string completa con creds. |
| API keys de providers | DB tabla `ai_provider.api_key` | **AES-256-GCM** (12-byte IV + 16-byte auth tag) usando `ENCRYPTION_SECRET`. |
| `channel.credentials_encrypted` | DB | Mismo esquema (Telegram bot token, Slack signing+bot secrets) |
| Session tokens | DB tabla `session` | better-auth, cookie HttpOnly + SameSite=Lax |

**Implementación:** `apps/web/lib/encryption.ts`. Formato:
`base64(iv):base64(authTag):base64(ciphertext)`. Si tampera el ciphertext,
el `authTag` no valida y `decrypt()` lanza. Test cubre esto.

**Rotación:** `scripts/rotate-encryption-secret.sh` re-cifra todas las filas
con campos AES en una sola pasada. Procedimiento:

```bash
# 1. Pará workers + web (o ponelos read-only).
# 2. Corré el script con el secret viejo en env:
DATABASE_URL=postgres://... ENCRYPTION_SECRET=<viejo> ./scripts/rotate-encryption-secret.sh
# 3. El script imprime el secret nuevo. Pegalo en .env / secret manager.
# 4. Levantá web + worker.
```

### 2. Authentication + Authorization

**better-auth** con sessions DB-backed:

- Cookie `__Secure-better-auth.session_token` en HTTPS, `better-auth.session_token` en local.
- HttpOnly + SameSite=Lax (CSRF parcial).
- Rotación natural por expiración server-side.

**Authorization:** cada endpoint llama `requireAuth({ minRole: "..." })`
del nuevo helper en `lib/auth-guards.ts`. Levels: viewer=0, editor=1,
admin=2, owner=3.

**Endpoints con role-check enforced:**

- `PATCH /api/workspaces/[id]` → owner/admin
- `DELETE /api/workspaces/[id]` → **owner only** + slug confirmation
- `PATCH /api/workspace-members` → owner/admin (último-owner-protection)
- `DELETE /api/workspace-members` → owner/admin (no se puede borrar owner)
- `POST/DELETE /api/invites` → owner/admin
- `POST /api/providers` → autenticado (workspace owner por convención)
- `DELETE /api/sessions` → solo el dueño de la session

### 3. Rate limiting

Token bucket pluggable en `lib/rate-limit.ts`. Default: in-memory single-node.
Para multi-node, swap a Redis con `setRateLimitAdapter(createRedisAdapter(client))`
del `lib/rate-limit-redis.ts` (Lua script atomic, sin races entre réplicas).

**Presets** (`RATE_LIMITS` en lib/rate-limit.ts):

- `LLM_HEAVY` = 30 req/min — endpoints que tocan provider de IA
- `MUTATION` = 120 req/min — POST/PATCH/DELETE de records
- `WEBHOOK` = 600 req/min — entrantes públicos

**Endpoints protegidos:**

- `/api/v1/agents`, `/api/v1/flows` (API pública con key) → 60/min/workspace
- `/api/agents/[id]/test-chat` → 30/min/(workspace,user) — LLM-heavy
- `/api/conversations/[id]/reply` → 120/min/(workspace,user)

### 4. Headers de seguridad

**CSP dinámico con nonce** en `middleware.ts` (Edge runtime). Genera nonce
con `crypto.getRandomValues` por request, lo inyecta en:

- header `Content-Security-Policy` con `'nonce-XXX' 'strict-dynamic'`
- header `x-nonce` para que Server Components lo lean

Resultado: scripts inline producidos por Next.js NO ejecutan a menos que
tengan el nonce de esta request → bloquea XSS reflejado.

**`script-src`:** `'self' 'nonce-XXX' 'strict-dynamic'` + en dev `'unsafe-eval'`.
**`style-src`:** mantenemos `'unsafe-inline'` porque framer-motion + recharts
inyectan styles inline sin nonce. Trade-off conocido; endurecible cuando
migremos a tailwind/CSS-modules.

Headers estáticos en `next.config.ts`:

| Header | Valor |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=() microphone=() geolocation=()` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |

**`connect-src` whitelist:** `'self'`, `api.anthropic.com`, `api.openai.com`,
`generativelanguage.googleapis.com`, `slack.com`, `api.telegram.org`. Si
agregás un provider nuevo, hay que agregarlo en `middleware.ts → buildCsp()`.

Caddyfile (deploy OSS) repite estos headers como defense-in-depth.

### 5. Audit log

Tabla `audit_log` con `userId`, `workspaceId`, `before`, `after`, `ip`, `userAgent`.

**Acciones logueadas:**

| Action | Resource | Loguea |
| --- | --- | --- |
| `invite.create` | `workspace_invite` | email, role |
| `invite.revoke` | `workspace_invite` | id |
| `workspace.update` | `workspace` | before/after de name+timezone |
| `workspace.delete` | `workspace` | name + slug **antes** del cascade |
| `member.role_change` | `workspace_member` | before/after role |
| `member.remove` | `workspace_member` | userId + role |
| `provider.create` | `ai_provider` | provider + apiKeyMasked (NUNCA la key) |
| `provider.update` | `ai_provider` | provider + apiKeyMasked |
| `channel.delete` | `channel` | name + type |
| `kb.doc.delete` | `knowledge_doc` | title + kbId |
| `conversation.takeover` | `conversation` | id |
| `conversation.takeover_release` | `conversation` | id |
| `session.revoke` | `session` | id |
| `session.revoke_all` | `session` | count |

UI: `/settings#audit` muestra los últimos 200 entries con filtro y diff
expandible. Read-only — un audit log mutable no es un audit log.

### 6. Sanitization de logs

`lib/safe-log.ts` con `safeLogError(prefix, err)`. Redacta antes de
`console.error`:

- `sk-ant-...`, `sk-proj-...`, `sk-...` (Anthropic/OpenAI)
- `AIza...` (Google)
- `xox[bp]-...` (Slack)
- `Bearer ...`, `Basic ...`
- `postgres://user:pass@...` → `postgres://user:***@...`
- JWTs (`eyJ...`)

**Aplicado en:** `webhooks-out`, `memory-compaction`, `audit`, `queue`,
`conversations/[id]/reply`. Auditá `git grep "console.error"` antes de cada
release para que no haya leaks nuevos sin sanitizar.

### 7. Sesiones revocables

`/api/sessions` (GET/DELETE) + UI en `/settings#sessions`:

- Lista todas las sessions activas del user (device, IP, fechas)
- Marca cuál es la actual (no se deja revocar — para eso está el logout)
- Botón "Cerrar todas las otras sesiones" → un click cierra remoto todos los devices

Útil ante "creo que olvidé cerrar sesión en la PC del laburo" o
"sospecho que me hackearon".

### 8. SQL injection

Drizzle ORM parameteriza todo. Cero string-concat en queries. Si tenés
que escribir `sql\`...\``, usá `sql<T>\`SELECT ... WHERE x = ${value}\`` —
drizzle bindea, no concatena.

### 9. Secret scanning

**Local:** pre-commit hook con gitleaks. Instalá una vez:

```bash
brew install gitleaks
./scripts/install-git-hooks.sh
```

A partir de ahí, cada `git commit` corre `gitleaks protect --staged` y
aborta si detecta secretos. Configurado en `.gitleaks.toml` (custom rules
para Anthropic, OpenAI, Google, Slack + allowlist para placeholders y tests).

**CI:** job `secret-scan` corre antes que el resto. Si gitleaks detecta
algo, el job principal de tests/build NO arranca.

### 10. Webhooks salientes con jitter

`lib/webhooks-out.ts` retry con **decorrelated jitter** (AWS pattern).
Backoff exponencial 500ms → 1s → 2s → ... cap 30s, con random factor.
Evita thundering herd cuando muchos webhooks fallan a la vez.

---

## Producción — checklist obligatoria

Antes de subir a prod (o hacer customer-facing):

- [ ] Generar `BETTER_AUTH_SECRET` real (`openssl rand -base64 32`)
- [ ] Generar `ENCRYPTION_SECRET` real (`openssl rand -hex 32`)
- [ ] Mover ambos a un secret manager (Doppler/Vault/Fly secrets/AWS SM)
- [ ] DB con TLS (no `?sslmode=disable`)
- [ ] Reverse proxy con TLS (Caddy lo hace solo)
- [ ] Backups DB + MinIO encriptados at-rest, restore probado
- [ ] Multi-node: swap rate-limit a Redis adapter
- [ ] gitleaks pre-commit + CI activos
- [ ] Monitoreo:
  - [ ] alertas si `/api/audit-logs` sin escrituras nuevas en >1h (sospechoso)
  - [ ] alertas en `429` rates altos
  - [ ] alertas en `provider.update` o `member.role_change` (signal de compromise)
- [ ] Rotación de API keys de providers cada 90 días (calendar reminder)
- [ ] Document para el equipo: "qué hacer si sospechás incidente" → seccion abajo.

---

## Respuesta a incidentes

### Si sospechás compromise de credenciales

1. **Cerrar todas las sesiones del user**: `/settings#sessions` → "Cerrar todas
   las otras sesiones".
2. **Cambiar password** del user (better-auth flow estándar).
3. **Revocar API keys de providers** del workspace afectado: `/settings#providers`
   → Quitar.
4. **Auditar `/settings#audit`** filtrando por `userId` del afectado para ver
   acciones recientes (24-72h).
5. **Si encontrás `provider.create` o `provider.update` no esperado:** rotar
   las keys reales en el dashboard del provider (Anthropic/OpenAI/etc.).

### Si sospechás compromise de la DB

1. **Rotar `ENCRYPTION_SECRET`** con `scripts/rotate-encryption-secret.sh`.
2. **Forzar logout global**: `DELETE FROM session;` (todos vuelven a loguear).
3. **Auditá `audit_log` completo** del periodo afectado.
4. **Notificar a usuarios** si sus datos podrían haberse comprometido (legal).

### Si encontrás un secret commiteado

1. **NO lo borres del archivo y commitees** — el secret ya está en el history.
2. **Rotá el secret real inmediatamente** (Anthropic/OpenAI/etc.).
3. Para limpiar el history: `git filter-repo --invert-paths --path <archivo>`,
   force-push, todos los devs deben re-clonar. Hablar con el equipo primero.

---

## Limitaciones conocidas

1. **CSP con `unsafe-inline` en `style-src`** — framer-motion + recharts.
   Endurecible migrando a tailwind puro.
2. **Sin 2FA** — better-auth lo soporta como plugin TOTP, no está habilitado
   todavía. **TODO siguiente sprint.**
3. **Rate-limit Redis no plug-and-play** — el adapter está, falta instalar
   `redis` package y configurar `instrumentation.ts` cuando vayas multi-node.
4. **`Buffer` y `process` en `scripts/rotate-encryption-secret.ts`** — Node
   types no resuelven en el tsconfig de web; el archivo se excluye del
   typecheck pero corre con tsx. No bloquea CI.
5. **No hay programa de bug bounty formal.**

## Reportar vulnerabilidades

Reportá a `security@orchester.io` con detalles + steps to reproduce. Para
high-severity respondemos en 24h.
