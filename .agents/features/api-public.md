# Public API + API Keys

**Files:**
- `apps/web/lib/api-auth/key.ts` — generate / hash / authenticate
- `apps/web/app/api/api-keys/{route,[id]/route}.ts` — CRUD
- `apps/web/app/api/v1/{agents,flows}/route.ts` — public endpoints
- `apps/web/lib/rate-limit.ts` — in-memory token bucket
- `apps/web/components/settings/DevelopersSection.tsx`
- Schema: `api_key` (in `production.ts`)

**Owner:** api / production
**Status:** stable for read endpoints; write endpoints pending

## Purpose
Allow external systems to integrate with the workspace via REST. Bearer
token auth. Rate-limited. Plain key shown once at creation.

## Planning (initial design)

### Key lifecycle
1. User creates key in Settings → DevelopersSection.
2. Server returns `{ id, name, prefix, key }` — `key` shown ONCE.
3. Server stores `hashedKey` (SHA-256), `prefix` (first 12 + last 4 chars).
4. User uses `Authorization: Bearer ok_live_...`.
5. Server hashes incoming key, looks up by hash, checks `revokedAt`.
6. On use, updates `lastUsedAt` (fire-and-forget).
7. User can revoke → sets `revokedAt`.

### Public endpoints (so far)
- `GET /api/v1/agents` — list with `id, name, role, kind, model, status`.
- `GET /api/v1/flows` — list with `id, name, description, status, version`.
- All authenticated. All rate-limited.

### Rate limit
- Token bucket per workspace: 60 req / minute (capacity 60, refill 1/sec).
- In-memory (per-process). Single-node only — Phase 6 will move to Upstash
  Redis.

### Decisions & trade-offs
- **SHA-256 hash, not bcrypt.** Tokens are random 24 bytes; SHA-256 is fine
  for high-entropy material. Bcrypt would slow lookups.
- **Plain key shown ONCE** — no recovery. User must regenerate if lost.
- **Rate limit scoped to workspace, not key** — simpler, sufficient for now.
- **No scopes UI yet** — schema has `scopes` array, defaults to read+write
  on agents+flows. Tightening scopes is Phase 7+.

## Execution (changelog — newest first)

### 2026-04-28 — Phase 6
- Initial impl with 2 read endpoints.
- DevelopersSection UI.

## Performance notes
- `authenticateApiKey()` does 1 indexed lookup on `hashed_key`.
- Rate limit is O(1) in-memory.

## Open issues / TODO
- Write endpoints: `POST /api/v1/agents`, `PATCH /api/v1/flows/[id]`, etc.
- `POST /api/v1/agents/[id]/messages` — send a message and get a reply.
- Per-key scopes UI.
- Move rate limit to Upstash (multi-node).
- OpenAPI spec generation.
- SDK: `@orchester/sdk` npm package.
