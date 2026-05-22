#!/usr/bin/env bash
#
# preflight.sh — Validación pre-deploy de Orchester.
#
# Corré esto ANTES de levantar el stack en un host nuevo. Falla loud con
# instrucciones específicas si algo está mal.
#
# Checks:
#   1. Env vars obligatorias presentes y bien formadas
#   2. Secrets reales (no placeholders dev)
#   3. ENCRYPTION_SECRET es 64-char hex
#   4. BETTER_AUTH_SECRET es ≥32 chars
#   5. DATABASE_URL pingable
#   6. Postgres tiene pgvector instalado
#   7. (opcional) MinIO/S3 alcanzable
#   8. (opcional) SMTP alcanzable
#   9. Provider key presente (Anthropic/OpenAI/Google) — al menos uno
#
# Uso:
#   ./scripts/preflight.sh
#   ENV_FILE=.env.production ./scripts/preflight.sh

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
PASS=0
FAIL=0
WARN=0

ok()    { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
warn()  { echo "  ⚠ $1"; WARN=$((WARN+1)); }

if [ -f "$ENV_FILE" ]; then
  set -a; source "$ENV_FILE"; set +a
  echo "Loaded env from $ENV_FILE"
else
  echo "No $ENV_FILE — using current shell env"
fi

echo ""
echo "=== Required env vars ==="

[ -n "${DATABASE_URL:-}" ] && ok "DATABASE_URL set" || fail "DATABASE_URL missing"
[ -n "${BETTER_AUTH_SECRET:-}" ] && ok "BETTER_AUTH_SECRET set" || fail "BETTER_AUTH_SECRET missing"
[ -n "${ENCRYPTION_SECRET:-}" ] && ok "ENCRYPTION_SECRET set" || fail "ENCRYPTION_SECRET missing"
[ -n "${NEXT_PUBLIC_APP_URL:-}" ] && ok "NEXT_PUBLIC_APP_URL set" || fail "NEXT_PUBLIC_APP_URL missing"

echo ""
echo "=== Secret strength ==="

if [ -n "${ENCRYPTION_SECRET:-}" ]; then
  LEN=${#ENCRYPTION_SECRET}
  if [ "$LEN" -ne 64 ]; then
    fail "ENCRYPTION_SECRET length=$LEN (must be 64 hex chars). Generate: openssl rand -hex 32"
  elif ! echo -n "$ENCRYPTION_SECRET" | grep -Eq '^[0-9a-fA-F]{64}$'; then
    fail "ENCRYPTION_SECRET is not valid hex"
  else
    ok "ENCRYPTION_SECRET is 64-char hex"
  fi
fi

if [ -n "${BETTER_AUTH_SECRET:-}" ]; then
  case "$BETTER_AUTH_SECRET" in
    "dev-secret-change-in-production"|"dev-better-auth-secret-change-in-prod-32chars"|"ci-test-secret-not-real-32chars-ok")
      fail "BETTER_AUTH_SECRET is a placeholder. Rotate: openssl rand -base64 32"
      ;;
    *)
      LEN=${#BETTER_AUTH_SECRET}
      if [ "$LEN" -lt 32 ]; then
        fail "BETTER_AUTH_SECRET length=$LEN (need ≥32). Rotate: openssl rand -base64 32"
      else
        ok "BETTER_AUTH_SECRET length=$LEN"
      fi
      ;;
  esac
fi

echo ""
echo "=== Provider keys ==="
PROVIDERS=0
[ -n "${ANTHROPIC_API_KEY:-}" ] && { PROVIDERS=$((PROVIDERS+1)); ok "ANTHROPIC_API_KEY set"; }
[ -n "${OPENAI_API_KEY:-}" ] && { PROVIDERS=$((PROVIDERS+1)); ok "OPENAI_API_KEY set"; }
[ -n "${GOOGLE_AI_API_KEY:-}" ] && { PROVIDERS=$((PROVIDERS+1)); ok "GOOGLE_AI_API_KEY set"; }
if [ "$PROVIDERS" -eq 0 ]; then
  warn "No env-level provider key. OK si los configurás vía /settings#providers per-workspace."
fi

echo ""
echo "=== Database connectivity ==="
if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  if psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
    ok "Postgres pingable"
    if psql "$DATABASE_URL" -c "SELECT 'vector'::regtype" >/dev/null 2>&1; then
      ok "pgvector instalado"
    else
      fail "pgvector NO instalado. Run: psql \"\$DATABASE_URL\" -c 'CREATE EXTENSION vector'"
    fi
    if psql "$DATABASE_URL" -c "SELECT 1 FROM workspace LIMIT 1" >/dev/null 2>&1; then
      ok "Schema aplicado (tabla workspace existe)"
    else
      warn "Schema NO aplicado. Run: pnpm --filter @orchester/db migrate"
    fi
  else
    fail "Postgres NO pingable con DATABASE_URL"
  fi
else
  warn "psql no disponible o DATABASE_URL vacío — skip"
fi

echo ""
echo "=== Optional services ==="
if [ -n "${S3_ENDPOINT:-}" ]; then
  if command -v curl >/dev/null 2>&1 && curl -sf "${S3_ENDPOINT}/minio/health/live" >/dev/null 2>&1; then
    ok "MinIO/S3 alcanzable en $S3_ENDPOINT"
  else
    warn "S3_ENDPOINT setteado pero no responde a /minio/health/live"
  fi
fi

if [ -n "${SMTP_HOST:-}" ]; then
  if command -v nc >/dev/null 2>&1 && nc -z -w 3 "$SMTP_HOST" "${SMTP_PORT:-587}" 2>/dev/null; then
    ok "SMTP $SMTP_HOST:${SMTP_PORT:-587} alcanzable"
  else
    warn "SMTP_HOST setteado pero puerto no abre (firewall? wrong host?)"
  fi
fi

echo ""
echo "=== TLS / hostname ==="
if [ -n "${NEXT_PUBLIC_APP_URL:-}" ]; then
  case "$NEXT_PUBLIC_APP_URL" in
    https://*) ok "NEXT_PUBLIC_APP_URL usa HTTPS" ;;
    http://localhost*|http://127.0.0.1*) warn "NEXT_PUBLIC_APP_URL es localhost (dev only — NO usar en prod)" ;;
    http://*) fail "NEXT_PUBLIC_APP_URL es HTTP. Usá HTTPS en producción (Caddy lo hace solo)" ;;
  esac
fi

echo ""
echo "=== Summary ==="
echo "  ✓ pass:  $PASS"
echo "  ⚠ warn:  $WARN"
echo "  ✗ fail:  $FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "✗ NOT READY — fix the ✗ items above before deploying."
  exit 1
fi
if [ "$WARN" -gt 0 ]; then
  echo "⚠ READY WITH WARNINGS — review ⚠ items, OK to deploy if intentional."
  exit 0
fi
echo "✓ ALL GOOD — proceed with deploy."
