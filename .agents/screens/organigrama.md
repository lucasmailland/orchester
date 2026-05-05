# Organigrama (AI Hierarchy)

**Route:** `/[locale]/org`
**Files:**
- `apps/web/app/[locale]/(shell)/org/page.tsx`
- `apps/web/components/org/OrgCanvas.tsx`
- `apps/web/app/api/org-graph/route.ts`

**Owner:** org / discovery
**Status:** stable

## Purpose
A live, interactive map of the workspace's AI architecture: workspace at the
top → teams (squads of agents) → agents → relationships (agent-to-agent edges
labeled with the flow that connects them).

**Not** an HR-style org chart of humans.

## Planning (initial design)

### Goals
- Single coherent view that shows EVERY relationship at a glance.
- Read like a tree: parents on top, children below.
- Live activity (which flows ran recently) visible without clicking.
- Click any node to navigate to its detail page.

### User flows
1. From sidebar → "Organigrama" → lands here.
2. Sees Workspace at top, Teams as 2nd row, Agents as 3rd row.
3. Sees agents that share a flow connected horizontally with the flow name.
4. Search by name or role — ancestors stay visible so the tree never breaks.
5. Drag any node to manually rearrange. Reset Layout returns to auto.
6. Click an agent → Agent Studio. Click a flow-edge label → Flow Builder.
   Click a team → Team detail.

### Data
- Endpoint: `GET /api/org-graph` returns `{ nodes, edges, summary }`.
- Reads: `team`, `agent`, `flow`, `flow_run` (last 50 for liveness),
  `channel` (per agent reach).
- Polls every 15 s for liveness updates.

### Components
- `OrgCanvas` (client) — @xyflow/react canvas with custom node renderers:
  `WorkspaceNode`, `TeamNode`, `AgentNode`. (FlowNode renderer exists but is
  not used since flows are rendered as edges.)
- Layout function `layoutNodes(rawNodes, rawEdges)` computes deterministic
  positions: workspace centered top, teams horizontally, agents in columns
  beneath their team.
- User-moved positions persist in `useRef<Map>` across data refreshes.

### Decisions & trade-offs
- **No employee nodes.** This is the AI tree — humans live in `/employees`.
- **Flows as EDGES, not nodes.** A flow that chains A→B is rendered as an
  agent→agent edge labeled "Pipeline de leads", not a separate orange pill.
  Reads more naturally and avoids disconnected floats.
- **No kind filters (team/agent/flow toggle).** Any filter that hides
  intermediate nodes would orphan their children.
- **Empty teams hidden.** A team with 0 agents is dropped from the layout
  (still exists in DB).
- **Smoothstep edges** for ws→team and team→agent (tree). Bezier for
  agent→agent (sequence/relationship).
- **Manual layout** instead of dagre — keeps the bundle small and lets us
  control aesthetics tightly.

## Execution (changelog — newest first)

### 2026-05-05 — single coherent view
- Removed the kind-filter toggles (Equipos / Agentes / Flujos) — they were
  hiding parents and orphaning children.
- Removed flow nodes from the canvas; flows now render as agent→agent edges
  labeled with the flow name.
- Search keeps ancestors visible so the tree stays connected.

### 2026-05-05 — UX polish
- All nodes now draggable (workspace + team had `draggable: false` — bug).
- User-moved positions persist across the 15-s polling refresh.
- `Reset layout` button to restore auto-arrangement.
- Tighter row spacing (200→150 between rows; 60→36 col gap; flow row 720→480).
- Edges switched to `smoothstep` for cleaner orthogonal routing.

### 2026-04-28 — initial org canvas
- Workspace + teams + agents + flows all as nodes.
- `OrgNode` types and a deterministic layout.
- Live badge on flows with recent runs.
- Click navigates to detail.

## Performance notes
- API fan-out: 5 parallel queries (`teams`, `agents`, `flows`, `flow_runs`
  limit 50, `channels`). Each hits indexed columns. ~24 ms warm.
- 15-s polling: `setInterval` cleared on unmount.
- Layout is deterministic (O(n)), no expensive graph algorithm.

## Open issues / TODO
- Hover an agent: highlight its incoming/outgoing edges + dim the rest.
- Click a team: collapse/expand its agents.
- Add channel lane on the left (Web Widget / Telegram nodes connecting to the
  agents they target).
- Export to PNG / SVG.
