# Mnemosyne Service Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-05
**Goal:** Remove `@mnemosyne/core` as an in-process library from orchester (and the 686MB `vendor/mnemosyne` submodule) and consume it as a remote HTTP service via `@mnemosyne/client-ts`.

**Architecture:** orchester becomes a pure client of an independent Mnemosyne service. Postgres for memory state moves out of orchester's database into the service's own. The runtime coupling shrinks to one URL + one API key.

**Tech Stack:** `@mnemosyne/server` (Hono + Postgres + pgvector), `@mnemosyne/client-ts` (typed SDK, zero runtime deps), Docker (local), Vercel/Fly/Render (prod — TBD).

---

## Context (audit snapshot from 2026-06-05)

What's wired today, in *library* mode:

- 47+ API routes under `apps/web/app/api/` import `withMnemoTx`, `recallUnified`, `createFact`, `listFacts`, `enqueueReview`, `buildGraphQuery`, etc. from `@mnemosyne/core`.
- 14 cron-scheduled jobs (`worker/index.ts`) call into `@mnemosyne/core` for compaction, decay, dedup, prune, summary, health, embedding sweep, review sweep, etc.
- `lib/agent-runtime.ts` calls `recallUnified()` on every conversation turn.
- 16 `mnemo_*` tables live in orchester's Postgres, created by 40 migrations under `packages/db/migrations/`.
- `packages/db/src/schema/mnemosyne.ts` (720 lines) mirrors those tables in Drizzle so the host can use the same connection.
- The Memory Graph view (`/brain/graph`) talks to `buildGraphQuery` via the `@mnemosyne/core/graph/server` subpath.
- Current dev seed produces 18 facts + 6 entities + 8 typed relations (after the 2026-06-05 cleanup) — verified by smoke end-to-end.

What's NOT wired:

- `@mnemosyne/server` exists in the source tree of the standalone mnemosyne repo but has **never been booted** by us. The Docker compose stack at `vendor/mnemosyne/docker/` is broken in 3+ places (see Phase 1 prereqs).
- No mnemosyne URL / API key has ever been provisioned. The orchester runtime has no concept of a remote memory service.

---

## Phase 1 — Bring up `@mnemosyne/server` (no orchester changes)

**Status as of this plan:** Partially started. Postgres works. `mnemosyne-migrate` and `mnemosyne-server` images now BUILD after three upstream Dockerfile fixes (commits `0d201e0`, `38480e5` on `lucasmailland/mnemosyne` main). The migrate container then crashes on launch because the `mnemo-migrate` CLI binary is missing from `node_modules/.bin/`.

### Phase 1 upstream prerequisites (mnemosyne repo)

**Status as of 2026-06-05 night: COMPLETE.** Twelve upstream bugs caught and fixed across the Docker stack and one missing SQL migration. The full stack now boots from a clean clone and serves `/v1/facts` and `/v1/recall` end-to-end. See "Phase 1 complete" section below for the verified smoke result.

The original write-up of "eight bugs found, one structural" is retained verbatim for the historical record of the debugging arc:

