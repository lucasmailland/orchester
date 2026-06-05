// packages/mnemosyne/src/graph/index.ts
// CLIENT-SAFE graph primitives: canvas drawing, types, layout, colors.
//
// PORTABILITY CONTRACT: this entry imports ZERO server/DB code. It is the
// surface a browser bundle (or any non-Node renderer) imports. The DB query
// layer lives in `./server` (which pulls @orchester/db → postgres) and must
// never be re-exported from here — doing so would drag the Node Postgres
// driver into client bundles. See docs/specs/2026-06-04-memory-graph-design.md.
export {
  drawNode,
  nodeRadius,
  ENTITY_KIND_COLOR,
  NODE_RADIUS_MIN,
  NODE_RADIUS_MAX,
  type NodeDrawOptions,
} from "./node-canvas";
export { drawEdge, EDGE_STYLES, type EdgeDrawOptions } from "./edge-canvas";
export { defaultForceConfig, type ForceConfig } from "./layout";
export type {
  GraphNode,
  GraphEdge,
  GraphResponse,
  GraphQueryOptions,
  GraphNodeKind,
  GraphEntityKind,
} from "./types";
