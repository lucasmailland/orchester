/**
 * Auto-organización del lienzo: ubica los pasos en columnas de izquierda a
 * derecha según su profundidad desde los disparadores. Puro y testeable.
 */

export interface LayoutNode {
  id: string;
  position: { x: number; y: number };
}
export interface LayoutEdge {
  source: string;
  target: string;
}

const COL_GAP = 240;
const ROW_GAP = 140;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;

export function autoLayout<T extends LayoutNode>(nodes: T[], edges: LayoutEdge[]): T[] {
  if (nodes.length === 0) return nodes;
  const adj: Record<string, string[]> = {};
  const indeg: Record<string, number> = {};
  for (const n of nodes) {
    adj[n.id] = [];
    indeg[n.id] = 0;
  }
  for (const e of edges) {
    const list = adj[e.source];
    if (list && e.target in indeg) {
      list.push(e.target);
      indeg[e.target] = (indeg[e.target] ?? 0) + 1;
    }
  }

  const depth: Record<string, number> = {};
  const queue = nodes.filter((n) => (indeg[n.id] ?? 0) === 0).map((n) => n.id);
  for (const id of queue) depth[id] = 0;
  let head = 0;
  let guard = 0;
  while (head < queue.length && guard++ < 100_000) {
    const id = queue[head++]!;
    for (const next of adj[id] ?? []) {
      const cand = (depth[id] ?? 0) + 1;
      if (depth[next] === undefined || cand > depth[next]) {
        depth[next] = cand;
        queue.push(next);
      }
    }
  }

  // Cualquier nodo que no quedó alcanzado (ciclos/islas) va a la columna 0.
  for (const n of nodes) if (depth[n.id] === undefined) depth[n.id] = 0;

  // Reparte por columna.
  const perColCount: Record<number, number> = {};
  return nodes.map((n) => {
    const d = depth[n.id] ?? 0;
    const row = perColCount[d] ?? 0;
    perColCount[d] = row + 1;
    return { ...n, position: { x: ORIGIN_X + d * COL_GAP, y: ORIGIN_Y + row * ROW_GAP } };
  });
}
