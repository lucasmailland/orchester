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

/**
 * Si un cambio merece quedar en el historial.
 *
 * Sólo cuenta el grafo y su documentación: nodos, aristas, variables y spec.
 * Renombrar el flow, pausarlo o reactivarlo no deja versión, y eso es a
 * propósito — la retención conserva las últimas 20, así que un historial lleno
 * de "lo pausé y lo volví a activar" desaloja justo las versiones a las que
 * uno querría volver.
 *
 * Compara contra lo que hay guardado, no contra lo que llegó: un `update` que
 * manda los mismos nodos —lo que hace la UI al guardar sin tocar nada— no
 * gasta una versión.
 */
export function changesTheGraph(
  current: GraphLike,
  input: {
    nodes?: unknown;
    edges?: unknown;
    variables?: unknown;
    spec?: string | null | undefined;
  }
): boolean {
  const iguales = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (input.nodes !== undefined && !iguales(input.nodes, current.nodes)) return true;
  if (input.edges !== undefined && !iguales(input.edges, current.edges)) return true;
  if (input.variables !== undefined && !iguales(input.variables, current.variables)) return true;
  if (input.spec !== undefined && (input.spec ?? null) !== (current.spec ?? null)) return true;
  return false;
}
