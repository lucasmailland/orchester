/** Flow version snapshots and restores. The spec travels with the graph. */
interface GraphLike {
  nodes: unknown;
  edges: unknown;
  variables: unknown;
  spec: string | null;
}

function toPatch(src: GraphLike) {
  return {
    nodes: Array.isArray(src.nodes) ? src.nodes : [],
    edges: Array.isArray(src.edges) ? src.edges : [],
    variables:
      src.variables && typeof src.variables === "object" && !Array.isArray(src.variables)
        ? (src.variables as Record<string, unknown>)
        : {},
    spec: src.spec ?? null,
  };
}

export const versionSnapshot = (flow: GraphLike) => toPatch(flow);
export const restorePatch = (version: GraphLike) => toPatch(version);
