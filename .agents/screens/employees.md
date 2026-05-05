# Employees

**Route:** `/[locale]/employees`
**Files:**
- `apps/web/app/[locale]/(shell)/employees/page.tsx`
- `apps/web/components/employees/EmployeeTable.tsx`
- `apps/web/app/api/employees/[id]/agents/route.ts`

**Owner:** employees
**Status:** beta

## Purpose
Directory of human employees in the workspace. Each employee can have
agents assigned to them. **Not** the agent workforce — that's `/agents`.

## Planning (initial design)

### Goals
- Lightweight CRM-style table (name, email, area, manager, active).
- Per-employee agent assignment (e.g. the CEO has 3 personal agents).

### Data
- Table: `employee` (id, workspaceId, name, email, phone, area, managerId,
  avatarUrl, active, assignedAgentIds[]).
- Endpoint: `PUT /api/employees/[id]/agents` to set assigned agent IDs.

### Decisions & trade-offs
- **`assignedAgentIds` is a jsonb array on `employee`** — simple, no
  many-to-many join table. Trade-off: harder reverse query (who has X agent).
- This screen is intentionally simple; complex CRMs are out of scope.

## Execution (changelog — newest first)

### 2026-04-28 — assignedAgentIds + endpoint
- Added `assignedAgentIds` jsonb column.
- `PUT /api/employees/[id]/agents` updates the array.

## Performance notes
- Indexed on `(workspace_id)`.

## Open issues / TODO
- Bulk import (CSV).
- Direct integration with Fichap (the parent product).
- UI for the agent assignment popover (data layer ready).
