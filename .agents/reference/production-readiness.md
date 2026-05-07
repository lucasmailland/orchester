# Production readiness — checklist real

> Lo que falta para que Orchester corra en producción atendiendo customers
> reales con SLA. Sin marketing.

Última auditoría: 2026-05-07.

---

## Estado por sistema

| Sistema | Estado | Bloqueante para prod | Nota |
| --- | --- | --- | --- |
| Auth + RBAC | 🟢 listo | no | better-auth + 4 roles + helper centralizado |
| Encryption at-rest (provider keys, channel creds) | 🟢 listo | no | AES-256-GCM + script de rotación |
| Audit log | 🟢 listo | no | 14 acciones cubiertas + UI viewer |
| Sessions revocables | 🟢 listo | no | UI en `/settings#sessions` |
| Rate-limit | 🟡 single-node | si vas multi-node | Adapter Redis listo (lib/rate-limit-redis.ts), falta `pnpm add redis` + `instrumentation.ts` |
| Headers seguridad + CSP nonce | 🟢 listo | no | `style-src` con `unsafe-inline` (limitación libs) |
| Sanitización de logs | 🟢 listo | no | `safeLogError()` aplicado en lib/queue/audit/webhooks/conversations |
| Secret scanning | 🟢 listo | no | gitleaks pre-commit + CI job |
| Multi-agent (flows, handoff, subflows, flow_call) | 🟢 listo | no | Documentado en multi-agent.md |
| Worker (pg-boss queue) | 🟡 código listo | sí, si usás flows async | Falta correrlo en prod (`pnpm worker:prod`) |
| KB ingest (PDF/DOCX) | 🟢 código listo | no | Necesita key de embeddings (OpenAI o Google) |
| Channels: web widget, Telegram, Slack | 🟢 listos | no | Cada uno con setup documentado |
| 2FA | 🔴 no implementado | depende de tu compliance | better-auth tiene plugin TOTP, no wireado |
| Backups DB + restore | 🔴 no automatizado | sí | Hay snippet en `deploy.md`, falta cron |
| Monitoring/alerting | 🔴 no automatizado | sí | GlitchTip incluido en docker-compose, falta wirearlo |
| Tests (unit + integration) | 🟡 cobertura baja | depende | ~10 unit tests, sin integration |
| Load testing | 🔴 nunca corrido | sí, si esperás >100 RPS | k6 / vegeta scripts: TBD |
| Email outbound real | 🟡 SMTP listo, no testeado | sí | `lib/email.ts` usa fetch a Resend o SMTP |
| 12-factor compliance | 🟢 listo | no | `output: standalone`, env-driven |

---

## Bloqueantes duros para go-live

Estas cosas **rompen experiencia o seguridad** si las salteás:

### 1. Provider de IA real con saldo
Anthropic o OpenAI con credit balance > $5. Probado: la integración funciona,
el error de Anthropic ("Your credit balance is too low") se propaga al UI.

### 2. `BETTER_AUTH_SECRET` y `ENCRYPTION_SECRET` rotados
Hoy `.env.local` tiene placeholders dev. Para prod:
```bash
openssl rand -base64 32   # → BETTER_AUTH_SECRET
openssl rand -hex 32      # → ENCRYPTION_SECRET
```
Y movélos a un **secret manager** (Doppler / Vault / Fly secrets / AWS SM).
NUNCA los pongas en `.env` de un servidor productivo.

### 3. DB con TLS + backups
`DATABASE_URL` debe usar `?sslmode=require`. Backup:
```bash
# cron diario en el host de DB (o en otro)
docker compose exec -T postgres pg_dump -U orchester orchester | gzip > /backups/orchester-$(date +%F).sql.gz
```
**Probá un restore antes de poner customers reales.** Backup que no se
restaura no es backup.

### 4. Worker corriendo
Sin worker, los flows con `trigger: schedule` no disparan, los webhooks
salientes con retry quedan stuck, y el ingest async de KB nunca completa.
Asegurate de que `apps/web/worker/index.ts` esté arriba.

```bash
pnpm --filter web worker:prod
# o en docker-compose.prod.yml ya está como servicio "worker"
```

### 5. Reverse proxy con TLS
Caddy lo hace solo con `domain.com { reverse_proxy web:3000 }`. Verificá
que tu DNS apunte y que el cert se renueve.

### 6. Mailer real
Si los emails no salen, los flows de invite + reset password rompen.
Configurá:
```
SMTP_HOST=smtp.tuserver.com
SMTP_PORT=587
SMTP_USER=…
SMTP_PASS=…
MAIL_FROM=noreply@tu-dominio.com
```
**Probá un invite end-to-end** antes del go-live.

---

## Hardening operacional (no bloqueante pero altamente recomendado)

### Monitoring
1. Habilitá GlitchTip (ya en `docker-compose.prod.yml --profile observability`).
2. `SENTRY_DSN=https://errors.tu-dominio.com/...` en env.
3. Alertas:
   - 5xx rate > 1%/5min → notificación.
   - Audit log sin entries en >2h en horario laboral → puede haber inactividad real o un bug que no loguea.
   - 429 rate alto → un cliente está hammerando.

### Load testing
Probá con k6 antes de aceptar SLA:
```bash
k6 run --vus 100 --duration 5m scripts/loadtest-test-chat.js
```
Si falla a 100 VUs, identificá: DB pool, rate-limit en web, latencia provider.

### Rotación periódica
Calendario:
- API keys de providers (Anthropic/OpenAI) → cada 90 días
- `ENCRYPTION_SECRET` → cada 180 días con `scripts/rotate-encryption-secret.sh`
- `BETTER_AUTH_SECRET` → cada 365 días (rotation invalida sessions activas — programalo en off-hours)

