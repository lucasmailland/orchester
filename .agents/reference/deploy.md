# Deploy — Orchester

Orchester se diseñó para correr **100% en infraestructura propia, con software open-source**.
Cero SaaS pago obligatorio. Cero lock-in con Vercel/Neon/Inngest/Sentry-cloud/Stripe.

## Tabla de contenidos

1. [Stack OSS de producción (recomendado)](#1-stack-oss-de-producción-recomendado)
2. [Variables de entorno](#2-variables-de-entorno)
3. [Bootstrap del dominio + TLS](#3-bootstrap-del-dominio--tls)
4. [Levantar el stack](#4-levantar-el-stack)
5. [Day-2: backups, upgrades, escalado](#5-day-2-backups-upgrades-escalado)
6. [Apéndice A: sólo Postgres + Node (sin Docker)](#6-apéndice-a-sólo-postgres--node-sin-docker)
7. [Apéndice B: Vercel + Neon (PaaS, opcional)](#7-apéndice-b-vercel--neon-paas-opcional)

---

## 1. Stack OSS de producción (recomendado)

| Componente       | Software                              | Rol                                              |
| ---------------- | ------------------------------------- | ------------------------------------------------ |
| Reverse proxy    | **Caddy 2**                           | TLS automático Let's Encrypt, HTTP/3, headers    |
| App              | **Next.js standalone** (Node 22)      | UI + API + auth + RAG                            |
| Worker           | mismo image, comando distinto         | flows async, webhooks, cron                      |
| DB               | **Postgres 16 + pgvector 0.8**        | tabular + embeddings + cola pg-boss              |
| Cola             | **pg-boss** (dentro de Postgres)      | sin Redis, sin RabbitMQ                          |
| Blob storage     | **MinIO** (S3-compatible)             | uploads de KB                                    |
| SMTP             | tu server (Plunk/Postal/Mailcow/SES)  | invites, reset password                          |
| Errores (opt.)   | **GlitchTip** (Sentry-compatible)     | error tracking                                   |
| Analytics (opt.) | **PostHog** self-hosted               | producto + funnels                               |

Toda la stack arriba está en `docker-compose.prod.yml`. Un VPS de 4 vCPU / 8 GB RAM
soporta cientos de workspaces activos.

### Diagrama lógico

```
Internet ─┬─→ :443 ─→ Caddy ──→ web (Next.js, escalá horizontal si querés HA)
          │                  ↘
          │                   worker (pg-boss consumer)
          └─→ :443 ─→ Caddy ──→ glitchtip (errors.tu-dominio)

web + worker  ─→ postgres (datos + vectores + cola pg-boss)
              ─→ minio    (archivos)
```

---

## 2. Variables de entorno

Copiar `.env.example` a `.env` (al lado del `docker-compose.prod.yml`) y llenar:

**Obligatorias:**

```bash
DOMAIN=orchester.tu-dominio.com
AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24)
MINIO_ROOT_USER=orchester
MINIO_ROOT_PASSWORD=$(openssl rand -base64 24)

# Al menos un provider de LLM
ANTHROPIC_API_KEY=sk-ant-…
# OPENAI_API_KEY=…
# GOOGLE_AI_API_KEY=…

SMTP_HOST=smtp.tu-server.com
SMTP_PORT=587
SMTP_USER=…
SMTP_PASS=…
MAIL_FROM=noreply@tu-dominio.com
```

**Opcionales:**

- `SENTRY_DSN` — apuntar a tu GlitchTip si usás `--profile observability`
- `POSTHOG_KEY` + `POSTHOG_HOST` — analytics
- `STRIPE_SECRET_KEY` — sólo si querés cobrar a tus clientes; sin esto, plan enterprise por default

> **Sin Stripe = sin quotas.** El código detecta `STRIPE_SECRET_KEY` ausente o `SELF_HOSTED=true` y devuelve plan "enterprise" (ilimitado) a todos los workspaces. La UI esconde upgrade flows.

---

## 3. Bootstrap del dominio + TLS

1. Apuntá un A record (o AAAA) de `tu-dominio.com` al IP del VPS.
2. Abrí puertos `80` y `443` en el firewall.
3. Caddy resuelve el certificado solo en el primer arranque (~30 s).

Si querés error-tracking accesible públicamente, agregá un A record de `errors.tu-dominio.com`.

---

## 4. Levantar el stack

```bash
# Primer arranque: build + migraciones + indices + start
docker compose -f docker-compose.prod.yml up -d

# Aplicar schema (la primera vez, dentro del container web):
docker compose -f docker-compose.prod.yml exec web \
  pnpm --filter @orchester/db push

# Logs
docker compose -f docker-compose.prod.yml logs -f web worker

# Levantar también error-tracking
docker compose -f docker-compose.prod.yml --profile observability up -d
```

Verificación:

- `https://tu-dominio.com/api/health` → `200 OK`
- `https://tu-dominio.com/auth/login` → UI carga
- Dentro del container: `docker compose exec postgres pg_isready` → ok

---

## 5. Day-2: backups, upgrades, escalado

### Backups

```bash
# Postgres → archivo .sql.gz (cron diario)
docker compose exec -T postgres pg_dump -U orchester orchester | gzip > backup-$(date +%F).sql.gz

# MinIO → otro bucket (cron horario)
docker compose exec minio mc mirror local/orchester remote/orchester-backup
```

Restore:

```bash
gunzip -c backup-2026-04-15.sql.gz | docker compose exec -T postgres psql -U orchester -d orchester
```

### Upgrades

```bash
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d --no-deps web worker
```

El standalone bundle de Next.js se rebuilea; las migraciones de schema corren con `pnpm --filter @orchester/db push` dentro del container web (idempotente).

### Escalar

- **Vertical:** crecé el VPS. Hasta 16 vCPU una sola VM aguanta tranquilo.
- **Horizontal web:** corré `web` con `deploy: replicas: N` y poné Caddy en LB mode (round-robin).
- **Horizontal worker:** mismo patrón, `worker` aguanta concurrencia interna (`teamSize`/`teamConcurrency` en `apps/web/worker/index.ts`).
- **DB:** cuando supere 1 nodo, mové a Postgres con réplica + PITR (Crunchy/Patroni). pgvector es estándar; cualquier Postgres 16 sirve.

---

## 6. Apéndice A: sólo Postgres + Node (sin Docker)

Para dev local o single-host minimalista:

```bash
# 1. Postgres + pgvector ya andando
psql -d orchester -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 2. Schema + indices
pnpm --filter @orchester/db push
psql -d orchester -f .agents/reference/init-indices.sql

# 3. Build + start
pnpm --filter web build
node apps/web/.next/standalone/apps/web/server.js &

# 4. Worker
pnpm --filter web worker:prod &
```

---

## 7. Apéndice B: Vercel + Neon (PaaS, opcional)

**No recomendado** si querés evitar SaaS pago, pero sigue funcionando:

- Vercel hostea `web` (Next.js standalone se desactiva, runtime Vercel)
- Neon hostea Postgres (con pgvector enabled)
- Resend para mail, Cloudflare R2 para blobs

Limitaciones:

- Free tier de Vercel timeoutea a 10 s — flow:run debe ir a worker self-hosted (rompe el "todo en Vercel")
- Neon free tier suspende el cluster con baja actividad (cold start ~2 s)

Por eso la **recomendación oficial es el path 1 (stack OSS).**
