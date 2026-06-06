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

// Arrowhead geometry (canvas px). Relations are directional (supersedes,
// derived_from, part_of…), so every edge gets a solid head at the target end
// to make the direction legible.
const ARROW_LEN = 6;
const ARROW_GAP = 4; // back-off from the target center so the head clears the node

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

  // Unit vector source → target, for both the line and the arrowhead.
  const dx = tx_ - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  ctx.save();

  // Line.
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx_, ty);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = width;
  ctx.globalAlpha = 0.5 + confidence * 0.3;
  if (style.dash.length > 0) ctx.setLineDash(style.dash);
  ctx.stroke();
  if (style.dash.length > 0) ctx.setLineDash([]);

  // Arrowhead — solid triangle at the target end, drawn opaque (no dash) so the
  // direction reads clearly even on dashed edges.
  const tipX = tx_ - ux * ARROW_GAP;
  const tipY = ty - uy * ARROW_GAP;
  const baseX = tipX - ux * ARROW_LEN;
  const baseY = tipY - uy * ARROW_LEN;
  const perpX = -uy;
  const perpY = ux;
  const half = ARROW_LEN * 0.5;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + perpX * half, baseY + perpY * half);
  ctx.lineTo(baseX - perpX * half, baseY - perpY * half);
  ctx.closePath();
  ctx.fillStyle = style.color;
  ctx.globalAlpha = 0.6 + confidence * 0.4;
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.restore();
}
