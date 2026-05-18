#!/usr/bin/env bash
#
# verify-email.sh — Verifica entregabilidad de email ANTES de go-live.
#
# 1. SMTP handshake real (EHLO + STARTTLS) contra SMTP_HOST:SMTP_PORT
# 2. SPF  TXT record presente para el dominio del remitente
# 3. DMARC TXT record presente (_dmarc.<dominio>)
# 4. DKIM  TXT record presente para el selector dado (<sel>._domainkey.<dominio>)
#
# Si usás Resend (RESEND_API_KEY), el SMTP check se saltea (Resend es API) y
# sólo validamos los DNS records del dominio configurado en EMAIL_FROM.
#
# Uso:
#   ENV_FILE=.env DKIM_SELECTOR=resend ./scripts/verify-email.sh
#   SMTP_HOST=smtp.tu.com SMTP_PORT=587 EMAIL_FROM="no-reply@tu.com" ./scripts/verify-email.sh

set -uo pipefail

ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

DKIM_SELECTOR="${DKIM_SELECTOR:-resend}"
PASS=0; FAIL=0; WARN=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
warn() { echo "  ⚠ $1"; WARN=$((WARN+1)); }

# Extraer dominio del remitente. EMAIL_FROM puede ser "Name <a@b.com>" o "a@b.com".
RAW_FROM="${EMAIL_FROM:-onboarding@orchester.io}"
SENDER="$(echo "$RAW_FROM" | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' | head -1)"
DOMAIN="${SENDER##*@}"
[ -n "$DOMAIN" ] || { echo "No pude extraer dominio de EMAIL_FROM='$RAW_FROM'"; exit 1; }

echo "Verificando email para dominio: $DOMAIN (remitente: $SENDER)"
echo ""

# --- DNS helper ---------------------------------------------------------------
dns_txt() {
  if command -v dig >/dev/null 2>&1; then
    dig +short TXT "$1" | tr -d '"' | tr '\n' ' '
  elif command -v host >/dev/null 2>&1; then
    host -t TXT "$1" 2>/dev/null | sed 's/.*descriptive text //' | tr -d '"' | tr '\n' ' '
  elif command -v nslookup >/dev/null 2>&1; then
    nslookup -type=TXT "$1" 2>/dev/null | grep -i text | sed 's/.*text = //' | tr -d '"' | tr '\n' ' '
  else
    echo "__NO_DNS_TOOL__"
  fi
}

echo "=== SMTP ==="
if [ -n "${RESEND_API_KEY:-}" ]; then
  warn "RESEND_API_KEY presente → envío vía API HTTP (no SMTP). Skip handshake."
elif [ -z "${SMTP_HOST:-}" ]; then
  warn "SMTP_HOST no configurado y sin RESEND_API_KEY → emails quedan en console (dev)."
else
  PORT="${SMTP_PORT:-587}"
  if command -v nc >/dev/null 2>&1 && nc -z -w 4 "$SMTP_HOST" "$PORT" 2>/dev/null; then
    ok "Puerto $SMTP_HOST:$PORT abierto"
    if command -v openssl >/dev/null 2>&1; then
      RESP="$( (printf 'EHLO orchester.local\r\nQUIT\r\n'; sleep 2) | \
        timeout 10 openssl s_client -starttls smtp -connect "$SMTP_HOST:$PORT" -crlf 2>/dev/null | head -40 )"
      if echo "$RESP" | grep -qiE '^250'; then
        ok "EHLO 250 OK (STARTTLS handshake exitoso)"
        echo "$RESP" | grep -qi 'AUTH' && ok "Servidor anuncia AUTH" || warn "Servidor no anuncia AUTH (¿relay abierto o sólo IP-allowlist?)"
      else
        fail "EHLO no devolvió 250 (revisá host/cert/STARTTLS)"
      fi
    else
      warn "openssl no disponible — sólo verifiqué el puerto TCP"
    fi
  else
    fail "No pude abrir $SMTP_HOST:$PORT (firewall / host mal / puerto cerrado)"
  fi
fi

echo ""
echo "=== DNS records ($DOMAIN) ==="
SPF="$(dns_txt "$DOMAIN")"
if [ "$SPF" = "__NO_DNS_TOOL__" ]; then
  warn "Sin dig/host/nslookup — instalá dnsutils para validar SPF/DKIM/DMARC"
else
  echo "$SPF" | grep -qi 'v=spf1' && ok "SPF presente" || fail "SPF (v=spf1) NO encontrado en TXT de $DOMAIN"

  DMARC="$(dns_txt "_dmarc.$DOMAIN")"
  echo "$DMARC" | grep -qi 'v=DMARC1' && ok "DMARC presente" || fail "DMARC NO encontrado en _dmarc.$DOMAIN"

  DKIM="$(dns_txt "${DKIM_SELECTOR}._domainkey.$DOMAIN")"
  if echo "$DKIM" | grep -qiE 'v=DKIM1|p='; then
    ok "DKIM presente (selector: $DKIM_SELECTOR)"
  else
    fail "DKIM NO encontrado en ${DKIM_SELECTOR}._domainkey.$DOMAIN (¿selector correcto?)"
  fi
fi

echo ""
echo "=== Summary ==="
echo "  ✓ pass: $PASS   ⚠ warn: $WARN   ✗ fail: $FAIL"
[ "$FAIL" -gt 0 ] && { echo "✗ EMAIL NO LISTO — los emails de invite/budget pueden ir a spam o fallar."; exit 1; }
echo "✓ EMAIL OK${WARN:+ (con warnings — revisá ⚠)}"
exit 0
