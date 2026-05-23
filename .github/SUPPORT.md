# Getting help

This file is for **users** of Orchester who need help running, deploying, or building with it. If you want to **contribute code or docs**, see [CONTRIBUTING.md](CONTRIBUTING.md) instead. If you found a **security vulnerability**, see [SECURITY.md](SECURITY.md).

## Quickly: which channel?

| You want to …                                      | Use                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Ask "is this supposed to work this way?"           | [GitHub Discussions → Q&A](https://github.com/lucasmailland/orchester/discussions/categories/q-a)                       |
| Share what you built with Orchester                | [GitHub Discussions → Show and tell](https://github.com/lucasmailland/orchester/discussions/categories/show-and-tell)   |
| Propose an idea (before opening a feature request) | [GitHub Discussions → Ideas](https://github.com/lucasmailland/orchester/discussions/categories/ideas)                   |
| Report a bug with reproduction steps               | [Bug Report issue](https://github.com/lucasmailland/orchester/issues/new?template=bug_report.yml)                       |
| Request a concrete feature                         | [Feature Request issue](https://github.com/lucasmailland/orchester/issues/new?template=feature_request.yml)             |
| Report a security vulnerability                    | [Private advisory](https://github.com/lucasmailland/orchester/security/advisories/new) (see [SECURITY.md](SECURITY.md)) |

## Before asking

A 60-second checklist saves everyone time:

1. **Search existing issues + discussions.** Most "obvious" questions have been asked. Use specific keywords from the error message.
2. **Read the README** quickstart end to end. The `.env` example, migration step, and worker process are easy to miss the first time.
3. **Confirm the basics**:
   - Node 22 and pnpm 9 installed
   - Postgres 15+ running with the `pgvector` extension enabled
   - Migrations applied: `pnpm --filter @orchester/db migrate`
   - **Worker is running** in a second terminal: `pnpm worker:dev` (flows don't execute without it)
   - `.env` has the required vars: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET`

## How to write a great question

The more context, the faster the answer:

- **Version** — output of `git rev-parse --short HEAD` or the release tag.
- **What you tried** — exact commands or steps.
- **What you expected** vs **what happened** — be specific.
- **Logs** — paste relevant output (redact secrets). Server logs + browser console if it's a UI issue.
- **Environment** — local dev / Docker / Vercel / VPS; Node version; Postgres version.

A great question gets answered in hours. A vague one waits for someone with the energy to play 20 questions — could be days.

## Response expectations

Orchester is maintained by a small team (currently solo + community contributors). We try to:

- **Acknowledge** new issues and Discussion posts within a few business days.
- **Triage** with a label and a question or pointer to the right area.
- **Resolve or close** with an explanation — we don't leave threads hanging silently.

If we miss something, a friendly nudge on the thread is fine. Please don't @-mention multiple maintainers at once; it doesn't make the answer come faster and tends to deter the community from chiming in.

## What's NOT supported here

- **Production incidents on third-party hosting** — your cloud provider's support handles deployment infrastructure. We help with Orchester itself.
- **Private 1:1 consulting** — we don't offer paid support for Orchester (yet). If you need that scale of help, hire a contractor familiar with Next.js + Postgres, or [sponsor the project](https://github.com/sponsors/lucasmailland) to get on a future commercial support tier.
- **Build-it-for-me requests** — we're happy to clarify how Orchester works; we can't write your business logic for free.

## Community

- **Discussions:** https://github.com/lucasmailland/orchester/discussions
- **Code of Conduct:** [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — please read before participating.

Thanks for being here. We genuinely want this to be useful to you.
