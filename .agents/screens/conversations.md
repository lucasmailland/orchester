# Conversations Hub

**Route:** `/[locale]/conversations`
**Files:**
- `apps/web/app/[locale]/(shell)/conversations/page.tsx`
- `apps/web/components/conversations/{ConversationsClient,ConversationRow}.tsx`
- `apps/web/app/api/conversations/{route,[id]/route,[id]/takeover,[id]/reply}.ts`
- `apps/web/app/api/conversation-labels/{route,[id]}.ts`

**Owner:** conversations
**Status:** stable

## Purpose
Operations console: every interaction between an agent and a customer (or
employee) across every channel. Filter, search, take-over, reply manually,
tag, export.

## Planning (initial design)

### Goals
- One screen to see EVERY conversation — multi-channel, multi-agent.
- Filter by status / channel / agent / tag / search.
- Operator can intervene (take-over) for sensitive cases.
- Export CSV for compliance / analysis.

### User flows
1. Land on the list with default filters (all statuses, last 50).
2. Adjust filters via the bar (live re-fetch).
3. Click a row → drawer slides from right with full transcript.
4. In the drawer: change status, toggle tags, take-over ("Tomar"),
   release back to agent, reply manually, see CSAT.
5. Click "Exportar CSV" downloads the current filtered set.

### Data
**Tables:** `conversation` (with: tags, csat, deflected, takenOverAt,
assignedToUserId, externalId, customerName, customerEmail), `message`
(with: fromOperator, authorUserId, metadata), `conversation_label`.

**Endpoints:**
- `GET /api/conversations?status=&channel=&agentId=&tag=&search=&from=`
- `GET /api/conversations/[id]` — conversation + messages
- `PATCH /api/conversations/[id]` — status, tags, csat, summary, assignee
- `POST /api/conversations/[id]/takeover` — operator takes over
- `DELETE /api/conversations/[id]/takeover` — release back to agent
- `POST /api/conversations/[id]/reply` — operator manual reply (sends to
  outbound channel like Telegram)
- `GET/POST /api/conversation-labels` + `DELETE /[id]`

### Components
- `ConversationsClient` (filter bar + list + drawer)
- `ConversationRow` (status dot, channel icon, customer, tags, CSAT)

### Decisions & trade-offs
- **Take-over freezes the agent.** While `takenOverAt` is set, inbound
  messages still get persisted but `handleInbound()` returns without
  invoking the LLM.
- **Manual reply persists as `role:assistant + fromOperator:true`** so the
  transcript stays linear and the channel adapter (Telegram/widget) sends it
  outbound.
- CSV export is client-side (Blob) — works for thousands but not millions.

## Execution (changelog — newest first)

### 2026-04-28 — Phase 5
- Initial implementation: filter bar, drawer, takeover, manual reply, tags,
  CSV export.
- Added 7 conversation fields to support hub features.
- 6 endpoints for conversations + 3 for labels.

## Performance notes
- List query joins with `channel` for type/name. Filters use indexed columns.
- Drawer fetches the conversation + messages in 1 round-trip.
- CSV export is in-memory; cap at ~10k rows for now.

## Open issues / TODO
- Server-side CSV export streaming for very large workspaces.
- Search should hit a full-text index on `summary` + `messages.content`.
- CSAT survey UI shown to the customer at conversation end.
- Label chips with custom colors (color is in DB but not rendered in chips yet).
