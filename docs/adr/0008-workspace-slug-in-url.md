# 0008. URL path includes workspaceSlug

- Status: Accepted
- Date: 2026-05-23

## Context

Phase D needed a way for users in multiple workspaces to switch context without re-authenticating. Three options:

1. Subdomain per workspace (`acme.orchester.app`).
2. URL path segment (`orchester.app/en/acme/...`).
3. Header-only (`x-tenant: acme`) with active workspace stored in a cookie.

See `docs/specs/2026-05-23-tenant-hardening-design.md` §3.5.

## Decision

Use **URL path segment**: `/[locale]/[workspaceSlug]/...`. The slug is the canonical tenant identifier in every internal link. A cookie (`orch-active-workspace`) bridges the gap when the user lands on a generic URL (see ADR-0011).

## Consequences

**Positive:** copy-paste-shareable URLs; no DNS / TLS-cert complexity per tenant; works identically on self-host; switching tabs to different workspaces is unambiguous.
**Negative:** every internal link must include the slug (Phase D had to sweep ~400 links); long URLs.
**Revisit when:** an Enterprise customer needs vanity subdomains for branding (add subdomain as an aliased path resolver, keep path canonical internally).
