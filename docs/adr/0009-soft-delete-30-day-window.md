# 0009. Workspace lifecycle: soft-delete with 30-day restore window

- Status: Accepted
- Date: 2026-05-23

## Context

Deleting a workspace destroys agents, conversations, knowledge bases, billing history — irreversible at scale. Customers occasionally request deletion in error (wrong workspace, employee acting on stale instructions). Hard-delete on click is hostile.

The alternative — never delete, soft-flag forever — bloats the DB and complicates GDPR right-to-be-forgotten (Art. 17, must purge within "without undue delay").

See `docs/specs/2026-05-23-tenant-hardening-design.md` §4.

## Decision

Soft-delete sets `status='deleted'`, `deleted_at=now()`, `delete_scheduled_at=now()+30d`, and mints a one-shot `restore_token`. A daily cron (`workspace:hard_delete`, 04:00 UTC) deletes rows whose window has expired, cascading through every tenant FK.

30 days is the EU GDPR "reasonable" upper bound while still letting customers reverse a mistake.

## Consequences

**Positive:** mistake-recovery is one HTTP call; GDPR-compliant; the audit chain survives the soft-delete and is captured before hard-delete.
**Negative:** soft-deleted workspaces still consume storage for 30 days; restore-via-token requires careful UX to avoid the token leaking in emails.
**Revisit when:** legal asks for a shorter window or a customer-configurable retention dial.
