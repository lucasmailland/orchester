#!/usr/bin/env bash
#
# generate-secrets.sh — imprime un bloque .env listo para copiar al secret manager.
#
# Genera:
#   BETTER_AUTH_SECRET     — base64 random, 32 bytes (44 chars)
#   COOKIE_SIGNING_SECRET  — base64 random, 32 bytes (44 chars)
#   ENCRYPTION_SECRET      — hex random, 32 bytes (64 chars)
#   POSTGRES_PASSWORD      — base64 random, 24 bytes
#   MINIO_ROOT_PASSWORD    — base64 random, 24 bytes
#
# Uso:
#   ./scripts/generate-secrets.sh > .env.production.secrets
#   # editá .env.production.secrets para agregar lo no-secreto (DOMAIN, etc.)
#
# IMPORTANTE: NUNCA commitees el archivo de secretos.

set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl required" >&2
  exit 1
fi

cat <<EOF
# Generado por scripts/generate-secrets.sh — $(date -u +%Y-%m-%dT%H:%M:%SZ)
# NO commitear este archivo. Movelo a tu secret manager (Doppler/Vault/etc.).

BETTER_AUTH_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
COOKIE_SIGNING_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
ENCRYPTION_SECRET="$(openssl rand -hex 32)"
POSTGRES_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=\n' | head -c 24)"
MINIO_ROOT_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=\n' | head -c 24)"

# Faltan llenar (no son secretos pero hacen falta):
#  DOMAIN=<your-domain.com>
#  ANTHROPIC_API_KEY=<your-key>
#  SMTP_HOST=<host>  SMTP_PORT=587  SMTP_USER=<user>  SMTP_PASS=<pass>
#  MAIL_FROM=<noreply@your-domain.com>
EOF
