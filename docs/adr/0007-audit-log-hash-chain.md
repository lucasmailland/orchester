# 0007. Audit log: tamper-evident hash chain

- Status: Accepted
- Date: 2026-05-23

## Context

Compliance frameworks (SOC 2, ISO 27001, HIPAA) require an audit trail that an operator cannot silently modify. A naive append-only table is insufficient: anyone with DB superuser access (an insider, a compromised migration job, a backup-and-restore swap) can rewrite history without leaving a trace.

The two practical approaches: ship audit events to an external WORM store (Cloud-only solution, complicates self-host), or embed cryptographic integrity into the row itself.

See `docs/specs/2026-05-23-tenant-hardening-design.md` §3.3-§3.4.

## Decision

Audit rows form a per-workspace hash chain. For each entry we persist:

- `payload_hash = sha256(canonical_json({action, actor, target, meta, createdAt}))`
- `chain_hash = sha256(prev_chain_hash || payload_hash || seq)`

A daily cron (`audit:verify_all_chains`) walks every active workspace and writes a critical `security_event` on any break. The verifier endpoint (`GET /workspaces/[slug]/audit/verify`) exposes the same check on demand.

## Consequences

**Positive:** integrity is checkable offline (any backup); no external storage dependency; cheap (~200 bytes per row).
**Negative:** tampering is detectable, not prevented — restoration still requires backups; canonical JSON serialisation must be exact across language versions.
**Revisit when:** a customer requires write-once storage (then ship to S3 Object Lock as a secondary sink).
