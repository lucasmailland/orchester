# Memory Graph — Design Spec

**Date:** 2026-06-04  
**Status:** Approved  
**Author:** Claude + Lucas Mailland

---

## 1. Overview

Add a **Graph view** to the Brain Inspector that renders the workspace's knowledge graph as an interactive 2D force-directed canvas (with an optional 3D toggle). Nodes are `mnemo_entity` records; secondary nodes are `mnemo_episode` (non-synthetic) and `mnemo_decision` (active). Edges come from `mnemo_relation`. Node visual weight derives from `memoryStrength` (Hebbian potentiation); edge color and style from `mnemo_relation.relation` type.

This is a new _view mode_ — no new DB tables, no new schema migrations. All data already exists.

### Why this beats Obsidian

| Feature                               | Obsidian | This |
| ------------------------------------- | -------- | ---- |
| Typed edges (conflict/derived/…)      | ✗        | ✓    |
| Memory Aura (Hebbian strength → glow) | ✗        | ✓    |
| Node shapes by entity kind            | ✗        | ✓    |
| Episode nodes on the graph            | ✗        | ✓    |
| Conflict layer (red dashed edges)     | ✗        | ✓    |
| 3D toggle                             | ✗        | ✓    |

---

## 2. User Experience

### Entry point

- A new **"✦ Graph"** button is added to the `headerActions` in `BrainInspectorClient.tsx`, between "Timeline" and "Undo". It links to `/${locale}/${ws}/brain/graph`.
- Clicking any entity in the existing Brain Inspector list also links to `/${locale}/${ws}/brain/graph?focus=<entityId>` — the graph opens centered on that entity's 1-hop neighborhood (local graph mode).

### Graph canvas layout

```
┌─────────────────────────────────────────────────────┐
│ [Filter panel — top-left]       [2D/3D — top-right] │
│                                                     │
│              force-directed graph canvas            │
│                                                     │
│ [Legend — bottom-left]          [Zoom — bottom-right]│
│ [Status — bottom-right]                             │
└─────────────────────────────────────────────────────┘
           ← slides in on node click →
                                     ┌───────────────┐
                                     │ Node detail   │
                                     │ panel (272px) │
                                     └───────────────┘
```

### Interactions

- **Click node** → opens the detail panel on the right. Graph canvas shrinks by 272px.
- **Double-click node** → enters _local graph mode_: graph rerenders with only the clicked entity and its 1–2 hop neighbors.
- **Click canvas background** → closes detail panel, returns to global graph if in local mode.
- **Drag** → pans the canvas.
- **Scroll / pinch** → zooms.
- **Filter chips** → toggle node/edge types on/off (React state only, no refetch).
- **Memory strength slider** → hides nodes whose linked `avgMemoryStrength < threshold`.
- **Search input** → highlights matching nodes, dims others.
- **2D/3D toggle** → swaps the renderer between `react-force-graph-2d` and `react-force-graph-3d`.
- **"Focus local graph"** button in detail panel → same as double-click.

---

## 3. Visual Vocabulary

### Node shapes (drawn on canvas)

| `entity.kind`           | Shape          | Color              |
| ----------------------- | -------------- | ------------------ |
| `person`                | Circle         | `#7c3aed` (violet) |
| `organization`          | Hexagon        | `#2563eb` (blue)   |
| `project`               | Rounded rect   | `#16a34a` (green)  |
| `concept`               | Diamond        | `#d97706` (amber)  |
| `place`                 | Pentagon       | `#0891b2` (cyan)   |
| `other`                 | Circle (small) | `#52525b` (gray)   |
| `episode` (non-entity)  | Rounded rect   | `#0e7490` (teal)   |
| `decision` (non-entity) | Diamond with ⚖ | `#9333ea` (purple) |

### Node size

```
r = 8 + (node.mentionCount / maxMentionCount) * 20
```

Range [8, 28]. `maxMentionCount` is the max across all nodes in the current view.

### Memory Aura

Two concentric semi-transparent rings rendered behind each node:

```
ring1_r    = node_r + 8
ring1_opacity = (avgMemoryStrength / 5.0) * 0.18   // max 0.18 at strength 5.0
ring2_r    = node_r + 18
ring2_opacity = ring1_opacity * 0.5
```

Color = same as node border color. Both rings animate via a time-based sine wave inside the `nodeCanvasObject` callback (canvas redraws every frame while the force simulation is running):

```ts
const t = Date.now() / 2000;
const pulse = Math.sin(t * Math.PI) * 0.4 + 0.6; // oscillates [0.2, 1.0]
ctx.globalAlpha = ring1_opacity * pulse;
```

This produces the "breathing" effect without CSS.

### Edge styles

