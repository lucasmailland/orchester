# Architecture

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Frontend | Next.js 15 (App Router, RSC), React 19 | dev: webpack, prod: webpack. **NEVER use --turbopack** (10x perf hit) |
| Styling | Tailwind 3.4 + HeroUI 2.7 | tree-shaken via `optimizePackageImports` |
| Animation | framer-motion 11 | optimized import |
| Graph editor | @xyflow/react 12 | flow builder + organigrama |
| State (server) | React Server Components + `cache()` per request |
| Auth | better-auth 1.6 | email/password + Google OAuth + sessions in DB |
| DB | PostgreSQL 16 + pgvector 0.8 + Drizzle ORM 0.45 | prepared statements ON, 28 indices on hot FKs |
| LLMs | Anthropic / OpenAI / Google / Azure OpenAI | API keys encrypted with AES-256-GCM |
| Embeddings | OpenAI `text-embedding-3-small` (1536d) or Google `text-embedding-004` (768d→pad) |
| Email | Resend (optional, falls back to console.log) |
| Billing | Stripe (Checkout + Portal + Webhook) |
| Errors | Sentry envelope POST (no SDK, light cold start) |
| i18n | next-intl, locales: `es` (default), `en`, `pt-BR` |

## Project layout

```
apps/web/
├── app/
│   ├── [locale]/
│   │   ├── (auth)/login, signup
│   │   ├── (shell)/                ← layout with sidebar + topbar
│   │   │   ├── page.tsx            ← Dashboard (Command Center)
│   │   │   ├── agents/
│   │   │   ├── flows/              ← list (full-screen builder is outside shell)
│   │   │   ├── org/
│   │   │   ├── knowledge/
│   │   │   ├── conversations/
│   │   │   ├── channels/
│   │   │   ├── teams/
│   │   │   ├── employees/
│   │   │   └── settings/
│   │   ├── agents/[id]/page.tsx    ← Agent Studio (full-screen)
│   │   ├── flows/[id]/page.tsx     ← Flow Builder (full-screen)
│   │   ├── invite/[token]/         ← accept workspace invite
│   │   └── pricing, privacy, terms ← public marketing
│   ├── api/                        ← all backend endpoints (see reference/api-routes.md)
│   └── widget/[channelId]/         ← public iframe chat widget
├── components/
│   ├── shell/                      ← Sidebar, Topbar, CommandPalette
│   ├── agents/studio/              ← AgentStudio + sub-components
│   ├── flows/                      ← FlowBuilder + nodes/
│   ├── org/                        ← OrgCanvas
│   ├── conversations/              ← ConversationsClient + drawer
│   ├── channels/                   ← ChannelsClient + WidgetChat
│   ├── knowledge/                  ← KnowledgeListClient + DetailClient
│   ├── settings/                   ← SettingsClient + sections
│   ├── auth/                       ← LoginForm, SignupForm, InviteAcceptClient
│   ├── onboarding/                 ← OnboardingWizard + steps/
│   └── common/                     ← cross-cutting (NoProviderBanner, etc.)
├── lib/
│   ├── workspace.ts                ← getCurrentSession + getCurrentWorkspace (cached)
│   ├── auth.ts                     ← better-auth setup
│   ├── encryption.ts               ← AES-256-GCM
│   ├── providers.ts                ← LLM provider routing
│   ├── llm-call.ts                 ← unified call() with tools
│   ├── tools.ts                    ← built-in agent tools
│   ├── flow-engine.ts              ← flow executor
│   ├── embeddings.ts               ← multi-provider embeddings
│   ├── chunking.ts                 ← RAG chunker
│   ├── rbac.ts                     ← roles + assertCan
│   ├── audit.ts                    ← logAudit helper
│   ├── rate-limit.ts               ← in-memory token bucket
│   ├── api-auth/key.ts             ← public API Bearer auth
│   ├── webhooks-out.ts             ← outbound webhook dispatcher
│   ├── email.ts                    ← Resend wrapper
│   ├── observability.ts            ← Sentry envelope sender
│   ├── billing/{plans,quotas,stripe}.ts
│   ├── channels/{router,telegram}.ts
│   └── db-queries.ts               ← read-only aggregate queries (cached at call site)
├── messages/                       ← es.json, en.json, pt-BR.json
├── i18n/                           ← next-intl setup
├── middleware.ts                   ← auth gate + locale routing
└── next.config.ts                  ← optimizePackageImports

packages/db/src/
├── schema/
│   ├── auth.ts             user, session, account, verification (better-auth)
│   ├── workspaces.ts       workspace, workspace_member
│   ├── core.ts             team, agent, channel, employee, conversation, message, conversation_label
│   ├── ai-providers.ts     ai_provider, agent_version
│   ├── flows.ts            flow, flow_run, flow_run_step, flow_version, flow_webhook, flow_schedule, flow_template
│   ├── knowledge.ts        knowledge_base, knowledge_doc, knowledge_chunk (pgvector), agent_memory
│   ├── agent-tools.ts      agent_tool (custom tools)
│   └── production.ts       audit_log, workspace_invite, api_key, outbound_webhook, webhook_delivery, usage_event, workspace_billing
├── client.ts               ← getDb() with global pool + prepared statements
└── index.ts                ← public exports
```

