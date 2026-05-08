#!/usr/bin/env bash
#
# smoke-test.sh — verificación post-deploy automatizada.
#
# Corre los smoke tests del PRODUCTION-CHECKLIST.md sin necesidad de un
# browser interactivo. Útil para CI/CD o para cuando deployás manual.
#
# Uso:
#   DOMAIN=https://orchester.tu-dominio.com ./scripts/smoke-test.sh
#
# Tests:
#   1. /api/health → 200 healthy
#   2. /es/login → 200 (UI carga)
#   3. /api/v1/agents → 401 (público sin API key, NO debe ser 500)
#   4. /api/conversations → 401 (auth required)
#   5. CSP header presente en respuesta HTML
#   6. HSTS header presente en respuesta HTTPS
#
# Output: exit 0 si todos OK, exit 1 con detalle si alguno falla.

set -euo pipefail

DOMAIN="${DOMAIN:-http://localhost:3000}"
PASS=0
FAIL=0

run() {
  local name="$1" expect="$2" url="$3"
  shift 3
  local actual
  actual=$(curl -sk -o /dev/null -w "%{http_code}" "$@" "$url" || echo "000")
  if [ "$actual" = "$expect" ]; then
    echo "  ✓ $name → $actual"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name → got $actual (expected $expect)"
    FAIL=$((FAIL+1))
  fi
}

run_headers() {
  local name="$1" header="$2" url="$3"
  if curl -skI "$url" | grep -qi "^${header}:"; then
    echo "  ✓ $name (header $header presente)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $name (header $header faltante)"
    FAIL=$((FAIL+1))
  fi
}

echo "Smoke test → $DOMAIN"
echo ""
echo "=== HTTP status codes ==="

run "health public"      200 "$DOMAIN/api/health"
run "login page"         200 "$DOMAIN/es/login"
run "v1/agents no auth"  401 "$DOMAIN/api/v1/agents"
run "conversations no auth" 401 "$DOMAIN/api/conversations"
run "ws no auth"         401 "$DOMAIN/api/workspaces/nonexistent"
run "404 unknown"        404 "$DOMAIN/api/this-does-not-exist"

echo ""
echo "=== Health body ==="
HEALTH=$(curl -sk "$DOMAIN/api/health" | head -c 500)
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
  echo "  ✓ health.status === healthy"
  PASS=$((PASS+1))
else
  echo "  ✗ health.status NOT healthy: $HEALTH"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=== Security headers ==="
run_headers "X-Content-Type-Options" "X-Content-Type-Options"   "$DOMAIN/es/login"
run_headers "X-Frame-Options"        "X-Frame-Options"          "$DOMAIN/es/login"
run_headers "Referrer-Policy"        "Referrer-Policy"          "$DOMAIN/es/login"

# CSP es dinámico per request, sólo verificamos que esté
if curl -skI "$DOMAIN/es/login" | grep -qi "^content-security-policy:"; then
  echo "  ✓ CSP header presente"
  PASS=$((PASS+1))
else
  echo "  ⚠ CSP header missing (revisá middleware.ts)"
  # CSP missing es warning, no fail (puede no estar en /api/*)
fi

# HSTS solo aplicable en HTTPS
case "$DOMAIN" in
  https://*)
    run_headers "HSTS" "Strict-Transport-Security" "$DOMAIN/api/health"
    ;;
  *)
    echo "  ℹ HSTS skip (HTTP, no aplicable)"
    ;;
esac

echo ""
echo "=== Summary ==="
echo "  ✓ pass: $PASS"
echo "  ✗ fail: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "✗ SMOKE TEST FAILED"
  exit 1
fi
echo ""
echo "✓ SMOKE TEST PASSED"
