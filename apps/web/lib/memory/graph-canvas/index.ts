// apps/web/lib/brain/graph-canvas/index.ts
//
// CLIENT-SAFE graph rendering primitives copied from @mnemosyne/core/graph
// after the Phase 3 service-extraction cut-over. These are pure canvas
// helpers (Canvas 2D drawing, color tables, layout config, types) — they
// don't touch the database, the wire, or the mnemosyne SDK.
//
// They live in orchester because they're UI concerns. The companion
// data shape (`GraphResponse`, `GraphNode`, `GraphEdge` from
// `@mnemo-ai/client-ts`) still ships from the SDK — these helpers
// just consume that shape and paint.

export {
  drawNode,
  nodeRadius,
  ENTITY_KIND_COLOR,
  NODE_RADIUS_MIN,
  NODE_RADIUS_MAX,
  type NodeDrawOptions,
} from "./node-canvas";
export { drawEdge, EDGE_STYLES, type EdgeDrawOptions, type EdgeStyle } from "./edge-canvas";
export { defaultForceConfig, type ForceConfig } from "./layout";
export type {
  GraphNode,
  GraphEdge,
  GraphResponse,
  GraphQueryOptions,
  GraphNodeKind,
  GraphEntityKind,
} from "./types";
export { debounce, type Debounced } from "./debounce";
export {
  stellarColor,
  STELLAR_STOPS,
  edgeIntensity,
  EDGE_INTRA_INTENSITY,
  EDGE_INTER_INTENSITY,
} from "./stellar";
export {
  edgeKey,
  endId,
  keyForEdge,
  pathEdgeKeySet,
  pathNodeIdSet,
  type EdgeEnd,
} from "./path-edges";
export { filterGraphToIds } from "./depth-filter";
