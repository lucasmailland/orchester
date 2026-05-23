# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-05-22

## Context

The project is moving from solo work to an open-source contributor base. The reasoning behind structural decisions exists today only in commit messages, audit reports, and the founder's head. Neither of those scales: commit messages are searched once, audit reports get archived, and humans forget.

We want a single, well-known place where someone can answer "why is it this way?" without spelunking.

## Decision

We adopt Architecture Decision Records (ADRs) — short, numbered, append-only markdown files in [`docs/adr/`](.). The format is the one popularized by Michael Nygard's 2011 post, simplified to the sections we actually use.

Each ADR has:

- A numeric prefix in the filename (`NNNN-kebab-case-title.md`).
- A `Status` field (`Proposed | Accepted | Superseded by NNNN | Deprecated`).
- A `Date` field (ISO date of ratification).
- `Context`, `Decision`, `Consequences` sections at minimum.

ADRs are PRs like anything else. They go through the same review path defined in [`GOVERNANCE.md`](../../GOVERNANCE.md), with the same DCO sign-off requirement.

Superseding an ADR means writing a new one that references the older one and bumping the older one's `Status` to `Superseded by NNNN`. We never delete or rewrite history — the chain is the value.

## Consequences

**Positive.** Reasoning becomes durable, searchable, and discoverable from a single index. New contributors have a starting point. Disagreements about past decisions become productive ("the ADR's premise no longer holds because X") rather than ad-hoc.

**Negative.** Some small overhead per significant decision. A bias toward over-documenting decisions that don't deserve an ADR is possible — mitigated by the "when to write one" criteria in the directory README.

## Alternatives considered

- **A `decisions/` folder of free-form notes.** Rejected — no structure means nothing gets read.
- **Issue threads tagged `decision`.** Rejected — issue threads close and become hard to find; markdown in the repo is searchable forever.
- **A wiki.** Rejected — the wiki is outside the repo, so it drifts out of sync with the code.
