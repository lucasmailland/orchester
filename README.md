<div align="center">

<img src=".github/assets/social-preview.png" alt="Orchester — build agents, orchestrate flows" width="100%" />

# Orchester

**The open-source platform for building AI agents and orchestrating them in workflows.**

Multi-tenant from day one · 80+ AI providers behind one API · 30+ visual flow nodes · Self-hostable on Postgres.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/lucasmailland/orchester/actions/workflows/ci.yml/badge.svg)](https://github.com/lucasmailland/orchester/actions/workflows/ci.yml)
[![CodeQL](https://github.com/lucasmailland/orchester/actions/workflows/codeql.yml/badge.svg)](https://github.com/lucasmailland/orchester/actions/workflows/codeql.yml)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](apps/web/tsconfig.json)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fa6673.svg)](https://www.conventionalcommits.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[**Quickstart**](#-quickstart) · [**Architecture**](#-architecture-at-a-glance) · [**Features**](#-features) · [**Docs**](#-documentation) · [**Contribute**](CONTRIBUTING.md)

</div>

---

## ✨ Why Orchester

> Most platforms in this space pick _one_ of "open source", "AI-native", "multi-tenant", or "self-hostable". Orchester is all four — and the trade-offs were deliberate, not accidental.

- 🧠 **Agents** with memory, tools, handoffs, and structured outputs.
- 🔗 **Flows** — a visual builder with 30+ node types: LLM, image, video, avatar, OCR, HTTP, branching, parallel, subflows, code, spreadsheet…
- 🛰️ **Channels** — inbound chat from Slack, Telegram, web widget, embeds, raw webhooks.
- 📚 **Knowledge bases** with `pgvector` retrieval — no separate vector DB to manage.
- 💬 **Conversations** with cost attribution, takeover, and an audit trail.
- 🏢 **Multi-tenant by default** — workspace isolation, RBAC, plan quotas, per-workspace spend caps.
- 🔐 **BYO API keys**, encrypted at rest (AES-256-GCM) with versioned key rotation.
- 🔌 **MCP server** so any MCP-aware client (Claude Desktop, Cursor, …) can talk to your data.

All of it under **Apache 2.0**. No "free for personal use only" rug-pulls.

---

## 🏛️ Architecture at a glance

```mermaid
flowchart TB
    subgraph clients["Clients"]
        B[Browser · Studio UI]
        M[MCP client · Claude Desktop, Cursor]
        E[Embedded widget · Slack, Telegram, web]
    end

    subgraph app["Next.js 15 app"]
        UI[Studio React + HeroUI]
        API[REST + SSE routes]
        MCP[MCP server · HTTP & stdio]
        PUB["Public /api/v1/* · API keys"]
    end

    subgraph data["Postgres 15 + pgvector"]
        D1[(Application data)]
        D2[(Job queue · pg-boss)]
        D3[(Vector embeddings)]
    end

    W[Worker process · pg-boss consumer]

    subgraph ai["AI providers · BYO keys, encrypted at rest"]
        P1[OpenAI · Anthropic · Google · xAI]
        P2[Replicate · fal · ElevenLabs · …]
    end

    B --> UI --> API
    M --> MCP
    E --> PUB
    API --> D1
    MCP --> D1
    PUB --> D1
    API -- enqueue --> D2
    W -- consume --> D2
    W --> D1
    W --> ai
    UI -.SSE.- API

    classDef hl fill:#0f1729,stroke:#7c8cff,color:#f1f5f9
    classDef db fill:#0b1322,stroke:#22d3ee,color:#cbd5e1
    classDef ext fill:#1a1224,stroke:#a78bfa,color:#cbd5e1
    class UI,API,MCP,PUB,W hl
    class D1,D2,D3 db
    class P1,P2 ext
```

**One Next.js app. One database. One worker process.** That's the entire required topology.

Optional add-ons (Redis for high-throughput rate limiting, S3 for object storage) layer in _without_ replacing the Postgres-based default path. The deliberate constraint is documented in [ADR 0003: Postgres as the only required runtime dependency](docs/adr/0003-postgres-as-only-dependency.md).

### What happens when a flow runs

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant API as Next.js API
    participant DB as Postgres
    participant W as Worker
    participant AI as AI provider

    C->>API: POST /api/flows/:id/run
    API->>API: zod validate · auth · RBAC (assertCan)
    API->>DB: pg_advisory_xact_lock(workspaceId)
    API->>DB: check plan quota + spend cap
    API->>DB: enqueue flow_run job
    API-->>C: 202 Accepted · runId
    C->>API: GET /api/flows/runs/:runId (SSE)
    API-->>C: stream: node_started, node_done, …

    W->>DB: claim job (SKIP LOCKED)
    loop For each node in the DAG
        W->>AI: invoke (with AbortSignal)
        AI-->>W: response
        W->>DB: write usage_event (cost, tokens)
        W->>DB: append telemetry event
    end
    W->>DB: flow_run.status = succeeded
    API-->>C: stream: flow_completed
```

**Every step has a structural CI guard behind it.** See [§ Multi-tenant safety](#-multi-tenant-safety-is-structural-not-procedural).

---

## 🛡️ Multi-tenant safety is structural, not procedural

Most multi-tenant breaches happen the same way: a developer writes `db.query.flows.findMany(...)` and forgets the `workspaceId` predicate. Review catches most. One slips through. A workspace sees another's data.

We don't rely on review for this. We grep-enforce it in CI.

```mermaid
flowchart LR
    PR[Pull request] --> CI{audit-invariants.sh}
    CI -- "Every mutating route<br>has zod + assertCan?" --> Q1{Yes}
    CI -- "Every workspace query<br>has workspaceId predicate?" --> Q2{Yes}
    CI -- "Every llmCall is metered<br>+ spend-capped?" --> Q3{Yes}
    CI -- "Every executeFlow has<br>AbortSignal threaded?" --> Q4{Yes}
    Q1 & Q2 & Q3 & Q4 --> PASS[✓ merge allowed]
    CI -- "Any invariant violated" --> FAIL[✗ CI fails<br>PR blocked]

    style PASS fill:#052e16,stroke:#22c55e,color:#f1f5f9
    style FAIL fill:#3f0d0d,stroke:#ef4444,color:#f1f5f9
```

The full reasoning lives in [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md) and the decision to enforce app-layer (not Postgres RLS) is recorded in [ADR 0005](docs/adr/0005-app-layer-tenancy.md).

---

## 🚀 Quickstart

> **Requirements:** Node 22, pnpm 9, Postgres 15+ with the `pgvector` extension.

```bash
# 1. Clone and install
git clone https://github.com/lucasmailland/orchester.git
cd orchester
pnpm install

# 2. Spin up Postgres (Docker compose included)
docker compose up -d postgres

# 3. Configure env
cp .env.example .env
# Required minimum:
#   DATABASE_URL=postgres://orchester:orchester@localhost:55432/orchester
#   BETTER_AUTH_SECRET=$(openssl rand -hex 32)
#   ENCRYPTION_SECRET=$(openssl rand -hex 32)

# 4. Apply migrations
pnpm --filter @orchester/db migrate

# 5. Start the dev server + worker (two terminals)
pnpm dev          # → http://localhost:3333
pnpm worker:dev   # runs flows
```

Open `http://localhost:3333`, sign up, and you're in. The studio walks you through creating your first agent and connecting an AI provider.

> 💡 There's also a `Makefile` front-door: `make help` lists every common task. `make ci` runs everything CI runs.

---

## 🎛️ Features

### AI capability matrix

A hand-rolled catalog covering **10 capabilities** across **25+ direct providers** and **4 aggregators**:

| Capability       | Providers (selected)                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 💬 **Chat**      | OpenAI · Anthropic · Google · xAI · Mistral · DeepSeek · Groq · Together · Cohere · Perplexity · OpenRouter · Azure · Bedrock |
| 🖼️ **Image**     | OpenAI · Google Imagen · Stability · Ideogram · Recraft · BFL · Replicate · fal                                               |
| 🎬 **Video**     | Replicate (Minimax / Veo) · fal                                                                                               |
| 🧑 **Avatar**    | HeyGen · D-ID · Replicate                                                                                                     |
| 📐 **Embedding** | OpenAI · Google · Cohere · Voyage · Jina                                                                                      |
| 🎯 **Rerank**    | Cohere · Voyage · Jina                                                                                                        |
| 🎙️ **TTS / STT** | OpenAI · ElevenLabs · Deepgram · AssemblyAI                                                                                   |
| 🎵 **Music**     | Replicate · fal                                                                                                               |
| 📄 **OCR**       | Mistral OCR                                                                                                                   |

Adding a provider that fits an existing **family** (e.g. another `openai-compatible` endpoint) is a single row in the catalog. A genuinely new family is one adapter file plus a catalog entry. See [`docs/ARCHITECTURE.md § AI catalog`](docs/ARCHITECTURE.md#ai-catalog).

### Flow nodes

30+ node types in five groups:

- 🧠 **AI** — chat, image, video, avatar, embed, rerank, TTS, STT, music, OCR
- 🔀 **Logic** — condition, switch, transform, code, spreadsheet, delay
- 🔌 **Integration** — HTTP, integration apps, KB search, notify
- 🏗️ **Structure** — loop, parallel, try / catch, subflow
- 👤 **Interactive** — wait-for-human, end

### Observability & cost

Every AI dispatch writes a `usage_events` row with `cost_usd` populated. Per-workspace monthly cap (`AI_MONTHLY_SPEND_CAP_USD`) and a global kill switch (`AI_DISABLED=1`). Structured logs with correlation IDs by `runId`. Audit log for every sensitive mutation, admin-only.

### Reliability

Flows execute via a Postgres-backed job queue (pg-boss — **no Redis needed**), with an orphan-run reaper, bounded fan-out for parallel branches, signal-driven cancellation when clients disconnect, and per-flow concurrency caps enforced via Postgres advisory locks.

---

## ⚖️ How it compares

|                                  | **Orchester** |     n8n      | Flowise | Zapier / Make |
| -------------------------------- | :-----------: | :----------: | :-----: | :-----------: |
| **Open source**                  | ✅ Apache 2.0 | ⚠️ fair-code | ✅ MIT  |      ❌       |
| **AI-native primitives**         |      ✅       | ⚠️ via nodes |   ✅    |      ❌       |
| **Multi-tenant**                 |      ✅       |      ❌      |   ❌    |      n/a      |
| **Self-host**                    |      ✅       |      ✅      |   ✅    |      ❌       |
| **Conversations & channels**     |      ✅       |      ❌      |   ⚠️    |      ❌       |
| **Built-in cost cap + metering** |      ✅       |      ❌      |   ❌    |      n/a      |
| **MCP server**                   |      ✅       |      ❌      |   ❌    |      ❌       |
| **Structural CI guards**         |      ✅       |      ❌      |   ❌    |      n/a      |

---

## 📚 Documentation

| Doc                                                            | What it's for                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`README.md`](README.md)                                       | You are here — the overview                                                     |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | Component map, request lifecycle, data model, security boundaries               |
| [`ROADMAP.md`](ROADMAP.md)                                     | Shipped, in flight, and what's next on the way to 1.0                           |
| [`GOVERNANCE.md`](GOVERNANCE.md)                               | Roles, decision making, succession, values                                      |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                           | Dev setup, conventions, DCO, PR process                                         |
| [`SECURITY.md`](SECURITY.md)                                   | Vulnerability disclosure, scope, SLAs, safe harbour                             |
| [`docs/adr/`](docs/adr/)                                       | Architecture Decision Records — the reasoning behind load-bearing calls         |
| [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md)             | The 14-dimension audit methodology + the invariants that emerged from it        |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md)                           | What to do when something breaks (operations runbook)                           |
| [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md) | Pre-launch checklist for self-hosters                                           |
| [`CHANGELOG.md`](CHANGELOG.md)                                 | Versioned release notes, [Keep a Changelog](https://keepachangelog.com/) format |

---

## 🤝 Contributing

Pull requests are welcome — every contribution helps Orchester get better. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first; it covers the development setup, project conventions, and the **DCO sign-off requirement** (one line in your commit message).

Not sure where to start? Look for issues labelled [`good first issue`](https://github.com/lucasmailland/orchester/labels/good%20first%20issue) or open a thread in [Discussions](https://github.com/lucasmailland/orchester/discussions).

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 🔒 Security

Please **don't** open public issues for security vulnerabilities. Use [GitHub's private vulnerability reporting](https://github.com/lucasmailland/orchester/security/advisories/new) (see [SECURITY.md](SECURITY.md)) so we can fix and disclose responsibly.

The project ships with `gitleaks` in CI, `CodeQL` security-extended analysis, Dependabot security updates, and a structural invariants guard. Details in [SECURITY.md](SECURITY.md) and [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md).

---

## 📖 Citing Orchester

If you use Orchester in academic work or technical writing, citation metadata lives in [`CITATION.cff`](CITATION.cff) and GitHub surfaces a "Cite this repository" button automatically.

---

## ⚖️ License

Orchester is licensed under the **Apache License, Version 2.0** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

You can use, modify, and redistribute Orchester — including for commercial purposes — provided you preserve the copyright notices and the patent-grant clause. Apache 2.0 also gives both sides mutual patent protection: if you sue us over a patent you claim covers Orchester, you lose your license.

The reasoning behind choosing Apache 2.0 over MIT (patent grant + trademark protection) is recorded in [ADR 0002](docs/adr/0002-apache-2-0-over-mit.md).

---

<div align="center">

**Built with care · TypeScript · Postgres · pg-boss · Next.js**

[Quickstart](#-quickstart) · [Architecture](#-architecture-at-a-glance) · [Roadmap](ROADMAP.md) · [Discussions](https://github.com/lucasmailland/orchester/discussions) · [Star on GitHub ⭐](https://github.com/lucasmailland/orchester)

</div>
