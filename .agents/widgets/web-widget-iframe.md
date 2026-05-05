# Web Widget (public chat iframe)

**Files:**
- `apps/web/app/api/embed/route.ts` (serves `embed.js`)
- `apps/web/app/widget/[channelId]/page.tsx` (iframe page)
- `apps/web/components/channels/WidgetChat.tsx` (chat UI)
- `apps/web/app/api/widget/[channelId]/messages/route.ts` (public POST)

**Owner:** channels / public surface
**Status:** stable

## Purpose
Drop-in chat for any 3rd-party website. Customer pastes a `<script>` snippet
on their site → a floating button appears bottom-right → click opens a chat
iframe pointing to `/widget/<channelId>`.

## Planning (initial design)

### Architecture
```
3rd-party site
   ├─ <script src="ORIGIN/api/embed?c=CHANNEL_ID">
   │     creates floating button + iframe
   └─ iframe src="ORIGIN/widget/CHANNEL_ID"
         ├─ <WidgetChat /> — full-height chat UI
         └─ POST /api/widget/CHANNEL_ID/messages with { visitorId, text }
              → handleInbound() routes to agent
              → response shown in chat
```

### Key behaviors
- **Visitor ID persistence** in `localStorage` so conversations survive page reloads.
- **CORS open** on `/api/widget/*/messages` — required to talk from any origin.
- **Branding:** color, title, greeting, starters all read from
  `channel.config` (workspace customizes per channel).

### Decisions & trade-offs
- **Iframe**, not Web Component — strict CSS isolation from host page.
  Trade-off: 1 extra round trip to load the iframe page.
- **No tracking pixel** — privacy-first.
- **Static styles** in the iframe page (no Tailwind hydration) — minimum bundle.

## Execution (changelog — newest first)

### 2026-04-28 — Phase 4 channels
- Initial impl: embed.js JS-built (no innerHTML), iframe page, CORS-open
  POST endpoint, visitor localStorage.

## Performance notes
- `embed.js` is ~1.5 KB gzipped.
- Iframe HTML ~6 KB gzipped.
- Cache: `Cache-Control: public, max-age=300` on `/api/embed`.

## Open issues / TODO
- SSE / streaming responses.
- File uploads.
- Custom CSS hook.
- Mobile FAB position adjusts when other widgets exist.
- Pre-chat form (name + email collection).
