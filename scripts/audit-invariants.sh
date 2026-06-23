#!/usr/bin/env bash
# CI guard para invariantes transversales de seguridad/billing/reliability.
#
# Cada auditoría (v1, meta-audit pass 1, pass 2, v2) cazó el MISMO patrón: una
# invariante que debería valer en todos los callers se fijaba sólo en los sitios
# nombrados en el reporte previo. Este script captura las 3 invariantes más
# load-bearing y falla CI si aparece una violación nueva:
#
#   1. Todo `llmCall(` o `llmStream(` debe tener `assertWithinSpend` en el mismo
#      archivo (spend cap / kill-switch — E1/E3).
#   2. Todo `llmCall(` o `llmStream(` debe tener `recordAiUsage` en el mismo
#      archivo (metering — D4/E2).
#   3. Toda ruta mutante (POST/PUT/PATCH/DELETE) en `app/api/**/route.ts` debe
#      tener `requireAuth` (RBAC — RBAC-1) Y `parseBody` (zod — K4).
#   4. `executeFlow(` SÓLO debe llamarse desde el worker o desde callers que
#      explícitamente pasan `signal:` (cancelación bounded — F-B1/F-1).
#
# Uso: `bash scripts/audit-invariants.sh` desde el repo root. Exit 0 ↔ todo ok.
# Wireado en .github/workflows/ci.yml.

set -euo pipefail

cd "$(dirname "$0")/.."

VIOLATIONS=0
fail() {
  printf '\033[31m✘\033[0m %s\n' "$1"
  VIOLATIONS=$((VIOLATIONS + 1))
}
ok() { printf '\033[32m✓\033[0m %s\n' "$1"; }

WEB=apps/web
# Mnemosyne is vendored as a git submodule at vendor/mnemosyne; its source
# tree (incl. packages/core/src) is present even though orchester only builds
# the client-ts SDK. Override with MNEMO_REPO_PATH=/path/to/mnemosyne if
# checked out elsewhere. If the path doesn't exist, the mnemo block below
# skips gracefully.
MNEMO="${MNEMO_REPO_PATH:-vendor/mnemosyne/packages/core}/src"

# Exclude .next/standalone build artifacts and the llm-call file itself
# (which defines llmCall/llmStream and naturally doesn't call them).
# Also exclude test files — tests mention `llmCall(` as the function
# they exercise via mocks; pairing them with assertWithinSpend +
# recordAiUsage would be theatre. The invariant is about PRODUCTION
# callers. Test directories: `__tests__/`, `tests/`, `*.test.ts`,
# `*.spec.ts`.
FILES_WITH_LLM=$(grep -rln "llmCall(\\|llmStream(" "$WEB" --include='*.ts' \
  | grep -v ".next/standalone" \
  | grep -v "lib/llm-call.ts" \
  | grep -v "__tests__/" \
  | grep -v "/tests/" \
  | grep -vE "\.(test|spec)\.ts$" || true)

# ── Invariante 1 + 2: spend guard + metering en cada archivo con llm* ──────
for f in $FILES_WITH_LLM; do
  if ! grep -q "assertWithinSpend" "$f"; then
    fail "spend guard missing in: $f (add: import { assertWithinSpend } + call before llmCall/llmStream)"
  fi
  if ! grep -q "recordAiUsage\\|persistAssistantTurn" "$f"; then
    fail "metering missing in: $f (add: recordAiUsage after the LLM result, or use persistAssistantTurn)"
  fi
done

# ── Mnemosyne package: same invariants 1 + 2 ───────────────────────────────
# Audit 2026-05-24 (mnemosyne v1 final, §1.f) flagged that this script only
# covered apps/web, so any future llmCall/llmStream landing inside
# the mnemosyne sources would silently skip the spend-cap + metering gate.
# Mnemosyne is vendored as a submodule at vendor/mnemosyne; we audit its
# sources only if present (override the path via MNEMO_REPO_PATH). When
# extraction/judge adapters start calling the LLM,
# they MUST pair every call with assertWithinSpend + recordAiUsage in the
# same file. No exclusions: every *.ts file under the mnemosyne src dir
# that names llmCall(/llmStream( is in scope.
if [ -d "$MNEMO" ]; then
  FILES_WITH_LLM_MNEMO=$(grep -rln "llmCall(\\|llmStream(" "$MNEMO" --include='*.ts' \
    | grep -v ".next/standalone" || true)

  for f in $FILES_WITH_LLM_MNEMO; do
    if ! grep -q "assertWithinSpend" "$f"; then
      fail "spend guard missing in: $f (add: import { assertWithinSpend } + call before llmCall/llmStream)"
    fi
    if ! grep -q "recordAiUsage\\|persistAssistantTurn" "$f"; then
      fail "metering missing in: $f (add: recordAiUsage after the LLM result, or use persistAssistantTurn)"
    fi
  done
