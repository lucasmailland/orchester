# OSS Self-Hosted Stack

> Estado: implementado · Owner: platform · Última edición: 2026-05-05

## Planning

**Objetivo:** Orchester debe correr 100% en open-source sin obligar a contratar SaaS pago. La opción default es self-hosted con Docker Compose; cualquier dependencia comercial (Stripe, Vercel, Neon, Resend) es opcional y degrada graceful cuando no está configurada.

**Por qué:** El usuario explicitó *"no quiero servicios pagos! quiero todo open source"*. Una plataforma para multi-tenant AI que dependa de SaaS pago para funcionar mínimamente bloquea a equipos que necesitan on-prem (compliance, data residency, costo).

**Restricciones:**
- Cero Redis, RabbitMQ, ni broker externo. Cola va dentro de Postgres.
- Cero AWS SDK gigante para S3 — usar SigV4 firmado a mano + fetch.
- Stripe debe poder estar ausente sin romper el árbol de quotas.
- Email cae a SMTP estándar (cualquier server).
- TLS automático sin tocar nada (Caddy resuelve cert solo).

## Componentes

| Componente | Implementación | Archivo principal |
| --- | --- | --- |
| Reverse proxy + TLS | Caddy 2 con auto Let's Encrypt | `Caddyfile` |
| Web | Next.js 15 standalone, Node 22 | `Dockerfile` (stage `runner`) |
| Worker | Mismo image, comando distinto | `apps/web/worker/index.ts` |
| DB | Postgres 16 + pgvector 0.8 | `pgvector/pgvector:pg16` |
| Cola | pg-boss (Postgres-native) | `apps/web/lib/queue.ts` |
| Blob storage | MinIO + driver S3 / fallback local FS | `apps/web/lib/storage.ts` |
| Mail | SMTP (vía `lib/email.ts`, ya existía) | `apps/web/lib/email.ts` |
| Errores (opc.) | GlitchTip (Sentry-compatible) | profile `observability` |
| Analytics (opc.) | PostHog self-hosted | env-only |
| Billing (opc.) | Stripe degrada a "enterprise" sin key | `apps/web/lib/billing/{stripe,quotas}.ts` |

## Flow de boot

```
docker compose -f docker-compose.prod.yml up -d
  ├── postgres (healthcheck OK)
  ├── minio    (healthcheck OK)
  ├── minio-init (one-shot: crea bucket "orchester")
  ├── web      (depends_on: postgres healthy + minio healthy)
  ├── worker   (registra handlers en pg-boss; cron daily a las 03:00 UTC)
  └── caddy    (resuelve cert a Let's Encrypt; expose 80/443)
```

## Decisiones clave

- **pg-boss > BullMQ:** evita Redis. La cola comparte la DB principal y se beneficia del mismo backup/restore. Performance es suficiente hasta ~1000 jobs/sec, mucho más allá del target.
- **MinIO con SigV4 manual:** integrar `@aws-sdk/client-s3` agrega ~3 MB al worker. Para uploads de KB (un endpoint), firmar a mano con `node:crypto` cuesta 200 LoC y ahorra el peso.
- **Caddy > nginx:** TLS automático sin Let's Encrypt manual. Setup zero-config.
- **Stripe opcional, no removido:** la lógica queda; un operador puede activarla en cualquier momento. Sin key, todo es plan "enterprise" (ilimitado) y la UI esconde upgrade flows.
- **Worker comparte image con web:** un solo build, un solo set de deps, un solo upgrade cycle.

## Variables de entorno nuevas

Ver `.env.example` y `.agents/reference/deploy.md` (sección 2). Resumen:

- `DOMAIN` — usado por Caddy + AUTH_URL
- `SELF_HOSTED=true` — bypass Stripe; plan enterprise
- `STORAGE_DRIVER=local|s3` + `S3_*` cuando aplica
- `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`

## Execution log

### 2026-05-05 — Pivot OSS inicial

- ✅ `docker-compose.prod.yml`: web + worker + postgres + minio + caddy + (profile) glitchtip
- ✅ `Caddyfile`: reverse proxy con auto-TLS, cache de assets, headers de seguridad
- ✅ `apps/web/lib/storage.ts`: driver `local` (default dev) + `s3` (SigV4 firmado a mano)
- ✅ `apps/web/lib/queue.ts`: wrapper sobre pg-boss con job names registrados
- ✅ `apps/web/worker/index.ts`: handlers `flow:run`, `webhook:deliver`, cron `usage:aggregate`
- ✅ `apps/web/lib/billing/quotas.ts`: `isSelfHosted()` retorna plan enterprise sin Stripe
- ✅ `apps/web/lib/billing/stripe.ts`: `isStripeEnabled()` para que la UI gate features
- ✅ `Dockerfile`: copia `apps/web/worker` + `apps/web/lib` + `tsx` al runtime stage
- ✅ `package.json` (web): scripts `worker` / `worker:prod`, deps `pg-boss`, `tsx`
- ✅ `.env.example`: rewrite con sección storage S3/local + SELF_HOSTED + Stripe opcional
- ✅ `.agents/reference/deploy.md`: stack OSS como path principal, Vercel relegado a apéndice

### Pendientes / next steps

- [ ] Encolar `flow:run` desde el endpoint HTTP en lugar de `executeFlow` síncrono (requiere refactor del trigger handler)
- [ ] KB ingest async vía pg-boss (hoy es síncrono en el route handler; bloquea hasta 60s)
- [ ] Probar el image en un VPS real con dominio
- [ ] Healthcheck del worker (HTTP endpoint o liveness file en disco)
- [ ] Esconder upgrade-billing UI cuando `isStripeEnabled()===false`
