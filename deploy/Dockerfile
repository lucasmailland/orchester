# Production Dockerfile for Orchester (Next.js standalone + worker process).
#
# Build context = repo root, so always invoke from the root:
#   docker build -f deploy/Dockerfile -t orchester .
#
# Run web (default CMD):
#   docker run -p 3000:3000 --env-file .env.production orchester
#
# Run worker (same image, different command — bundle is pre-built in
# the builder stage so the runner ships no esbuild + no TS source):
#   docker run --env-file .env.production orchester \
#     node apps/web/worker/.dist/worker.mjs
#
# deploy/docker-compose.prod.yml wires the correct CMD for each service.

# ----- Stage 1: deps -----
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Workspace lockfile + manifests. All workspace packages must be present
# BEFORE `pnpm install --frozen-lockfile` because pnpm validates every
# workspace:* entry in the lockfile against the on-disk packages.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/mnemosyne/package.json packages/mnemosyne/
# pnpm `patchedDependencies` (better-auth/kysely-adapter) requires the patch
# file at install time, otherwise --frozen-lockfile fails.
COPY patches/ patches/

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
RUN pnpm install --frozen-lockfile --prod=false

# ----- Stage 2: build -----
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/mnemosyne/node_modules ./packages/mnemosyne/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
RUN pnpm --filter @orchester/web build
# Pre-build the worker bundle inside the builder stage where the full
# workspace TS source + esbuild + node_modules are available. The runner
# stage only carries the resulting `.dist/worker.mjs` — no esbuild, no
# workspace TS sources, no @orchester/* needs to resolve at runtime.
# Matches the original `worker:build` script in apps/web/package.json.
RUN node apps/web/worker/build.mjs

# ----- Stage 3: runtime -----
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat wget
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Standalone Next.js output
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Pre-built worker bundle (built in the builder stage). Self-contained:
# pg-boss, postgres, drizzle and the @orchester/* workspace packages are
# all inlined by esbuild (alias server-only/client-only → empty). Only
# `pg-native` is marked external and is optional — pg will fall back to
# the pure-JS protocol.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/worker/.dist ./apps/web/worker/.dist

USER nextjs
EXPOSE 3000

# Healthcheck — observable at the image level as well as in compose so
# `docker run` users (no compose) still get an unhealthy signal when the
# server crashes or `validateEnv()` rejects boot.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

# Default: web. The worker service in docker-compose.prod.yml overrides
# this with `["node", "apps/web/worker/.dist/worker.mjs"]`.
CMD ["node", "apps/web/server.js"]
