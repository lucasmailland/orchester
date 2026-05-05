# Teams

**Routes:**
- List: `/[locale]/teams`
- Detail: `/[locale]/teams/[id]`

**Files:**
- `apps/web/app/[locale]/(shell)/teams/{page,[id]/page}.tsx`
- `apps/web/components/teams/{TeamsPageClient,TeamCard,TeamDetailClient,TeamFormModal}.tsx`
- `apps/web/app/api/teams/{route,[id]/route}.ts`

**Owner:** teams
**Status:** stable

## Purpose
Squads of agents. Group related agents under a "Team" so the org chart can
visualize them and so flows can target a team's agents collectively.

## Planning (initial design)

### Goals
- Lightweight CRUD: name, description, avatar color.
- Detail page lists the team's agents and channels.
- Click an agent → opens Agent Studio.

### Data
- Table: `team` (id, workspaceId, name, description, avatarColor).
- API: `GET/POST /api/teams`, `GET/PATCH/DELETE /api/teams/[id]`.
- Read agents/channels by `teamId` foreign key.

### Components
- `TeamsPageClient` — list + create modal + filter.
- `TeamDetailClient` — agents grid + channels + edit + delete.
- `TeamFormModal` — name + color picker.

### Decisions & trade-offs
- **Teams are NOT folders for permissions** — they're organizational. RBAC
  is per-workspace (Phase 6).

## Execution (changelog — newest first)

### 2026-04-26 — initial CRUD
- Schema, list page, detail page, modal.

## Performance notes
- Indexed `(workspace_id)` on `team` and `(team_id)` on `agent` and `channel`.
- Detail page does 3 queries: team, agents in team, channels in team.

## Open issues / TODO
- Team templates (e.g. "Sales squad", "Support squad" with pre-filled agents).
- Team-level analytics rolling up agent stats.
