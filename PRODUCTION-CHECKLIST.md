# Production Checklist — Orchester

> Antes de poner el sistema customer-facing, recorré esta checklist en orden.
> Cada item es accionable. Lo que no podés tildar te indica un blocker real.

## 0. Pre-deploy

```bash
./scripts/preflight.sh   # falla loud con cada item que falte
```

Si tira ✗ en algo, arreglalo antes de seguir.

## 1. Secrets

- [ ] **`BETTER_AUTH_SECRET`** generado nuevo (no el placeholder dev).
  ```bash
  openssl rand -base64 32
  ```
- [ ] **`ENCRYPTION_SECRET`** generado nuevo (64-char hex).
  ```bash
  openssl rand -hex 32
  ```
- [ ] Ambos secrets viven en un **secret manager** (Doppler, Vault, Fly Secrets,
      AWS Secrets Manager) — NO en `.env` commiteado.
- [ ] **`scripts/generate-secrets.sh`** genera el bloque listo.
- [ ] Plan de rotación documentado: cada 90 días + ante sospecha de compromise
      (`./scripts/rotate-encryption-secret.sh`).

## 2. Database

- [ ] Postgres 16 con `pgvector >=0.8` instalado (`CREATE EXTENSION vector`).
- [ ] Schema aplicado (`pnpm --filter @orchester/db migrate`).
- [ ] **TLS forzado** en la connection string: `?sslmode=require` (NO disable).
- [ ] Connection pool dimensionado: para `web` 10-20 conns, `worker` 5-10.
- [ ] Backups automáticos: `crontab -e`
  ```cron
  0 3 * * * cd /opt/orchester && ./scripts/backup.sh >> /var/log/orchester-backup.log 2>&1
  ```
- [ ] Restore probado **al menos una vez** desde un backup real:
  ```bash
  gunzip -c backups/db-2026-05-07-0300.sql.gz | psql "$STAGING_DATABASE_URL"
  ```
- [ ] PITR (point-in-time recovery) configurado si tu provider lo soporta
      (Crunchy, Neon, AWS RDS).

## 3. Storage (uploads de KB)

- [ ] `STORAGE_DRIVER=s3` en prod (no `local` salvo single-node con backups del fs).
- [ ] MinIO o S3 real con credenciales propias (no las de demo).
- [ ] Bucket con versioning habilitado (recovery de archivos borrados).
- [ ] Backup del bucket via `mc mirror` (incluido en `scripts/backup.sh`).

## 4. Encryption + Auth

- [ ] AES-256-GCM activo (`encrypt()` lanza si `ENCRYPTION_SECRET` mal). Test en `__tests__/encryption.test.ts`.
- [ ] better-auth + sessions DB-backed funcionando.
- [ ] **2FA TOTP** habilitado para owners/admins (no obligatorio, recomendado).
- [ ] Cookie con flags correctos: HttpOnly + SameSite=Lax + Secure (HTTPS).

## 5. Network + headers

- [ ] **HTTPS forzado** (Caddy o equivalente con auto-TLS).
- [ ] Headers de seguridad presentes en producción (`curl -I https://tu-dominio`):
  - `Content-Security-Policy: ...nonce-...`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Frame-Options: SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
- [ ] WAF / DDoS protection (Cloudflare, Fastly, AWS WAF) frente al origin.
- [ ] Firewall sólo permite `:80` y `:443` desde internet; DB y MinIO en VPC privado.

## 6. Rate limiting

- [ ] Si **multi-node** (>1 réplica web): swap rate-limit a Redis adapter.
  ```ts
  // apps/web/instrumentation.ts
  import { setRateLimitAdapter } from "@/lib/rate-limit";
  import { createRedisAdapter } from "@/lib/rate-limit-redis";
  // ...
  ```
- [ ] Si single-node: in-memory está OK.
- [ ] Verificar headers `Retry-After` + `X-RateLimit-Remaining` en 429.

## 7. Monitoring

- [ ] **`SENTRY_DSN`** apuntando a GlitchTip / Sentry. `lib/observability.ts`
      arma envelopes y los manda solo (sin SDK gigante).
- [ ] Uptime monitor (UptimeRobot, Better Stack, Pingdom) golpeando
      `/api/health` cada 60s.
