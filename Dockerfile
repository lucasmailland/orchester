# Production Dockerfile for Orchester (Next.js standalone + worker process).
#
# Build:
#   docker build -t orchester .
#
# Run web:
#   docker run -p 3000:3000 --env-file .env.production orchester
#
# Run worker (mismo image, distinto comando):
#   docker run --env-file .env.production orchester \
#     node --import tsx/esm apps/web/worker/index.ts
#
# El docker-compose.prod.yml setea el comando correcto para cada servicio.

# ----- Stage 1: deps -----
FROM node:26-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Workspace lockfile + manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
RUN pnpm install --frozen-lockfile --prod=false

# ----- Stage 2: build -----
FROM node:26-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
RUN pnpm --filter web build

# ----- Stage 3: runtime -----
FROM node:26-alpine AS runner
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

# Worker source + tsx (runtime TS) + node_modules necesarios para el worker.
# El standalone ya trae los deps tracked por Next; el worker requiere los suyos
# (pg-boss, tsx, lib/* compartidas).
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/worker ./apps/web/worker
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/lib ./apps/web/lib
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/tsconfig.json ./apps/web/tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pg-boss ./node_modules/pg-boss

USER nextjs
EXPOSE 3000

# Default: web. docker-compose override comando para el worker.
CMD ["node", "apps/web/server.js"]
