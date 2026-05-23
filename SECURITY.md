# Security Policy

We take the security of Orchester seriously. If you believe you have found a security vulnerability in this project, we ask that you report it to us privately — **not** as a public GitHub issue.

## Reporting a vulnerability

The preferred channel is **GitHub's private vulnerability reporting**:

> https://github.com/lucasmailland/orchester/security/advisories/new

Alternatively, you can email the maintainer at **lucasmailland@gmail.com** with the subject prefixed `[Orchester Security]`. If you want to encrypt your report, request a PGP key in your first message.

Please include:

- A clear description of the issue and its potential impact.
- The version, commit SHA, or branch where you reproduced it.
- Reproduction steps or a minimal proof of concept.
- Any logs, screenshots, or test cases that help us understand the problem.
- Your name / handle and how you'd like to be credited (or "anonymous" — your call).

**Do not** include real user data, real API keys, or production credentials in your report. If a finding requires those to reproduce, describe the conditions rather than sharing the values.

## What we commit to

| Stage                                 | SLA                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Acknowledge receipt                   | within **72 hours**                                                         |
| Initial assessment (severity + plan)  | within **7 days**                                                           |
| Fix released for high/critical issues | aim **30 days** from validation                                             |
| Coordinated disclosure                | published with the fix, crediting the reporter unless they prefer anonymity |

We will keep you informed of progress throughout. If a finding turns out not to be a vulnerability, we will explain why.

## Scope

The following are **in scope**:

- The Orchester codebase in this repository (`apps/web`, `packages/db`, `scripts/`).
- The default deployment patterns documented in `README.md` / `docs/RUNBOOK.md`.
- The CI workflows in `.github/workflows/`.

The following are **out of scope** (please don't report these):

- Vulnerabilities in third-party dependencies — please report those to the upstream project. We do monitor `pnpm audit` and patch promptly.
- Social engineering or physical attacks against maintainers.
- Denial-of-service attacks requiring unreasonable rate / volume.
- Self-XSS that requires the victim to paste attacker-controlled content into their own browser.
- Misconfigurations of a self-hosted deployment (e.g. exposing the admin endpoint to the public internet without auth) — those are responsibility of the operator.

## Disclosure policy

We follow **coordinated disclosure**. After a fix is released, we publish a GitHub Security Advisory describing the issue, affected versions, fix versions, and credits. We do not publicly discuss unpatched vulnerabilities.

If you discover an issue that is already being exploited in the wild, we will accelerate the disclosure timeline accordingly — please flag this in your report.

## Supported versions

This project is in active development. Until we cut a v1.0 release, **only the `main` branch is supported**. We do not backport security fixes to older commits.

Once we cut versioned releases, we will update this table:

| Version      |    Supported    |
| ------------ | :-------------: |
| `main` (dev) |       ✅        |
| `v0.x`       | ✅ latest minor |
| older        |       ❌        |

## Safe harbour

We will not pursue legal action against researchers who act in good faith and follow this policy. Specifically, we consider security research conducted under this policy as:

- **Authorized** under any applicable anti-hacking statutes (e.g. CFAA in the US, similar laws elsewhere) for the purpose of finding and reporting the vulnerability.
- **Exempt** from the restrictions in our Terms of Service that would otherwise interfere with the research.

This safe harbour applies if you:

- Make a good-faith effort to avoid privacy violations, destruction of data, interruption of service, or financial harm.
- Stop your testing and notify us as soon as you confirm a vulnerability.
- Give us a reasonable opportunity to fix the issue before any public disclosure.

Thank you for helping keep Orchester and its users safe.