## Key request flow (authenticated page)

```
Browser → middleware.ts
            ├─ /api/* → pass through (each route checks auth)
            ├─ /widget|/c → public, pass through
            ├─ /[locale]/login|signup → pass to next-intl
            └─ /[locale]/...        → check session cookie
                                     │ no cookie → redirect /login
                                     └─ has cookie → next-intl → page render

Page render (server):
  layout.tsx ((shell))
    getCurrentSession()   ← React cache()
    getCurrentWorkspace() ← React cache()
    Sidebar + Topbar (server-rendered shell)
  page.tsx
    runs server data fetches (db queries)
  client components hydrate
    fetch /api/* for live data
```

## Per-request caching

`lib/workspace.ts` wraps `getCurrentSession` and `getCurrentWorkspace` with React's
`cache()`. So if a page calls them 5 times across server components, it's still
ONE auth lookup + ONE DB query. Massive perf win for the shell layout.

## DB connection

`packages/db/src/client.ts` keeps the postgres-js pool on `globalThis` so HMR
in dev doesn't leak connections. `prepare: true` is enabled (was a `false` bug
that we fixed — caused 3-10x slowdowns).

## Indexing strategy

See [`reference/perf.md`](./reference/perf.md). Short version: every
`workspace_id` FK is indexed, plus composite indices for sorted-by-time queries
(e.g. `(workspace_id, started_at DESC)`).

## i18n

- Locales: `es`, `en`, `pt-BR`. Default: `es`.
- Files: `apps/web/messages/{es,en,pt-BR}.json`.
- Routing handled by `middleware.ts` + `i18n/routing.ts`.
- Server: `getTranslations({ locale, namespace })`.
- Client: `useTranslations('namespace')`.

## Auth

- `lib/auth.ts` — better-auth config. Email/password + Google OAuth (optional).
- Sessions live in the `session` table (DB-backed, not JWT).
- `requireEmailVerification: false` for now — flip to `true` before launch.
- Workspace context comes from `workspace_member` (one user can be in many).

## Critical perf rules

1. **NEVER use `next dev --turbopack`** — adds 250+ ms per request.
2. **ALL `workspace_id` queries must hit an index.** Verify with `EXPLAIN ANALYZE`.
3. **Heavy aggregate queries (dashboard, org-graph) MUST be cached** with `unstable_cache`.
4. **Per-request dedup** server-side: wrap session/workspace lookups in `cache()`.
5. **Client polling** of expensive endpoints stays at ≥10 s.

## Production checklist (pre-launch)

See `docs/superpowers/audits/2026-04-28-market-launch-audit.md` for the full
roadmap. The 5 phases (4-8) are landed. Remaining for production cutover:
- Set `requireEmailVerification: true`
- Provision Resend API key
- Provision Sentry DSN
- Provision Stripe keys + webhook secret
- Run `pnpm build` and deploy as `next start`
- Add log shipping (Vector / Datadog)
