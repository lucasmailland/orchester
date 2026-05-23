<div align="center">

<img src=".github/assets/social-preview.png" alt="Orchester — Build agents. Orchestrate flows." width="100%" />

# Orchester

### The open-source platform for the AI-agent era.

**Build agents. Orchestrate flows. Multi-tenant from day one.**

<sub>One Postgres. One worker. 80+ AI providers behind one adapter layer. 30+ visual flow nodes.<br/>Self-hostable. Apache 2.0. Zero "free for personal use only" rug-pulls.</sub>

<br/>

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/lucasmailland/orchester/ci.yml?style=flat-square&label=CI)](https://github.com/lucasmailland/orchester/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/lucasmailland/orchester/codeql.yml?style=flat-square&label=CodeQL)](https://github.com/lucasmailland/orchester/actions/workflows/codeql.yml)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?style=flat-square)](apps/web/tsconfig.json)
[![Conventional Commits](https://img.shields.io/badge/Conventional_Commits-1.0.0-fa6673.svg?style=flat-square)](https://www.conventionalcommits.org)
[![Release](https://img.shields.io/github/v/release/lucasmailland/orchester?style=flat-square&label=Release)](https://github.com/lucasmailland/orchester/releases)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e.svg?style=flat-square)](CONTRIBUTING.md)
[![Discussions](https://img.shields.io/badge/💬-Discussions-7c8cff.svg?style=flat-square)](https://github.com/lucasmailland/orchester/discussions)

<br/>

[**Manifesto**](#-why-orchester) ・ [**Quickstart**](#-quickstart) ・ [**Architecture**](#-architecture) ・ [**What you can build**](#-what-you-can-build) ・ [**Compare**](#-how-it-compares) ・ [**Docs**](#-documentation)

</div>

---

## ✦ Why Orchester

> Every team building with AI ends up reinventing the same six things: a way to compose agents and tools, a way to swap models without rewriting, multi-tenant isolation, cost control, observability, and a way to plug into the rest of the stack.
>
> We built those six things, made them open source, and made the trade-offs **visible** — not hidden behind a SaaS pricing page.

Most platforms in this space pick exactly **one** of _open source_, _AI-native_, _multi-tenant_, or _self-hostable_. Orchester is all four. The trade-offs are deliberate and documented in [`docs/adr/`](docs/adr/) — every load-bearing call has a record explaining what we chose, what we rejected, and what would invalidate the decision.

We're not chasing feature parity with hosted clouds. We're chasing the **substrate** that the next decade of agent systems will be built on top of: portable, inspectable, structurally safe, and economically honest.

---

## ⚡ At a glance

<table>
<tr>
<td width="33%" valign="top">

#### 🧠 Agents

First-class agents with memory, tools, handoffs, structured outputs, streaming. Per-workspace model picker across 80+ providers.

</td>
<td width="33%" valign="top">

#### 🔗 Flows

Visual builder. 30+ node types. Auto-layout, copilot, drag-and-drop, run-as-form, inline validation, AbortSignal-aware execution.

</td>
<td width="34%" valign="top">

#### 🛰️ Channels

Inbound chat from Slack, Telegram, the embeddable web widget, raw webhooks. Conversations with cost attribution and audit.

</td>
</tr>
<tr>
<td valign="top">

#### 🏢 Multi-tenant

Workspace isolation enforced _structurally_ — not by review. CI fails any PR that breaks the tenancy invariant.

</td>
<td valign="top">

#### 💸 Cost guard

AES-256-GCM-encrypted BYO keys. Every `llmCall` metered. Per-workspace spend cap. Global kill-switch. No "oops, the bill" mornings.

</td>
<td valign="top">

#### 🔌 MCP-native

A built-in MCP server (HTTP + stdio, read+write) so Claude Desktop, Cursor, and anything MCP-aware can talk to your data.

</td>
</tr>
</table>

---

## 🏛️ Architecture

```mermaid
flowchart TB
    subgraph clients["&nbsp;<b>🌐 Clients</b>&nbsp;"]
        direction LR
        B["Browser<br/><sub>Studio UI</sub>"]
        M["MCP client<br/><sub>Claude Desktop · Cursor</sub>"]
        E["Embeds<br/><sub>Slack · Telegram · Web widget</sub>"]
    end

    subgraph app["&nbsp;<b>⚡ Next.js 15 · single deployable</b>&nbsp;"]
        direction LR
        UI["Studio<br/><sub>React + HeroUI</sub>"]
        API["REST + SSE API<br/><sub>zod · RBAC · advisory locks</sub>"]
        MCP["MCP server<br/><sub>HTTP · stdio</sub>"]
        PUB["Public /api/v1/*<br/><sub>API keys</sub>"]
    end

    W["⚙️ Worker<br/><sub>pg-boss consumer · same image, different mode</sub>"]

    subgraph DB["&nbsp;<b>🐘 Postgres 15 + pgvector · only required dependency</b>&nbsp;"]
        direction LR
        D1[("Application<br/>data")]
        D2[("Job queue<br/>pg-boss")]
        D3[("Vector<br/>embeddings")]
    end

    subgraph AI["&nbsp;<b>🤖 AI providers · BYO keys · encrypted at rest</b>&nbsp;"]
        direction LR
        P1["Chat<br/><sub>OpenAI · Anthropic · Google · xAI · Mistral · …</sub>"]
        P2["Media<br/><sub>Replicate · fal · ElevenLabs · Stability · …</sub>"]
    end

    B --> UI
    UI --> API
    M --> MCP
    E --> PUB
    API -- writes --> D1
    MCP -- reads/writes --> D1
    PUB -- reads/writes --> D1
    API -- enqueue --> D2
    W -- claim --> D2
    W -- execute --> AI
    W -- telemetry --> D1
    API -. "SSE stream" .- UI

    classDef appBox fill:#0f1729,stroke:#7c8cff,color:#f1f5f9,stroke-width:1.5px
    classDef dbBox fill:#0b1322,stroke:#22d3ee,color:#cbd5e1,stroke-width:1.5px
    classDef extBox fill:#1a1224,stroke:#a78bfa,color:#cbd5e1,stroke-width:1.5px
    classDef workerBox fill:#1a1d2e,stroke:#fbbf24,color:#f1f5f9,stroke-width:1.5px,stroke-dasharray:4
    class UI,API,MCP,PUB appBox
    class D1,D2,D3 dbBox
    class P1,P2 extBox
    class W workerBox
```

<div align="center"><sub><b>One Next.js app. One Postgres. One worker. That's the entire required topology.</b><br/>Optional add-ons (Redis, S3) layer in without replacing the default path — see <a href="docs/adr/0003-postgres-as-only-dependency.md">ADR 0003</a>.</sub></div>

### Anatomy of a flow run

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant API as Next.js API
    participant DB as Postgres
    participant W as Worker
    participant AI as AI provider

    rect rgb(15,23,41)
    Note over C,DB: 1 · Enqueue · synchronous · &lt;50ms
    C->>API: POST /api/flows/:id/run
    API->>API: zod · auth · assertCan
    API->>DB: pg_advisory_xact_lock(workspaceId)
    API->>DB: check plan quota + spend cap
    API->>DB: enqueue flow_run
    API-->>C: 202 Accepted · runId
    end

    rect rgb(11,19,34)
    Note over C,W: 2 · Stream · server-sent events
    C->>API: GET /api/flows/runs/:runId
    API-->>C: stream: node_started, node_done, …
    end

    rect rgb(15,23,41)
    Note over W,AI: 3 · Execute · async · in worker
    W->>DB: claim job (SKIP LOCKED)
    loop For each node in the DAG
        W->>AI: invoke (with AbortSignal)
        AI-->>W: response
        W->>DB: usage_event (cost, tokens)
        W->>DB: telemetry event
    end
    W->>DB: flow_run.status = succeeded
    end

    API-->>C: stream: flow_completed
```

### Multi-tenant safety is structural, not procedural

Most multi-tenant breaches happen the same way: a developer writes `db.query.flows.findMany(...)` and forgets the `workspaceId` predicate. Review catches most. One slips through. A workspace sees another's data.

**We don't rely on review for this.** We grep-enforce it in CI — every PR runs four structural checks before merge is allowed:

```mermaid
flowchart LR
    PR(["📬 Pull request"]) --> CI{{"<b>audit-invariants.sh</b><br/>runs in CI"}}

    CI --> C1["✓ Every mutating route<br/>has zod + assertCan"]
    CI --> C2["✓ Every workspace query<br/>carries workspaceId"]
    CI --> C3["✓ Every llmCall is metered<br/>+ spend-capped"]
    CI --> C4["✓ Every executeFlow has<br/>AbortSignal threaded"]

    C1 --> PASS(["<b>✓ merge allowed</b>"])
    C2 --> PASS
    C3 --> PASS
    C4 --> PASS

    CI -- any check fails --> FAIL(["<b>✗ CI blocks merge</b>"])

    style PR fill:#1e293b,stroke:#94a3b8,color:#f1f5f9
    style CI fill:#1e293b,stroke:#fbbf24,color:#f1f5f9,stroke-width:2px
    style PASS fill:#052e16,stroke:#22c55e,color:#f1f5f9,stroke-width:2.5px
    style FAIL fill:#3f0d0d,stroke:#ef4444,color:#f1f5f9,stroke-width:2.5px
    style C1 fill:#0f1729,stroke:#22d3ee,color:#cbd5e1
    style C2 fill:#0f1729,stroke:#22d3ee,color:#cbd5e1
    style C3 fill:#0f1729,stroke:#22d3ee,color:#cbd5e1
    style C4 fill:#0f1729,stroke:#22d3ee,color:#cbd5e1
```

Full reasoning in [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md). The decision to enforce at the application layer (not Postgres RLS) is documented in [ADR 0005](docs/adr/0005-app-layer-tenancy.md).

### How an agent thinks

```mermaid
flowchart LR
    IN(["📥 User message"]) --> CTX
    subgraph runtime["&nbsp;<b>🧠 Agent runtime</b>&nbsp;"]
        direction TB
        CTX["Context assembly<br/><sub>memory + KB + tools schema</sub>"] --> LLM
        LLM["Model adapter<br/><sub>capability=chat · streamable</sub>"]
        LLM -- "tool call" --> TOOLS["Tools<br/><sub>HTTP · KB search · SQL · custom</sub>"]
        TOOLS -- "result" --> LLM
        LLM -- "final" --> OUT
        OUT["Structured output<br/><sub>zod-validated</sub>"]
    end
    OUT --> MEM[("📚 Memory<br/><sub>compacted async</sub>")]
    OUT --> RES(["📤 Response · streamed"])

    classDef hl fill:#0f1729,stroke:#7c8cff,color:#f1f5f9
    class CTX,LLM,TOOLS,OUT hl
```

The model adapter is _interchangeable_. Swapping `gpt-5` for `claude-sonnet-4` or `gemini-3` is a settings change — not a refactor. See [`docs/ARCHITECTURE.md § AI catalog`](docs/ARCHITECTURE.md#ai-catalog).

---

## 🎯 What you can build

Five concrete shapes the platform is designed to support — each composable with the others.

<table>
<tr>
<th width="20%">Pattern</th>
<th width="35%">What it does</th>
<th width="45%">How it composes</th>
</tr>
<tr>
<td valign="top"><b>🤖 Conversational agent</b></td>
<td valign="top">A chat surface (Slack, Telegram, the web widget, or your own embed) backed by a memoryful agent with tools.</td>
<td valign="top"><code>channel → agent(model, tools, KB) → reply</code></td>
</tr>
<tr>
<td valign="top"><b>🔄 Event-driven automation</b></td>
<td valign="top">Webhook fires → enrich data → call an LLM to make a decision → branch to the right downstream action.</td>
<td valign="top"><code>webhook → http(enrich) → agent(decide) → switch → http(act)</code></td>
</tr>
<tr>
<td valign="top"><b>📚 RAG over your data</b></td>
<td valign="top">Knowledge base with hybrid retrieval (pgvector + BM25), chunked at ingest, surfaced as a tool the agent calls.</td>
<td valign="top"><code>agent.tool(kb.search) → rerank → context → answer</code></td>
</tr>
<tr>
<td valign="top"><b>🎬 Media pipelines</b></td>
<td valign="top">Generate images, video, voice from one flow. Same metering, same cost cap, same audit log.</td>
<td valign="top"><code>trigger → agent(prompt) → generate(image|video|tts) → store</code></td>
</tr>
<tr>
<td valign="top"><b>⚙️ Headless via API</b></td>
<td valign="top">Skip the Studio entirely. Hit <code>/api/v1/*</code> with an API key, or expose your data via the MCP server.</td>
<td valign="top"><code>your app → POST /api/v1/flows/:id/run → SSE → done</code></td>
</tr>
</table>

---

## 🤖 The AI catalog

**10 capabilities** across **25+ direct providers** and **4 aggregators**, behind a single adapter contract.

<table>
<tr>
<td valign="top" width="50%">

| Capability       | Selected providers                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| 💬 **Chat**      | OpenAI · Anthropic · Google · xAI · Mistral · DeepSeek · Groq · Together · Cohere · Perplexity |
| 🖼️ **Image**     | OpenAI · Google Imagen · Stability · Ideogram · Recraft · BFL · Replicate · fal                |
| 🎬 **Video**     | Replicate (Minimax · Veo) · fal                                                                |
| 🧑 **Avatar**    | HeyGen · D-ID · Replicate                                                                      |
| 📐 **Embedding** | OpenAI · Google · Cohere · Voyage · Jina                                                       |

</td>
<td valign="top" width="50%">

| Capability         | Selected providers                                          |
| ------------------ | ----------------------------------------------------------- |
| 🎯 **Rerank**      | Cohere · Voyage · Jina                                      |
| 🎙️ **TTS / STT**   | OpenAI · ElevenLabs · Deepgram · AssemblyAI                 |
| 🎵 **Music**       | Replicate · fal                                             |
| 📄 **OCR**         | Mistral OCR                                                 |
| 🌐 **Aggregators** | OpenRouter · Azure OpenAI · AWS Bedrock · OpenAI-compatible |

</td>
</tr>
</table>

> Adding a provider that fits an existing family (e.g. another `openai-compatible` endpoint) is **a single row in the catalog**. A genuinely new family is one adapter file plus a catalog entry. Cost rows are honored automatically — every dispatch writes a `usage_events` row with `cost_usd` populated.

---

## ⚖️ How it compares

The honest version. Every row is verifiable from each project's docs as of mid-2026.

|                                   | **Orchester** |     n8n      | Flowise | Langflow |      Dify       | Activepieces |   AutoGen    |  Zapier / Make   | OpenAI Assistants |
| --------------------------------- | :-----------: | :----------: | :-----: | :------: | :-------------: | :----------: | :----------: | :--------------: | :---------------: |
| **License**                       | ✅ Apache 2.0 | ⚠️ fair-code | ✅ MIT  |  ✅ MIT  | ⚠️ source-avail |  ✅ MIT-ish  |    ✅ MIT    |        ❌        |     ❌ closed     |
| **AI-native primitives**          |      ✅       | ⚠️ via nodes |   ✅    |    ✅    |       ✅        |      ❌      | ✅ framework |        ❌        |        ✅         |
| **Visual flow builder**           |      ✅       |      ✅      |   ✅    |    ✅    |       ✅        |      ✅      |      ❌      | ✅ (proprietary) |        ❌         |
| **Multi-tenant by design**        |      ✅       |      ❌      |   ❌    |    ❌    |  ⚠️ workspaces  |      ❌      |      ❌      |       n/a        |        ❌         |
| **Self-host**                     |      ✅       |      ✅      |   ✅    |    ✅    |       ✅        |      ✅      | ✅ (library) |        ❌        |        ❌         |
| **Conversations + channels**      |      ✅       |      ❌      |   ⚠️    |    ⚠️    |       ✅        |      ❌      |      ❌      |        ❌        |    ⚠️ threads     |
| **Built-in cost cap + metering**  |      ✅       |      ❌      |   ❌    |    ❌    |   ⚠️ limited    |      ❌      |      ❌      |       n/a        |        ❌         |
| **MCP server (HTTP + stdio)**     |      ✅       |      ❌      |   ❌    |    ❌    |       ❌        |      ❌      |      ❌      |        ❌        |        ❌         |
| **Structural CI guards**          |      ✅       |      ❌      |   ❌    |    ❌    |       ❌        |      ❌      |      ❌      |       n/a        |        n/a        |
| **BYO keys, encrypted at rest**   |      ✅       |      ⚠️      |   ✅    |    ✅    |       ✅        |      ✅      |      ✅      |        ❌        |        ❌         |
| **Only required dep is Postgres** |      ✅       |      ❌      |   ❌    |    ❌    |       ❌        |      ❌      |     n/a      |       n/a        |        n/a        |
| **Audit log + admin trail**       |      ✅       |   ✅ paid    |   ❌    |    ❌    |   ⚠️ partial    |      ❌      |      ❌      |        ✅        |        ⚠️         |

> n/a = the category doesn't apply (e.g. multi-tenancy on a hosted-only product). ⚠️ = partial, behind a paywall, or community-maintained. ✅ = first-class, default, documented.

Orchester is the only row that says ✅ to **all** of: multi-tenant, MCP, structural CI guards, cost cap, single-dependency self-host. That's the bet.

---

## 🚀 Quickstart

> **Requires:** Node 22, pnpm 9, Postgres 15+ with `pgvector`.

```bash
git clone https://github.com/lucasmailland/orchester.git
cd orchester
pnpm install

docker compose up -d postgres          # local Postgres + pgvector

cp .env.example .env                   # then set:
#   DATABASE_URL=postgres://orchester:orchester@localhost:55432/orchester
#   BETTER_AUTH_SECRET=$(openssl rand -hex 32)
#   ENCRYPTION_SECRET=$(openssl rand -hex 32)

pnpm --filter @orchester/db migrate    # apply schema

pnpm dev                               # studio  → http://localhost:3333
pnpm worker:dev                        # worker (second terminal · executes flows)
```

Open `http://localhost:3333`, sign up, and you're in. The studio walks you through your first agent and provider connection.

> 💡 `make help` lists every common task. `make ci` runs everything CI runs — typecheck, vitest, prettier check, invariants guard.

---

## 🧱 The stack

| Layer          | Choice                                                | Why                                                                 |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| **Language**   | TypeScript (strict, no `any`)                         | One language, one type system, client and server                    |
| **App**        | Next.js 15 (App Router)                               | Server components + streaming, edge + node mixed                    |
| **UI**         | React 19 + HeroUI + Tailwind                          | Composable primitives, designed by humans, themable                 |
| **Auth**       | Better Auth                                           | Session-cookie + OAuth, plays well with multi-tenant                |
| **ORM**        | Drizzle + drizzle-kit (generate+migrate)              | Typed end-to-end, reviewable migrations, no `push --force`          |
| **DB**         | Postgres 15 + pgvector                                | One dependency. Job queue, vector store, application data, all here |
| **Queue**      | pg-boss                                               | SKIP LOCKED. No Redis required                                      |
| **Process**    | Worker process · same image                           | Same code paths as API. No RPC boundary                             |
| **Encryption** | AES-256-GCM · versioned keyring                       | Rotate without downtime; old ciphertexts still decrypt              |
| **Tests**      | Vitest                                                | 82+ specs covering engine, RBAC, providers, copilot, encryption     |
| **CI**         | GitHub Actions · CodeQL · gitleaks · DCO · invariants | Defense in depth, structural where possible                         |

Each load-bearing choice has an ADR explaining what we considered and why we picked this one — start with [ADR 0003: Postgres as the only required dependency](docs/adr/0003-postgres-as-only-dependency.md).

---

## 📚 Documentation

| Doc                                                            | What it's for                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`README.md`](README.md)                                       | You are here                                                         |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | Component map, request lifecycle, data model, security boundaries    |
| [`ROADMAP.md`](ROADMAP.md)                                     | Shipped, in flight, the road to 1.0                                  |
| [`GOVERNANCE.md`](GOVERNANCE.md)                               | Roles, decision making, succession, values                           |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                           | Dev setup, conventions, DCO sign-off, PR process                     |
| [`SECURITY.md`](SECURITY.md)                                   | Vulnerability disclosure, scope, SLAs, safe harbour                  |
| [`docs/adr/`](docs/adr/)                                       | Architecture Decision Records — the reasoning, archived              |
| [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md)             | 14-dimension audit methodology + the invariants that emerged from it |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md)                           | What to do when something breaks                                     |
| [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md) | Pre-launch checklist for self-hosters                                |
| [`CHANGELOG.md`](CHANGELOG.md)                                 | Keep a Changelog 1.1.0 · release-please-managed                      |

---

## 🗺️ Roadmap

A few of the bigger pieces on the way to 1.0 — see [`ROADMAP.md`](ROADMAP.md) for the full picture.

- **0.2.x** — templates marketplace · per-flow versions with visual diff · run replays · provider health dashboards · distributed tracing
- **0.3.x** — KB v2 (hybrid retrieval + reranking) · built-in eval harness · multi-region deployment template · SIEM-exportable audit log · SSO + SCIM
- **1.0** — API stability commitment · documented migration policy · zero structural-guard regressions for a full release cycle

Open an [Idea](https://github.com/lucasmailland/orchester/discussions/categories/ideas) to influence what comes next.

---

## 🤝 Contributing

Pull requests are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — it covers the development setup, project conventions, and the **DCO sign-off requirement** (`git commit -s`).

Not sure where to start? Look for [`good first issue`](https://github.com/lucasmailland/orchester/labels/good%20first%20issue) or [`help wanted`](https://github.com/lucasmailland/orchester/labels/help%20wanted), or open a thread in [Discussions](https://github.com/lucasmailland/orchester/discussions).

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 🔐 Security

**Don't open public issues for vulnerabilities.** Use [GitHub's private vulnerability reporting](https://github.com/lucasmailland/orchester/security/advisories/new) so we can fix and disclose responsibly. See [`SECURITY.md`](SECURITY.md) for scope, SLAs, and safe harbour terms.

Ships with `gitleaks`, `CodeQL` (security-extended), Dependabot security updates, and the structural invariants guard. Details in [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md).

---

## 📖 Citing

If you reference Orchester in academic or technical writing, citation metadata is in [`CITATION.cff`](CITATION.cff). GitHub renders a "Cite this repository" button automatically.

---

## ⚖️ License

**Apache License 2.0** — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). You may use, modify, and redistribute Orchester, including commercially, provided you preserve the copyright notices and the patent-grant clause. Apache 2.0 gives both sides mutual patent protection: if you sue us over a patent you claim covers Orchester, you lose your license.

The reasoning behind Apache 2.0 over MIT (patent grant + trademark protection) is in [ADR 0002](docs/adr/0002-apache-2-0-over-mit.md).

---

<div align="center">
<br/>

**Built carefully · TypeScript · Postgres · pg-boss · Next.js**

<sub>If Orchester is useful to you, [⭐ star the repo](https://github.com/lucasmailland/orchester) — it's the single biggest signal that helps other people find it.</sub>

<br/>

[Manifesto](#-why-orchester) ・ [Architecture](#%EF%B8%8F-architecture) ・ [Compare](#%EF%B8%8F-how-it-compares) ・ [Quickstart](#-quickstart) ・ [Roadmap](ROADMAP.md) ・ [Discussions](https://github.com/lucasmailland/orchester/discussions)

</div>
