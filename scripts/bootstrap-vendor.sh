#!/usr/bin/env bash
# scripts/bootstrap-vendor.sh
#
# Bootstrap the @mnemosyne/core git submodule before orchester's main
# `pnpm install` runs. This builds the submodule IN ISOLATION (its own
# pnpm install with --ignore-workspace, then `pnpm build`) so its
# `dist/` is ready by the time apps/web's `file:` dependency resolves it.
#
# Why isolation matters:
#   If we let pnpm flatten vendor/mnemosyne's deps into orchester's
#   node_modules, drizzle-orm gets resolved with EXTRA peer-dep adapters
#   active (pg, kysely, gel, opentelemetry) that orchester pulls in for
#   other reasons. Those extra peers change the overload resolution of
#   `db.update(...).returning({...})` and mnemosyne's `dts` build fails
#   with TS2554 in `review/queue.ts`. Building mnemosyne with ONLY its
#   own declared peers (postgres@^3, drizzle-orm@^0.45) makes the types
#   line up exactly as they do in the standalone mnemosyne repo.
#
# Idempotent: safe to re-run; pnpm skips work that's already done.
# Used by:
#   - .github/workflows/ci.yml (right after the submodule checkout)
#   - the root `postinstall` script for local devs
#
# When @mnemosyne/core@2.x ships on npm, delete this script and the
# vendor/ submodule.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$REPO_ROOT/vendor/mnemosyne"

if [ ! -d "$VENDOR/packages/core" ]; then
  echo "==> vendor/mnemosyne is missing or empty."
  echo "    Run: git submodule update --init --recursive"
  exit 1
fi

# Skip if the dist is already current relative to its sources. This makes
# `postinstall` cheap on every subsequent `pnpm install` in dev. CI always
# starts from a fresh clone, so this always runs there.
NEWEST_SRC="$(find "$VENDOR/packages/core/src" -type f -newer "$VENDOR/packages/core/dist/graph.js" 2>/dev/null | head -1 || true)"
if [ -f "$VENDOR/packages/core/dist/graph.js" ] && [ -z "$NEWEST_SRC" ]; then
  echo "==> vendor/mnemosyne/packages/core: dist/ is up-to-date — skipping rebuild."
  exit 0
fi

echo "==> Bootstrapping vendor/mnemosyne (isolated install + build)..."
cd "$VENDOR"

# pnpm discovers the workspace root by walking up from the cwd. Running
# from $VENDOR makes it pick mnemosyne's own pnpm-workspace.yaml first,
# NOT orchester's, so vendor/mnemosyne gets its own node_modules with
# isolated peer-dep resolution (drizzle-orm w/ only `postgres@^3`, not
# orchester's extra adapters). DO NOT pass --ignore-workspace here —
# that would skip installing the internal workspace packages' dev deps
# (tsup, etc.) and the build would fail.
pnpm install --frozen-lockfile

# Only @mnemosyne/core is consumed by orchester. Other packages
# (server, mcp, llm-providers, client-ts, examples) aren't needed.
pnpm --filter @mnemosyne/core build

echo "==> vendor/mnemosyne/packages/core built."
echo "    dist artifacts:"
ls -1 "$VENDOR/packages/core/dist"/{index,graph,graph-server}.* 2>/dev/null | sed 's/^/      /'
