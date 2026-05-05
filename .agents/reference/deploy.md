# Deploy Guide

> Three deployment paths from "click and ship" to "self-hosted Docker".
> All three use the same codebase. Pick what fits your team.

## Quick comparison

| Option | Cost (start) | Setup time | Cold start | Long flows | Vector DB |
|---|---|---|---|---|---|
| **Vercel + Neon** | $0 | 10 min | 50 ms | Up to 5 min on Pro | Neon pgvector |
| **Railway** (recommended) | $5/mo | 15 min | none (always-on) | Unlimited | Built-in pg + pgvector |
| **Fly.io / self-hosted Docker** | $0–$2/mo VM | 30 min | none | Unlimited | Bring your own |

---

## Option A — Vercel + Neon (fastest)

Best for: getting online today with zero ops.

### Steps

1. **Provision Postgres on Neon** ([neon.tech](https://neon.tech))
   - Create a project, region close to your Vercel one (e.g. `us-east-2`).
   - Enable pgvector: dashboard → SQL Editor → run:
     ```sql
     CREATE EXTENSION IF NOT EXISTS vector;
     ```
   - Copy the pooled connection string.

2. **Push the schema** (run locally once):
   ```bash
   DATABASE_URL="postgres://...@neon.tech/orchester?sslmode=require" \
     pnpm --filter @orchester/db push
   ```

3. **Add HNSW index + workspace indices** (already-baked SQL):
   ```bash
   psql "$DATABASE_URL" < .agents/reference/init-indices.sql
   ```
   (See [`init-indices.sql`](#initial-indices-sql) at the bottom of this doc.)

4. **Deploy to Vercel**:
   - `npm i -g vercel && vercel link` (point to `apps/web`)
   - Or: connect the GitHub repo in the Vercel dashboard.
   - Vercel reads `vercel.json` at the repo root — `framework: nextjs`,
     extended `maxDuration` for flow runs and KB ingest.

5. **Set env vars** in Vercel dashboard (or via CLI `vercel env add`):
   - `DATABASE_URL` (Neon)
   - `BETTER_AUTH_SECRET` (`openssl rand -base64 32`)
   - `BETTER_AUTH_URL` = your Vercel URL (e.g. `https://orchester.vercel.app`)
   - `NEXT_PUBLIC_APP_URL` = same as above
   - `ENCRYPTION_SECRET` (`openssl rand -hex 32`)
   - Optional: `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, etc.
     (full list: [`env-vars.md`](./env-vars.md))

6. **Trigger redeploy** — Vercel rebuilds with the env vars.

7. **Verify**: `curl https://your.vercel.app/api/health` → `{"db":"ok",...}`.

### Limits to know
- Hobby: 60 s function timeout. Upgrade to Pro for 300 s on flow runs.
- 50 MB request body cap (fine for PDFs ≤50 MB).
- Bandwidth: 100 GB/mo free tier.

---

## Option B — Railway (recommended for production)

Best for: persistent server, no cold starts, internal Postgres in the same project.

### Steps

1. **Install CLI**: `npm i -g @railway/cli && railway login`.

2. **Create a project**:
   ```bash
   cd /path/to/orchester
   railway init
   ```

3. **Add Postgres with pgvector**:
   - Dashboard → New service → Database → PostgreSQL.
   - Open the Postgres service → Settings → Advanced.
   - Set Docker image override: `pgvector/pgvector:pg16`.
   - Restart, then run `CREATE EXTENSION vector;` from the SQL panel.

4. **Add the Web service**:
   - From the same project → New service → GitHub repo (or `railway up`).
   - Railway picks up `railway.json` (Dockerfile-based build) and `Dockerfile`.

5. **Wire env vars**:
   - In the Web service → Variables, link:
     - `DATABASE_URL` → reference the Postgres service's `DATABASE_URL`.
     - `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`.
   - Optional: `RESEND_API_KEY`, `STRIPE_*`, `SENTRY_DSN`.

6. **Custom domain** (optional):
   - Service → Settings → Networking → Add custom domain.
   - Point your DNS CNAME to the Railway-provided URL.

7. **Deploy**: Railway redeploys on every push to the configured branch.

8. **Schema push** (once):
   - Open a shell in the Web service: `railway run pnpm --filter @orchester/db push --force`.
   - Or wire it as a one-shot job.

### Pros
- Persistent server → no cold starts; auto-warmup not needed.
- Postgres + Web in the same VPC → low latency.
- Easy worker process when we move flow execution to a queue.

### Cost
- $5/mo Hobby plan covers ≈100 h of CPU + 500 MB RAM. Plenty for early users.

---

## Option C — Self-hosted Docker

Best for: on-prem, AWS ECS, GCP Cloud Run, or Fly.io.

### Build the image
```bash
docker build -t orchester .
```

### Run
```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://... \
  -e BETTER_AUTH_SECRET=... \
  -e BETTER_AUTH_URL=https://... \
  -e NEXT_PUBLIC_APP_URL=https://... \
  -e ENCRYPTION_SECRET=... \
  orchester
```

### Postgres requirement
- PostgreSQL 16 with pgvector extension.
- Easiest: use the official `pgvector/pgvector:pg16` image.

### Reverse proxy
Put nginx/Caddy/Traefik in front to terminate TLS and route.

### Fly.io shortcut
```bash
fly launch --no-deploy
# Edit fly.toml: set internal_port = 3000
fly secrets set DATABASE_URL=... BETTER_AUTH_SECRET=... # etc
fly deploy
```

---

## Pre-flight checklist

Run before any deploy. Failure on any of these → fix before shipping.

```bash
# 1. Lockfile is up to date
pnpm install --frozen-lockfile

# 2. TypeScript clean
pnpm --filter web tsc --noEmit

# 3. Tests green
pnpm --filter web vitest run

# 4. Production build succeeds
pnpm --filter web build

# 5. Smoke test the build locally
DATABASE_URL=postgres://... pnpm --filter web start
curl http://localhost:3000/api/health  # should return { db: "ok" }
```

---

## Post-deploy checklist

After the first deploy, run through:

1. ☐ `/api/health` returns 200 with `db: "ok"`.
2. ☐ Sign up a fresh account and complete onboarding.
3. ☐ **Settings → AI Providers** → paste a real Anthropic key → "Probar conexión".
4. ☐ **Agentes** → click any seeded agent → **Test chat** sends a message and receives a reply.
5. ☐ **Conocimiento** → New KB → upload a small PDF → "Probar búsqueda" returns chunks.
6. ☐ **Flujos** → run "Pipeline de leads" demo → run completes without error.
7. ☐ **Canales** → create a Web Widget channel → paste the snippet on a test page.
8. ☐ **Settings → Developers** → create an API key → `curl -H "Authorization: Bearer ok_live_..." https://your-app/api/v1/agents`.
9. ☐ (Optional) Stripe Webhook URL `https://your-app/api/billing/webhook` configured + endpoint signature verified.
10. ☐ Sentry receives a test error (`POST /api/sentry-test` if you wire it).

---

## Initial indices SQL

These are already created locally; for a fresh production DB run them once
(idempotent):

```sql
-- Hot FK indices
CREATE INDEX IF NOT EXISTS idx_agent_workspace_id ON agent(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_team_id ON agent(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_status ON agent(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_conversation_workspace_id ON conversation(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversation_started_at ON conversation(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_agent_id ON conversation(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversation_status ON conversation(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_conversation_external ON conversation(channel_id, external_id);
CREATE INDEX IF NOT EXISTS idx_conversation_employee_id ON conversation(employee_id);
CREATE INDEX IF NOT EXISTS idx_message_conversation_id ON message(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_created_at ON message(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_team_workspace_id ON team(workspace_id);
CREATE INDEX IF NOT EXISTS idx_channel_workspace_id ON channel(workspace_id);
CREATE INDEX IF NOT EXISTS idx_employee_workspace_id ON employee(workspace_id);
CREATE INDEX IF NOT EXISTS idx_flow_workspace_id ON flow(workspace_id);
CREATE INDEX IF NOT EXISTS idx_flow_run_flow_id ON flow_run(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_run_started_at ON flow_run(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_run_step_run_id ON flow_run_step(run_id);
CREATE INDEX IF NOT EXISTS idx_kb_workspace_id ON knowledge_base(workspace_id);
CREATE INDEX IF NOT EXISTS idx_kb_doc_kb_id ON knowledge_doc(kb_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunk_kb_id ON knowledge_chunk(kb_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunk_doc_id ON knowledge_chunk(doc_id);
CREATE INDEX IF NOT EXISTS idx_audit_workspace_id ON audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_workspace_id ON usage_event(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apikey_hash ON api_key(hashed_key);
CREATE INDEX IF NOT EXISTS idx_session_user_id ON "session"(user_id);
CREATE INDEX IF NOT EXISTS idx_session_token ON "session"(token);
CREATE INDEX IF NOT EXISTS idx_workspace_member_user ON workspace_member(user_id);

-- HNSW for RAG vector search
CREATE INDEX IF NOT EXISTS idx_kb_chunk_embedding_hnsw
  ON knowledge_chunk USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ANALYZE;
```

This file is also bundled at `.agents/reference/init-indices.sql`.

---

## After-launch ops

Once live, work through:

- **Email transactional**: provision Resend → set `RESEND_API_KEY` → workspace
  invites + password reset emails will start sending.
- **Sentry DSN**: set `SENTRY_DSN` → errors flow to your project.
- **Stripe**: create products + prices in Stripe dashboard → set
  `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`. Add
  webhook endpoint `/api/billing/webhook` + paste the signing secret to
  `STRIPE_WEBHOOK_SECRET`.
- **Telegram bot**: each workspace user adds their own bot token in
  `Canales → Conectar Telegram`. Server auto-registers the webhook to
  `${NEXT_PUBLIC_APP_URL}/api/channels/telegram/webhook/<secret>`.
- **Custom domain**: configure in Vercel/Railway, update `NEXT_PUBLIC_APP_URL`
  + `BETTER_AUTH_URL` to match.
- **Email verification**: in `lib/auth.ts`, flip `requireEmailVerification: true`
  before granting your first paid customer access.

## CI

`.github/workflows/ci.yml` runs on every push and PR:
1. Spins up Postgres + pgvector via service container.
2. `pnpm install --frozen-lockfile`.
3. Pushes the schema.
4. `tsc --noEmit`, `vitest run`, `next build`.

Configure branch protection on `main` to require this check.
