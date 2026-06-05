# Changelog

All notable changes to **@orchester/mnemosyne** are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

---

## [1.6.0] — 2026-06-04

The "ready for external integration" release. Three milestones land together: the package becomes npm-publishable, the storage layer gets an abstract adapter contract so consumers don't have to bring Drizzle, and the bundled migrations gain a first-class CLI runner.

### Added

- **`MnemoStorage` adapter interface** (`storage/types.ts`). The first formal contract that lets a downstream product back Mnemosyne with anything that satisfies the interface — `vectorSearch`, `ftsSearch`, `getFactsByIds`. Capability flags (`vectorSearch`, `ftsSearch`, `bitemporal`, `graphExpansion`) let adapters advertise what they can and can't do; the client honors them silently instead of throwing. `MnemoCapabilityError` is exported for adapter authors who need to fail loud on unsupported call paths.

- **`createDrizzleStorage(tx)`** (`storage/drizzle.ts`) — the default reference implementation. Wraps a Drizzle pg transaction and implements the three v1.6 methods against the existing `mnemo_fact` schema (with pgvector cosine + Postgres FTS `ts_rank_cd`). Internal Orchester code continues to use the legacy direct exports (`withMnemoTx`, `searchMnemo`); the adapter is the path for external consumers.

- **`createMnemoClient({ storage })`** (`storage/client.ts`) — high-level façade with one stable v1.6 method: `recall({ workspaceId, query, vector, topK, asOf, vectorWeight })`. Dispatches both retrieval paths in parallel, normalises distances to a `[0, 1]` similarity, blends with a configurable weight, dedupes by fact id, and returns the top-K with `reasons` carrying which paths surfaced each hit. Re-normalises weights when an adapter doesn't implement one of the two backends so picking `vectorWeight=0.6` against a vector-only adapter yields a sensible result instead of silent down-weighting.

- **`mnemo-migrate` CLI** (`bin/mnemo-migrate`, sourced from `src/cli/migrate.ts`). External consumers install the package and run `DATABASE_URL=… npx mnemo-migrate` against their Postgres. Bundled migrations live under `migrations/` and ship via `package.json#files`. The CLI tracks applied migrations in `mnemo_migration_history`, runs each migration in its own transaction (rollback on throw, halt-on-first-error), and surfaces `--dry-run` and `--target <prefix>` for staged rollouts. Hostile-friendly: a missing `pgvector` extension or insufficient privileges produce a one-line error + a hint.

- **npm-publishable build pipeline** (`tsup.config.ts`). Dual ESM (`*.mjs`) and CJS (`*.js`) outputs with type declarations (`.d.ts` / `.d.cts`). Three entry points — `index`, `protocol`, `migrate` — so consumers can tree-shake per subpath. Peer deps (`drizzle-orm`, `postgres`, etc.) are externalised; the consumer's lockfile owns versions. `prepublishOnly` runs a clean build before any `pnpm publish`.

- **Professional README** (`README.md`). Architectural intro, primitives table, 60-second tour, five non-obvious design decisions (bitemporal, trust ladder, RLS+FORCE, provider-agnostic + degradation modes, async maintenance), the stable public API table, three integration paths (TS import / MCP / HTTP), and an honest "what we don't do yet" list.

- **`LICENSE`** mirror inside the package — Apache-2.0 — so the npm tarball ships the license alongside the code.

### Changed

- **`package.json`**: bumped to 1.6.0; switched to public (`"private": false`), added `bin`, `exports` map (with `types`, `import`, `require` conditions), `files`, `engines.node >= 20`, `publishConfig.access = public`. Moved `drizzle-orm` and `postgres` to `peerDependencies` (consumers bring their own).

- **`tsconfig.json`**: added `"types": ["node"]` so the CLI bin compiles with `node:` imports + `process`. `@types/node` is a devDependency.

### Documentation

- Stable public API surface published in `README.md`. Adapter authors implementing a new backend now have a contract to write against without reading the Drizzle source.

### What's NOT in this release (roadmap for 2.0)

- **Full adapter coverage** — write paths (`createFact`, `saveFactWithCandidates`), maintenance (`prune`, `dedup`, `consolidate`), bitemporal queries, review queue. v1.6 covers the read side end-to-end. Adding more methods is non-breaking; the interface tightens at v2.0 with a deprecation cycle.
- **Reference adapters for `pg` (no ORM) and Prisma.** Wanted; not blocking the release.
- **In-memory mock adapter** for unit tests in consumer projects.
- **Cron parser inside the warm-up gate** — currently the CLI is fire-and-forget; the cron-schedule overrides for housekeeping live in Orchester (`apps/web/lib/mnemo/cron-policy.ts`) and will move into this package in v2.0.

---

## [1.5.0] — 2026-05-22

> Pre-extraction release. See the Orchester `CHANGELOG.md` for the full v1.0 → v1.5 history; the package only became standalone-shipped in 1.6.

- Entity primitive (`mnemo_entity`).
- Per-user actor isolation via `mnemo_fact.actor_id` + RLS restrictive policy (migration 0040).
- Premium embedding tier (`resolveEmbeddingTier`).
- HNSW `halfvec(1536)` quantization (migration 0042).
- L3 query cache.
- Agent runtime v1.5 with HyDE + rerank + graph expansion.

---

[1.6.0]: https://github.com/lucasmailland/orchester/releases/tag/mnemosyne-v1.6.0
[1.5.0]: https://github.com/lucasmailland/orchester/releases/tag/mnemosyne-v1.5
