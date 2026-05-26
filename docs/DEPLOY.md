# Self-host with Docker Compose

> End-to-end runbook for standing up Orchester on a single host with the
> production compose stack (`deploy/docker-compose.prod.yml`).
> For a higher-level checklist of "what should be true before going live"
> see [`PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md). For incident
> response see [`RUNBOOK.md`](./RUNBOOK.md).

## Prerequisites

- Docker Engine 24+ and Docker Compose v2 (`docker compose`, not the
  legacy `docker-compose`).
- 4 GB RAM / 2 CPU minimum. 8 GB / 4 CPU recommended once a worker pool
  is doing real embedding work.
- A domain you control. Caddy obtains a Let's Encrypt cert automatically
  on first boot — point both `A` and `AAAA` (if you have IPv6) records
  at the host before bringing the stack up.
- `openssl` on the host (for secret generation).

## Quick start

```bash
# 1. Clone
git clone https://github.com/lucasmailland/orchester.git
cd orchester

# 2. Generate secrets into the file the compose stack reads from.
#    deploy/docker-compose.prod.yml resolves ${VAR} from a `.env` next to it.
./scripts/generate-secrets.sh > deploy/.env

# 3. Fill in the non-secret blanks. At minimum:
#      DOMAIN=orchester.example.com
#      ANTHROPIC_API_KEY=sk-ant-...     (or OPENAI_API_KEY / GOOGLE_AI_API_KEY)
#      SMTP_HOST=…  SMTP_PORT=…  SMTP_USER=…  SMTP_PASS=…  MAIL_FROM=…
#      MINIO_ROOT_USER=orchester        (any string, must match across web+worker)
$EDITOR deploy/.env

# 4. Bring up Postgres + MinIO first so we can run migrations against them.
docker compose -f deploy/docker-compose.prod.yml up -d postgres minio minio-init

# 5. Run migrations as the SUPERUSER role (`orchester`) — this is the only
#    place superuser creds are used. Migrations create `app_user`, the
#    NOINHERIT non-BYPASSRLS role the app connects as at runtime
#    (defense-in-depth Layer 3 — see ADR-0010).
docker compose -f deploy/docker-compose.prod.yml run --rm \
  -e DATABASE_URL="postgresql://orchester:${POSTGRES_PASSWORD}@postgres:5432/orchester" \
  web pnpm --filter @orchester/db migrate

# 6. Bring up the rest. Caddy will request a TLS cert on first boot —
#    make sure :80 and :443 reach the host from the public internet.
docker compose -f deploy/docker-compose.prod.yml up -d

# 7. Sanity check
curl -fsS https://${DOMAIN}/api/health | jq .
```

If `/api/health` returns `200 { status: "ok", checks: { db_ping: "ok", db_schema: "ok" } }`
you're live. Create your first owner account at `https://${DOMAIN}/signup`.

## Required environment variables

Compose enforces these via `${VAR:?error}` — `docker compose up` fails
loud if any are missing.

| Var                     | Purpose                                                                 | How to generate                       |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `DOMAIN`                | Public hostname Caddy serves + better-auth base URL                     | DNS — point at the host.              |
| `BETTER_AUTH_SECRET`    | better-auth session-cookie signing key (also encrypts TOTP secrets)     | `openssl rand -base64 32`             |
| `ENCRYPTION_SECRET`     | AES-256-GCM primary key (v1) for at-rest provider credentials           | `openssl rand -hex 32` (64 hex chars) |
| `COOKIE_SIGNING_SECRET` | HMAC secret for signed cookies + signed GDPR-export download URLs       | `openssl rand -base64 32`             |
| `POSTGRES_PASSWORD`     | Superuser password (used for migrations and the postgres container)     | `openssl rand -base64 24`             |
| `MINIO_ROOT_USER`       | MinIO admin user (any string, becomes the S3 access key)                | A short identifier, e.g. `orchester`  |
| `MINIO_ROOT_PASSWORD`   | MinIO admin password (becomes the S3 secret key)                        | `openssl rand -base64 24`             |
| `ANTHROPIC_API_KEY`     | LLM provider key — at least one of Anthropic / OpenAI / Google required | https://console.anthropic.com         |
| `SMTP_HOST` etc.        | Outbound mail server for invites + GDPR export notifications            | Plunk, Postal, AWS SES, Mailcow, …    |
| `MAIL_FROM`             | Envelope sender — must pass DKIM/SPF/DMARC on `DOMAIN`                  | `noreply@your-domain.com`             |

`scripts/generate-secrets.sh` produces a ready-to-paste block with all
four random secrets (BETTER_AUTH, COOKIE_SIGNING, ENCRYPTION,
POSTGRES, MINIO) in one go.

### Optional environment variables

| Var                                     | Default                                         | Notes                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_BACKEND`                       | `filesystem`                                    | GDPR export adapter. `filesystem` writes zips to `GDPR_EXPORT_DIR` (the `gdpr-exports` named volume); `s3` switches to presigned URLs against `GDPR_EXPORT_BUCKET`.       |
| `GDPR_EXPORT_DIR`                       | `/var/lib/orchester/exports` (in the container) | Volume-backed in compose. Survives restarts so signed download URLs stay valid for the 7-day TTL.                                                                         |
| `SENTRY_DSN`                            | unset                                           | Point at GlitchTip or Sentry. Without it, errors only land in container stdout. See § Sentry observability below.                                                         |
| `SENTRY_TRACES_SAMPLE_RATE`             | `0.1`                                           | 0..1 — fraction of transactions traced when Sentry is enabled.                                                                                                            |
| `SENTRY_RELEASE`                        | unset                                           | Release tag (git SHA / version) attached to Sentry events. Required if you later wire source-maps upload.                                                                 |
| `NEXT_PUBLIC_SENTRY_DSN`                | unset                                           | Browser-side DSN. Inlined at build time — leave unset and `@sentry/nextjs` is tree-shaken from the client bundle.                                                         |
| `POSTHOG_KEY` / `POSTHOG_HOST`          | unset                                           | Self-hosted PostHog. Without it, no product analytics.                                                                                                                    |
| `GOOGLE_CLIENT_ID` / `_SECRET`          | unset                                           | Enables Google OAuth signup. Without it, only email/password auth.                                                                                                        |
| `STRIPE_SECRET_KEY` / `_WEBHOOK_SECRET` | unset                                           | Self-host defaults to `SELF_HOSTED=true` → all workspaces on the "enterprise" plan with unlimited quotas. Only set Stripe vars if you run a hosted commercial deployment. |
| `ALLOW_PRIVATE_HTTP`                    | `0`                                             | Lets the HTTP flow node hit RFC1918 / loopback IPs. Self-host only — leaks metadata in cloud.                                                                             |

The full schema lives in `apps/web/lib/env.ts`. Boot fails fast with a
single aggregated error listing every missing/invalid var.

### Sentry observability

The integration is fully **opt-in**. When `SENTRY_DSN` is unset:

- `@sentry/nextjs` is never imported at runtime (the import lives behind
  an `if (process.env.SENTRY_DSN)` guard in `apps/web/instrumentation.ts`
  and `apps/web/lib/observability.ts`).
- `NEXT_PUBLIC_SENTRY_DSN` left unset at build time tree-shakes the
  client-side Sentry init out of the browser bundle entirely (verified
  by inspecting `.next/static/chunks` post-build).
- The dev server boots silently — no `[sentry]` warnings, no extra
  modules in the graph.

To enable Sentry (or a Sentry-compatible target like GlitchTip):

| Variable                    | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `SENTRY_DSN`                | Server + edge DSN.                                       |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional. Default `0.1`.                                 |
| `SENTRY_RELEASE`            | Optional. Release tag (e.g. git SHA) attached to events. |
| `NEXT_PUBLIC_SENTRY_DSN`    | Optional. Browser-side DSN — inlined at build time.      |

Once these are set, errors thrown in route handlers, server actions,
React Server Components, the worker, and the browser are forwarded to
Sentry via the standard `instrumentation.ts` + `onRequestError` hooks,
and `recordMetric` / `logWithContext` from `lib/observability.ts`
double-dispatch to the SDK.

**Source-maps upload is intentionally NOT wired in this commit.** It
requires a Sentry org account and the `SENTRY_AUTH_TOKEN` / `SENTRY_ORG`
/ `SENTRY_PROJECT` env vars, plus a `withSentryConfig()` wrap in
`next.config.ts`. Add them later when you have a Sentry org provisioned;
the existing `register()` and `onRequestError()` hooks will keep
working unchanged.

## First-run setup

After `docker compose up -d` reports all services `healthy`:

1. **Create the first owner.** Visit `https://${DOMAIN}/signup`. The
   first user to register becomes the workspace owner — there is no
   bootstrap CLI on purpose, since exposing one would be a permanent
   privilege-escalation surface.
2. **Configure an AI provider.** Settings → Providers → paste your
   Anthropic / OpenAI / Google key. The key is encrypted at rest with
   `ENCRYPTION_SECRET`.
3. **Smoke-test a chat.** Agents → Quick Start → message it. A
   successful round-trip confirms the provider key + the worker queue
   (`pg-boss`) are wired correctly.
4. **(Optional)** seed a turnkey demo workspace so you can explore a
   working product instead of empty states:

   ```bash
   # Lightweight: NEW "Acme Inc." workspace (slug=demo) with 3 agents,
   # 2 channels, 1 KB (3 docs / hand-written chunks, embeddings deferred),
   # 3 closed sample conversations, 1 draft flow, 2 employees, 1 owner
   # (demo@orchester.local). Idempotent — aborts if a workspace with
   # slug="demo" already exists.
   docker compose -f deploy/docker-compose.prod.yml exec web \
     pnpm --filter @orchester/web seed:demo

   # Heavier (optional): adds extra volume (16 employees, 14 agents,
   # 22 conversations, multi-node flows, 4 KBs) INTO an existing
   # workspace. Run after the owner signs in once.
   docker compose -f deploy/docker-compose.prod.yml exec web \
     pnpm --filter @orchester/db seed:demo
   ```

## Common operational tasks

### Backups

`scripts/backup.sh` runs `pg_dump → gzip` + `mc mirror` of the MinIO
bucket. Schedule it in host crontab — the container doesn't run cron.

```cron
0 3 * * *  cd /opt/orchester && ./scripts/backup.sh >> /var/log/orchester-backup.log 2>&1
```

Retention is `RETAIN_DAYS=14` by default. Bump it in the script env if
your regulator wants more.

**Restore** is documented in [`RUNBOOK.md` → "Restore de backup tras DB
destruida"](./RUNBOOK.md#restore-de-backup-tras-db-destruida). Rehearse
quarterly — a backup you never restored is not a backup.

### Upgrading

```bash
# 1. Pull the new image (or rebuild if you self-build)
git -C /opt/orchester pull
docker compose -f deploy/docker-compose.prod.yml build --pull

# 2. Run migrations BEFORE bouncing web/worker so the schema is ahead
docker compose -f deploy/docker-compose.prod.yml run --rm \
  -e DATABASE_URL="postgresql://orchester:${POSTGRES_PASSWORD}@postgres:5432/orchester" \
  web pnpm --filter @orchester/db migrate

# 3. Roll web + worker
docker compose -f deploy/docker-compose.prod.yml up -d web worker

# 4. Smoke test
curl -fsS https://${DOMAIN}/api/health | jq .
```

Migrations run as the `orchester` superuser; the runtime keeps using
`app_user`. Never put the superuser DSN in the long-running `web` /
`worker` environment — that bypasses RLS and the boot probe in
`apps/web/lib/db-role-check.ts` will refuse to start the service.

### Reading logs / debugging

```bash
# Tail web + worker
docker compose -f deploy/docker-compose.prod.yml logs -f web worker

# Just the worker (e.g. when a flow hangs)
docker compose -f deploy/docker-compose.prod.yml logs -f --tail=200 worker

# pg-boss queue snapshot (jobs by state)
docker compose -f deploy/docker-compose.prod.yml exec postgres \
  psql -U orchester -d orchester \
  -c "SELECT name, state, count(*) FROM pgboss.job GROUP BY 1,2 ORDER BY 1,2"

# Open a Postgres shell as the same role the app uses — useful to
# reproduce an "0 rows" mystery that is actually RLS doing its job.
docker compose -f deploy/docker-compose.prod.yml exec postgres \
  psql "postgresql://app_user:app@localhost/orchester"
```

## Troubleshooting

### "DB is starting up" / web container restart-loop

The web container can't open a connection because Postgres is still
initializing. Compose declares `depends_on: postgres: condition:
service_healthy`, so this usually resolves on its own within 30
seconds. If it persists:

```bash
docker compose -f deploy/docker-compose.prod.yml logs postgres | tail -50
```

If you see `FATAL: role "app_user" does not exist`, migrations haven't
run yet — go back to the Quick start step 5.

### `BETTER_AUTH_SECRET` not set / env validation failed

```
[instrumentation] FATAL: environment validation failed.
Invalid environment configuration — 1 problem(s):
  - BETTER_AUTH_SECRET: is required
```

The env name is **`BETTER_AUTH_SECRET`**, not `AUTH_SECRET`. Check the
"Required environment variables" table above. The schema lives in
`apps/web/lib/env.ts` — every missing/invalid var is listed in the
aggregated error.

### `ENCRYPTION_SECRET` length error

```
- ENCRYPTION_SECRET: must be a 64-char hex string (openssl rand -hex 32)
```

`ENCRYPTION_SECRET` is the AES-256-GCM primary key. It MUST be exactly
64 hexadecimal characters (32 bytes). Regenerate:

```bash
openssl rand -hex 32
```

If you need to rotate an existing secret without losing already-encrypted
provider credentials, see
[`docs/encryption-key-rotation.md`](./encryption-key-rotation.md) — the
`ENCRYPTION_KEYS` env var supports multi-version keys.

### `COOKIE_SIGNING_SECRET required in production`

The error comes from `apps/web/lib/cookies.ts:52`. There is no
production fallback because a dev secret would let any browser forge a
signed cookie. Generate one and put it in `deploy/.env`:

```bash
openssl rand -base64 32
```

The same secret is used to sign GDPR export download URLs (see
`apps/web/lib/gdpr/signed-url.ts`).

### "db-role-check refused to start: DATABASE_URL connects as a BYPASSRLS role"

You set `DATABASE_URL` to the superuser DSN (`postgresql://orchester:...`).
Defense-in-depth Layer 2 (ADR-0010) refuses to boot in that posture
because RLS+FORCE would be a no-op for the connection. The runtime
must use `postgresql://app_user:app@postgres:5432/orchester`. Migrations
are the only place the superuser DSN is OK — use the one-shot pattern
shown in "Upgrading" above.

### Worker not picking up jobs

Verify the worker is healthy and connected:

```bash
docker compose -f deploy/docker-compose.prod.yml ps worker
docker compose -f deploy/docker-compose.prod.yml logs --tail=50 worker
```

If the container is `unhealthy`, `pgrep` couldn't find the bundle
process — usually means a crash on boot. Common causes are the same env
errors above. Logs will show the actual stack.

### Caddy can't get a TLS cert

```bash
docker compose -f deploy/docker-compose.prod.yml logs caddy | grep -iE "acme|error"
```

Common: port 80 isn't open to the public internet (ACME HTTP-01
challenge), or the `A` record doesn't point at this host. Caddy retries
forever — fix the DNS or firewall and it'll succeed on the next attempt.

## Helm chart

There is no Helm chart yet. If you need one, the compose file is the
canonical reference for the service graph + env wiring; track the
backlog in `ROADMAP.md`.
