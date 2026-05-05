# Command Palette (Cmd-K)

**File:** `apps/web/components/shell/CommandPalette.tsx`
**Mounted in:** `apps/web/app/[locale]/(shell)/layout.tsx`

**Owner:** shell / UX
**Status:** stable

## Purpose
Global keyboard-driven launcher. Press `⌘-K` (or `Ctrl-K`) anywhere inside
the shell to navigate, search agents, flows, KBs, channels.

## Planning (initial design)

### Goals
- Always one keystroke away from any screen or resource.
- Fuzzy search across agents, flows, KBs, channels.
- Minimal latency: lazy fetches resources only when palette opens.

### User flow
1. Press `⌘-K` → modal opens, input focused.
2. Type → cmdk filters across two groups (Navegación + Recursos).
3. ↑/↓ navigate, ↵ open. Esc to close.

### Components
- Built on `cmdk` 1.1 (~5 KB).
- `Command.Input` for fuzzy filter.
- `Command.Group` for "Navegación" (10 static routes) and "Recursos"
  (resources fetched on open).

### Decisions & trade-offs
- **Lazy fetch on open** (not on mount) — avoids a 4× /api/* fan-out on
  every shell page render.
- **Fuzzy match handled by cmdk** — no custom search logic.

## Execution (changelog — newest first)

### 2026-04-28 — Phase 8 polish
- Initial implementation.
- 4 parallel fetches (`agents`, `flows`, `knowledge-bases`, `channels`) on open.
- Mounted globally inside `(shell)/layout.tsx`.

## Open issues / TODO
- Fuzzy match scoring weights (currently equal).
- Recent items pinned to the top.
- Action commands (e.g. "Crear agente", "Conectar Slack").
- Deep linking: `?cmd=create-agent`.
