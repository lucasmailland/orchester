# Contributing to Orchester

First — thank you for considering a contribution. Orchester is open source because the community has better ideas than any single team. Whether you fix a typo, file a thoughtful issue, or design a new node type, you're shaping the project.

This document is the short version of how we work. Skim it once before opening your first PR.

## Code of Conduct

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Briefly: be kind, be specific, and assume the best in people you've never met.

## Ways to contribute

- **Report bugs** — open an issue using the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) template. Reproductions get fixed faster than vibes.
- **Propose features** — open a [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) and start a conversation BEFORE writing a 2,000-line PR. Saves everyone time.
- **Improve docs** — typos, clarifications, missing examples. Docs PRs are merged the fastest.
- **Open Pull Requests** — for bugs, features, or refactors. See [Pull Request Process](#pull-request-process) below.
- **Ask & answer** in [GitHub Discussions](https://github.com/lucasmailland/orchester/discussions) — peer help builds the community.

If you're not sure where to start, look for [`good first issue`](https://github.com/lucasmailland/orchester/labels/good%20first%20issue) or [`help wanted`](https://github.com/lucasmailland/orchester/labels/help%20wanted) labels.

## Development setup

```bash
# Toolchain
node --version    # ≥ 22 (see .nvmrc)
pnpm --version    # 9.x

# Clone + install
git clone https://github.com/lucasmailland/orchester.git
cd orchester
pnpm install

# Postgres (Docker compose included)
docker compose up -d postgres

# Env
cp .env.example .env
# Fill in at minimum:
#   DATABASE_URL=...
#   BETTER_AUTH_SECRET=$(openssl rand -hex 32)
#   ENCRYPTION_SECRET=$(openssl rand -hex 32)

# Schema
pnpm --filter @orchester/db migrate

# Run
pnpm dev          # Next.js dev server  → http://localhost:3333
pnpm worker:dev   # job worker (flows, retention, reaper) — separate terminal
```

### Project layout

```
apps/web/          # Next.js 15 app — UI + API routes + worker
  app/             # Routes (localized under [locale]/)
  app/api/         # API endpoints
  components/      # React components
  lib/             # Server-only logic (the heart of the system)
  worker/          # Standalone worker entry (executes pg-boss jobs)
packages/db/       # Drizzle schema + migrations + client
scripts/           # Maintenance + CI scripts (audit-invariants, backups, etc.)
docs/              # Public documentation
.agents/           # Architecture + feature specs (for both humans and AI agents)
```

The internal architecture is documented in [`.agents/`](.agents/). Start with [`.agents/README.md`](.agents/README.md) and [`.agents/architecture.md`](.agents/architecture.md).

## Conventions

### Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(flows): add try/catch node
fix(api): close spend-cap bypass in channels/router
docs: clarify ENCRYPTION_KEYS rotation procedure
refactor(ai): unify ChatMessage types in capabilities port
chore(deps): bump next to 15.5.18
test(encryption): cover legacy 3-part ciphertext decrypt path
```

Common scopes: `flows`, `api`, `ai`, `web`, `db`, `auth`, `billing`, `deps`, `ci`, `docs`.

Subjects in lowercase, imperative ("add", not "added"). Wrap the body at ~72 chars and explain **why**, not just **what**.

### Code style

- **TypeScript strict** — `tsc --noEmit` must pass. No `any` in production code (cast at the boundary if absolutely needed and comment why).
- **No emojis in committed code** unless explicitly part of UI copy.
- **Server-only files** start with `import "server-only";` to fence them from client bundles.
- **Comments explain why** (the non-obvious decision). Code shows what.

### Spanish / English

Code, identifiers and PR descriptions in **English**. User-facing UI copy is in **Spanish** by default (this is a Spanish-speaking-led project) and translated via `apps/web/messages/`. Docs are in **English**.

### Security-sensitive areas

These have `@maintainer` CODEOWNERS review required:

- `apps/web/lib/encryption.ts` — AES keyring, rotation, backward-compat
- `apps/web/lib/auth-guards.ts`, `apps/web/lib/rbac.ts` — authentication & authorization
- `apps/web/lib/net-guard.ts` — SSRF guard
- `apps/web/lib/flow-engine.ts` — the executor (RCE-sensitive `code` node)
- `apps/web/lib/cost-alerts.ts` — spend cap / kill-switch
- `packages/db/drizzle/` — DB migrations
- `scripts/audit-invariants.sh` — the CI invariants guard

If you're touching one of these, expect a thorough review and please write a clear changeset.

## The CI invariants guard

`scripts/audit-invariants.sh` is run on every PR. It enforces structural invariants that emerged from the project's audit history (see [`.agents/audit.md`](.agents/audit.md)). Specifically, **every PR must satisfy all of these**:

1. Every file calling `llmCall(` or `llmStream(` has `assertWithinSpend` and `recordAiUsage` (or `persistAssistantTurn`) in the same file.
2. Every mutating API route (`POST`/`PUT`/`PATCH`/`DELETE`) uses `requireAuth({ minRole })` AND `parseBody(...)` — unless the file is listed in the documented exclusions (public webhooks, MCP, Stripe webhook, body-less actions).
3. Every `executeFlow(` outside the worker passes `signal: AbortSignal` (or you switch to `enqueueFlowRun(...)` for async).

Run it locally before pushing:

```bash
bash scripts/audit-invariants.sh
```

If you're introducing a new file that legitimately needs to be excluded, add it to the script's `EXCLUDE_*` list in the same PR with a short comment explaining why.

## Pull Request process

1. **Open an issue first** for non-trivial changes. Quick alignment beats a rejected PR.
2. **Fork & branch** from `main`. Use a descriptive branch name (`feat/llm-retry-backoff`, `fix/quota-period-edge-case`).
3. **Write or update tests** — vitest. We don't require 100% coverage; we require *meaningful* coverage of the change.
4. **Run the local checks** before pushing:
   ```bash
   pnpm --filter @orchester/web exec tsc --noEmit   # type-check
   pnpm --filter @orchester/web exec vitest run     # unit tests
   bash scripts/audit-invariants.sh                 # invariants guard
   ```
5. **Sign off your commits** (DCO — see next section). The PR's CI will reject unsigned commits.
6. **Open the PR** filling out the template. Include screenshots for UI changes; include a short justification for behavior changes.
7. **Iterate on review**. Maintainers will respond within a few business days. Please don't take feedback personally — reviews are about the code, not you.
8. **Squash & merge** is the default. Your commit message becomes the PR title; keep it conventional.

## Developer Certificate of Origin (DCO)

Orchester uses the **Developer Certificate of Origin** instead of a Contributor License Agreement. The DCO is a lightweight, signed declaration that you have the right to contribute your code under the project's license. It's the same mechanism used by the Linux kernel, Docker, GitLab, and many other projects.

**What you need to do**: add a `Signed-off-by:` trailer to every commit. Git can do this for you automatically:

```bash
git commit -s -m "feat(flows): add try/catch node"
# becomes:
# feat(flows): add try/catch node
#
# Signed-off-by: Your Name <your.email@example.com>
```

The DCO text (which the sign-off attests to) is reproduced in [`.github/DCO.txt`](.github/DCO.txt). It's three short paragraphs.

**Forgot to sign off?** Amend or rebase:

```bash
git commit --amend --no-edit --signoff               # last commit
git rebase HEAD~N --signoff                          # the last N commits
```

CI checks every commit on the PR. Unsigned commits block the merge.

## Maintainers' responsibilities

Maintainers commit to:

- **Respond** to issues and PRs within a few business days.
- **Explain rejections** — if we close your PR without merging, you'll know why and what would change our mind.
- **Credit your work** — meaningful contributions earn a mention in release notes.
- **Keep this document honest** — if our process changes, this file changes with it.

If a maintainer ever falls short of these, please let us know via Discussions or the security channel.

---

Thank you again for being here. Happy hacking.
