#!/usr/bin/env bash
set -euo pipefail
# Idempotent: if MNEMO_API_KEY in apps/web/.env.local already passes /v1/health, no-op.
# Otherwise, mint a fresh UUID-workspace key via the running mnemosyne-server container
# and write MNEMO_URL + MNEMO_API_KEY into apps/web/.env.local.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
URL="${MNEMO_URL:-http://localhost:3939}"
ENVF="$ROOT_DIR/apps/web/.env.local"

# --- idempotency check ---
existing_key="$(grep -E '^MNEMO_API_KEY=' "$ENVF" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)"
if [ -n "$existing_key" ] && curl -fsS -H "Authorization: Bearer $existing_key" "$URL/v1/health" >/dev/null 2>&1; then
  echo "mnemo: existing key is valid — no-op (delete MNEMO_API_KEY from $ENVF to force re-provision)"
  exit 0
fi

# --- mint new key ---
echo "mnemo: provisioning new UUID workspace + API key..."
ws="$(uuidgen | tr '[:upper:]' '[:lower:]')"
key="$(docker exec mnemosyne-server node /app/scripts/create-api-key.cjs --workspace "$ws" --label orchester-dev 2>/dev/null | tail -1)"

if [ -z "$key" ] || [[ "$key" != mns_live_* ]]; then
  echo "ERROR: Failed to mint key — is mnemosyne-server running? (docker ps | grep mnemosyne-server)" >&2
  exit 1
fi

# --- upsert into .env.local ---
touch "$ENVF"
if grep -qE '^MNEMO_URL=' "$ENVF"; then
  sed -i '' "s|^MNEMO_URL=.*|MNEMO_URL=$URL|" "$ENVF"
else
  echo "MNEMO_URL=$URL" >> "$ENVF"
fi
if grep -qE '^MNEMO_API_KEY=' "$ENVF"; then
  sed -i '' "s|^MNEMO_API_KEY=.*|MNEMO_API_KEY=$key|" "$ENVF"
else
  echo "MNEMO_API_KEY=$key" >> "$ENVF"
fi

echo "mnemo: provisioned workspace $ws"
echo "mnemo: key written to $ENVF"
