# Orchester — Agent Operating Manual

> Read this BEFORE making any change. Every agent (Claude Code, Cursor, Copilot,
> manual) and every human contributor MUST follow these rules.

## 🚨 Documentation Is Not Optional

**Every feature, section, screen, widget, API endpoint, and shared utility
MUST have a matching spec under `.agents/`.** If you create or change one
without updating the spec in the same commit, your change is incomplete.

Specs live in:
- `.agents/screens/<name>.md` — every user-facing route or full-screen surface
- `.agents/features/<name>.md` — cross-cutting features (RBAC, billing, etc.)
- `.agents/reference/<name>.md` — API routes, schema, env vars, perf

The shape of every spec is defined in [`.agents/README.md`](./.agents/README.md).

### Two-track documentation

Every spec captures **two layers** of information:

1. **Initial design (Planning)** — what was conceived at the start: goals,
   user flows, data model, API surface, UI layout, decisions and trade-offs.
   This section is written FIRST, before code.
2. **Changelog (Execution)** — every meaningful change made afterwards: what
   was modified, when, why, what alternatives were considered, what trade-offs
   were accepted. This section grows over time.

Spec template (used by every file under `.agents/`):

```md
# <Name>

**Route(s)** · **File(s)** · **Owner**

## Purpose
1-2 sentences.

## Planning (initial design)
### Goals
### User flows
### Data model
### API surface
### UI / components
### Decisions & trade-offs

## Execution (changelog)
### YYYY-MM-DD — short title
- what changed
- why
- impact / trade-offs

## Open issues / TODO
```

The Planning section is **immutable** — it captures what was originally
designed. If reality diverges, document it in Execution, don't rewrite history.

### Enforcement

When you (the agent) finish a coding task:

1. List every screen / feature / widget / endpoint you touched.
2. For each, confirm the matching spec was created or updated.
3. **For new specs:** write the full Planning section.
4. **For existing specs:** add an entry to the Execution changelog with the
   date, what changed, and why.
5. If a spec is missing, create it before declaring done.

When reviewing a diff (PR or commit):

- A change in `apps/web/components/` requires a touch in `.agents/screens/`
  or `.agents/features/`.
- A change in `apps/web/app/api/` requires a touch in
  `.agents/reference/api-routes.md`.
- A change in `packages/db/src/schema/` requires a touch in
  `.agents/reference/database.md`.

There are zero exceptions for "small" changes. Small changes accumulate into
undocumented surface area.

## Code Hygiene

- TypeScript strict mode is ON (`exactOptionalPropertyTypes: true`,
  `noUncheckedIndexedAccess: true`). Don't disable, fix the types.
- All `lib/*.ts` files used by server code start with `import "server-only";`
- All workspace-scoped DB queries MUST filter by `workspaceId` AND hit an
  indexed column. Verify with `EXPLAIN ANALYZE` if unsure.
- Heavy aggregates (any query producing dashboard-style stats) MUST be wrapped
  in `unstable_cache` with revalidate ≥ 30 s.
- Client polling of any backend endpoint must run at ≥ 10 s interval.
- Never commit secrets. Never log decrypted API keys, even at debug level.

## Performance Rules

1. **NEVER use `next dev --turbopack`** — Next.js 15 turbopack has heavy
   per-request overhead. The `dev` script in `apps/web/package.json` uses
   webpack on purpose. There's a `dev:turbo` if you want to test.
2. Indices on every `workspace_id` and other hot FK columns. See
   [`/.agents/reference/perf.md`](./.agents/reference/perf.md).
3. `getCurrentSession` and `getCurrentWorkspace` are `cache()`-wrapped per
   request. Don't bypass them.

## Branch & Commit Conventions

- Conventional commits: `feat`, `fix`, `perf`, `refactor`, `docs`, `chore`.
- Commit messages explain **why** the change matters, not just **what** changed.
  Example: `perf: 14x faster TTFB — 28 indices on hot FK columns + dashboard cache`.
- After a major change, append a note to the relevant `.agents/<spec>.md`
  under a "Changelog" section if it materially changes behavior.

## When Adding a New Screen

1. Create the route under `apps/web/app/[locale]/(shell)/<name>/page.tsx`
   (or outside `(shell)` for full-screen views).
2. Add nav entry in `apps/web/components/shell/Sidebar.tsx`.
3. Add i18n keys in all three locale files: `es.json`, `en.json`, `pt-BR.json`.
4. **Create `.agents/screens/<name>.md`** with the spec template.
5. If the screen uses a new DB table, add the schema and update
   `.agents/reference/database.md`.

## When Adding a New Feature

1. Add `lib/<feature>.ts` (server-only) and any UI under
   `components/<feature>/`.
2. **Create `.agents/features/<feature>.md`**.
3. Add tests under `apps/web/__tests__/`.
4. If the feature exposes endpoints, document them in
   `.agents/reference/api-routes.md`.

## Tooling

- `pnpm dev` — start dev server (webpack, port 3333)
- `pnpm test` — vitest, all tests must pass before commit
- `pnpm tsc --noEmit` — TS check, MUST be zero errors
- `pnpm --filter @orchester/db push` — apply schema changes

## Agent-specific notes

If you are an autonomous agent (Claude Code, Codex, etc.):

- Always read the matching spec for the area you're touching before editing.
- Always commit specs with code in the same commit. Never split into a
  "follow-up docs commit" — historically those never happen.
- Ask the user before introducing a new dependency. Audit the dep's bundle
  cost.
- Don't refactor unrelated code in the same change. One concern per commit.
