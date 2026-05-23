# Governance

Orchester is an open-source project. This document describes how decisions get made, who can make them, and how those rules evolve.

It is intentionally lightweight while the project is small. As contributor count and surface area grow, this document will too — but always in the direction of _more_ transparency, not less.

## Project structure

### Roles

**Users.** Anyone running Orchester. Open issues, ask questions in [Discussions](https://github.com/lucasmailland/orchester/discussions), submit ideas. No expectations beyond following the [Code of Conduct](CODE_OF_CONDUCT.md).

**Contributors.** Anyone who has had at least one PR merged. Listed in the GitHub contributors graph. No special permissions; same review process as everyone else.

**Maintainers.** Have write access to the repository. Review and merge PRs, triage issues, cut releases. Listed in [`.github/CODEOWNERS`](.github/CODEOWNERS).

**Lead maintainer.** [@lucasmailland](https://github.com/lucasmailland). Tiebreaker on disputed decisions, final say on scope and direction, accountable for the project’s health. The role is not permanent — see "Succession" below.

### Becoming a maintainer

The lead maintainer invites new maintainers based on demonstrated:

1. Sustained, high-quality contributions over time.
2. Good judgment in code review (engaging on others’ PRs, not just shipping their own).
3. Alignment with project values: simplicity, security, multi-tenancy as a default, refusal to take shortcuts that compound.

There is no fixed contribution threshold. The bar is qualitative.

Maintainers may step down at any time by opening a PR removing themselves from `CODEOWNERS`.

### Succession

If the lead maintainer becomes unavailable for an extended period (≥ 30 days without response on critical security or governance threads), the active maintainers may, by simple majority, designate an interim lead until the original lead returns or formally hands off the role.

If the lead maintainer formally steps down, they nominate a successor in a public Discussion; active maintainers ratify by simple majority.

## How decisions are made

### Day-to-day changes

Most changes — bug fixes, small features, docs, refactors — follow the normal PR flow:

1. Open an issue first if the change is non-trivial. This avoids wasted work.
2. Open a PR with the sign-off (DCO).
3. At least one maintainer reviews. For changes touching `CODEOWNERS`-protected paths, the relevant owner must approve.
4. CI must pass. The structural invariants guard (`scripts/audit-invariants.sh`) is non-negotiable.
5. Squash-merge to `main`.

### Bigger changes (features, breaking changes, scope shifts)

For anything that changes public API, alters core architecture, or commits the project to a new long-term direction:

1. Open a Discussion in [Ideas](https://github.com/lucasmailland/orchester/discussions/categories/ideas) describing the change, motivation, and alternatives considered.
2. Allow at least 7 days for feedback (longer for substantive proposals).
3. If consensus emerges, open the PR. If consensus does not emerge, the lead maintainer decides.

Most decisions are by [lazy consensus](https://www.apache.org/foundation/glossary.html#LazyConsensus) — silence is assent. Voting is only used when there’s an active disagreement among maintainers; simple majority of active maintainers wins, lead maintainer breaks ties.

### Security decisions

See [`SECURITY.md`](SECURITY.md). Vulnerabilities are handled privately by the lead maintainer (and any maintainer they delegate to) until fixed and disclosed. No public discussion of unfixed vulnerabilities.

### Releases

Releases are produced by [release-please](https://github.com/googleapis/release-please) from Conventional Commit messages on `main`. Cutting a release is the act of merging the release-please PR. Any maintainer may merge it; the lead maintainer is responsible for ensuring releases happen on a reasonable cadence.

See [`CHANGELOG.md`](CHANGELOG.md) for the format and policy.

## Values

These are the lenses every decision gets weighed against:

1. **Multi-tenancy is not retrofittable.** Features that can’t be made tenant-isolated by default get rejected, however clever.
2. **Security is structural, not procedural.** A bug fixed only at the sites named in the report is not fixed — the invariant has to hold everywhere. The audit playbook in `.agents/audit.md` encodes this.
3. **Self-hostability is a feature.** If a contribution requires a SaaS-only dependency or proprietary service, it needs a self-host fallback.
4. **Simplicity over flexibility.** When in doubt, fewer knobs. New configuration is a tax on every future reader of the codebase.
5. **Boring tech where it matters.** Postgres, Next.js, TypeScript, queues. We pay the cost of novelty only at the layers that justify it.

## Changing this document

Changes to `GOVERNANCE.md` follow the "bigger changes" path above. Opening a Discussion is required; lazy consensus over 7 days is required; lead maintainer ratifies.

## Code of conduct

Project participation — including governance discussions — is bound by the [Code of Conduct](CODE_OF_CONDUCT.md). Enforcement is delegated to the lead maintainer, with the option to designate an additional contact when conflict-of-interest demands it.
