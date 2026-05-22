# Orchester · Agent Docs

> **Purpose:** Single source of truth for every screen, feature and contract in the codebase.
> Optimized for AI agents (Claude Code, etc.) and new humans onboarding.

## How this folder is organized

```
.agents/
├── README.md                  ← you are here (index + conventions)
├── architecture.md            ← stack, layout, key flows
├── audit-playbook.md          ← on-demand full-system audit (A–N); run only when asked
├── screens/                   ← one file per user-facing route
│   ├── dashboard.md
│   ├── agent-studio.md
│   ├── flow-builder.md
│   ├── organigrama.md
│   ├── conversations.md
│   ├── channels.md
│   ├── knowledge.md
│   ├── settings.md
│   ├── teams.md
│   └── auth.md
├── features/                  ← cross-cutting features
│   ├── ai-providers.md        ← multi-provider routing + encryption
│   ├── tools-registry.md      ← agent tools (calculator, http, kb-search…)
│   ├── flow-engine.md         ← server-side flow executor
│   ├── rbac.md                ← roles + actions matrix
│   ├── billing.md             ← Stripe + plans + quotas
│   ├── webhooks.md            ← outbound + inbound
│   ├── api-public.md          ← /api/v1/* + API keys
│   ├── i18n.md                ← es/en/pt-BR
│   └── observability.md       ← Sentry + audit log + rate limit
└── reference/
    ├── api-routes.md          ← every endpoint, methods, payloads
    ├── database.md            ← schema diagram + tables
    ├── env-vars.md            ← every env var explained
    └── perf.md                ← perf playbook (indices + caching)
```

## Conventions for spec files

Every spec captures **two layers**: the initial Planning (designed before code)
and the Execution changelog (every meaningful change after).

```md
# <Name>

**Route(s):** /es/...
**File(s):** apps/web/app/[locale]/(shell)/.../page.tsx + components/...
**Owner:** product area (agents | flows | conversations | ...)
**Status:** alpha | beta | stable

## Purpose
1-2 sentences: what user problem it solves.

## Planning (initial design)

### Goals
### User flows
### Data
### Components
### Decisions & trade-offs

## Execution (changelog — newest first)

### YYYY-MM-DD — short title
- What changed
- Why
- Impact / trade-offs

## Performance notes
- Caching, queries, known costs

## Open issues / TODO
- ...
```

When changing code, **update the matching spec in the same commit**. PRs that
modify a screen without touching its spec are red flags.

## How to onboard a new agent

1. Read `architecture.md`.
2. Read the spec for the screen/feature you're touching.
3. Update the spec at the end of your change.

## Project tree (high-level)

```
orchester/
├── apps/web/                  ← Next.js 15 app (the product)
│   ├── app/[locale]/          ← localized routes
│   ├── app/api/               ← server endpoints
│   ├── components/            ← React components
│   ├── lib/                   ← server-only utilities
│   └── messages/              ← i18n JSON
├── packages/db/               ← Drizzle schema + migrations
├── docs/superpowers/          ← historical specs and plans
└── .agents/                   ← this folder
```
