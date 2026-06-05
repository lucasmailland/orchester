# vendor/

External code consumed by orchester but maintained outside this repo.
Each subdirectory is a **git submodule** pinned to a specific commit.

## What's here

| Path         | Upstream                                                                | Why submoduled                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mnemosyne/` | [`lucasmailland/mnemosyne`](https://github.com/lucasmailland/mnemosyne) | `@mnemosyne/core@2.x` is the new home of the Mnemosyne memory engine. It used to live inside this monorepo as `packages/mnemosyne`; it was extracted in PR #24 to become a standalone open-source package. Until it ships to npm, orchester consumes it via this submodule. `apps/web/package.json` depends on it with `"@mnemosyne/core": "file:../../vendor/mnemosyne/packages/core"`. |

## How it builds

`scripts/bootstrap-vendor.sh` runs `pnpm install` and `pnpm --filter @mnemosyne/core build` **inside** `vendor/mnemosyne/` — i.e. as part of mnemosyne's own pnpm workspace, NOT orchester's.

That isolation matters: when mnemosyne's deps get hoisted alongside orchester's, `drizzle-orm` resolves with extra peer adapters (`pg`, `kysely`, `gel`, `opentelemetry`) that orchester pulls in for unrelated reasons. The extra peers change the overload resolution of `db.update(...).returning({...})` and mnemosyne's `dts` build fails with `TS2554` in `review/queue.ts`. Running install from inside the submodule keeps drizzle-orm resolved to `drizzle-orm@0.45.2_postgres@3.4.9` — the same way mnemosyne builds standalone.

The bootstrap is wired into both the root `prepare` script (local devs) and the CI workflow (`.github/workflows/ci.yml`), and it short-circuits when `dist/graph.js` is already current relative to `src/`.

## Updating the pinned commit

```bash
cd vendor/mnemosyne
git fetch && git checkout <new-sha>
cd ../..
git add vendor/mnemosyne
bash scripts/bootstrap-vendor.sh
pnpm install               # picks up the new file: dist
git commit -m "chore(vendor): bump mnemosyne to <new-sha>"
```

## Removing the submodule (after npm publish)

When `@mnemosyne/core@2.x` is on npm:

1. Bump `apps/web/package.json`: replace `"file:../../vendor/mnemosyne/packages/core"` with `"^2.x.y"`.
2. Run `pnpm install`.
3. `git submodule deinit -f vendor/mnemosyne && git rm -f vendor/mnemosyne`.
4. Remove `scripts/bootstrap-vendor.sh`, the `bootstrap` script from `package.json`, and the bootstrap step from `.github/workflows/ci.yml`.
5. Drop the `submodules: recursive` from both checkout steps.
6. Delete this README.