| `relation`                              | Color     | Style          | Width                    |
| --------------------------------------- | --------- | -------------- | ------------------------ |
| `related`, `compatible`, `not_conflict` | `#7c3aed` | Solid          | `0.8 + confidence * 0.8` |
| `conflicts_with`                        | `#dc2626` | Dashed `[5,4]` | 1.5                      |
| `derived_from`, `scoped`                | `#52525b` | Dashed `[3,3]` | 0.8                      |
| `supersedes`                            | `#b45309` | Dashed `[4,3]` | 1.0                      |
| `part_of`, `member_of`                  | `#4c1d95` | Solid          | 1.0                      |

All edges have small arrow markers (`markerEnd`).

### Selection state

Selected node gets a dashed ring at `r + 12`, color `#a78bfa`, stroke-width 1, dash `[4,3]`.

---

## 4. Architecture

### New files

```
apps/web/
  app/[locale]/[workspaceSlug]/(shell)/brain/graph/
    page.tsx                     ← Next.js page, lazy-loads BrainGraph
  app/api/workspaces/[slug]/brain/
    graph/
      route.ts                   ← GET endpoint, returns GraphResponse

  components/brain/graph/
    BrainGraph.tsx               ← react-force-graph wrapper, owns canvas
    BrainGraphFilters.tsx        ← floating filter panel
    BrainGraphNodeDetail.tsx     ← right-side detail drawer
    BrainGraphLegend.tsx         ← bottom legend bar
    BrainGraphViewToggle.tsx     ← 2D/3D pill toggle
    BrainGraphEmptyState.tsx     ← "No entities yet" placeholder
    node-canvas.ts               ← canvas drawing helpers (shapes + aura)
    edge-canvas.ts               ← edge drawing helpers (dashed, arrows)
    graph-types.ts               ← TypeScript types for GraphNode/GraphEdge
  lib/hooks/
    use-brain-graph.ts           ← SWR hook, fetches /api/.../brain/graph
    use-graph-filters.ts         ← filter state (node types, edge types, strength)
```

### Modified files

```
apps/web/
  app/[locale]/[workspaceSlug]/(shell)/brain/
    BrainInspectorClient.tsx     ← add "Graph" button to headerActions
  package.json                   ← add react-force-graph-2d, react-force-graph-3d
```

---

## 5. API

### `GET /api/workspaces/[slug]/brain/graph`

**Auth:** workspace member (existing `getCurrentWorkspace()` pattern).

**Query params:**

- `focus?: string` — if provided, return only the entity with this ID and its 1-hop neighbors + their edges. Omit for global graph.

**Response:**

```ts
interface GraphNode {
  id: string;
  kind: "entity" | "episode" | "decision";
  entityKind?:
    | "person"
    | "organization"
    | "project"
    | "concept"
    | "place"
    | "other";
  label: string;
  description?: string | null;
  mentionCount: number;
  factCount: number;
  avgMemoryStrength: number; // avg of linked mnemo_fact.memory_strength; 0 if no facts
  createdAt: string; // ISO
}

interface GraphEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  relation: string; // mnemo_relation.relation enum value
  confidence: number; // mnemo_relation.confidence ?? 0.7
  provenance: string | null;
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    entityCount: number;
    episodeCount: number;
    decisionCount: number;
    relationCount: number;
  };
}
```

**DB query strategy:**

1. Pull `mnemo_entity` for the workspace (all active + non-canonical rows excluded).
2. Pull non-synthetic `mnemo_episode` for the workspace.
3. Pull active `mnemo_decision` for the workspace.
4. Pull `mnemo_relation` where `sourceKind` and `targetKind` are in `{entity, episode, decision}` and `judgmentStatus != 'dismissed'` and `validTo IS NULL`.
5. For entity nodes: join `mnemo_fact` grouped by `entity_id` to get `COUNT(*) as factCount`, `AVG(memory_strength) as avgMemoryStrength`.
6. If `focus` param: filter nodes to entity + 1-hop neighbors, filter edges to those between these nodes.

**Performance:** expected graph size per workspace is <500 nodes + <2000 edges. No pagination needed. Response cached with `Cache-Control: private, max-age=30`.

---

## 6. Component Design

### `BrainGraph.tsx`

```
Props:
  initialFocusId?: string   // entity to center on load (from ?focus= URL param)

State:
  graphData: { nodes, links }   // react-force-graph format
  selectedNodeId: string | null
  isLocalMode: boolean
  is3D: boolean

Behavior:
  - Dynamic imports react-force-graph-2d / react-force-graph-3d (SSR-safe)
  - Passes nodeCanvasObject to draw shapes + aura
  - Passes linkCanvasObject to draw typed edges
  - onNodeClick → setSelectedNodeId, open detail panel
  - onNodeDoubleClick → setIsLocalMode(true), filter graph to 1-hop
  - onBackgroundClick → close panel, if local mode return to global
  - Wraps in a ResizeObserver so graph fills canvas minus detail panel width
```

