import dagre from "@dagrejs/dagre";

/**
 * Auto-organización del lienzo con dagre: layout por capas de izquierda a
 * derecha, sin superposiciones, respetando el tamaño de cada paso. Puro.
 */

export interface LayoutNode {
  id: string;
  position: { x: number; y: number };
}
export interface LayoutEdge {
  source: string;
  target: string;
}

const DEFAULT_W = 210;
const DEFAULT_H = 64;

export function autoLayout<T extends LayoutNode>(
  nodes: T[],
  edges: LayoutEdge[],
  sizeOf?: (n: T) => { width: number; height: number }
): T[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 56, ranksep: 96, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const s = sizeOf?.(n) ?? { width: DEFAULT_W, height: DEFAULT_H };
    g.setNode(n.id, { width: s.width, height: s.height });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return nodes.map((n) => {
    const p = g.node(n.id);
    if (!p) return n;
    // dagre da el centro; convertimos a esquina superior-izquierda.
    return { ...n, position: { x: p.x - p.width / 2, y: p.y - p.height / 2 } };
  });
}
