// packages/mnemosyne/src/graph/node-canvas.ts
// Pure Canvas 2D drawing helpers for graph nodes.
// Zero framework dependencies — works in browser, Node.js + canvas, etc.

import type { GraphNodeKind, GraphEntityKind } from "./types";

export const NODE_RADIUS_MIN = 8;
export const NODE_RADIUS_MAX = 26;

export function nodeRadius(mentionCount: number, maxMentionCount: number): number {
  if (maxMentionCount === 0) return NODE_RADIUS_MIN;
  return NODE_RADIUS_MIN + (mentionCount / maxMentionCount) * (NODE_RADIUS_MAX - NODE_RADIUS_MIN);
}

export const ENTITY_KIND_COLOR: Record<string, string> = {
  person: "#7c3aed",
  organization: "#2563eb",
  project: "#16a34a",
  concept: "#d97706",
  place: "#0891b2",
  other: "#52525b",
  episode: "#0e7490",
  decision: "#9333ea",
};

const FILL_OPACITY = 0.15;

export interface NodeDrawOptions {
  x: number;
  y: number;
  r: number;
  color: string;
  selected: boolean;
  memoryStrength: number;
  label: string;
  kind: GraphNodeKind;
  entityKind?: GraphEntityKind;
  globalScale: number;
  /** Hover/search focus is elsewhere — ghost the node and hide its label. */
  dimmed?: boolean;
  /** Pointer is on this node — glow + thicker stroke. */
  hovered?: boolean;
  /** Node matches the active search query — persistent highlight ring. */
  searchHit?: boolean;
}

export function drawNode(
  ctx: CanvasRenderingContext2D,
  opts: NodeDrawOptions,
  now = Date.now()
): void {
  const {
    x,
    y,
    r,
    color,
    selected,
    memoryStrength,
    label,
    kind,
    entityKind,
    globalScale,
    dimmed,
    hovered,
    searchHit,
  } = opts;

  ctx.save();

  if (dimmed) {
    // Ghosted shape only — no aura, no label. Drawing the body at ~12%
    // keeps the overall graph silhouette while the user inspects a
    // neighbourhood (Obsidian-style focus dimming).
    ctx.globalAlpha = 0.12;
    _drawShape(ctx, x, y, r, color, entityKind ?? kind);
    ctx.restore();
    return;
  }

  _drawAura(ctx, x, y, r, color, memoryStrength, now);

  // Hover glow under the shape — canvas shadow gives a cheap halo that
  // reads instantly without an extra render pass.
  if (hovered || selected) {
    ctx.shadowColor = color;
    ctx.shadowBlur = hovered ? 22 : 14;
  }

  _drawShape(ctx, x, y, r, color, entityKind ?? kind, hovered ? 0.35 : undefined);
  ctx.shadowBlur = 0;

  if (globalScale >= 0.3) {
    // Labels render in CANVAS COORDINATE space, but they must remain a
    // constant SCREEN size as the viewport zooms. The transform from
    // coord → screen is the `globalScale` multiplier, so to render an
    // 11-screen-pixel label we draw 11 / globalScale in coord space.
    const screenPx = 11;
    const fontSize = Math.min(28, Math.max(6, screenPx / globalScale));
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const textWidth = ctx.measureText(label).width;
    const padX = fontSize * 0.45;
    const padY = fontSize * 0.25;
    const labelY = y + r + fontSize * 0.9 + 4;
    // Backdrop pill keeps the label legible when neighbouring nodes
    // crowd the label band — without it, dense clusters look like
    // text soup.
    ctx.fillStyle = "rgba(8, 8, 12, 0.78)";
    ctx.beginPath();
    const w = textWidth + padX * 2;
    const h = fontSize + padY * 2;
    const rx = Math.min(h / 2, 6);
    const sx = x - w / 2;
    const sy = labelY - h / 2;
    ctx.moveTo(sx + rx, sy);
    ctx.lineTo(sx + w - rx, sy);
    ctx.arcTo(sx + w, sy, sx + w, sy + rx, rx);
    ctx.lineTo(sx + w, sy + h - rx);
    ctx.arcTo(sx + w, sy + h, sx + w - rx, sy + h, rx);
    ctx.lineTo(sx + rx, sy + h);
    ctx.arcTo(sx, sy + h, sx, sy + h - rx, rx);
    ctx.lineTo(sx, sy + rx);
    ctx.arcTo(sx, sy, sx + rx, sy, rx);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fafafa";
    ctx.fillText(label, x, labelY);
    ctx.textBaseline = "alphabetic";
  }

  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, r + 6, 0, 2 * Math.PI);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 1.2 / globalScale;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (searchHit) {
    // Solid amber ring — persists while the query is active so matches stay
    // findable even after the pointer moves away.
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2 / globalScale;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function _drawShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  resolvedKind: string,
  fillOpacity?: number
): void {
  switch (resolvedKind) {
    case "person":
      _drawCircle(ctx, x, y, r, color, fillOpacity);
      break;
    case "organization":
      _drawHexagon(ctx, x, y, r, color, fillOpacity);
      break;
    case "project":
    case "episode":
      _drawRoundedRect(ctx, x, y, r, color, fillOpacity);
      break;
    case "concept":
    case "decision":
      _drawDiamond(ctx, x, y, r, color, fillOpacity);
      break;
    case "place":
      _drawPentagon(ctx, x, y, r, color, fillOpacity);
      break;
    default:
      _drawCircle(ctx, x, y, r, color, fillOpacity);
  }
}

