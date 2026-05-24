# Incident Response Runbook — Tenant Isolation & Audit

This runbook covers the security-critical incident classes introduced by the tenant hardening sub-spec (ADR-0006 through ADR-0013). Pair it with the existing infra runbook for outage handling.

## Severity classification

| Severity | Description                                                                                            | Examples                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| SEV-1    | Critical: cross-tenant data leak confirmed, audit chain break confirmed, ransomware, data exfiltration | A tenant queries `/api/agents` and gets another tenant's rows; `audit:verify_all_chains` finds a break. |
| SEV-2    | High: suspected breach, mass auth failures, isolation E2E test fail in prod                            | Spike of 403s after a deploy; a customer claims they saw another tenant's name in a dropdown.           |
| SEV-3    | Low: anomaly, single user complaint                                                                    | One user sees a stale workspace name; an audit log row looks oddly timed.                               |

## Phase A — Triage (0-15 min)

1. **On-call ack the alert.** PagerDuty alerts on `audit.chain_break_detected` (SEV-1 by default).
2. **Identify scope.** Single workspace? Multiple? All? Use the workspace IDs in the alert payload.
3. **Severity classification** (table above).
4. **Open incident channel** in Slack: `#inc-YYYYMMDD-N`. Pin the alert, the on-call, and a link to this runbook.

## Phase B — Containment (15-60 min)

Containment actions are class-specific:

- **Cross-tenant leak**: disable the affected endpoint via per-workspace feature flag (`setFlag(workspaceId, "endpoint.disabled", true)`); freeze writes by flipping the workspace to `status='suspended'` (`POST /api/workspaces/[slug]/suspend` — admin-global only).
- **Audit chain break**: snapshot Postgres immediately (`pg_dump --no-owner --format=custom orchester > snapshot-$(date +%s).dump`); preserve forensics. Do NOT auto-suspend the workspace — human decision.
- **Auth compromise**: force logout via `session.revoke_all`; rotate Better-Auth session secret in env; redeploy.
- **Data exfil suspected**: revoke API keys (`apikey.revoke` from settings); suspend outbound webhooks (`webhook.manage` admin).
- **Key compromise**: rotate `STORAGE_ENCRYPTION_KEY` env; re-encrypt at-rest blobs; flush caches.

## Phase C — Eradication & recovery (1-24 h)

1. Patch root cause (the bug, the misconfig, the leaked credential).
2. Re-enable affected systems incrementally; watch the same telemetry that caught the issue (`recordTenantContextMissing`, audit chain verifier).
3. Restore from backup if data was destroyed.
4. Notify affected customers within 72 h (GDPR Art. 33).

## Phase D — Post-mortem

- Blameless post-mortem within 5 business days.
- Action items become GitHub issues, prioritised.
- Update threat model (`docs/specs/2026-05-23-tenant-hardening-design.md` §6).
- If the gap is a missing automated check, add it to `scripts/audit-invariants.sh` so the same class of bug fails CI next time.

## Common scenarios

### Scenario: Audit chain break detected (PagerDuty alert)

1. **Snapshot Postgres state**:
   ```
   pg_dump --no-owner --format=custom orchester > snapshot-$(date +%s).dump
   ```
2. **Identify which workspace + entry**:
   ```sql
   SELECT * FROM security_event
   WHERE event_type='audit_chain.break_detected'
   ORDER BY created_at DESC LIMIT 5;
   ```
   The `detail` JSON has `entryId`, `expectedHash`, `foundHash`.
3. **Reproduce locally**: `await verifyChain(workspaceId)` from `apps/web/lib/audit/verify.ts` against a fresh restore of the snapshot — confirm the break is in the data, not the verifier.
4. **Lock down**: do NOT auto-suspend the workspace. Human decision. Read access stays open; freezing writes is a separate gesture (`POST /workspaces/[slug]/suspend`).
5. **Investigate**: was it (a) a deploy bug that wrote bad rows, (b) a malicious actor with DB access, or (c) DB-level tampering? Cross-reference with Postgres logs and `pg_stat_activity` history.
6. **Notify the workspace owner within 72 h** if breach is confirmed (Art. 33).

### Scenario: Cross-tenant leak suspected

1. **Disable affected endpoint** via feature flag (`setFlag` in `apps/web/lib/feature-flags/admin.ts`).
2. **Snapshot logs** of affected requests (request IDs from the access log).
3. **Inspect SQL trail** in Postgres logs around those request IDs.
4. **Verify RLS is FORCED** on the affected table:
   ```sql
   SELECT tablename, forcerowsecurity
   FROM pg_tables WHERE tablename='<X>';
   ```
   If `forcerowsecurity` is `false`, ADR-0010 was violated — file an immediate fix.
5. **Patch the code path; redeploy.**
6. **Run isolation E2E suite** against staging with the fix: `cd apps/web && pnpm exec vitest run tests/isolation`.
7. **Notify all affected customers** within 72 h.

### Scenario: GDPR export job stuck

1. **Check job state**:
   ```sql
   SELECT id, state, progress, error, retry_count, started_at, created_at
   FROM gdpr_export_job
   WHERE workspace_id='<id>'
   ORDER BY created_at DESC LIMIT 5;
   ```
2. **If `state='exporting'` for > 1 h**, the worker crashed mid-run. Inspect `apps/web/lib/gdpr/export-job.ts` (`runExportJob`) for the failed step.
3. **Mark failed via direct SQL** (under `cron_admin` role):
   ```sql
   UPDATE gdpr_export_job SET state='failed', error='manual_reset'
   WHERE id='<jobId>';
   ```
4. **Re-enqueue**: from a Node REPL or one-shot script,
   ```ts
   import { enqueue, JOB_GDPR_EXPORT } from "@/lib/queue";
   await enqueue(JOB_GDPR_EXPORT, { jobId: "<id>" });
   ```

### Scenario: Hard-delete cron didn't run

1. Check pg-boss state:
   ```sql
   SELECT name, state, created_on, completed_on, output
   FROM pgboss.job
   WHERE name='workspace:hard_delete'
   ORDER BY created_on DESC LIMIT 5;
   ```
2. If the last successful run is > 25 h old, manually trigger from a Node script: `await runHardDeleteCron()` from `apps/web/lib/tenant/hard-delete-job.ts`.
3. If cascade DELETE errors out (foreign key without `ON DELETE CASCADE`), file a schema fix; do NOT manually clean up rows — the integrity invariant is "cascade or nothing".
