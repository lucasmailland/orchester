# Channels

**Route:** `/[locale]/channels`
**Files:**
- `apps/web/app/[locale]/(shell)/channels/page.tsx`
- `apps/web/components/channels/{ChannelsClient,WidgetChat}.tsx`
- `apps/web/app/api/channels/{route,[id]/route,telegram/webhook/[secret]}.ts`
- `apps/web/app/api/embed/route.ts` (public embed.js)
- `apps/web/app/api/widget/[channelId]/messages/route.ts`
- `apps/web/app/widget/[channelId]/page.tsx` (iframe page)
- `apps/web/lib/channels/{router,telegram}.ts`

**Owner:** channels
**Status:** Web Widget + Telegram + API public stable; Slack/WhatsApp/Email scaffolded

## Purpose
Connect agents to the outside world. Each "channel" is a typed config
(widget / telegram / slack / whatsapp / email / api) bound to one agent.

## Planning (initial design)

### Goals
- Plug-and-play setup: paste a token, the channel "just works".
- Public surface: every channel exposes a unique `secret` URL for inbound
  webhooks; the widget and `/api/widget/.../messages` are CORS-open.
- Single inbound router (`lib/channels/router.ts`) handles every channel type.

### User flows
1. Pick a channel type from the gallery → "Conectar".
2. Pick the agent that should answer.
3. (Telegram) paste bot token → server auto-registers webhook.
4. (Widget) copy the `<script>` snippet → paste in any HTML page.
5. (API) copy POST URL → use from any code.
6. Toggle channel active/inactive with one click.

### Data
**Table:** `channel` with: `kind`, `agentId`, `secret`, `credentialsEncrypted` (AES-256-GCM JSON), `config`.

**Endpoints:**
- `GET/POST /api/channels` (list + create)
- `GET/PATCH/DELETE /api/channels/[id]`
- `POST /api/channels/telegram/webhook/[secret]` (public, Telegram inbound)
- `POST /api/widget/[channelId]/messages` (public, CORS open)
- `GET /api/embed?c=<channelId>` (returns `embed.js` to mount the widget)

### Components
- **ChannelsClient** — list + create + per-channel drawer with token input,
  status toggle, embed snippet copy, webhook URL display.
- **WidgetChat** — minimal chat UI rendered inside the iframe at
  `/widget/[channelId]`. Uses localStorage for visitor persistence.
- **lib/channels/router.ts → handleInbound()** — the one place where:
  1. Look up channel + agent.
  2. Find or create conversation by `externalId`.
  3. Persist user message.
  4. If agent.kind=flow → run flow. Else → llm-call loop with tools.
  5. Persist assistant message + emit `usage_event`.
  6. If conversation is taken-over by a human, return without LLM call.

### Decisions & trade-offs
- **Credentials encrypted** with AES-256-GCM at rest. Decrypted only when
  invoking the upstream API.
- **Telegram via simple `setWebhook`** — no polling. Trade-off: requires the
  app to be reachable on a public URL (`NEXT_PUBLIC_APP_URL`).
- **Widget is iframe-based** rather than a Web Component to keep host-page CSS
  isolation. Trade-off: 1 extra request to load the iframe page.
- **Slack/WhatsApp/Email scaffolded** — adapter shape is fixed, but no full
  OAuth flow yet. Marked "Beta" in UI.

## Execution (changelog — newest first)

### 2026-04-28 — Phase 4 channels
- channel schema extended with `kind` enum, `agentId`, `secret`, `credentialsEncrypted`.
- Web Widget: embed.js + iframe + CORS-open messages endpoint.
- Telegram: full inbound (webhook) + outbound (sendMessage), auto-register on token save.
- ChannelsClient with per-channel drawer.
- Inbound router unifies LLM-tools-loop and flow execution.

## Performance notes
- Inbound router is the hot path for every channel message — it's optimized
  for round-trip ≤ 1 s + LLM time.
- Messages and conversations both have `(workspaceId, externalId)` indexed
  via composite indices.
- Widget iframe gzipped HTML ≈ 6 KB.

## Open issues / TODO
- WhatsApp via Twilio (full impl) and Meta Cloud API.
- Slack OAuth + slash command + DM listener.
- Email inbound (Postmark routing) + outbound templates.
- Widget customization UI (color, position, greeting) — schema has `config`,
  needs UI.
- Streaming for widget responses (SSE).
- Per-channel rate limit (today rate limit is workspace-wide).