function _drawAura(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  memoryStrength: number,
  now: number
): void {
  const baseOpacity = (memoryStrength / 5.0) * 0.14;
  if (baseOpacity < 0.01) return;
  const pulse = Math.sin((now / 2000) * Math.PI) * 0.2 + 0.8;
  for (const [ring_r, opMult] of [
    [r + 4, 1.0],
    [r + 9, 0.5],
  ] as [number, number][]) {
    ctx.beginPath();
    ctx.arc(x, y, ring_r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = baseOpacity * opMult * pulse;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function _withAlpha(hex: string, alpha: number): string {
  // Accept `#rgb` and `#rrggbb`. For anything else (named colors, rgb()/hsl(),
  // CSS vars from a non-hex palette in a portable host) fall back to the raw
  // string so a solid color still renders instead of an invalid
  // `rgba(NaN,NaN,NaN,…)` that the canvas would silently drop.
  let h = hex;
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    h = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(h)) return hex;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function _drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  fillOpacity?: number
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.fillStyle = _withAlpha(color, fillOpacity ?? FILL_OPACITY);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function _drawHexagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  fillOpacity?: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + r * Math.cos(angle);
    const py = y + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = _withAlpha(color, fillOpacity ?? FILL_OPACITY);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function _drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  fillOpacity?: number
): void {
  const w = r * 2.2;
  const h = r * 1.6;
  const rx = r * 0.35;
  const sx = x - w / 2;
  const sy = y - h / 2;
  ctx.beginPath();
  ctx.moveTo(sx + rx, sy);
  ctx.lineTo(sx + w - rx, sy);
  ctx.arcTo(sx + w, sy, sx + w, sy + rx, rx);
  ctx.lineTo(sx + w, sy + h - rx);
  ctx.arcTo(sx + w, sy + h, sx + w - rx, sy + h, rx);
  ctx.lineTo(sx + rx, sy + h);
  ctx.arcTo(sx, sy + h, sx, sy + h - rx, rx);
  ctx.lineTo(sx, sy + rx);
  ctx.arcTo(sx, sy, sx + rx, sy, rx);
  ctx.closePath();
  ctx.fillStyle = _withAlpha(color, fillOpacity ?? FILL_OPACITY);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function _drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  fillOpacity?: number
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = _withAlpha(color, fillOpacity ?? FILL_OPACITY);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function _drawPentagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  fillOpacity?: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (2 * Math.PI * i) / 5 - Math.PI / 2;
    const px = x + r * Math.cos(angle);
    const py = y + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = _withAlpha(color, fillOpacity ?? FILL_OPACITY);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
