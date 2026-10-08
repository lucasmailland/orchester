import { normalizeFlowGroups, pruneFlowGroups } from "./groups";

/**
 * Flow version snapshots and restores. The spec and the step groups travel
 * with the graph: a version restores how the flow read, not only what it ran.
 */
interface GraphLike {
  nodes: unknown;
  edges: unknown;
  variables: unknown;
  spec: string | null;
  /** Absent on rows written before groups existed; the column defaults to []. */
  groups?: unknown;
}

function toPatch(src: GraphLike) {
  const nodes = Array.isArray(src.nodes) ? src.nodes : [];
  const nodeIds = nodes
    .map((n) => (n && typeof n === "object" ? (n as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string");
  return {
    nodes,
    edges: Array.isArray(src.edges) ? src.edges : [],
    variables:
      src.variables && typeof src.variables === "object" && !Array.isArray(src.variables)
        ? (src.variables as Record<string, unknown>)
        : {},
    spec: src.spec ?? null,
    // Snapshotted with the nodes they name, so pruning only drops what was
    // already malformed.
    groups: pruneFlowGroups(normalizeFlowGroups(src.groups), nodeIds),
  };
}

export const versionSnapshot = (flow: GraphLike) => toPatch(flow);
export const restorePatch = (version: GraphLike) => toPatch(version);

/**
 * Si un cambio merece quedar en el historial.
 *
 * Sólo cuenta el grafo y su documentación: nodos, aristas, variables, spec y
 * grupos de pasos (renombrar un grupo cambia cómo se lee el flow).
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
    groups?: unknown;
  }
): boolean {
  const iguales = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (input.nodes !== undefined && !iguales(input.nodes, current.nodes)) return true;
  if (input.edges !== undefined && !iguales(input.edges, current.edges)) return true;
  if (input.variables !== undefined && !iguales(input.variables, current.variables)) return true;
  if (input.spec !== undefined && (input.spec ?? null) !== (current.spec ?? null)) return true;
  if (input.groups !== undefined && !iguales(input.groups, current.groups ?? [])) return true;
  return false;
}