else
  printf '\033[33m⚠\033[0m mnemosyne repo not found at %s — skipping mnemo invariants (set MNEMO_REPO_PATH to enable)\n' "$MNEMO"
fi

# ── Invariante 3: RBAC + zod en rutas mutantes ─────────────────────────────
# Listamos archivos route.ts cuyo contenido contiene POST/PUT/PATCH/DELETE
# handler (export async function POST/PUT/PATCH/DELETE).
#
# Excepciones (públicas / con auth propia):
# Public surfaces with their own auth pattern (session/secret/API-key/Stripe sig).
EXCLUDE_RBAC='/api/auth/|/api/health|/api/webhooks/\[secret\]|/api/widget/|/api/embed|/api/me/|/api/me/|/api/v1/|/api/billing/webhook|/api/mcp|/api/sessions|/api/invites/accept|/api/notification-prefs|/api/workspaces/\[id\]|/channels/(telegram|slack)/webhook/\[secret\]'

# Routes whose mutating handlers genuinely have NO body (param-only):
# - .../restore/route.ts (POST with only URL params)
# - .../test/route.ts under providers (param-only "test connection")
# - flows/seed-real (dev-only seed util)
# - billing/portal (Stripe form, no JSON)
# - any route that DOES validate manually if not zod (audited case-by-case)
EXCLUDE_BODY='/restore/route.ts$|/api/providers/\[id\]/test/route.ts$|/api/flows/seed-real/route.ts$|/api/billing/portal/route.ts$|/api/workspace-members/route.ts$|/api/conversations/\[id\]/takeover/route.ts$|/api/webhooks/\[secret\]/route.ts$|/api/billing/webhook/route.ts$|/channels/(telegram|slack)/webhook/\[secret\]/route.ts$|/api/mcp/route.ts$|/api/widget/\[channelId\]/stream/route.ts$'

while IFS= read -r f; do
  # Sólo rutas con un handler mutante
  if ! grep -qE '^export async function (POST|PUT|PATCH|DELETE)' "$f"; then continue; fi
  # Skip RBAC exceptions
  if ! echo "$f" | grep -qE "$EXCLUDE_RBAC"; then
    if ! grep -q "requireAuth" "$f"; then
      fail "RBAC gate missing in route: $f (add: requireAuth({minRole}))"
    fi
  fi
  # Skip body-validation exceptions
  if ! echo "$f" | grep -qE "$EXCLUDE_BODY"; then
    if grep -qE '^export async function (POST|PUT|PATCH)' "$f"; then
      if ! grep -q "parseBody" "$f"; then
        fail "zod parseBody missing in mutating route: $f (add: parseBody(req, schema))"
      fi
    fi
  fi
done < <(find "$WEB/app/api" -name 'route.ts' -type f)

# ── Invariante 4: executeFlow sin signal sólo en worker ────────────────────
# Buscamos llamadas a executeFlow( fuera del worker y fuera de archivos del
# motor (flow-engine.ts define executeFlow). Cada llamada debe pasar `signal:`.
EXECUTE_FLOW_CALLERS=$(grep -rln "executeFlow(" "$WEB" --include='*.ts' \
  | grep -v ".next/standalone" \
  | grep -v "lib/flow-engine.ts" \
  | grep -v "worker/index.ts" \
  | grep -v "__tests__/" \
  | grep -v "/tests/" \
  | grep -vE "\.(test|spec)\.ts$" || true)

for f in $EXECUTE_FLOW_CALLERS; do
  # Heurística: si el archivo llama executeFlow() debe contener "signal:"
  # cerca (en el mismo archivo basta — no validamos posición exacta).
  if ! grep -q "signal:" "$f"; then
    fail "executeFlow without bounded signal in: $f (pass signal: AbortSignal or switch to enqueueFlowRun)"
  fi
done

# ── Resumen ─────────────────────────────────────────────────────────────────
echo
if [ "$VIOLATIONS" -gt 0 ]; then
  printf '\033[31m%s violation(s)\033[0m — fix above before merging.\n' "$VIOLATIONS"
  exit 1
fi
ok "all transversal invariants hold."
