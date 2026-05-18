#!/usr/bin/env bash
#
# go-live.sh — Checklist runner pre-lanzamiento. Un solo go/no-go.
#
# Orquesta los checks que ya existen + verificaciones del app corriendo:
#   1. preflight.sh        — env vars, secretos, DB, pgvector
#   2. verify-email.sh     — SMTP handshake + SPF/DKIM/DMARC
#   3. smoke-test.sh       — endpoints HTTP del app desplegado
#   4. TLS cert válido     — el dominio sirve HTTPS con cert no vencido
#   5. /api/health healthy — el app responde sano
#
# Uso:
#   ./scripts/go-live.sh https://orchester.tu-dominio.com
#   ENV_FILE=.env.production ./scripts/go-live.sh https://app.tu.com
#
# Exit 0 = listo para anunciar. Exit 1 = NO lanzar todavía.

set -uo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
ENV_FILE="${ENV_FILE:-.env}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bold() { echo -e "\033[1m$1\033[0m"; }
section() { echo ""; bold "━━━ $1 ━━━"; }

[ -n "$DOMAIN" ] || { echo "Uso: ./scripts/go-live.sh https://tu-dominio.com"; exit 1; }

GATE_FAIL=0
gate() {
  # gate <nombre> <comando...>
  local name="$1"; shift
  section "$name"
  if "$@"; then
    echo "  → $name: OK"
  else
    echo "  → $name: FALLÓ"
    GATE_FAIL=$((GATE_FAIL+1))
  fi
}

bold "Go-Live checklist → $DOMAIN"
echo "ENV_FILE=$ENV_FILE"

# 1. Preflight (no fatal si no hay psql; preflight maneja sus propios exit codes)
if [ -x "$HERE/preflight.sh" ]; then
  gate "Preflight (env/secrets/DB)" env ENV_FILE="$ENV_FILE" "$HERE/preflight.sh"
else
  section "Preflight"; echo "  ⚠ preflight.sh no encontrado — skip"
fi

# 2. Email deliverability
if [ -x "$HERE/verify-email.sh" ]; then
  gate "Email (SMTP + SPF/DKIM/DMARC)" env ENV_FILE="$ENV_FILE" "$HERE/verify-email.sh"
else
  section "Email"; echo "  ⚠ verify-email.sh no encontrado — skip"
fi

# 3. TLS cert
section "TLS certificate"
if command -v openssl >/dev/null 2>&1; then
  HOST="${DOMAIN#https://}"; HOST="${HOST#http://}"; HOST="${HOST%%/*}"
  END="$(echo | timeout 10 openssl s_client -servername "$HOST" -connect "$HOST:443" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -n "$END" ]; then
    END_TS="$(date -d "$END" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$END" +%s 2>/dev/null || echo 0)"
    NOW_TS="$(date +%s)"
    DAYS=$(( (END_TS - NOW_TS) / 86400 ))
    if [ "$END_TS" -gt "$NOW_TS" ]; then
      echo "  ✓ Cert válido — expira en $DAYS días ($END)"
      [ "$DAYS" -lt 14 ] && { echo "  ⚠ Expira pronto (<14d) — verificá auto-renew de Caddy/certbot"; }
    else
      echo "  ✗ Cert VENCIDO ($END)"; GATE_FAIL=$((GATE_FAIL+1))
    fi
  else
    echo "  ✗ No pude leer el cert TLS de $HOST:443 (¿DNS? ¿443 cerrado? ¿no HTTPS aún?)"
    GATE_FAIL=$((GATE_FAIL+1))
  fi
else
  echo "  ⚠ openssl no disponible — skip TLS check"
fi

# 4. Smoke test del app corriendo
if [ -x "$HERE/smoke-test.sh" ]; then
  gate "Smoke test (HTTP endpoints)" env DOMAIN="$DOMAIN" "$HERE/smoke-test.sh"
else
  section "Smoke test"; echo "  ⚠ smoke-test.sh no encontrado — skip"
fi

# 5. Health body explícito
section "Health endpoint"
HBODY="$(curl -sk --max-time 10 "$DOMAIN/api/health" 2>/dev/null | head -c 300)"
if echo "$HBODY" | grep -q '"status":"healthy"'; then
  echo "  ✓ /api/health → healthy"
else
  echo "  ✗ /api/health no healthy: ${HBODY:-<sin respuesta>}"
  GATE_FAIL=$((GATE_FAIL+1))
fi

echo ""
bold "═══════════════════════════════════════"
if [ "$GATE_FAIL" -eq 0 ]; then
  bold "✓ GO — todo verde. Podés anunciar el lanzamiento."
  exit 0
fi
bold "✗ NO-GO — $GATE_FAIL gate(s) fallaron. Resolvé antes de lanzar."
exit 1
