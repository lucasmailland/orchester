#!/usr/bin/env bash
#
# Rota ENCRYPTION_SECRET sin perder los datos cifrados (re-encripta in-place).
#
# Pasos:
#   1. parar workers
#   2. parar web (o ponerlo read-only)
#   3. correr este script
#   4. actualizar ENCRYPTION_SECRET en config (.env / secret manager)
#   5. levantar workers + web
#
# Uso:
#   DATABASE_URL=postgres://… ENCRYPTION_SECRET=<viejo> ./scripts/rotate-encryption-secret.sh

set -euo pipefail

if [ -z "${ENCRYPTION_SECRET:-}" ]; then
  echo "ERROR: ENCRYPTION_SECRET (el viejo) requerido en env." >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL requerido en env." >&2
  exit 1
fi

NEW_SECRET=$(openssl rand -hex 32)

cd "$(dirname "$0")/../apps/web"
OLD_ENCRYPTION_SECRET="$ENCRYPTION_SECRET" \
NEW_ENCRYPTION_SECRET="$NEW_SECRET" \
DATABASE_URL="$DATABASE_URL" \
pnpm exec tsx scripts/rotate-encryption-secret.ts

echo ""
echo "==================================================================="
echo "Rotation complete. Update ENCRYPTION_SECRET to:"
echo ""
echo "$NEW_SECRET"
echo ""
echo "Then restart web + worker."
echo "==================================================================="
