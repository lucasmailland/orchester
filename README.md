# Orchester

> Multi-tenant AI agent platform — agentes conversacionales y flujos
> orquestados, conectados a tus canales (web widget, Slack, Telegram,
> WhatsApp, Email, API), con knowledge bases vectorizadas y memoria
> persistente compartida entre agentes del mismo equipo.

[![CI](https://github.com/lucasmailland/orchester/actions/workflows/ci.yml/badge.svg)](https://github.com/lucasmailland/orchester/actions)

```
┌──────────────────────────────────────────────────────────┐
│  Inbox + Web widget + Slack + Telegram + WhatsApp + API  │
└────────────────────────┬─────────────────────────────────┘
                         ▼
              ┌────────────────────┐
              │  Channel Router    │  ← anti-loop, signature verify
              └────────┬───────────┘
                       ▼
            ┌──────────────────────────┐
            │  Agent runtime (LLM call │
            │  + tools + memory + RAG) │
            └────────┬─────────────────┘
                     ▼ (handoff / cascade)
        ┌─────────────────────────────────────┐
        │ Team of agents (same team_id)       │
        │  - shared team-memory                │
        │  - agent_handoff between members     │
        │  - flow-driven (BANT / triage / …)   │
        └─────────────────────────────────────┘
                     ▼
              Postgres + pgvector
              MinIO (S3-compatible)
              pg-boss queue
```

## Quickstart (dev)

```bash
git clone https://github.com/lucasmailland/orchester
cd orchester
docker compose up -d postgres minio    # DB + blob storage
cp .env.example apps/web/.env.local
pnpm install
pnpm --filter @orchester/db push       # apply schema
pnpm --filter @orchester/db seed       # demo data (workspace + agents + flows)
pnpm --filter web dev                  # starts on :3000
```

Login con `demo@fichap.com` / contraseña que setea el seed (mirá la consola).

## Stack

- **Runtime:** Next.js 15 (App Router, RSC), Node 22
- **DB:** Postgres 16 + pgvector + Drizzle ORM
- **Auth:** better-auth con sessions DB-backed + 2FA TOTP opcional
- **Queue:** pg-boss (Postgres-native, sin Redis)
- **Storage:** MinIO (S3 API) — drivers `local` y `s3` en `lib/storage.ts`
- **Email:** SMTP (cualquier server) o Resend
- **Encryption:** AES-256-GCM at-rest para API keys de providers
- **Frontend:** React 19, framer-motion, recharts, @xyflow/react

## Características

- **8 tipos de canales** (widget web, Telegram, Slack, WhatsApp, Email, API, etc.)
- **Flow builder visual** con 14 tipos de nodos (agente, condition, switch, HTTP, transform, code, loop, parallel, try/catch, subflow, wait_human, notify, delay, end)
- **Agent handoff** — un agente cede la conversación a otro por especialidad
- **4 scopes de memoria:** global, employee, conversation, **team** (compartida entre agentes del mismo team)
- **Knowledge bases** con ingest de PDF/DOCX/URL/texto + embeddings + búsqueda semántica
- **Audit log** de 14 acciones críticas
- **Multi-locale** (en, es, pt-BR)
- **Dashboard** con 11 widgets (KPIs, costos, top agents, equipos, etc.)

## Documentación

- [`PRODUCTION-CHECKLIST.md`](./PRODUCTION-CHECKLIST.md) — antes del go-live
- [`RUNBOOK.md`](./RUNBOOK.md) — qué hacer cuando algo se rompe
- [`.agents/reference/security.md`](./.agents/reference/security.md) — postura de seguridad completa
- [`.agents/reference/deploy.md`](./.agents/reference/deploy.md) — paths de deploy (OSS docker-compose / Vercel / Railway)
- [`.agents/screens/`](./.agents/screens/) — spec por pantalla
- [`.agents/features/`](./.agents/features/) — spec por feature

## Comandos útiles

```bash
# Desarrollo
pnpm --filter web dev                       # Next.js dev server :3000
pnpm --filter web worker                    # worker (pg-boss consumer)
pnpm --filter web test                      # vitest
pnpm --filter web tsc --noEmit              # type-check

# Producción
./scripts/preflight.sh                      # valida env antes del deploy
./scripts/generate-secrets.sh > .env.prod   # genera secrets criptográficos
./scripts/install-git-hooks.sh              # instala pre-commit gitleaks
./scripts/backup.sh                         # backup completo (pg + minio)
./scripts/rotate-encryption-secret.sh       # rota ENCRYPTION_SECRET re-cifrando todo

# Docker prod
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml --profile observability up -d  # +GlitchTip+PostHog
```

## Licencia

Propietaria. Ver [LICENSE](./LICENSE) (TBD).
