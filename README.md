<div align="center">

# Orchester

**The open-source platform for building AI agents and orchestrating them in workflows.**

Multi-tenant from day one. 80+ AI providers behind one API. 30+ flow nodes. Self-hostable on Postgres.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/lucasmailland/orchester/actions/workflows/ci.yml/badge.svg)](https://github.com/lucasmailland/orchester/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](apps/web/tsconfig.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Quickstart](#quickstart) · [Features](#features) · [Architecture](#architecture) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

---

## Why Orchester

Orchester gives you the primitives most AI platforms keep locked in their cloud:

- **Agents** with memory, tools, handoffs, and structured output validation
- **Flows** — a visual builder with 30+ node types (LLM, image, video, avatar, OCR, HTTP, branching, parallel, subflows, code, spreadsheet…)
- **Channels** — inbound chat from Slack, Telegram, web widget, embed, raw webhooks
- **Knowledge bases** with embeddings + pgvector retrieval
- **Conversations** with cost attribution, takeover, and audit
- **Multi-tenant** workspace isolation, RBAC, plan quotas, per-workspace spend caps
- **BYO API keys**, encrypted at rest with versioned key rotation
- **MCP server** so any MCP-aware client (Claude Desktop, Cursor, etc.) can talk to your data

All of it under Apache 2.0. No "free for personal use only" footguns.

## How it compares

|                                | Orchester      | n8n           | Flowise   | Zapier / Make |
| ------------------------------ | :------------: | :-----------: | :-------: | :-----------: |
| Open source                    | ✅ Apache 2.0   | ⚠️ fair-code  | ✅ MIT    | ❌            |
| AI-native primitives           | ✅              | ⚠️ via nodes  | ✅        | ❌            |
| Multi-tenant                   | ✅              | ❌            | ❌        | n/a           |
| Self-host                      | ✅              | ✅            | ✅        | ❌            |
| Conversations & channels       | ✅              | ❌            | ⚠️        | ❌            |
| Built-in cost cap & metering   | ✅              | ❌            | ❌        | n/a           |
| MCP server                     | ✅              | ❌            | ❌        | ❌            |

## Quickstart

> Requirements: Node 22, pnpm 9, Postgres 15+ with the `pgvector` extension.

```bash
# 1. Clone and install
git clone https://github.com/lucasmailland/orchester.git
cd orchester
pnpm install

# 2. Spin up Postgres (Docker compose included)
docker compose up -d postgres

# 3. Configure env — start from the example
cp .env.example .env
# Required minimum:
#   DATABASE_URL=postgres://orchester:orchester@localhost:55432/orchester
#   BETTER_AUTH_SECRET=...      (any 32+ char secret)
#   ENCRYPTION_SECRET=...       (openssl rand -hex 32)

# 4. Apply migrations
pnpm --filter @orchester/db migrate

# 5. Start the dev server + worker
pnpm dev          # → http://localhost:3333
pnpm worker:dev   # in a second terminal — runs flows
```

Open `http://localhost:3333`, sign up, and you're in. The studio walks you through creating your first agent and connecting an AI provider.

## Features

### AI capabilities

A hand-rolled catalog covering **10 capabilities** across ~25 direct providers and 4 aggregators:

| Capability      | Providers (selected)                                                |
| --------------- | ------------------------------------------------------------------- |
| **Chat**        | OpenAI, Anthropic, Google, xAI, Mistral, DeepSeek, Groq, Together, Cohere, Perplexity, OpenRouter, Azure, Bedrock |
| **Image**       | OpenAI, Google Imagen, Stability, Ideogram, Recraft, BFL, Replicate, fal |
| **Video**       | Replicate (Minimax / Veo), fal                                      |
| **Avatar**      | HeyGen, D-ID, Replicate                                             |
| **Embedding**   | OpenAI, Google, Cohere, Voyage, Jina                                |
| **Rerank**      | Cohere, Voyage, Jina                                                |
| **TTS / STT**   | OpenAI, ElevenLabs, Deepgram, AssemblyAI                            |
| **Music**       | Replicate, fal                                                      |
| **OCR**         | Mistral OCR                                                         |

Adding a provider that fits an existing **family** (e.g. `openai-compatible`) is a single row in the catalog.

### Flow nodes

30+ node types in five groups: **AI** (chat, image, video, avatar, embed, rerank, TTS, STT, music, OCR), **logic** (condition, switch, transform, code, spreadsheet, delay), **integration** (HTTP, integration apps, KB search, notify), **structure** (loop, parallel, try / catch, subflow) and **interactive** (wait-for-human, end).

### Multi-tenant by default

Workspace-scoped queries everywhere, RBAC with `viewer / editor / admin / owner` roles, per-tenant rate limits, per-flow concurrency caps and a **structural CI guard** that fails the build if a new route or LLM call breaks the transversal invariants.

### Observability & cost

Every AI dispatch is metered to `usage_events` with `cost_usd` populated. Per-workspace monthly cap (`AI_MONTHLY_SPEND_CAP_USD`) and global kill-switch (`AI_DISABLED=1`). Structured logs with correlation IDs by `runId`. Audit log for every sensitive mutation, admin-only.

### Reliability

Flows execute via a Postgres-backed job queue (pg-boss — **no Redis needed**), with an orphan-run reaper, bounded fan-out for parallel branches, signal-driven cancellation when clients disconnect, and per-flow concurrency caps enforced via Postgres advisory locks.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Next.js 15 App                         │
│  ┌────────────────────┐  ┌──────────────────────────────────┐   │
│  │  Studio (React)    │  │  API routes (App Router)         │   │
│  │  • Flow builder    │  │  • REST + SSE streaming          │   │
│  │  • Agent editor    │  │  • RBAC + zod validation         │   │
│  │  • Conversations   │  │  • Public /api/v1/* with API keys│   │
│  │  • Settings        │  │  • MCP server                    │   │
│  └────────────────────┘  └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
              │
              ├─→  Postgres + pgvector  (data + jobs via pg-boss)
              ├─→  pg-boss worker        (flow runs, retention, reaper)
              ├─→  Object storage        (local / S3 / R2 / MinIO)
              └─→  AI providers          (BYO keys, encrypted at rest)
```

Built on **Next.js 15 (App Router)**, **Drizzle ORM**, **pg-boss**, **HeroUI + Tailwind**, **better-auth**. Strict TypeScript, no `any` allowed in production code.

## Development

```bash
# Type-check, test, and run the CI invariants guard locally:
pnpm --filter @orchester/web exec tsc --noEmit
pnpm --filter @orchester/web exec vitest run
bash scripts/audit-invariants.sh
```

The **invariants guard** is the structural lesson from our remediation history: it fails CI if a new file calls `llmCall` without a spend guard, a new mutating route lacks `requireAuth` or `parseBody`, or `executeFlow` is called inline without a cancellation signal. See [`.agents/audit.md`](.agents/audit.md) for the full story.

## Documentation

- **Architecture & feature docs** for agents/humans: [`.agents/`](.agents/)
- **Roadmap**: [GitHub Projects](https://github.com/lucasmailland/orchester/projects)
- **Changelog**: [GitHub Releases](https://github.com/lucasmailland/orchester/releases)

## Contributing

Pull requests are welcome — every contribution helps Orchester get better. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; it covers the development setup, project conventions, and the **DCO sign-off requirement** (one line in your commit message).

If you're not sure where to start, look for issues labelled [`good first issue`](https://github.com/lucasmailland/orchester/labels/good%20first%20issue) or open a thread in [Discussions](https://github.com/lucasmailland/orchester/discussions).

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please **don't** open public issues for security vulnerabilities. Use GitHub's private vulnerability reporting (see [SECURITY.md](SECURITY.md)) so we can fix and disclose responsibly.

## License

Orchester is licensed under the **Apache License, Version 2.0** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).

You can use, modify, and redistribute Orchester — including for commercial purposes — provided you preserve the copyright notices and the patent-grant clause. Apache 2.0 also gives both sides mutual patent protection: if you sue us over a patent you claim covers Orchester, you lose your license.

---

<div align="center">
Made with care · Built with TypeScript · Powered by Postgres
</div>
