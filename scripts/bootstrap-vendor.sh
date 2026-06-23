#!/usr/bin/env bash
# scripts/bootstrap-vendor.sh
#
# Build the @mnemosyne/client-ts SDK from the vendor/mnemosyne git
# submodule before orchester's main `pnpm install` runs, so that apps/web's
# `file:../../vendor/mnemosyne/packages/client-ts` dependency resolves a
# ready-to-import dist/ by the time pnpm links it.
#
# orchester talks to mnemosyne EXCLUSIVELY over HTTP through the typed SDK
# (@mnemosyne/client-ts). The in-process @mnemosyne/core engine was removed
# from orchester's runtime in Phase 3/4 of the service-extraction plan, so
# we only build the SDK here — not core or server. (Run the server itself
# with `docker compose up -d` in vendor/mnemosyne/docker.)
#
# Why build IN ISOLATION (its own `pnpm install` rooted at vendor/):
#   vendor/mnemosyne pins its own toolchain — TypeScript 6, @types/node 25,
#   tsup — that differs from orchester's (TypeScript 5.7). Installing the
#   submodule from its OWN workspace root keeps those versions out of
#   orchester's node_modules and lets the SDK build with exactly the deps it
#   declares, the same way it does in the standalone mnemosyne repo. We scope
#   the install to the client-ts subgraph so the server's native deps
#   (argon2/bcrypt) — which orchester never touches — are not installed.
#
# Idempotent: safe to re-run; skips the rebuild when dist/ is already current.
# Used by:
#   - .github/workflows/ci.yml (right after the submodule checkout)
#   - the root `prepare` script for local devs
#
# When @mnemosyne/client-ts@3.x ships on npm, delete this script and the
# vendor/ submodule, and point apps/web at a published version range.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$REPO_ROOT/vendor/mnemosyne"
PKG="$VENDOR/packages/client-ts"

if [ ! -d "$PKG" ]; then
  echo "==> vendor/mnemosyne is missing or empty."
  echo "    Run: git submodule update --init --recursive"
  exit 1
fi

# Skip if dist/ is already current relative to its sources. This makes
# `prepare`/postinstall cheap on every subsequent `pnpm install` in dev. CI
# always starts from a fresh clone, so this always runs there.
NEWEST_SRC="$(find "$PKG/src" -type f -newer "$PKG/dist/index.js" 2>/dev/null | head -1 || true)"
if [ -f "$PKG/dist/index.js" ] && [ -z "$NEWEST_SRC" ]; then
  echo "==> vendor/mnemosyne/packages/client-ts: dist/ is up-to-date — skipping rebuild."
  exit 0
fi

echo "==> Bootstrapping vendor/mnemosyne (isolated install + build @mnemosyne/client-ts)..."
cd "$VENDOR"

# pnpm discovers the workspace root by walking up from the cwd. Running from
# $VENDOR makes it pick mnemosyne's own pnpm-workspace.yaml first, NOT
# orchester's, so vendor/mnemosyne gets its own isolated node_modules. The
# `...` selector pulls in client-ts's workspace deps but stops short of the
# server's heavy/native dependency tree.
pnpm install --frozen-lockfile --filter "@mnemosyne/client-ts..."

# Build the typed HTTP SDK — the only mnemosyne package orchester consumes.
pnpm --filter @mnemosyne/client-ts build

echo "==> vendor/mnemosyne/packages/client-ts built."
echo "    dist artifacts:"
ls -1 "$PKG/dist"/index.* 2>/dev/null | sed 's/^/      /'
