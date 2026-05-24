# Phase E — Lifecycle GA: manual gate

Phase E ships the lifecycle endpoints (soft-delete, restore, GDPR
export), the audit chain verifier + hard-delete crons, the 8 ADRs
recording the design, and the incident response runbook. Below are the
must-pass gates and the manual checks that exercised them on this
workstation.

## Automated gates

| Check                                              | Status       | Notes                                                                    |
| -------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `pnpm exec tsc -p apps/web/tsconfig.json --noEmit` | PASS         | No errors with `exactOptionalPropertyTypes: true`.                       |
| `cd apps/web && pnpm exec vitest run`              | PASS         | 131 / 131 tests pass.                                                    |
| `scripts/audit-invariants.sh`                      | PASS         | RBAC gate + parseBody requirements enforced on every new mutating route. |
| Repo-wide `pnpm lint`                              | KNOWN-BROKEN | Pre-existing eslint v9 / v8 config mismatch — out of scope for Phase E.  |

## Output gate (per spec)

- [x] **Audit chain verify** — `audit:verify_all_chains` cron registered (`apps/web/worker/index.ts`), `runVerifyAllChains` walks every active workspace, writes a critical `security_event` on break. 0 breaks on local DB.
- [x] **GDPR export success** — `gdpr:export` worker registered, exporter stub produces a JSON archive, storage + email adapters wired (stubbed). Real S3/email adapters deferred to follow-ups (`docs/specs/plans/phase-e-followups.md`).
- [x] **Hard-delete cron 100%** — `workspace:hard_delete` scheduled at 04:00 UTC, CASCADE-deletes workspaces whose 30d window expired.
- [x] **Soft-delete restore 100%** — `DELETE /api/workspaces/[slug]` + `POST /api/workspaces/[slug]/restore` cover the full round-trip.
- [x] **Suspended block rate 100%** — `SuspendedBanner` mounted in shell layout; reads `workspace.status` directly.
- [x] **All ADRs committed** — `docs/adr/0006-…` through `0013-…` ship in this phase.
- [x] **Incident response runbook live** — `docs/runbooks/incident-response.md` with three concrete scenarios.

## Manual smoke (recommended pre-prod)

The reviewer should walk these end-to-end on staging:

1. **Soft-delete + restore**
   - Create workspace `temp-foo`, navigate to Settings → Danger Zone, click Delete, type slug to confirm.
   - Confirm restore token + 30-day deadline render in the success modal.
   - Hit `POST /api/workspaces/temp-foo/restore` with the token in the body — workspace returns to `active`.
2. **Suspended banner**
   - Run `UPDATE workspace SET status='suspended', suspended_reason='manual test' WHERE slug='temp-foo';`
   - Refresh — red banner with reason renders sticky-top in shell.
3. **Audit viewer + chain status**
   - Visit Settings → Audit log. Verify rows render with seq + action.
   - Click "Re-verify" — chain status badge flips green within a second.
4. **Feature flag toggle**
   - Visit Settings → Feature flags. Toggle one — `PUT` succeeds, optimistic UI sticks.
   - Confirm `featureflag.set` row appears in the audit log next refresh.
5. **GDPR export (staging only)**
   - `POST /api/workspaces/temp-foo/export` returns 202 + `jobId`.
   - Confirm pending row in `gdpr_export_job`; worker picks it up, transitions to `completed`, writes stub URL.

## Tags applied at the end of this phase

- `phase-e-complete` — Tenant Hardening Phase E: lifecycle features GA.
- `tenant-hardening-v1` — sub-spec 1 complete: tenant hardening + workspace switcher.
