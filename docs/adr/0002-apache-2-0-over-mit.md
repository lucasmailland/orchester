# 0002. License under Apache 2.0 (not MIT)

- Status: Accepted
- Date: 2026-05-22

## Context

Orchester is being open-sourced. The pragmatic choice for a permissive license is between MIT and Apache 2.0; the maintainer's initial preference was MIT because it's familiar and culturally default in JavaScript ecosystems.

Two concrete properties matter for this project:

1. **Patent exposure.** The platform integrates with many AI vendors, ships novel composition over their APIs, and is plausibly subject to forward patent claims. MIT is silent on patents; Apache 2.0 grants contributors' patent rights to users and revokes them automatically on patent litigation.
2. **Trademark protection.** "Orchester" as a name should be defensible if the project succeeds. MIT does not address trademarks; Apache 2.0 explicitly carves trademarks out of the grant.

There's also a soft third factor: enterprise adoption. Procurement teams typically have Apache 2.0 in their pre-cleared list. MIT is also pre-cleared, but the patent grant frequently matters for legal review.

## Decision

License under **Apache License 2.0**.

We include:

- `LICENSE` — the full Apache 2.0 text.
- `NOTICE` — required by §4(d). Lists project name, copyright holder, and any third-party attributions that require notice propagation.
- An SPDX identifier (`Apache-2.0`) in every published `package.json`.

Contributors keep their copyright. They license their contributions to the project under Apache 2.0 implicitly via the DCO sign-off (see [ADR 0004](0004-dco-over-cla.md)) — Apache 2.0 §5 specifies inbound = outbound by default.

## Consequences

**Positive.** Explicit patent grant deters patent trolling. Trademark protection is preserved. Compatible with the major permissive licenses we depend on (MIT, BSD, ISC). Acceptable for downstream commercial use including SaaS hosting.

**Negative.** Apache 2.0 is incompatible with GPLv2 (without the "or later" clause). We accept this — the project doesn't currently link to GPLv2-only code, and contributors are expected to flag any new dependency under GPLv2-only during review.

**Watch for.** If a dependency lands under GPLv2-only or any "AGPL" / "SSPL" / non-OSI-approved "source available" license, the license check in CI must flag it. The license inventory in [`docs/dependency-licenses.md`](../dependency-licenses.md) is reviewed every release.

## Alternatives considered

- **MIT.** Familiar, short, ubiquitous. Rejected for the patent and trademark gaps described above.
- **MPL 2.0.** File-level copyleft. Rejected — too restrictive for what is intended as a permissively-reusable platform layer.
- **AGPLv3.** Network copyleft. Rejected — it gates exactly the use case (hosted derivatives) we want to encourage, contradicting the goal of broad adoption.
- **BSL / Elastic License / SSPL.** "Source available" rather than OSS. Rejected — they create friction with the OSI definition, with Linux distributions, and with the procurement teams we want to make adoption easy for.