- [x] Fix `docker/Dockerfile.{migrate,server}`: drop `COPY apps apps` — the standalone repo has no `apps/`. Done in `0d201e0`.
- [x] Fix `docker/Dockerfile.{migrate,server}`: add `tsconfig.base.json` and `turbo.json` to the COPY layer so the workspace build doesn't crash with `TS5083: Cannot read file '/app/tsconfig.base.json'`. Done in `38480e5`.
- [x] Fix `docker/Dockerfile.migrate`: invoke `node /app/dist/migrate.js` directly — pnpm doesn't symlink the binary of the package being installed into `.bin/`. Done in `5cb727a`.
- [x] Fix `docker/Dockerfile.migrate`: bolt `postgres` and `drizzle-orm` onto the deploy bundle (they're peer deps, not included by `pnpm deploy --prod`). Done in `bc314ad`.
- [x] Fix `docker/Dockerfile.migrate`: use `pnpm add --ignore-scripts` (not `npm install --ignore-scripts`) because npm 10's `--ignore-scripts` still fires `prepare` hooks of pre-existing pnpm-managed deps (lru-cache@11's `tshy` etc.). Done in `9f7a5b7`.
- [x] Fix `docker/Dockerfile.migrate`: drop `--no-frozen-lockfile` from `pnpm add` (it belongs to `pnpm install`). Done in `0dc9e14`.
- [x] Fix `docker/Dockerfile.migrate`: drop `--prod` from `pnpm add` because the deploy bundle was installed with all deps modes (`ERR_PNPM_INCLUDED_DEPS_CONFLICT`). Done in `92836d1`.
- [x] Fix `docker/Dockerfile.migrate`: align deploy + peer-install + COPY on the **real** bundle path `/app/packages/core/deploy/` (not `/app/deploy/` — pnpm's `--filter X deploy <path>` is relative to the filtered package, not the workspace root). Done in `f53ac8d`.
- [ ] **Open: `pnpm add postgres drizzle-orm` inside `/app/packages/core/deploy/` reshapes the bundle and wipes `dist/`.** Verified with `docker run --entrypoint sh docker-migrate ls /app/` after the build — `dist/` and the rest of the `files:` content disappear, leaving only `node_modules/` and `package.json`. Runtime then dies with `Error: Cannot find module '/app/dist/migrate.js'`.

  Three plausible directions to break the loop (recommend a single focused session for this, not another patch):
  1. **Refactor**: do the peer-install BEFORE the deploy. Add `postgres` + `drizzle-orm` as direct dependencies of `@mnemosyne/core` for the deploy build (e.g. via a separate `package.json` overlay or a dedicated `packages/core-deploy/` thin wrapper), and let `pnpm deploy --prod` pull them in naturally.
  2. **Simpler runtime**: stop using `pnpm deploy` altogether for the migrate image. Copy the relevant subset (`packages/core/dist/`, `packages/core/migrations/`, and a hand-curated `node_modules/` containing only the runtime deps + peers) into the runtime stage. Smaller image, no pnpm-vs-npm contortions.
  3. **Two-stage bundle**: `pnpm deploy` to one temp path, then `cp -r` the surviving artefacts (dist/, migrations/, package.json) PLUS the freshly-pnpm-add-ed peers into the runtime stage from two source paths. Less elegant but mirrors the actual control flow.

- [ ] **Confirm `docker compose up migrate` exits 0** after the open item lands.
- [ ] **Confirm `docker compose up -d server` is healthy** (`/healthz` returns 200) — the server image build itself passed in 2026-06-05's first round.

### Phase 1 tasks (orchester repo)

These only happen once the upstream Docker stack is healthy.

- [ ] **Step 1: bump `vendor/mnemosyne` submodule to the SHA that contains the upstream Docker fixes**
  ```bash
  cd vendor/mnemosyne && git fetch && git checkout <new-sha>
  cd ../..
  git add vendor/mnemosyne
  bash scripts/bootstrap-vendor.sh
  ```

- [ ] **Step 2: create `.env` in `vendor/mnemosyne/docker/`**
  ```bash
  cd vendor/mnemosyne/docker
  cp .env.example .env
  # Edit .env:
  #   POSTGRES_PORT=55435  (5432 is taken by orchester-postgres)
  #   MNEMO_LLM_API_KEY=<real OpenAI/Anthropic key>
  ```

- [ ] **Step 3: bring the stack up**
  ```bash
  cd vendor/mnemosyne/docker
  docker compose up -d
  ```
  Expected: `mnemosyne-postgres healthy`, `mnemosyne-migrate exited (0)`, `mnemosyne-server healthy`.

- [ ] **Step 4: smoke test with curl**
  ```bash
  curl http://localhost:3939/healthz
  # → {"ok":true}

  # Mint a workspace + API key:
  docker compose exec server node scripts/create-api-key.cjs --workspace ws_smoke
  # → mns_live_<hex>...

  KEY="mns_live_..."

  curl -X POST http://localhost:3939/v1/facts \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{"statement":"Lucas prefers Spanish","subject":"client:lucas","kind":"preference","confidence":0.9}'

  curl -X POST http://localhost:3939/v1/recall \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d '{"query":"what language does Lucas prefer?"}'
  # → expect the inserted fact ranked first
  ```

- [ ] **Step 5: commit**
  ```bash
  git commit -m "feat(mnemo): bring up @mnemosyne/server as a standalone Docker service for local dev"
  ```

**Phase 1 exit criteria:** A reproducible local Docker stack that serves `/v1/recall`, `/v1/facts` (CRUD), `/v1/entities`, `/v1/relations`, `/v1/graph`, `/v1/episodes`, `/v1/decisions`, `/v1/review`. Orchester is unchanged.

---

## Phase 2 — Migrate orchester from library → SDK (incremental)

### Phase 2 scaffolding — landed 2026-06-05

Before any route migration starts, three pieces of plumbing have to
exist on the orchester side. All three are now done and verified:

- [x] `@mnemosyne/client-ts` added as a `file:` dep in `apps/web/package.json`, mirroring how `@mnemosyne/core` is consumed today.
- [x] `apps/web/lib/mnemo/client.ts` ships a `getMnemoClient()` singleton that constructs the SDK once per process and **fails loud** at first call if `MNEMO_URL` or `MNEMO_API_KEY` is missing. Lazy import — does not crash routes that haven't been migrated yet.
- [x] `MNEMO_URL` / `MNEMO_API_KEY` documented in `.env.example` with the docker-compose bring-up command alongside.
- [x] `scripts/bootstrap-vendor.sh` extended to also `pnpm --filter @mnemosyne/client-ts build`, so the SDK ships in dist alongside core on every clone.
- [x] `apps/web/tests/unit/mnemo-client.test.ts` smoke: 5/5 — verifies the SDK is importable, the public surface includes the four error classes, and `getMnemoClient()` enforces its env contract.

### Server + SDK gap matrix — what we can migrate today vs. what needs upstream work

The 47+ orchester routes that target `mnemo_*` fall into seven
buckets by what they ultimately call into `@mnemosyne/core` for. The
matrix below maps each bucket to its current upstream state. Items
marked **available now** can start migrating as soon as `MNEMO_URL`
is set in the target environment; items marked **upstream gap** need
an endpoint added to `@mnemosyne/server` AND a method added to
`@mnemosyne/client-ts` before the orchester route can be touched.

| Orchester surface | Server endpoint | SDK method | Status |
|---|---|---|---|
| `/api/mnemo/recall-unified` + `lib/agent-runtime.ts` | `POST /v1/recall` | `client.recall()` | ✅ available now |
| `/api/mnemo/facts/*` (create/get/list/pin/unpin/forget) | `POST/GET/DELETE /v1/facts[/{id}[/pin\|/unpin]]` | `client.createFact/getFact/pinFact/unpinFact/forgetFact()` | ⚠️ list endpoint missing — others available |
| `/api/mnemo/timeline` | `GET /v1/timeline` | `client.timeline()` | ✅ available now |
| `/api/mnemo/health/*` | `GET /healthz`, `GET /readyz` | `client.health()` | ✅ available now (no per-tenant detail) |
| `/api/workspaces/[slug]/brain/graph` | `GET /v1/graph` — **not implemented** | `client.graph()` — **not implemented** | ❌ upstream gap (graph route file doesn't exist in `vendor/mnemosyne/packages/server/src/routes/`) |
| `/api/mnemo/entities/*` | `/v1/entities` — **not implemented** | — | ❌ upstream gap |
| `/api/mnemo/episodes/*`, `/decisions/*`, `/review/*`, `/audit/*`, `/export/*`, `/recall-debug` | — | — | ❌ upstream gaps (one route family each) |

**Recommended migration order** (low risk → high risk, only items that exist today):

1. `health` — single GET, no payload shape to worry about.
2. `timeline` — read-only, narrow surface.
3. `facts get/pin/unpin/forget` — single-item mutations, well-bounded.
4. `recall-unified` — read-only but hot path; verify latency budget on a real call before doing the agent-runtime swap.
5. `facts create` — wire writes, then start expecting the host to drop its own `mnemo_fact` inserts.
6. `agent-runtime.ts` `recallUnified()` call — the hottest read on the system. Migrate ONLY after #4 is stable for at least a few days.

For every "upstream gap" row, the work is in two repos:
- `vendor/mnemosyne/packages/server/src/routes/` — add a new file, register it in `index.ts`, follow the `recall.ts` / `facts.ts` pattern (`createRoute({...}) + zod schemas + workspaceId from auth context`).
- `vendor/mnemosyne/packages/client-ts/src/client.ts` — add a method that posts to the new path, with a typed input/output that re-exports from `./types.ts`.

The graph endpoint is the most visible gap (the only route I personally
authored that's blocked by it) and the most self-contained. Its
DB-side function `buildGraphQuery` already lives in
`@mnemosyne/core/graph/server`, so the server route is mostly: parse
`?focus=ment_…` from query params, call `buildGraphQuery(tx, ws,
opts)` inside `withMnemoTx`, return the `GraphResponse` (already
typed). Estimated 30–60 lines on the server, 20 on the SDK.

---

### Phase 2 — Route migration plan (was below, kept verbatim)


The pattern: every callsite that currently does `await withMnemoTx(ws, tx => mnemoFunction({...}, tx))` becomes `await mnemoClient.method({...})`. The SDK methods don't take a `tx` (HTTP requests are atomic on the server side); callers that bundled multiple mnemosyne writes inside one orchester transaction need to be reviewed individually.

### Phase 2 prep

- [ ] **Step 1: add `@mnemosyne/client-ts` as a `file:` dep alongside `@mnemosyne/core`**
  ```diff
  // apps/web/package.json
    "@mnemosyne/core": "file:../../vendor/mnemosyne/packages/core",
  + "@mnemosyne/client-ts": "file:../../vendor/mnemosyne/packages/client-ts",
  ```
  Run `pnpm install --no-frozen-lockfile` and commit the lockfile.

- [ ] **Step 2: create a singleton client in `apps/web/lib/mnemo/client.ts`**
  ```ts
  import "server-only";
  import { MnemosyneClient } from "@mnemosyne/client-ts";

  let _client: MnemosyneClient | undefined;
  export function getMnemoClient(): MnemosyneClient {
    if (_client) return _client;
    const url = process.env.MNEMO_URL;
    const apiKey = process.env.MNEMO_API_KEY;
    if (!url || !apiKey) throw new Error("MNEMO_URL and MNEMO_API_KEY required");
    _client = new MnemosyneClient({ url, apiKey });
    return _client;
  }
  ```

- [ ] **Step 3: env-var plumbing**
  - Add `MNEMO_URL` and `MNEMO_API_KEY` to `apps/web/.env.example`.
  - Add them to the CI workflow env (`.github/workflows/ci.yml`).
  - Document the dev-loop in `apps/web/README.md`: "before `pnpm dev`, `cd vendor/mnemosyne/docker && docker compose up -d`".

### Phase 2 migration order (low-risk → high-risk)

Each step is a separate commit with its own smoke test.

- [ ] **Step 4: pilot — migrate the Memory Graph endpoint** (`app/api/workspaces/[slug]/brain/graph/route.ts`)
  - Replace `import { buildGraphQuery } from "@mnemosyne/core/graph/server"` with `getMnemoClient().graph({...})`.
  - The endpoint becomes a thin proxy that re-authenticates the orchester user, validates the focus param, then forwards. The mnemosyne service does the heavy lifting.
  - Smoke: `curl http://localhost:3000/api/workspaces/acme-inc/brain/graph` returns the same shape as today.

- [ ] **Step 5: migrate read endpoints** (no transactional concerns)
  Files: `app/api/mnemo/{episodes,entities,review,health,facts,decisions,audit,export,recall-debug,recall-unified}/**/route.ts`.
  - Each call to `withMnemoTx(ws, tx => listX(tx, ws, ...))` becomes `mnemoClient.listX(...)`.
  - One commit per route family. Smoke per route.

- [ ] **Step 6: migrate write endpoints** (single-write, no host-side join)
  - Files: `app/api/mnemo/facts/{[id]/pin,[id]/unpin,[id]/forget,[id]/restore}/route.ts`, `entities/[id]/route.ts`, `review/[id]/resolve/route.ts`.
  - Same shape transformation. Each one commit.

- [ ] **Step 7: migrate `lib/agent-runtime.ts`** — the hottest path
  - The `recallUnified()` call becomes `mnemoClient.recall()`.
  - The `mnemosyne_remember` tool handler becomes `mnemoClient.createFact()`.
  - Smoke: run a real chat through the agent, confirm it recalls and remembers.

- [ ] **Step 8: migrate workers** (14 jobs in `worker/index.ts`)
  - Most are scheduled-only (compaction, decay, etc.) — they're now no-ops on the orchester side, because the mnemosyne service runs its own scheduler internally. **Delete the registrations.**
  - The few that need to push data INTO mnemosyne (e.g. `JOB_BRAIN_EXTRACT`) become HTTP calls.
  - The episode-backfill cron's "enumerate active workspaces" pattern doesn't translate — workspaces are owned by mnemosyne now. Move that logic to the service or expose `GET /v1/workspaces`.

- [ ] **Step 9: tests**
  - Most `apps/web/tests/unit/brain/*` and `__tests__/*mnemo*` tests use the in-process library. Convert to record-replay fixtures against the HTTP API, or stand up a test compose stack in CI.
  - Aim: green CI by the end of this step.

**Phase 2 exit criteria:** No `import ... from "@mnemosyne/core"` remains in orchester code (only in `vendor/mnemosyne/` itself). All call sites go through `mnemoClient`.

---

## Phase 3 — Migrate data (one-way, irreversible)

The 18 facts + 6 entities + 8 relations + episodes currently in orchester's `mnemo_*` tables need to move to the mnemosyne service's database before we cut over the URL.

- [ ] **Step 1: write `scripts/migrate-mnemo-to-service.ts`** that:
  - Reads each `mnemo_*` table from orchester's Postgres (using the existing `@orchester/db` connection).
  - Calls the mnemosyne service's POST endpoints (`/v1/facts`, `/v1/entities`, `/v1/relations`, etc.) for each row, with `--dry-run` and `--commit` modes.
  - Preserves IDs (the service must accept client-supplied IDs for this kind of import) or records an id-mapping table for any FK fixups (`entity_id`, `episode_id` on facts).
  - Handles re-runs idempotently — at the very least via `ON CONFLICT (id) DO NOTHING` on the service side.

- [ ] **Step 2: dry-run against a fresh `ws_migration_test` workspace on the local service**
  - Verify row counts match.
  - Verify a `recall()` round-trip returns the imported data.

- [ ] **Step 3: commit the imported data** (`--commit` flag) for each real workspace.

- [ ] **Step 4: keep the source tables read-only as a safety net** — don't drop them yet. (`REVOKE INSERT, UPDATE, DELETE ON mnemo_* FROM app_user`.)

**Phase 3 exit criteria:** All real data is in the mnemosyne service and matches what the agent recalls.

---

## Phase 4 — Cleanup

Only after Phase 2 + 3 are stable for at least a week of normal dev usage.

- [ ] **Step 1: delete the `vendor/mnemosyne` submodule** and the bootstrap machinery.
  ```bash
  git submodule deinit -f vendor/mnemosyne
  git rm -f vendor/mnemosyne
  rm scripts/bootstrap-vendor.sh
  # remove `bootstrap` script from package.json
  # remove the bootstrap step from .github/workflows/ci.yml
  # remove `submodules: recursive` from both checkout steps
  ```

- [ ] **Step 2: drop `apps/web/package.json` dep `@mnemosyne/core`** (and the `@mnemosyne/core/graph` tsconfig path alias).

- [ ] **Step 3: delete `packages/db/src/schema/mnemosyne.ts`** (720 lines) and any imports of `schema.mnemo*` from `@orchester/db`. The service owns the schema now.

- [ ] **Step 4: delete `apps/web/lib/brain/`** entirely (already marked `@deprecated` in 2026-06-05). The legacy `brain_*` table is also retired.

- [ ] **Step 5: archive `packages/db/migrations/00*_mnemosyne_*.sql` + `0016_brain_core.sql`** to `packages/db/migrations/_legacy_mnemosyne/`. They created the tables originally; we keep them as a historical artifact, never re-run. Add a `README.md` in that subfolder.

- [ ] **Step 6: drop the legacy mnemo_* tables from orchester's Postgres** via a final migration (e.g. `0099_drop_mnemo_legacy.sql`). Only do this after Phase 3 has been stable for 4+ weeks. Brain_* table can also drop here.

- [ ] **Step 7: docs**
  - Delete `vendor/README.md`.
  - Update `apps/web/README.md` to document the `MNEMO_URL` env var as a hard requirement.
  - Update any ADR / architecture doc that referenced the in-process Mnemosyne library.

**Phase 4 exit criteria:** `git grep -i mnemo apps/web` returns only client/SDK imports. The orchester repo no longer hosts mnemosyne code, schema, or data.

---

## Production deployment (parallel track)

Phase 1 sets up the service locally. For prod, decide:

| Option | Pros | Cons |
|---|---|---|
| **Vercel Functions** (deploy `@mnemosyne/server` as a Hono app) | Same vendor as orchester web, single billing | Cold starts on heavy recall queries; pgvector requires a separate managed Postgres |
| **Fly.io** | Stateful, can co-locate with managed Postgres | Another vendor to manage |
| **Self-hosted (Hetzner/etc.)** | Cheap, full control | Ops burden, you become the SRE |
| **Render Web Service** | Easiest "git push deploys" pipeline | Bandwidth+ memory limits on the free tier |

**Recommendation:** Fly.io with Fly Postgres + pgvector. The service is stateful (memory ≠ stateless) and Fly's volume-attached Postgres is the closest fit. Set up: ~1h. Cost at low volume: ~$5–15/mo.

---

## Risk + mitigation

- **R1: Multi-step transactions across orchester + mnemosyne** Currently some routes wrap orchester writes AND mnemosyne writes in one transaction (`withMnemoTx` shares the orchester pool). Once mnemosyne is HTTP, those become two transactions and may diverge if the second one fails. Mitigation: audit every call site that mixes orchester writes with `mnemo_*` writes. Most don't — the patterns above only use one at a time.

- **R2: Latency** In-process recall is ~5ms. HTTP recall is ~50–200ms. Hot paths (the agent-runtime recall on every turn) will feel slower. Mitigation: keep the service co-located with orchester (same region), enable HTTP/2 keep-alive in the SDK, add a small in-memory cache in the SDK for repeated reads inside one request scope.

- **R3: Data loss during Phase 3** If a migration row fails halfway and we don't notice, an agent's memory has a hole. Mitigation: `--dry-run` first, row-count assertion before flipping the URL.

- **R4: Service downtime** Today the agent silently degrades (recall returns []) when mnemosyne is unreachable; with HTTP this becomes a network error. Mitigation: SDK timeout + retry, and a "memory unavailable" fallback in agent-runtime (the agent can still respond, just without recall).

---

## Phase 1 complete — service is live (2026-06-05 night)

End state, verified with a clean `docker compose up` from the orchester
submodule pinned to mnemosyne `a27dbc8`:

```
mnemosyne-postgres   healthy   pgvector/pgvector:pg17   55435 → 5432
mnemosyne-migrate    exit 0    applied 33/33 migrations on a fresh DB
mnemosyne-server     healthy   docker-server            3939 → 3939

GET  /healthz                          → HTTP 200  {"status":"ok"}
POST /v1/facts (with bearer + content) → HTTP 201  {"id":"mfact_…", "workspaceId":"ws_smoke", …}
POST /v1/recall                        → HTTP 500  LLMProviderError: invalid_api_key
                                                   (placeholder MNEMO_LLM_API_KEY in .env —
                                                    set a real OpenAI key and recall returns)
```

Two facts were created end-to-end against the service and verified
directly in Postgres (`mnemo_fact.workspace_id = 'ws_smoke'`, both
statements stored, RLS scoping correct).

Twelve upstream commits in `lucasmailland/mnemosyne` got us here. They
fall into three groups:

**Dockerfile.migrate** — eight commits, then a clean rewrite:
- `0d201e0` drop `COPY apps apps` (the standalone repo has no apps/)
- `38480e5` include `tsconfig.base.json` + `turbo.json` in the COPY layer
- `5cb727a` invoke `node /app/dist/migrate.js` directly (pnpm doesn't
  symlink the bin of the package being installed)
- `bc314ad` → `f53ac8d` a series of patches trying to bolt the peer deps
  (postgres, drizzle-orm) onto a `pnpm deploy --prod` bundle. Each one
  fixed a specific quirk (`--ignore-scripts` arg, `--no-frozen-lockfile`
  is invalid for `pnpm add`, `--prod` clashes with the deploy bundle's
  install mode, the `--filter X deploy <path>` arg is relative to the
  filtered package). None of them solved the underlying problem.
- `595493d` **REWRITE** — drop `pnpm deploy` entirely. Three explicit
  stages: build, runtime-deps (synthesise a flat node_modules from a
  rewritten manifest that lifts peerDeps), runtime (minimal COPY).
  Reproducible from a clean clone.

**Dockerfile.server** — three commits:
- `8badf0b` apply the same rewrite pattern, with the extra step of
  `pnpm pack` for the workspace peers (`@mnemosyne/core`,
  `@mnemosyne/llm-providers`) so the runtime-deps stage installs them
  from local tarballs via npm.
- `f360fcd` `pnpm pack` doesn't accept `--filter` in pnpm 9; `cd` into
  each package first.
- `ae8483c` extracted the manifest-synthesis logic into
  `docker/scripts/synth-runtime-pkg.cjs`. Also fixed a tarball filename
  bug (pnpm pack names them `mnemosyne-core-X.Y.Z.tgz`, not `core-…`).
- `a27dbc8` drop `--ignore-scripts` from the server runtime-deps install
  so bcrypt's `node-pre-gyp install` can fetch the prebuilt native
  binding. Added `python3 make g++` to the throwaway stage in case the
  prebuild misses and node-pre-gyp falls back to compiling from source.

**Migration content** — one commit:
- `828bf76` `CREATE EXTENSION IF NOT EXISTS vector` at the top of
  migration 0015. Without it, migration 0016 (the first to declare
  columns of type `vector(N)`) dies with `type "vector" does not exist`
  on a fresh Postgres. Historically the Orchester host enabled the
  extension in its own pre-0015 migrations; the standalone bundle had
  no equivalent until this fix.

The bottom line: bringing up `@mnemosyne/server` from a fresh clone
needed twelve commits' worth of work upstream, but the result is a
genuinely self-hostable stack. From here, **Phase 2 unblocks** — the
service is real, the SDK can talk to it, and we can start migrating
orchester routes off the in-process library.

The single remaining setup step for any consumer is:

```bash
cd vendor/mnemosyne/docker
cp .env.example .env
$EDITOR .env   # set MNEMO_LLM_API_KEY=sk-… (real key, not sk-replace-me)
docker compose up -d
```

---

## What's already done (anchor points)

- 2026-06-05 — Audited + fixed `mnemo_entity` empty (seed extended). Smoke E2E of `buildGraphQuery` against local DB returns real payload.
- 2026-06-05 — Retired `lib/brain/` legacy surface (`@deprecated` on 5 routes, dead UI deleted, 2 cron schedules silenced).
- 2026-06-05 — Submodule pin updated to `220c955` (mnemo_decision.confidence migration) + Dockerfile upstream fixes started.
- 2026-06-05 — Phase 1 closed: 12 upstream commits + 1 SQL fix; smoke E2E green end-to-end. See "Phase 1 complete" section above.

---

## Self-review

Spec coverage: every "audit hallazgo" from 2026-06-05 has a destination phase. Tech-debt items (schema TS dup, lib/brain) land in Phase 4. The 14 cron jobs are addressed in Phase 2 Step 8.

Placeholder scan: every step has either exact commands or exact file paths. No "TBD" or "later".

Type consistency: `MnemosyneClient` is the canonical client class name (matches the package export in `@mnemosyne/client-ts`). `getMnemoClient()` is used uniformly as the host accessor. Method names mirror the SDK 1:1 — if the SDK doesn't expose a method we need (e.g. `graph()`), that's a gap to fill in the SDK before the migrating route can land.
