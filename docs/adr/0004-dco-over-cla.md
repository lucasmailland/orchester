# 0004. Developer Certificate of Origin instead of a CLA

- Status: Accepted
- Date: 2026-05-22

## Context

Open-source projects with multiple contributors need a defensible answer to "where did this code come from, and does the project have the right to ship it?" Two common approaches:

1. **Contributor License Agreement (CLA).** Contributors sign a legal document (often via a bot or web form) granting the project specific rights to their contributions. Strong legal posture, but adds friction: every contributor reads and signs, sometimes through their employer's legal review process. CLAs have become culturally suspect in some communities (notably when used as a path to relicensing under proprietary terms later).
2. **Developer Certificate of Origin (DCO).** A short statement (DCO 1.1, originally from the Linux kernel project) that each contributor attests to _per commit_ by adding a `Signed-off-by:` trailer with `git commit -s`. The contributor asserts they have the right to submit the work under the project's license. No web form, no bot signup, no legal review beyond reading a paragraph.

The CLA is stronger if the project anticipates needing rights _beyond what the project license grants_, e.g. to relicense later or to grant exceptions. The DCO is sufficient if the project commits to staying inside its license.

Orchester is Apache 2.0 ([ADR 0002](0002-apache-2-0-over-mit.md)) and explicitly does not anticipate relicensing. The Apache License already handles inbound = outbound — contributions to an Apache 2.0 project are licensed back under Apache 2.0 by §5 of the license. The DCO adds the missing "I attest I have the right to do this" assertion.

## Decision

**Adopt the DCO.** Every commit must carry a `Signed-off-by:` trailer with a real legal name and reachable email. Enforced in CI by `christophebedard/dco-check@v1.4.2`.

The DCO text lives at [`.github/DCO.txt`](../../.github/DCO.txt). The contributing guide instructs new contributors how to sign off (`git commit -s`).

We do **not** require a CLA. The project will not relicense without unanimous contributor consent.

## Consequences

**Positive.** Contribution friction is minimal — one command. No third-party signup. No legal review needed for casual contributors. The DCO is a well-known, well-understood convention (Linux kernel, Docker, Kubernetes, GitLab Community Edition, etc.).

**Negative.** If the project ever needs to relicense or grant license exceptions (e.g. dual-licensing for embedded use), it requires contacting every contributor individually. We accept this — see "Watch for".

**Watch for.** If a commercial pathway emerges that requires relicensing or a dual-license model, this ADR will need to be superseded by one that introduces a CLA going forward (existing contributions remain under their original DCO terms). That hypothetical decision is far enough out that we don't pre-optimize for it.

## Alternatives considered

- **CLA (individual + corporate).** Rejected as premature optimization for a relicensing path we don't intend to take.
- **No formal attestation.** Rejected — too weak for any contributor base larger than the founder.
- **Both DCO and CLA.** Rejected — redundant, doubles the contribution friction without commensurate benefit.