### `node-canvas.ts`

Pure functions that take a canvas 2D context and draw:

- `drawPerson(ctx, x, y, r, color)` — circle
- `drawOrg(ctx, x, y, r, color)` — hexagon via 6-point path
- `drawProject(ctx, x, y, r, color)` — rounded rect
- `drawConcept(ctx, x, y, r, color)` — rotated square (diamond)
- `drawAura(ctx, x, y, r, strength, color)` — two concentric rings at computed opacity
- `drawSelectionRing(ctx, x, y, r)` — dashed violet ring

### `use-brain-graph.ts`

SWR hook wrapping `GET /api/workspaces/[slug]/brain/graph`.
Transforms response to `react-force-graph` format:

- `nodes` → add `val` (= `mentionCount`) which react-force-graph uses for force repulsion
- `links` → rename `source`/`target` (already correct)

### `use-graph-filters.ts`

Pure client state (no server calls):

```ts
{
  visibleNodeKinds: Set<string>; // person, org, project, concept, place, episode, decision
  visibleEdgeRelations: Set<string>;
  minMemoryStrength: number; // 0–5, default 0
  searchQuery: string;
}
```

Derives `filteredNodes` and `filteredEdges` via `useMemo`.

---

## 7. Dependencies

```json
{
  "react-force-graph-2d": "^1.43.0",
  "react-force-graph-3d": "^1.24.0"
}
```

Both are ~150KB each (gzipped ~50KB). Dynamic-imported so they don't bloat the main bundle.

No new DB migrations.

---

## 8. Error Handling & States

| State                     | Treatment                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Loading                   | Skeleton shimmer fills the canvas area                                                                         |
| Empty (0 entities)        | `BrainGraphEmptyState` with message "Start conversations to build your knowledge graph" + CTA to Conversations |
| API error                 | Inline error card with "Retry" button (no full-page error)                                                     |
| Focus entity not found    | Fall back to global graph silently                                                                             |
| 3D not supported (mobile) | Disable 3D toggle on `navigator.userAgent` mobile check                                                        |

---

## 9. i18n

New translation keys added to `en.json` (and forwarded to other locales):

```json
"brain": {
  "graph": {
    "title": "Memory Graph",
    "filter": "Filter",
    "searchPlaceholder": "Search entities…",
    "nodeTypes": "Node types",
    "edgeTypes": "Edge types",
    "memoryStrength": "Memory strength",
    "toggle2d": "2D",
    "toggle3d": "3D",
    "statusBar": "{{entities}} entities · {{relations}} relations · {{facts}} facts",
    "emptyState": "No entities yet",
    "emptyStateDesc": "Start a conversation — your agents will build this graph automatically.",
    "nodeDetail": {
      "memoryStrength": "Memory Strength",
      "facts": "Facts",
      "connectedTo": "Connected to",
      "focusLocal": "Focus local graph",
      "editEntity": "Edit entity",
      "viewAllFacts": "View all facts"
    }
  }
}
```

---

## 10. Testing

| Layer                         | What to test                                                         |
| ----------------------------- | -------------------------------------------------------------------- |
| Unit — `node-canvas.ts`       | Each shape function draws without throwing                           |
| Unit — `use-graph-filters.ts` | Filter combinations produce correct node/edge subsets                |
| Unit — `use-brain-graph.ts`   | SWR hook returns correct transformed data                            |
| Unit — API route              | Returns correct GraphResponse shape; `focus` param filters correctly |
| Integration — `BrainGraph`    | Graph renders, node click opens panel, panel close works             |
| E2E (Playwright)              | Navigate to `/brain/graph`; click node; detail panel visible; close  |

---

## 11. Implementation Sequence

The implementation is split into 5 tasks, each shippable independently:

1. **API** — `GET /api/workspaces/[slug]/brain/graph` route + types
2. **Canvas primitives** — `node-canvas.ts`, `edge-canvas.ts`, `graph-types.ts`
3. **Core graph component** — `BrainGraph.tsx` + `use-brain-graph.ts` + page route
4. **UI chrome** — Filters, NodeDetail, Legend, ViewToggle, EmptyState
5. **Wire-up** — Add "Graph" button to `BrainInspectorClient.tsx`; add deps to `package.json`; add i18n keys

---

## 12. Out of Scope (v1)

- Editing entities/relations directly from the graph (future)
- Exporting the graph as SVG/PNG (future)
- Graph diff / time-travel mode (future — visual replay of how graph evolved)
- Multiplayer cursors on the graph (future)
- WebGL particle effects for the memory aura (future — current approach is canvas arcs)