- [ ] Alerta en `/api/health` 5xx por 2 minutos seguidos → page on-call.
- [ ] Dashboard Datadog/Grafana scrapeando `/api/admin/health-detailed` con
      header de auth admin.
- [ ] Alerta `audit_recent_24h.value === 0` por >24h (sospechoso).
- [ ] Log sink (CloudWatch, Datadog Logs, Loki) para `web` + `worker` stdout.

## 8. Email

- [ ] SMTP / Resend configurado (`SMTP_*` o `RESEND_API_KEY`).
- [ ] Probado con `POST /api/admin/test-email` desde `/settings`.
- [ ] DKIM + SPF + DMARC en el dominio del `MAIL_FROM`.
- [ ] Address `MAIL_FROM` no rebotada.

## 9. Channels

- [ ] **Web widget** (`/c/<channelId>`): si lo embebés, configurá CORS allowlist.
- [ ] **Telegram bot**: webhook configurado automáticamente al guardar
      credenciales en `/channels`. Verificar `getMe` OK.
- [ ] **Slack app**: bot token + signing secret pegados; URL de Event
      Subscriptions copiada en `api.slack.com`. Scopes: `chat:write`,
      `app_mentions:read`, `im:history/read/write`, `reactions:write`,
      `assistant:write` (opcional).

## 10. Worker

- [ ] `worker` corriendo (en docker-compose.prod.yml ya está) — atende
      `flow:run`, `webhook:deliver`, `usage:aggregate` (cron diario 03:00 UTC).
- [ ] Healthcheck del worker (proceso vivo) — recomendado sidecar para k8s.
- [ ] Concurrency: `flow:run` teamSize=4 concurrency=2 (ajustable en
      `apps/web/worker/index.ts`).

## 11. Provider keys (LLM)

- [ ] Al menos un provider configurado en `/settings#providers` con key real
      con saldo activo. Probado con `POST /api/agents/[id]/test-chat`.
- [ ] Plan de rotación de keys cada 90 días (calendar reminder).
- [ ] Quota suficiente para el tráfico esperado (Anthropic console: tier).

## 12. Compliance / GDPR

- [ ] **`/api/me/delete`** (Article 17 — right to erasure) probado en staging.
- [ ] Audit log no se borra automáticamente — backups del audit log
      retenidos por el mínimo legal de tu jurisdicción.
- [ ] Política de privacidad publicada en `/{locale}/privacy`.
- [ ] DPA template listo para clientes que pidan.

## 13. Performance

- [ ] Build de prod en lugar de `next dev` (`pnpm --filter web build && pnpm --filter web start`).
- [ ] LCP < 2.5s en dashboard (medido con Lighthouse).
- [ ] TTFB < 600ms en endpoints autenticados warm.
- [ ] Indices DB cargados (`.agents/reference/init-indices.sql` ya aplicado por `db:migrate`).

## 14. Disaster recovery

- [ ] Backup retention ≥30 días.
- [ ] Backups copiados a otra región / proveedor.
- [ ] Runbook de "DB destruida" probado: ver [`RUNBOOK.md`](./RUNBOOK.md).
- [ ] RTO (Recovery Time Objective) y RPO (Recovery Point Objective) documentados.

## 15. Acceso humano al server

- [ ] SSH con key auth (no password).
- [ ] No hay user `root` con shell acceso.
- [ ] Passwordless `sudo` solo para usuarios autorizados.
- [ ] `fail2ban` activo.

## 16. Pre-launch smoke test

```bash
# Reemplazá los <vars> con valores reales
DOMAIN=https://orchester.tu-dominio.com

# 1. Health público
curl -f $DOMAIN/api/health | jq .

# 2. Login flow
# Hacelo manual con un user de prueba y verificá que llega el mail de bienvenida.

# 3. Test chat de un agente
# Logueado, andá a /agents/[id] y mandale un mensaje. Tiene que responder con el LLM real.

# 4. Crear flow + ejecutar
# /flows → "Pipeline de leads" → Ejecutar con input → ver historial → succeeded.

# 5. Webhook entrante de Slack/Telegram
# Mandá un DM al bot y verificá que llega a /conversations.
```

Si los 5 funcionan: **estás listo**.

---

## Si algo de esto no se cumple

Buscá la sección correspondiente en [`RUNBOOK.md`](./RUNBOOK.md) para qué hacer.
