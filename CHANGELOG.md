# Changelog

All notable changes to Orchester are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). Until **v1.0.0**, breaking changes may land in minor versions; we note them explicitly.

Releases are produced by [release-please](https://github.com/googleapis/release-please) from Conventional Commit messages on `main`.

## [Unreleased]

> **Draft for v1.0.0 — release-please will promote this block when the
> release commit lands.** Edits welcome; nothing here ships until the
> v1.0.0 tag.

This release is the v1.0 milestone — multi-tenant correctness hardened
end-to-end, the **Mnemosyne** cognitive memory layer reaches v1.6, and
the GDPR data-portability pipeline is rebuilt to stream instead of
buffer. The platform is ready for production self-host and managed
cloud at this point. See [`docs/specs/plans/2026-05-26-v1.0-ga-plan.md`](docs/specs/plans/2026-05-26-v1.0-ga-plan.md)
for the work plan that produced this release.

### Added

#### Mnemosyne — cognitive memory v1.5 → v1.6

- **Entity primitive** (the 4th cognitive primitive alongside fact, decision, episode). Canonical "things" — people, organizations, projects, concepts, places — with aliases, kinds, mention counts, and a `canonical_id` self-reference for merge. Heuristic + LLM extraction populates `mnemo_fact.entity_id` in the same write path. CRUD + `findOrCreate` + linked-facts endpoint at `/api/mnemo/entities`.
- **Per-user actor isolation** (`mnemo_fact.actor_id`). Opt-in RLS layer: when `app.enforce_actor_isolation='true'` and `app.actor_id` is set, the policy restricts SELECT to NULL-actor (workspace-shared) or own-actor rows. NULL by default — non-breaking back-compat. `withMnemoTx` accepts an optional `actorId` and `enforceActorIsolation` flag.
- **TimeTravelPicker** — bitemporal `asOf` UI in the Memory Inspector lets operators replay the memory state at any past moment.
- **Premium embedding tier** — `resolveEmbeddingTier` routes pinned / high-confidence / workspace-flagged facts to the upgraded model; settings UI exposes the selector. Workers batch by tier (one API call per tier per workspace).
- **HNSW `halfvec` quantization** on `mnemo_fact.embedding` — 2× storage reduction with no measurable recall loss.
- **L3 query cache** — write-through cache with 0.95 cosine lookup and 5-minute TTL on the search hot path.
- **Agent runtime v1.5** — wires HyDE, rerank, and graph expansion into the recall pipeline; defaults flipped to ON with kill-switches.
- **Memory Inspector** — review-queue counts, deep-linked fact citations to source conversations, and `mnemo.disable_*` kill-switches for every recall stage.
- **Memory operations panel** with manual cron triggers for compaction, prune, embed, and consolidate.
- **Sensitivity toggle** embedded in conversation detail with server persistence.
- **Mnemosyne protocol v1.2** — entity awareness + per-user privacy tagging.

#### UX

- **Account dropdown** in the global shell + Conversations page polish (HeroUI Select replaces native selects).
- **Recall quality** section in settings exposing the premium embedding model selector.

#### GDPR

- **Secret scrubber** (`lib/gdpr/redact.ts`) — recursive non-mutating walker covering 15 known credential prefixes (OpenAI `sk-`, Anthropic `sk-ant-`, Stripe `sk_live_`, Google `AIza`, Slack `xoxb`, Notion `ntn_`, GitHub `ghp_`, Orchester `ok_live_`, etc.) plus 17 key-name matches (`apiKey`, `secret`, `password`, `authorization`, `bearer`, …). Wired into the messages, agents, knowledge, and brain exporters so JSONB columns with unstructured user content cannot leak embedded credentials.
- **True streaming pipeline** — `archiver` pipes straight into the storage adapter. S3 via `@aws-sdk/lib-storage` multipart `Upload` (auto-aborts on source error); filesystem via `pipeline(stream, createWriteStream)` with unlink-on-error cleanup. Peak memory now bounded by `archiver`'s deflate buffer + one multipart part instead of the full archive — multi-GB tenant exports no longer OOM the worker.

#### Testing

- **Tenant isolation matrix suite** (`apps/web/tests/isolation/`):
  - `db-scan.spec.ts` — cross-tenant SELECT isolation across 21 host Pattern A tables.
  - `writes-cross-tenant.spec.ts` — INSERT-with-foreign-workspace rejection + foreign-row UPDATE/DELETE returning 0 rows on 6 representative tables.
  - `mnemo-tenant.spec.ts` — same matrix across all 5 Mnemosyne primitives + 4-cell verification of the per-actor RESTRICTIVE policy.
  - `routes-static-audit.spec.ts` — pure-text walker over `apps/web/app/api/` (130 routes, ~20ms) that fails CI when a new route forgets to use a tenant helper.
  - `injection-probes.spec.ts` — SQL-injection payloads stored literally, no GUC bypass.

### Changed

- **LLM tool loop transactional tx propagation** — `runConversationalTurn` now threads a single workspace-scoped `tx` through `llmCall`, `executeTool`, and `getRelevantMemories`. The legacy path opened nested connections that fell back to the BYPASSRLS connection role for provider-key reads, defeating tenant isolation in flight. `getProviderKey` accepts an optional `tx` and opens its own short workspace-scoped tx when the caller can't provide one.
- **Flow-engine inline branch tx** now downgrades to `app_user` (`SET LOCAL ROLE app_user`) so FORCE RLS actually applies — flow-engine writes used to run as the BYPASSRLS connection role, making FORCE a no-op on the entire flow runtime path.
- **Brain extract-job** populates `entity_id` and stamps `protocol_version='v1.2'` on every fact.
- **i18n** — final closeout across landing, legal, billing, invite email, integrations catalog, ConnectProviderModal, MCP JSON-RPC errors, and shared UI surfaces. `brain.*` and `settings.*` keys added across `en`, `es`, `pt-BR`.

### Fixed

- **Hydration bugs** — UserMenu Dropdown trigger className diff, RecallQualitySection Premium Select, settings nav `aria-current` hash-based active state, Brain Inspector FactFilters Select2 React Aria IDs, TeamCard initials slicing emoji surrogate pairs, Conversations HeroUI Select.
- **`parseBody`** — empty body now treated as `{}` so empty-schema routes (pin/unpin/forget/restore) work instead of 400-ing.
- **`GeneralSection.Save`** — was sending `workspace.id` where the API expected `workspace.slug`.
- **Notifications Toggle** — knob no longer escapes the track on certain viewport widths.
- **`pg-boss createQueue`** — boot-time deadlock window closed via pre-create + retry-on-deadlock; queue init is idempotent.
- **MCP error strings** translated — JSON-RPC error envelopes no longer leak Spanish to non-Spanish clients.
- **Seed** — stopped seeding fake-ready KB docs (status='ready' with NULL embedding); a backfill helper now re-embeds the existing rows.

### Security

- **GDPR exports cannot leak credentials**. Even if a tool response or chat message embedded a real API key, the scrubber replaces it with `<REDACTED>` before the archive lands.
- **FORCE RLS in the flow-engine + LLM tool loop**. Both paths previously ran as the BYPASSRLS connection role; the role downgrade closes the only remaining surface where FORCE was bypassed.
- **Tenant isolation matrix in CI** — `tests/isolation/` proves cross-tenant SELECT/INSERT/UPDATE/DELETE isolation on every Pattern A table on every PR.
- **Route static audit** — fails CI when a new API route forgets to use a tenant helper.
- **Per-actor isolation policy** (migration 0040) ships as a restrictive RLS layer that AND's with the workspace policy, gated by an opt-in GUC. No breakage for existing callers; available immediately to per-user agents.

### Documentation

- **v1.0 GA work plan** at `docs/specs/plans/2026-05-26-v1.0-ga-plan.md`.
- **Mnemosyne v1.6 final audit** + ADR-0020 amendment + v2.0 roadmap (`docs/specs/§43–§45`).
- **CONTRIBUTING.md** cross-references SECURITY.md and adds `lib/tenant/` + `lib/gdpr/` + `packages/db/migrations/` to the CODEOWNERS-protected security-sensitive areas list.

### Migrations

This release ships **25 schema migrations** beyond v0.1.0 (last shipped
migration: `0014`). The big arc is the **Brain Core → Mnemosyne**
evolution: `mnemo_fact`, `mnemo_decision`, `mnemo_relation`,
`mnemo_citation`, `mnemo_summary`, `mnemo_fact_archive`,
`mnemo_health`, `mnemo_review_queue`, `mnemo_episode`,
`mnemo_attribution`, `mnemo_agent_memory_policy`, `mnemo_entity`,
plus their indexes, RLS policies, and the bitemporal GIST exclusion
constraint. Apply in order with `pnpm --filter @orchester/db migrate`:

- `0015` — idempotency PK scoped to workspace.
- `0016` — Brain Core (initial fact table + extraction job).
- `0017` — Mnemosyne rename: `brain_fact` → `mnemo_fact`.
- `0018` — `mnemo_decision` primitive.
- `0020` — `mnemo_relation` (typed memory→memory edges).
- `0021` — `mnemo_citation` (memory→source attribution).
- `0022` — `mnemo_query_cache` (L3 search cache).
- `0024` — Brain → Mnemo data backfill.
- `0025` — extraction skip state.
- `0026` — bitemporal GIST exclusion (no valid-time overlap).
- `0027` — provider health rollup table.
- `0028` — `mnemo_summary` (per-agent injection blob).
- `0029` — `mnemo_fact_archive` (merged + pruned rows).
- `0031` — `mnemo_health` (per-workspace cognitive vitals).
- `0032` — `mnemo_review_queue` (low-confidence inbox).
- `0033` — memory types catalog.
- `0034` — `mnemo_episode` (timeline + multi-fact narrative).
- `0035` — attribution columns.
- `0036` — agent memory policy.
- `0037` — `mnemo_fact.actor_id`.
- `0038` — `conversation.sensitivity` toggle.
- `0039` — `mnemo_entity` primitive + linked-facts index.
- `0040` — opt-in per-actor RESTRICTIVE RLS policy.
- `0041` — protocol v1.2 tagging (`protocol_version` columns).
- `0042` — HNSW `halfvec(1536)` quantization on `mnemo_fact.embedding`.

No destructive operations. Every migration has a `.down.sql` companion
so deployment rollouts can roll back one step if a canary fails.

## [0.1.0] - 2026-05-22

First public release. Establishes the foundation: a multi-tenant, self-hostable platform for building AI agents and orchestrating them in workflows.

### Added

- **Visual flow builder** with 30+ node types (triggers, agents, tools, conditions, switches, loops, parallel, subflows, code, spreadsheet, KB, integrations, HTTP, wait-for-human, end).
- **Agent runtime** with memory, tools, handoffs, structured outputs, and streamable responses.
- **AI catalog** covering 10 capabilities (chat, image, video, embeddings, rerank, TTS, STT, code, vision, OCR) across 80+ providers via a unified adapter layer.
- **MCP server** (HTTP + stdio, read+write) so any MCP-aware client can talk to your data.
- **Integrations framework** with real connectors plus a webhook receiver, management UI, and expanded event catalog.
- **Authoring productivity**: drag-and-drop palette, auto-connect, labeled Sí/No handles, copy/paste/duplicate, dagre auto-layout, visual variable picker, run-as-form (no JSON), inline validation badges, pin/dry-run.
- **AI copilot** for build / explain / debug with preview-then-merge edits to the active flow.
- **Observability**: live execution view, run inspector, inline error badges, distributed run telemetry, cost breakdown.
- **Templates gallery** with rich node cards and a path to community contributions.

### Security

- **AES-256-GCM credential encryption** with versioned key rotation.
- **Code-node RCE closed**: per-workspace gate plus a sandboxed execution boundary.
- **RBAC enforced on every mutating route** via zod schemas + role checks.
- **Per-workspace AI spend cap** with hard fail-closed semantics, metered through `usage_events`.
- **Postgres advisory locks** on quota and spend writes — no TOCTOU windows.
- **Structural CI guard** (`scripts/audit-invariants.sh`) enforces the four cross-cutting invariants (spend guard, AI metering, RBAC+zod, flow signal).

### Changed

- Flow execution decoupled from request lifecycle via a Postgres-backed job queue (pg-boss) with an orphan-run reaper.
- Database workflow standardized on `drizzle-kit generate` + `migrate` (no more `push --force`).
- Provider field migrated from enum to text with credentials handled per-workspace.

### Documentation

- Public-facing [`README.md`](README.md), [`ROADMAP.md`](ROADMAP.md), [`GOVERNANCE.md`](GOVERNANCE.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md), [`.github/SUPPORT.md`](.github/SUPPORT.md), [`.github/CODE_OF_CONDUCT.md`](.github/CODE_OF_CONDUCT.md).
- Apache 2.0 license with NOTICE; Developer Certificate of Origin (DCO) for contributions.
- Per-node documentation surfaced inside the studio.

---

<!--
GUIDE for editors / release-please:

  ## [Unreleased]
  ### Added         — new user-facing features
  ### Changed       — changes in existing functionality
  ### Deprecated    — soon-to-be removed features
  ### Removed       — removed features (breaking)
  ### Fixed         — bug fixes
  ### Security      — vulnerability fixes (link to advisories)

When a release is cut, the [Unreleased] block becomes the version block and a
new empty [Unreleased] is added on top.

The version comparison links at the bottom should also be updated.
-->

[Unreleased]: https://github.com/lucasmailland/orchester/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lucasmailland/orchester/releases/tag/v0.1.0
