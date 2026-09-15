# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini and similar) working in this repository. The same rules apply to humans; see [`CONTRIBUTING.md`](CONTRIBUTING.md).

> `CLAUDE.md`, `.claude/`, `.agents/` and `docs/superpowers/` are gitignored as per-contributor files. This is the shared, versioned file. If your agent only reads `CLAUDE.md`, add a line with `@AGENTS.md` to it.

## Mandatory: no secrets in the repository

This repository is **public**. Anything committed stays in the history, even if the branch is deleted or the commit is reverted later. Treat every committed secret as leaked.

Never commit, in any file:

- API keys, access tokens, OAuth client secrets, webhook secrets, session cookies
- Passwords, private keys, certificates, connection strings with credentials
- `.env` files or copies of their values (`.env.example` holds placeholders only)
- Identifiers of a real deployment: internal hostnames and IPs, cloud account IDs, real email addresses, tenant or database names

This covers every file you write, not only source code. The findings in this repository's history came from places that look harmless:

- Implementation plans, specs and session notes that paste a key "for reference"
- Test fixtures copied from a real configuration
- CI workflow `env` blocks
- Logs, command output and error messages pasted into docs

Use instead:

- Environment variables read at runtime, documented in `.env.example` with placeholder values
- Obvious placeholders: `<YOUR_API_KEY>`, `sk-ant-api03-...`, `example.com`, `1234567`
- In tests, values that are visibly fake (`test-key`, `NRAK-testkey`) and hosts under `example.com`

### Before every commit

1. Read the staged diff (`git diff --cached`) looking for credentials and real identifiers.
2. Let the pre-commit hook run: it scans the staged changes with gitleaks. Never skip it with `--no-verify` or `-n`.
3. If the hook says gitleaks is not installed, install it (`brew install gitleaks`) before committing.

### If a secret was committed

Stop and tell the human you are working with. A follow-up commit that deletes the value does not fix anything: it is already in the history.

1. Revoke or rotate the secret first. That is the only step that makes the leak harmless.
2. Decide with a maintainer whether to rewrite history.
3. If a finding is a false positive or already revoked, add its fingerprint to `.gitleaksignore` with a comment saying why, in its own commit.

## Other conventions

Commits, code style, languages and the PR process are in [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: Conventional Commits with lowercase subjects, `git commit -s` (DCO), code and docs in English, and `tsc`, `vitest` and `scripts/audit-invariants.sh` passing before opening a PR.
