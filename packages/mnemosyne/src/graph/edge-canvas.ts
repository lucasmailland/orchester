// packages/mnemosyne/src/graph/edge-canvas.ts
// Pure Canvas 2D drawing helpers for graph edges.

export interface EdgeStyle {
  color: string;
  dash: number[];
  width: number;
}

// Concrete-keyed (not a `Record<string, …>` index signature) so member
// access by a known verb returns `EdgeStyle`, not `EdgeStyle | undefined`,
// under `noUncheckedIndexedAccess`. The `satisfies` clause type-checks every
// value against `EdgeStyle` while preserving the literal key set.
export const EDGE_STYLES = {
  related: { color: "#7c3aed", dash: [], width: 1.0 },
  compatible: { color: "#7c3aed", dash: [], width: 1.0 },
  not_conflict: { color: "#7c3aed", dash: [], width: 1.0 },
  conflicts_with: { color: "#dc2626", dash: [5, 4], width: 1.5 },
  derived_from: { color: "#52525b", dash: [3, 3], width: 0.8 },
  scoped: { color: "#52525b", dash: [3, 3], width: 0.8 },
  supersedes: { color: "#b45309", dash: [4, 3], width: 1.0 },
  part_of: { color: "#4c1d95", dash: [], width: 1.0 },
  member_of: { color: "#4c1d95", dash: [], width: 1.0 },
} satisfies Record<string, EdgeStyle>;

const FALLBACK_STYLE: EdgeStyle = EDGE_STYLES.related;

export interface EdgeDrawOptions {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  relation: string;
  confidence: number;
}

export function drawEdge(ctx: CanvasRenderingContext2D, opts: EdgeDrawOptions): void {
  const { sx, sy, tx: tx_, ty, relation, confidence } = opts;
  // `relation` is an arbitrary string; the concrete-keyed EDGE_STYLES can't be
  // indexed by it directly, so go through the record view for the dynamic lookup.
  const style: EdgeStyle = (EDGE_STYLES as Record<string, EdgeStyle>)[relation] ?? FALLBACK_STYLE;
  const width = style.width * (0.5 + confidence * 0.5);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx_, ty);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = width;
  ctx.globalAlpha = 0.5 + confidence * 0.3;
  if (style.dash.length > 0) ctx.setLineDash(style.dash);
  ctx.stroke();
  if (style.dash.length > 0) ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
}