### 2FA
better-auth plugin TOTP. Si tus usuarios manejan datos sensibles
(salud, fintech, legal), prendelo. Es ~1 día de trabajo:
- backend: agregar plugin a `auth.ts`
- UI: `/settings#account` → "Activar 2FA" → QR + recovery codes
- Login flow: si user tiene TOTP, pedir el código tras password

---

## Lo que NO probé end-to-end (pero el código está)

Estas cosas **el código existe y compila** pero no se corrieron en el
ambiente final con data real:

1. **Slack inbound real** — código + webhook + Block Kit + reactions están.
   Necesitás crear una Slack App y conectar el bot token.
2. **Telegram inbound** — código + webhook auto-config están. Bot token
   es lo único que falta.
3. **KB con embeddings reales** — pipeline corre hasta el llamado al
   provider; sin OpenAI key, falla con error claro y deja `status=failed`.
4. **Flow scheduled (cron)** — pg-boss debe estar arriba. El flow
   "Daily summary mail" tiene `trigger=schedule` con `cron=0 9 * * *`.
5. **Outbound webhooks** — código + retry con jitter. Si configurás un
   webhook saliente apuntando a tu endpoint, deberías recibir eventos.
6. **`agent_handoff`** — implementado en este sprint; testeado con type-check
   pero falta E2E con mensaje real.

---

## Capacidades que SÍ están testeadas

✅ Login + signup + invite flow (better-auth verificado en sesiones anteriores)
✅ Dashboard con KPIs reales (queries SQL sobre data viva, sin mocks)
✅ Conversations list con filtros + paginación + drawer
✅ Agent Studio: editar, save, test chat (con provider real)
✅ Flow builder: crear, drag, save, run manual con input modal, ver historial
✅ Provider key encriptada: pegar en /settings → guardada AES-256-GCM en DB
   → request real a Anthropic (recibimos `400: credit_balance_too_low`,
   error correcto)
✅ /api/v1 público con API key + rate-limit
✅ Audit log entries persistidas correctamente con before/after

---

## Roadmap recomendado (4 semanas para go-live serio)

**Semana 1 — ops básicos**
- [ ] Provisionar VPS (4 vCPU / 8GB RAM mínimo)
- [ ] Levantar `docker-compose.prod.yml` con stack completo
- [ ] DNS + Caddy TLS
- [ ] Verificar health endpoints
- [ ] Configurar SMTP real
- [ ] Probar registro + invite + login

**Semana 2 — providers + flows**
- [ ] Pegar API key real de Anthropic con saldo
- [ ] Cargar KB inicial (5-10 docs) y verificar que `knowledge_search` retorne resultados
- [ ] Crear/conectar canal real (Web widget en tu landing, Slack en tu workspace)
- [ ] Activar el flow "Daily summary mail" (necesita worker arriba)
- [ ] Probar `agent_handoff` con un caso real (Sofia → Elena)

**Semana 3 — hardening**
- [ ] Backups automatizados a S3/MinIO con lifecycle policy
- [ ] GlitchTip + alertas básicas (5xx rate, audit log silence, 429 spike)
- [ ] 2FA en cuentas owner/admin
- [ ] Pre-commit hook gitleaks instalado en todos los devs
- [ ] Load test con k6 (objetivo: 100 RPS sostenido en endpoints críticos)
- [ ] Rotar `ENCRYPTION_SECRET` y `BETTER_AUTH_SECRET` a valores reales en secret manager

**Semana 4 — beta cerrada**
- [ ] 5-10 usuarios reales usando el producto
- [ ] Métricas: tasa de errores, latencia P95, costo provider, customer feedback
- [ ] Iterar sobre los rough edges que detecten
- [ ] Documentar runbooks operativos para tu equipo
- [ ] Incident drill: simular "se cayó el provider" y "se filtró un secret"

---

## Costos estimados (orden de magnitud)

Para **100 conversaciones/día con un agente promedio**:

- **Provider de IA**: Anthropic Sonnet ~$0.003/conv (con histórico compactado a 2k tokens) → ~$10/mes
- **VPS**: $20–40/mes (Hetzner CCX23, Fly Machines, Railway)
- **DB**: incluida en el VPS si self-hosted
- **MinIO**: incluido
- **Mailer**: $0–10/mes (Resend free tier o Postmark)
- **Total**: ~$30–60/mes operativo

Para **10K conversaciones/día**:
- Provider: ~$1000/mes (depende del modelo)
- Infra: ~$200–500/mes (VPS más grande + réplicas)
- Total: ~$1.5K/mes

---

## Cuándo decir "estamos listos"

No se mide en checklist completas, se mide en respuesta a estas preguntas:

1. **¿Si se cae el provider de IA, qué pasa?** Respuesta esperada: el agent
   responde con `agent.fallback`, el operator ve el error en logs y un mail
   con `agent_down` se manda al admin (vía notification_pref).
2. **¿Si una API key se filtra, en cuánto tiempo está rotada?** < 1h con el
   script de rotación + revocación en el dashboard del provider.
3. **¿Si un user me pide "borrá toda mi data", cuánto tarda?** Hoy: imposible.
   GAP: no hay tool de "delete user account + cascade clean" formalizado.
4. **¿Si se cae el container web, levantamos en cuántos minutos?** < 5min
   con docker-compose restart si la imagen está cacheada.
5. **¿Tenés runbook escrito para incidentes top-3?** Sí — está en
   `.agents/reference/security.md` sección "Respuesta a incidentes".

Cuando todas las respuestas sean afirmativas y testeadas, estás listo.
