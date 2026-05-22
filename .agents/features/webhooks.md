# Webhooks (in & out)

**Files:**
- Outbound: `apps/web/lib/webhooks-out.ts`,
  `apps/web/app/api/webhooks-out/{route,[id]/route}.ts`
- Flow inbound: `apps/web/app/api/webhooks/[secret]/route.ts`
- Telegram inbound: `apps/web/app/api/channels/telegram/webhook/[secret]/route.ts`
- Stripe inbound: `apps/web/app/api/billing/webhook/route.ts`

**Owner:** integrations
**Status:** stable for outbound + flow + telegram + stripe

## Purpose
Two-way webhook plumbing. Inbound: trigger flows + receive channel messages
+ Stripe events. Outbound: notify external systems when interesting
workspace events happen.

## Planning (initial design)

### Inbound webhook types
1. **Flow webhook** (`/api/webhooks/[secret]`) — POST or GET triggers a flow.
   - Stored in `flow_webhook` table (per-flow, optional HMAC key).
   - Body parsed as `input`; query params merged as `_query`.
   - Increments `triggerCount`.

2. **Telegram inbound** (`/api/channels/telegram/webhook/[secret]`) —
   Telegram POSTs Update objects. Routed via `lib/channels/router.ts`.

3. **Stripe inbound** (`/api/billing/webhook`) — subscription events.
   Signature verified with `STRIPE_WEBHOOK_SECRET`.

### Outbound subscriptions
- Workspace creates `outbound_webhook` rows: `{ url, secret, events[], enabled }`.
- Events: `agent.responded`, `flow.run.succeeded`, `flow.run.failed`,
  `conversation.created`, `conversation.escalated`, `kb.doc.indexed`.
- Dispatcher: `dispatchEvent(workspaceId, event, payload)` finds matching
  subscriptions, signs body with HMAC-SHA256, retries 3x with backoff.
- Each delivery recorded in `webhook_delivery` table for observability.

### HMAC signature format
- Outbound: header `x-orchester-signature` = `sha256(secret + body)` hex.
- Inbound (flow): same header, verified before triggering.
- Stripe: their format `t=,v1=` parsed manually.

### Decisions & trade-offs
- **Fire-and-forget dispatch** — `dispatchEvent` returns immediately; failure
  is recorded but not propagated. Trade-off: caller doesn't block on slow
  subscriber.
- **3 retries with backoff** (500 ms × 2^attempt). After failure,
  `failureCount` increments; UI can show health.
- **No dead-letter queue yet** — failed deliveries stay as `failed` in
  `webhook_delivery`. Phase 6+ may add re-drive.

## Execution (changelog — newest first)

### 2026-05-21 — completeness + security hardening
- **Event catalog** expanded to 14 events (`WEBHOOK_EVENTS` in `webhooks-out.ts`):
  added `agent.created`, `conversation.closed`, `conversation.csat`,
  `message.received`, `integration.connected`. New `GET /api/webhooks-out/events`.
- **Test/ping:** `sendTestEvent()` + `POST /api/webhooks-out/[id] {action:"test"}`
  delivers a signed synthetic event; "Probar" button in DevelopersSection.
- **Deliveries viewer:** `GET /api/webhooks-out/[id]/deliveries` (last 25).
- `integration.connected` dispatched from `lib/integrations/store.ts`.
- **Security (audit fixes):**
  - Inbound `/api/webhooks/[secret]`: HMAC compare now timing-safe
    (`crypto.timingSafeEqual`, was `!==`); per-secret rate limit (60/min);
    1MB body cap; forwards only a safe header whitelist (was leaking
    Authorization/Cookie into the flow input).
  - Outbound: SSRF guard (`lib/net-guard.ts` `assertPublicUrl`) on create, edit,
    and before each delivery — blocks loopback/RFC1918/link-local (cloud metadata).
    PATCH previously had NO URL validation.
  - `failureCount` now increments (SQL `+ 1`) instead of being stuck at 0/1.

### 2026-04-28 — outbound webhooks
- `outbound_webhook` + `webhook_delivery` tables.
- 4 endpoints (CRUD + delivery list).
- DevelopersSection UI in Settings.

### 2026-04-28 — flow webhooks
- `flow_webhook` table with optional HMAC.
- Public `POST/GET /api/webhooks/[secret]`.

## Performance notes
- Outbound: each event spawns N parallel deliveries (N = matching subs).
- Indices on `(workspace_id, created_at DESC)` for `webhook_delivery`.

## Open issues / TODO
- Wire `dispatchEvent` calls into:
  - `lib/channels/router.ts` (agent.responded, conversation.created).
  - `lib/flow-engine.ts` (flow.run.succeeded/failed).
  - `app/api/knowledge-bases/[id]/docs` (kb.doc.indexed).
- Dead-letter / re-drive UI.
- Webhook test button in Developers section (sends a sample event).
- Idempotency keys on flow webhook trigger.
