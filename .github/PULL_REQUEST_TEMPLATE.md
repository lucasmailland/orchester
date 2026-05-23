<!--
Thanks for your contribution to Orchester!

Before submitting:
  • Read CONTRIBUTING.md once.
  • Sign off your commits with `git commit -s` (DCO — required).
  • Run locally: tsc, vitest, and scripts/audit-invariants.sh.

The CI runs all three automatically and will block the merge if any fail.
-->

## What does this PR do?

<!-- One short paragraph. What changes and why. -->

## Related issue / discussion

<!-- "Closes #123" — or link to a Discussion if it's a proposal. -->
Closes #

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior in a non-backwards-compatible way)
- [ ] Refactor / chore / docs only
- [ ] Performance improvement
- [ ] Test-only change

## How was this tested?

<!-- Manual steps, new tests added, what you ran locally. -->

## Screenshots / recordings (if UI)

<!-- Drop screenshots, before / after, or a short loom / gif. -->

## Checklist

- [ ] My commits are **signed off** (`git commit -s`)
- [ ] Tests pass locally: `pnpm --filter @orchester/web exec vitest run`
- [ ] Type-check passes: `pnpm --filter @orchester/web exec tsc --noEmit`
- [ ] Invariants guard passes: `bash scripts/audit-invariants.sh`
- [ ] Docs updated if behavior or surface area changed
- [ ] If touching a security-sensitive area (encryption, auth-guards, rbac, flow-engine, net-guard, cost-alerts, migrations), I tagged a maintainer for review

## Notes for the reviewer

<!-- Anything they should pay extra attention to, design choices, follow-ups deferred, known caveats. -->
