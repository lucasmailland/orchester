# Agents (list)

**Route:** `/[locale]/agents`
**Files:**
- `apps/web/app/[locale]/(shell)/agents/page.tsx`
- `apps/web/components/agents/{AgentsPageClient,AgentRow,AgentFormModal}.tsx`
- `apps/web/app/api/agents/{route,[id]/...}.ts`

**Owner:** agents
**Status:** stable

## Purpose
Browse + filter the workspace's agents grouped by team. Click any agent →
Agent Studio. Quick-create button for new agents.

## Planning (initial design)

### Goals
- Card-based grid, grouped by team, easy scanning.
- Filter by status (all / active / draft / inactive).
- Quick-create modal (name + role + team + status); after create, redirect to
  Studio.

### Data
- Table: `agent` (full schema in Agent Studio spec).
- API:
  - `GET /api/agents` — list (used by ModelPicker + others)
  - `POST /api/agents` — create
  - `PATCH/DELETE /api/agents/[id]`

### Components
- `AgentsPageClient` — filter chips + grouped grid + create modal.
- `AgentRow` — small variant of card for list contexts.
- `AgentFormModal` — quick create / edit.

### Decisions & trade-offs
- **Cards click navigate to Studio**, not to inline edit. Heavy-edit lives in
  Studio.
- **NoProviderBanner** shown on top if no AI provider is configured — primary
  CTA is to go to Settings.

## Execution (changelog — newest first)

### 2026-04-28 — Studio integration
- Card click pushes to `/agents/[id]` (Studio).
- Quick-create stays as modal; on success, push to Studio.

## Performance notes
- List query indexed on `(workspace_id)`. Grouping done client-side.

## Open issues / TODO
- Filter by team, model, kind.
- Bulk delete / archive.
- Drag agents between teams.
