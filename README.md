<div align="center">

<img src=".github/assets/social-preview.png" alt="Orchester — Stop building agents. Build teams." width="100%" />

# Orchester

### Stop building agents. Build teams.

<sub>An open-source platform for running **teams** of AI agents — with an orchestrator that delegates, specialists that execute, and a persistent memory that learns.<br/>One Postgres. One worker. 80+ AI providers. Multi-tenant from day one. Apache 2.0.</sub>

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

[**Teams**](#-teams-not-lone-agents) ・ [**Two patterns**](#%EF%B8%8F-two-ways-to-build-an-agent) ・ [**The Brain**](#-the-brain--persistent-memory) ・ [**Architecture**](#%EF%B8%8F-architecture) ・ [**Quickstart**](#-quickstart) ・ [**API · MCP**](#-use-it-from-outside-the-studio) ・ [**Compare**](#%EF%B8%8F-how-it-compares) ・ [**FAQ**](#-faq) ・ [**Docs**](#-documentation)

</div>

---

<div align="center">
  <img src=".github/assets/studio-dashboard.png" alt="Orchester Studio — Command Center" width="100%" />
  <sub><i>The Orchester Studio — Command Center showing active agents, today's conversations, open queue and 30-day spend.</i></sub>
</div>

---

## 🚀 Try it in 30 seconds

```bash
git clone https://github.com/lucasmailland/orchester
cd orchester
cp .env.example .env
docker compose up -d
pnpm install && pnpm db:migrate && pnpm dev
```

Open `http://localhost:3000`, log in with the seeded `demo@orchester.dev` account, and you'll have a workspace with a 3-agent team pre-wired to a flow. **Postgres and Redis are the only deps.**

> Full setup, BYO keys, multi-tenant config and production hardening live in [**`docs/QUICKSTART.md`**](docs/QUICKSTART.md).

---

## ✦ Why this exists

> Every team building with AI ends up reinventing the same six things: a way to compose agents and tools, a way to swap models without rewriting, multi-tenant isolation, cost control, observability, and a way to plug into the rest of the stack.

We built those six things, made them open source, and made the trade-offs **visible** — not hidden behind a SaaS pricing page.

Most platforms in this space pick exactly **one** of _open source_, _AI-native_, _multi-tenant_, or _self-hostable_. Orchester is all four. The trade-offs are deliberate and documented in [`docs/adr/`](docs/adr/) — every load-bearing call has a record explaining what we chose, what we rejected, and what would invalidate the decision.

We're not chasing feature parity with hosted clouds. We're chasing the **substrate** that the next decade of agent systems will be built on top of: portable, inspectable, structurally safe, and economically honest.

---

## 🎭 Teams, not lone agents

> A single agent isn't an AI system. It's a chatbot.

The mental model of Orchester is **teams** — not the standard "one big agent with a giant prompt" pattern that breaks at the first edge case.

```
              ┌─ Orchestrator ─────────┐
              │  claude-opus-4         │
              │  decides who handles   │
              │  what, when, with what │
              └──────────┬─────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼─────┐    ┌─────▼─────┐    ┌─────▼─────┐
   │  Sales   │    │  Support  │    │   Ops     │
   │ specialist│    │ specialist│    │ specialist│
   └──────────┘    └───────────┘    └───────────┘
```

The **Orchestrator** receives every message, classifies intent, and delegates to a **Specialist**. Specialists are focused: they know their tools, their persona, their model — and nothing else. When something goes wrong, you can tell _which_ specialist did _what_ and why, because the orchestrator emitted a `delegation` audit event with full context.

Each specialist can in turn be either a **Prompt + Tools agent** (LLM-driven) or a **Visual Flow agent** (deterministic). Both kinds live in the same team. The orchestrator doesn't care.

**Why this matters:**

- **Bounded context** — each specialist sees only what it needs, no 12-job context overflow
- **Parallelism** — specialists run concurrently when the orchestrator fans out
- **Traceable** — every routing decision is an audit log entry with the prompt, the candidates, and the choice
- **Composable** — swap a specialist's model, persona, or tools without touching the orchestrator

---

## ⚒️ Two ways to build an agent

Most agent frameworks force you to pick one pattern: either everything is an LLM-driven prompt-and-tools call, or everything is a hand-wired graph. Orchester runs **both** side by side, in the same team.

<table>
<tr>
<td width="50%" valign="top">

#### 🤖 Prompt + Tools

**For dialogue · LLM-decided · ad-hoc**

Define a persona, hand the model a toolbelt, let it decide what to call. Best for open-ended conversations, research, customer dialogue.

```typescript
const support = await orchester.agent({
  persona: "You help customers solve billing issues",
  model: "claude-sonnet-4-6",
  tools: ["search_kb", "create_ticket", "refund"],
  memory: "semantic",
});
```

</td>
<td width="50%" valign="top">

#### 🔗 Visual Flow

**For process · deterministic · drag-and-drop**

Wire triggers, branches, loops and retries on a canvas. Typed state, bounded loops, retry policies per node. Best for onboarding, lead routing, multi-step workflows — anything QA needs to sign off on.

```
   ┌─ Trigger
   └─► Classify intent
        ├─► Search KB ──┐
        └─► Call API ───┤
                        └─► Reply
```

</td>
</tr>
</table>

**Mix both in the same team.** A "support" specialist can be a Prompt+Tools agent. The same team's "billing-refund" specialist can be a Visual Flow that requires manager approval. The orchestrator delegates to whichever specialist matches the intent.

---

## 🧠 The Brain — persistent memory

> Not chat history. A real knowledge graph that decays, gets recalled by similarity, and is auditable.

Most agent frameworks ship with the wrong memory model: dump the last N messages into the prompt and hope. Orchester ships **the Brain** — a per-workspace knowledge graph designed for production teams.

```typescript
// Agents write facts as they learn — explicit, sourced, scored
await brain.remember({
  fact: "User is on Enterprise plan, 50 seats",
  source: "msg_1247",
  confidence: 0.95,
  agent: "support",
});

// Specialists recall by meaning, not by string match
const context = await brain.recall({
  query: "what plan are they on?",
  decay_after_days: 90,
  min_confidence: 0.6,
});
```

**What makes it different:**

| Capability             | What it gives you                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Semantic recall**    | `pgvector` HNSW + tiered embedding (768d/1536d) returns the _right_ context — not the last 10 messages     |
| **Trust decay**        | Every fact has a `confidence` that exponentially decays unless re-confirmed. Old prices stop being "truth" |
| **Versioning + audit** | Every write is logged with `source`, `agent`, `timestamp`. Compliance reviews go from weeks to hours       |
| **GDPR-safe**          | Per-fact `delete` and per-subject `export`. RLS keeps facts inside the workspace that wrote them           |
| **Recall telemetry**   | `recall-debug` traces show which embeddings matched and why a fact was/wasn't recalled                     |
| **Inspectable**        | The Brain Inspector UI lists facts with strength bars, last-recalled, source message, and decay rate       |

The Brain isn't a vector DB hidden behind an SDK — it's a **product surface** with admin tooling, observability, and tenant guarantees. The engine lives in the standalone [`@mnemosyne/core`](https://github.com/lucasmailland/mnemosyne) repo (consumed via `pnpm` `file:` link), and the UI lives at `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/`.

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

<p align="center"><a href=".github/assets/architecture-topology.svg"><img src=".github/assets/architecture-topology.svg" alt="Orchester architecture: five-tier topology — clients → Next.js 15 deployable → worker + Postgres (only required dependency) → 80+ AI providers with BYO keys, encrypted at rest." width="100%"></a></p>

<div align="center"><sub><b>One Next.js app. One Postgres. One worker. That's the entire required topology.</b><br/>Optional add-ons (Redis, S3) layer in without replacing the default path — see <a href="docs/adr/0003-postgres-as-only-dependency.md">ADR 0003</a>.</sub></div>

### Anatomy of a flow run

<p align="center"><a href=".github/assets/flow-run-lifecycle.svg"><img src=".github/assets/flow-run-lifecycle.svg" alt="Flow run lifecycle sequence: enqueue (sub-50ms), stream (SSE), execute (async in worker) across client, Next.js API, Postgres, worker and AI provider." width="100%"></a></p>

### Multi-tenant safety is structural, not procedural

Most multi-tenant breaches happen the same way: a developer writes `db.query.flows.findMany(...)` and forgets the `workspaceId` predicate. Review catches most. One slips through. A workspace sees another's data.

**We don't rely on review for this.** We grep-enforce it in CI — every PR runs four structural checks before merge is allowed:

<p align="center"><a href=".github/assets/ci-invariants.svg"><img src=".github/assets/ci-invariants.svg" alt="CI invariants: every PR runs audit-invariants.sh — zod + assertCan, workspace predicate, llmCall metered, AbortSignal threading. All four must pass before merge is allowed." width="100%"></a></p>

Full reasoning in [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md). The decision to enforce at the application layer (not Postgres RLS) is documented in [ADR 0005](docs/adr/0005-app-layer-tenancy.md).

### How an agent thinks

<p align="center"><a href=".github/assets/agent-runtime.svg"><img src=".github/assets/agent-runtime.svg" alt="Agent runtime loop: user message → context assembly (memory + KB + tools schema) → model adapter ↔ tools loop → structured output → memory (async) and streamed response." width="100%"></a></p>

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

The agent space has split in two: **frameworks you import** into your code (LangGraph, CrewAI, AutoGen, Swarm, MetaGPT) and **platforms you run** as a system (Dify, LangSmith, OpenAI Assistants). Frameworks are great at composing agent teams; they leave the platform concerns — tenancy, channels, KB, cost caps, audit, UI, MCP — to you. Hosted platforms solve those, then lock you in and take the multi-tenancy off the table.

**Orchester is a platform that doesn't make you choose** between OSS, multi-tenancy, and first-class agent teams.

|                                            | **Orchester** |    LangGraph     |   CrewAI   |  AutoGen   | OpenAI Swarm |  MetaGPT   |       Dify       | OpenAI Assistants |
| ------------------------------------------ | :-----------: | :--------------: | :--------: | :--------: | :----------: | :--------: | :--------------: | :---------------: |
| **Shape**                                  |   platform    |    framework     | framework  | framework  |  framework   | framework  |     platform     |    hosted API     |
| **License**                                | ✅ Apache 2.0 |      ✅ MIT      |   ✅ MIT   |   ✅ MIT   |    ✅ MIT    |   ✅ MIT   | ⚠️ source-avail. |     ❌ closed     |
| **Visual flow builder**                    |      ✅       |        ❌        |     ❌     |     ❌     |      ❌      |     ❌     |        ✅        |        ❌         |
| **Agents as first-class objects**          |      ✅       |        ✅        |     ✅     |     ✅     |      ✅      |     ✅     |        ✅        |        ✅         |
| **Multi-agent teams · handoffs**           |      ✅       |        ✅        |     ✅     |     ✅     |      ✅      |     ✅     |     ⚠️ basic     |   ⚠️ assistants   |
| **Multi-tenant by design**                 |      ✅       |        ❌        |     ❌     |     ❌     |      ❌      |     ❌     |  ⚠️ workspaces   |        ❌         |
| **Conversations + channels (Slack, etc.)** |      ✅       |        ❌        |     ❌     |     ❌     |      ❌      |     ❌     |        ✅        |    ⚠️ threads     |
| **Built-in cost cap + per-call metering**  |      ✅       |        ❌        |     ❌     |     ❌     |      ❌      |     ❌     |    ⚠️ limited    |        ❌         |
| **MCP server (HTTP + stdio)**              |      ✅       |        ❌        |     ❌     |     ❌     |      ❌      |     ❌     |        ❌        |        ❌         |
| **Knowledge base + retrieval built in**    |      ✅       |       DIY        |    DIY     |    DIY     |     DIY      |    DIY     |        ✅        |        ✅         |
| **80+ AI providers behind one adapter**    |      ✅       | ✅ via langchain |     ⚠️     |     ⚠️     | OpenAI-only  |     ⚠️     |        ✅        |    OpenAI-only    |
| **Self-host**                              |      ✅       |    ✅ library    | ✅ library | ✅ library |  ✅ library  | ✅ library |        ✅        |        ❌         |
| **Structural CI safety guards**            |      ✅       |        ❌        |     ❌     |     ❌     |      ❌      |     ❌     |        ❌        |        n/a        |
| **Audit log + admin trail**                |      ✅       |        ❌        |     ❌     |     ❌     |      ❌      |     ❌     |    ⚠️ partial    |        ⚠️         |

<sub>⚠️ = partial / behind a paywall / community-maintained. ✅ = first-class, default, documented. DIY = "build it yourself with available primitives." n/a = the category doesn't apply (hosted-only products don't have multi-tenancy concerns).</sub>

> [!IMPORTANT]
> **Orchester is the only entry that says ✅ to all of**: visual builder, multi-agent teams, multi-tenant by design, conversations + channels, built-in cost cap, MCP, 80+ providers, self-host, and structural CI guards. That's the bet — give teams the agent-team primitives the frameworks have, plus the platform concerns they shouldn't have to rebuild.

---

## 🚀 Quickstart

> **Requires:** Node 22, pnpm 9, Postgres 15+ with `pgvector`.

```bash
# 1. Clone Orchester + sibling mnemosyne (see "Local mnemosyne setup" below)
git clone https://github.com/lucasmailland/orchester.git
git clone https://github.com/lucasmailland/mnemosyne.git
cd mnemosyne && pnpm install && pnpm --filter @mnemosyne/core build && cd ..

# 2. Install Orchester
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

### Local mnemosyne setup

The Brain engine lives in a separate repo — [`@mnemosyne/core`](https://github.com/lucasmailland/mnemosyne) — and Orchester consumes it via the `pnpm` `file:` protocol declared in `apps/web/package.json`. A few things to know:

- The sibling repo **must** be checked out at `../mnemosyne` relative to `orchester/` (i.e. they share a parent directory). The standalone repo's `dist/` is gitignored, so after a fresh clone you must run `pnpm install && pnpm --filter @mnemosyne/core build` inside `mnemosyne/` **before** running `pnpm install` in `orchester/`.
- Override the default sibling location with the `MNEMO_REPO_PATH` env var (absolute path). This is used by `scripts/audit-invariants.sh` and other tooling that needs to resolve the standalone repo from a non-standard layout.
- Rebuild `@mnemosyne/core` (`pnpm --filter @mnemosyne/core build` inside the sibling repo) any time you pull or modify it — Orchester picks up the new `dist/` on the next `pnpm install` or dev-server restart.

> [!TIP]
> `make help` lists every common task. `make ci` runs everything CI runs — typecheck, vitest, prettier check, invariants guard.

---

## 🪄 Use it from outside the Studio

Once you've created a flow or an agent in the Studio, you don't have to keep going through the UI. Three first-class doors point at the same data:

### Public REST API (`/api/v1/*`)

Generate an API key in `Settings → API keys`, then drive any flow from your own services:

```bash
# Kick off a flow and stream telemetry as it runs.
curl -N -X POST https://your-host/api/v1/flows/$FLOW_ID/run \
  -H "x-api-key: $ORCHESTER_KEY" \
  -H "content-type: application/json" \
  -d '{
        "input": { "ticket_id": "T-1042" },
        "stream": true
      }'

# → event: node_started   { "node": "trigger", ... }
# → event: node_done      { "node": "agent", "cost_usd": 0.0034, ... }
# → event: flow_completed { "outputs": { "summary": "…" }, "cost_usd": 0.0089 }
```

The same key works against the agents endpoints (`POST /api/v1/agents/:id/chat`) and the conversation endpoints (`POST /api/v1/conversations/:id/messages`). Every request is RBAC-checked, rate-limited per workspace, and metered into `usage_events`.

### MCP server — let your IDE / desktop agent talk to your data

Orchester ships a built-in MCP server. Point Claude Desktop, Cursor, or any MCP-aware client at it and your flows + agents + KB become first-class tools:

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "orchester": {
      "command": "npx",
      "args": ["-y", "@orchester/mcp-stdio"],
      "env": {
        "ORCHESTER_URL": "https://your-host",
        "ORCHESTER_API_KEY": "ok_live_...",
      },
    },
  },
}
```

> [!IMPORTANT]
> The MCP server runs with the **same RBAC + quota stack as the REST API**. A read-only API key sees read-only tools. A workspace-scoped key cannot see another workspace's flows. This is enforced by the invariants guard — not by review.

### Webhooks — fire flows from anything that can POST

Every flow has an inbound webhook URL the moment it ships. Drop it in Stripe, GitHub, Linear, or your own product — the flow runs, the cost is metered, you get back a structured response.

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

## ❓ FAQ

<details>
<summary><b>Why another agent platform? There are 30 already.</b></summary>
<br/>

There are many _frameworks_ (LangChain, AutoGen, CrewAI) and many _hosted clouds_ (OpenAI Assistants, Vellum, LangSmith). What's missing is the **substrate in between**: an open-source, self-hostable, multi-tenant platform with first-class agents, flows, channels, cost control, and audit — under one Apache 2.0 license, on one Postgres. That's the gap Orchester fills.

</details>

<details>
<summary><b>Is it actually production-ready?</b></summary>
<br/>

It's actively used in production at small-team scale today. v0.1.0 is a public foundation — APIs may shift before v1.0, but every shift goes through release-please and Conventional Commits, so the changelog is reliable. Security-sensitive code paths (RBAC, encryption, spend gates) are protected by the structural invariants guard on every PR. See [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md).

</details>

<details>
<summary><b>How is this different from LangGraph, CrewAI, or AutoGen?</b></summary>
<br/>

Those are **agent frameworks** — Python libraries you import and wire up inside your application code. They're excellent at composing agents and orchestrating multi-agent teams, and Orchester deliberately learns from them. The deltas are everything _around_ the agents: **multi-tenant by design** with structural CI enforcement, a **visual flow builder**, **conversations + channels** (Slack/Telegram/webhooks) as first-class objects, **built-in cost cap + per-call metering**, an **MCP server** that exposes your data to any MCP-aware client, **80+ providers behind a single adapter**, **audit log**, and **self-hostable on a single Postgres**. You can keep using LangGraph or CrewAI inside an Orchester node if you want — Orchester gives you the platform, not the agent loop. See the [comparison matrix](#%EF%B8%8F-how-it-compares).

</details>

<details>
<summary><b>How is this different from Dify or OpenAI Assistants?</b></summary>
<br/>

Dify is the closest platform-shaped peer: a visual LLM app builder with workspaces and KB. The differences are licensing (Orchester is Apache 2.0; Dify is source-available with commercial-use restrictions), multi-tenancy as a _structural_ property enforced by CI rather than as a workspace UI on top, a built-in **MCP server**, **80+ providers behind one adapter**, and **built-in cost cap + spend metering** rather than usage limits as a paid feature.

OpenAI Assistants is a hosted API: powerful, OpenAI-only, not self-hostable, no multi-tenancy primitive, no audit, no provider portability. Excellent if you're locked into OpenAI; not a substitute if you want substrate.

</details>

<details>
<summary><b>Will you keep it open source if it grows?</b></summary>
<br/>

Yes. The decision to license under Apache 2.0 (with trademark + patent protections) is recorded in [ADR 0002](docs/adr/0002-apache-2-0-over-mit.md). The decision to use DCO instead of a CLA — which means we _cannot_ unilaterally relicense — is in [ADR 0004](docs/adr/0004-dco-over-cla.md). Future commercial work (managed hosting, premium support, enterprise add-ons) will be additive, not a relicense of what's here.

</details>

<details>
<summary><b>Do I need Redis, Kafka, or a vector DB?</b></summary>
<br/>

No. Postgres 15 with `pgvector` covers all three roles: relational store, job queue (via pg-boss), and vector index. Redis is supported as an _optional_ rate-limit backend for multi-replica deployments. A separate vector DB is **not** supported — this is a deliberate constraint documented in [ADR 0003](docs/adr/0003-postgres-as-only-dependency.md).

</details>

<details>
<summary><b>Can I add a new AI provider?</b></summary>
<br/>

If it speaks an `openai-compatible` API: yes, in **one row of the catalog**. If it's a new family: one adapter file (~150 lines following the existing pattern) plus a catalog entry. The capability contract is typed end-to-end, so the studio model picker and cost metering pick up the new provider automatically. See [`docs/ARCHITECTURE.md § AI catalog`](docs/ARCHITECTURE.md#ai-catalog).

</details>

<details>
<summary><b>How do you handle prompt injection / agent abuse?</b></summary>
<br/>

Three layers. (1) Outbound SSRF protection via `lib/net-guard.ts` — no private IP ranges, no localhost, no metadata endpoints from the HTTP node. (2) Per-workspace gate on the code node (sandbox via `node:vm`, hard timeout, restricted globals — _not claimed_ as a security boundary against a determined attacker, only against accidental footguns). (3) Hard spend cap per workspace + global kill-switch. Plus an audit log on every sensitive mutation. Documented in [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md) and [`docs/ARCHITECTURE.md § Security posture`](docs/ARCHITECTURE.md#security-posture).

</details>

<details>
<summary><b>Can I use this commercially?</b></summary>
<br/>

Yes — Apache 2.0 explicitly permits commercial use, modification, and redistribution. The conditions are: preserve the copyright notices, preserve the patent-grant clause, and don't use the project's trademarks. You don't owe us anything; if Orchester ends up underpinning something valuable, [⭐ starring the repo](https://github.com/lucasmailland/orchester) and contributing back when it makes sense is the only "payment" we ask for.

</details>

---

## 🤝 Contributing

> Every contribution makes Orchester better. Whether you fix a typo, file a thoughtful bug report, or design a new node type — you're shaping the project.

### Pick your path

<table>
<tr>
<td width="33%" valign="top">

#### 🐛 Found a bug

[Open a **Bug report**](https://github.com/lucasmailland/orchester/issues/new?template=bug_report.yml) with reproduction steps. Reproductions get fixed faster than vibes.

</td>
<td width="33%" valign="top">

#### 💡 Have an idea

[Start a **Discussion**](https://github.com/lucasmailland/orchester/discussions/categories/ideas) before writing a 2,000-line PR. We'll align on shape and save you time.

</td>
<td width="34%" valign="top">

#### 🛠️ Want to code

Look for [`good first issue`](https://github.com/lucasmailland/orchester/labels/good%20first%20issue) or [`help wanted`](https://github.com/lucasmailland/orchester/labels/help%20wanted), then read [`CONTRIBUTING.md`](CONTRIBUTING.md).

</td>
</tr>
<tr>
<td valign="top">

#### 📚 Improve docs

Typos, examples, clarifications — docs PRs get merged the fastest of any kind. README, ADRs, ARCHITECTURE, RUNBOOK all welcome.

</td>
<td valign="top">

#### 🌐 Translate

The Studio UI is in Spanish + English today. Adding a locale is one folder under `apps/web/messages/`. Open an [Idea](https://github.com/lucasmailland/orchester/discussions/categories/ideas) first.

</td>
<td valign="top">

#### ❓ Answer questions

[Help others in **Q&A**](https://github.com/lucasmailland/orchester/discussions/categories/q-a). Peer support builds the community as much as code does.

</td>
</tr>
</table>

### How a PR lands

1. **Fork & branch** from `main`. Descriptive name: `feat/llm-retry-backoff`, `fix/quota-edge-case`.
2. **Code + tests.** Vitest. Cover the change meaningfully.
3. **Run locally:** `make ci` (typecheck · vitest · prettier · invariants guard).
4. **Sign off:** `git commit -s` — adds the DCO trailer. Required by CI.
5. **Open the PR.** Fill the template. Screenshots for UI changes; rationale for behavior changes.
6. **Iterate.** Maintainers respond within a few business days. Squash-merge is the default.

By participating, you agree to abide by our [Code of Conduct](.github/CODE_OF_CONDUCT.md).

---

## 🔐 Security

> [!CAUTION]
> **Do not** open a public issue for security vulnerabilities. That exposes the vulnerability before it's patched.

### Reporting

Use **[GitHub's private vulnerability reporting](https://github.com/lucasmailland/orchester/security/advisories/new)** — it routes directly to the maintainer, end-to-end private until disclosure.

### Our commitment

| Stage                                |                                 SLA                                  |
| ------------------------------------ | :------------------------------------------------------------------: |
| Acknowledge receipt                  |                         within **72 hours**                          |
| Initial assessment (severity + plan) |                          within **7 days**                           |
| Fix for high / critical issues       |                   aim **30 days** from validation                    |
| Coordinated disclosure               | with the fix · credit to the reporter (unless they prefer anonymity) |

### Layered defenses (already shipping)

- **`gitleaks`** — scans every PR for accidentally-committed secrets
- **`CodeQL`** (security-extended) — static analysis for vulnerability patterns
- **`Dependabot`** — security updates + grouped dependency PRs
- **Structural invariants guard** — fails any PR that breaks RBAC, spend cap, tenancy, or AbortSignal threading

Full scope, safe-harbour terms, and out-of-scope items in [`SECURITY.md`](SECURITY.md). Threat model + remediation history in [`docs/AUDIT_PLAYBOOK.md`](docs/AUDIT_PLAYBOOK.md).

---

## 📖 Citing

If you reference Orchester in academic or technical writing, citation metadata is in [`CITATION.cff`](CITATION.cff). GitHub renders a **"Cite this repository"** button on the repo page automatically — visitors can copy a pre-formatted BibTeX, APA, or plain-text citation in one click.

```bibtex
@software{orchester,
  title  = {Orchester: an open-source platform for AI agents and workflow orchestration},
  author = {Mailland, Lucas},
  year   = {2026},
  url    = {https://github.com/lucasmailland/orchester},
  license = {Apache-2.0}
}
```

---

## 🙏 Acknowledgments

Orchester is built on a deep stack of open-source work. We owe these projects in particular:

- **[Next.js](https://nextjs.org/)** & **[React](https://react.dev/)** — the app substrate that lets us ship server components and streaming responses without a parallel backend.
- **[Postgres](https://www.postgresql.org/)** & **[`pgvector`](https://github.com/pgvector/pgvector)** — the single dependency that quietly does the work of four.
- **[Drizzle ORM](https://orm.drizzle.team/)** — typed-end-to-end SQL with reviewable migrations.
- **[pg-boss](https://github.com/timgit/pg-boss)** — Postgres-backed job queue with `SKIP LOCKED` semantics that make Redis unnecessary.
- **[Better Auth](https://www.better-auth.com/)** — session-cookie + OAuth done right, multi-tenant friendly.
- **[HeroUI](https://www.heroui.com/)** & **[Tailwind CSS](https://tailwindcss.com/)** — the design system layer of the Studio.
- **[`model-context-protocol`](https://modelcontextprotocol.io/)** — the open spec that makes Orchester's data addressable from any MCP-aware client.
- The **[Linux kernel project](https://www.kernel.org/)** — for the **Developer Certificate of Origin**, which we adopted for contributions.
- The **[Apache Software Foundation](https://www.apache.org/)** — for the license and the cultural blueprint of "lazy consensus + ADR-style decision records."

And to every AI provider whose adapter we ship — your APIs are what makes the AI catalog possible.

---

## 💫 Show your support

<div align="center">

[![Star this repo](https://img.shields.io/github/stars/lucasmailland/orchester?style=for-the-badge&logo=github&logoColor=white&label=Star&color=fbbf24&labelColor=0f1729)](https://github.com/lucasmailland/orchester/stargazers)
[![Latest release](https://img.shields.io/github/v/release/lucasmailland/orchester?style=for-the-badge&logo=semantic-release&logoColor=white&color=22c55e&labelColor=0f1729)](https://github.com/lucasmailland/orchester/releases)
[![Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-7c8cff?style=for-the-badge&logoColor=white&labelColor=0f1729)](LICENSE)
[![Discussions](https://img.shields.io/github/discussions/lucasmailland/orchester?style=for-the-badge&logo=github&logoColor=white&color=a78bfa&labelColor=0f1729)](https://github.com/lucasmailland/orchester/discussions)

<br/>

### Three ways to help right now

</div>

<table>
<tr>
<td width="33%" align="center" valign="top">

### ⭐<br/>**Star the repo**

The single biggest signal that helps others find Orchester. One click, takes 2 seconds, costs nothing.

<sub>[→ Star on GitHub](https://github.com/lucasmailland/orchester)</sub>

</td>
<td width="33%" align="center" valign="top">

### 🗣️<br/>**Tell a friend**

Working on AI agents? Sharing Orchester with one other team is worth more than 1,000 algorithmic impressions.

<sub>[→ Copy launch tweet](https://twitter.com/intent/tweet?text=Orchester%20%E2%80%94%20open-source%20platform%20for%20building%20AI%20agents%20and%20orchestrating%20them%20in%20flows.%20Multi-tenant%20from%20day%20one%2C%2080%2B%20providers%2C%20self-hostable%20on%20Postgres.&url=https%3A%2F%2Fgithub.com%2Flucasmailland%2Forchester)</sub>

</td>
<td width="34%" align="center" valign="top">

### 🤝<br/>**Contribute back**

Fix a bug, add a node, improve the docs, open a thoughtful issue. Every contribution moves the project forward.

<sub>[→ See how to contribute](CONTRIBUTING.md)</sub>

</td>
</tr>
</table>

---

## ⚖️ License

**Apache License 2.0** — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). You may use, modify, and redistribute Orchester, including commercially, provided you preserve the copyright notices and the patent-grant clause. Apache 2.0 gives both sides mutual patent protection: if you sue us over a patent you claim covers Orchester, you lose your license.

The reasoning behind Apache 2.0 over MIT (patent grant + trademark protection) is in [ADR 0002](docs/adr/0002-apache-2-0-over-mit.md).

---

<div align="center">
<br/>

**Open source for the AI-agent era.**

<sub>TypeScript · Postgres · pg-boss · Next.js · Apache 2.0</sub>

<br/>

[Manifesto](#-why-orchester) ・ [Architecture](#%EF%B8%8F-architecture) ・ [API · MCP](#-use-it-from-outside-the-studio) ・ [Compare](#%EF%B8%8F-how-it-compares) ・ [FAQ](#-faq) ・ [Roadmap](ROADMAP.md) ・ [Discussions](https://github.com/lucasmailland/orchester/discussions)

<br/>

<sub>Made by <a href="https://github.com/lucasmailland">@lucasmailland</a> and the contributors. If Orchester ends up useful to you, the kindest thing you can do is <a href="https://github.com/lucasmailland/orchester">⭐ star the repo</a> — it's the single biggest signal that helps other people find it.</sub>

</div>
