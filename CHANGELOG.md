# Changelog

All notable changes to Orchester are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html). Until **v1.0.0**, breaking changes may land in minor versions; we note them explicitly.

Releases are produced by [release-please](https://github.com/googleapis/release-please) from Conventional Commit messages on `main`.

## [Unreleased]

_Nothing yet._

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
