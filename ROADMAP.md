# Roadmap

Living document. Reflects current intent, not a contract — the only commitment is to keep this file honest.

Tracked in detail via [GitHub Milestones](https://github.com/lucasmailland/orchester/milestones) and [Issues](https://github.com/lucasmailland/orchester/issues). Open an [Idea](https://github.com/lucasmailland/orchester/discussions/categories/ideas) to influence what comes next.

---

## Shipped (v0.1.0)

The foundation. Everything below is in `main` today.

### Platform

- Multi-tenant from day one — workspace isolation enforced at the data layer and middleware.
- Postgres + `pgvector` as the only required external dependency; nothing else needs to exist for the platform to run.
- Self-hostable via Docker; production deploys validated on Vercel + managed Postgres.

### Agents & flows

- Visual flow builder with 30+ node types (triggers, agents, tools, switches, loops, code, spreadsheet, KB, integrations).
- Agent runtime with memory, tools, handoffs, and streamable responses.
- Drag-and-drop palette, auto-connect, labeled Sí/No handles, copy/paste/duplicate.
- AI copilot for build / explain / debug, with preview-then-merge edits.
- Live execution observability with inline error badges and per-node telemetry.

### AI catalog

- 10 capabilities (chat, image, video, embeddings, rerank, TTS, STT, code, vision, OCR) across 80+ providers.
- Unified adapter layer — switching providers is a settings change, not a refactor.
- Per-workspace model picker with capability filtering and connect-from-picker.

### Integrations & I/O

- MCP server: both HTTP and stdio, read+write.
- Integrations framework with real connectors (not just stubs).
- Webhooks: inbound receiver, management UI, expanded event catalog.

### Security & operations

- RBAC enforced on every mutating route (zod schemas + role check).
- Code-node RCE closed (sandbox + per-workspace gate).
- Plan quotas wired through `checkQuota`; per-workspace AI spend cap with hard fail-closed semantics.
- AES-256-GCM credential encryption with versioned key rotation.
- Job queue (pg-boss) with orphan reaper; flow execution decoupled from request lifecycle.
- Postgres advisory locks on quota/spend writes — no TOCTOU windows.
- Structural CI guard (`scripts/audit-invariants.sh`) enforces the four cross-cutting invariants: spend guard, AI metering, RBAC+zod, flow signal.
- GDPR-shaped data lifecycle hooks; env validation at startup.

---

## In flight

Things actively being worked on or imminently next. Status updates land in [Announcements](https://github.com/lucasmailland/orchester/discussions/categories/announcements).

- **Hardening for public launch.** Audit playbook in [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md) runs every wave; meta-audit findings get folded back into the invariants guard.
- **First public release (v0.1.0)** — tagged, with release-please managing every increment from here.
- **Discussions onboarding.** Q&A, Ideas, and Show-and-tell categories are live for the launch wave.

---

## Next up — 0.2.x

The next ~quarter of work. Order is intent, not promise.

- **Templates marketplace.** Curated, community-submittable flows + agents. Each template lists required providers/integrations up front.
- **Per-flow versions + diff.** First-class version history with visual diff between revisions and one-click rollback.
- **Run replays.** Re-execute a past run with edited inputs or against a different model, without forking the flow.
- **Tool authoring.** First-class custom tools (typed in/out, error contract, retry policy) without needing the code node.
- **Provider health.** Per-provider latency/error dashboards; auto-failover policies between adapters of the same capability.
- **Improved observability.** Distributed tracing across flow → agent → tool → provider; cost breakdown per branch.

## 0.3.x — 0.x

Bigger swings, scoped lightly.

- **Knowledge base v2.** Hybrid (BM25 + vector) retrieval with re-ranking and chunking policies as first-class config.
- **Eval harness.** Built-in regression suites: assertions on flow outputs, golden conversations for agents, scheduled CI runs.
- **Multi-region deployment template.** Reference architecture for Postgres + queue + worker fleet with sticky-by-workspace routing.
- **Audit log + SIEM export.** Tamper-evident audit trail with optional streaming to SIEM/blob storage.
- **SSO + SCIM.** OIDC, SAML, and SCIM provisioning behind a flag for self-hosters; managed offering ships them by default.

## 1.0 — when it’s ready

1.0 means: API stability commitment, documented migration policy, security advisories pipeline, and a deprecation window. We’ll cut it when:

- The on-disk + DB schema is stable enough to back-port migrations for at least two minor versions.
- Public APIs have been frozen for a release cycle without breaking changes.
- The structural invariants guard has caught zero regressions for a full release cycle.

---

## Out of scope (for now)

Documenting what we’re _not_ building keeps the contract honest.

- **Hosted offering.** Self-host only until the project is stable and the community has shape. Hosting may arrive later as a separate commercial product.
- **No-code app builder.** Orchester orchestrates AI; it doesn’t replace your application layer.
- **A second frontend framework.** Next.js is the supported app surface; embedding from other frameworks is fine, but the canonical UI is one stack.

---

## How decisions get made

Lightweight by design while the project is small — see [`GOVERNANCE.md`](GOVERNANCE.md).
