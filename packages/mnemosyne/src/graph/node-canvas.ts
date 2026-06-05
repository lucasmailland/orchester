// packages/mnemosyne/src/graph/node-canvas.ts
// Pure Canvas 2D drawing helpers for graph nodes.
// Zero framework dependencies — works in browser, Node.js + canvas, etc.

import type { GraphNodeKind, GraphEntityKind } from "./types";

export const NODE_RADIUS_MIN = 8;
export const NODE_RADIUS_MAX = 28;

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
}

export function drawNode(
  ctx: CanvasRenderingContext2D,
  opts: NodeDrawOptions,
  now = Date.now()
): void {
  const { x, y, r, color, selected, memoryStrength, label, kind, entityKind, globalScale } = opts;

  ctx.save();

  _drawAura(ctx, x, y, r, color, memoryStrength, now);

  const resolvedKind = entityKind ?? kind;
  switch (resolvedKind) {
    case "person":
      _drawCircle(ctx, x, y, r, color);
      break;
    case "organization":
      _drawHexagon(ctx, x, y, r, color);
      break;
    case "project":
    case "episode":
      _drawRoundedRect(ctx, x, y, r, color);
      break;
    case "concept":
    case "decision":
      _drawDiamond(ctx, x, y, r, color);
      break;
    case "place":
      _drawPentagon(ctx, x, y, r, color);
      break;
    default:
      _drawCircle(ctx, x, y, r, color);
  }

  if (globalScale >= 0.7) {
    const fontSize = Math.max(8, 12 / globalScale);
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#fafafa";
    ctx.fillText(label, x, y + r + fontSize + 2);
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

  ctx.restore();
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
  const baseOpacity = (memoryStrength / 5.0) * 0.18;
  if (baseOpacity < 0.01) return;
  const pulse = Math.sin((now / 2000) * Math.PI) * 0.2 + 0.8;
  for (const [ring_r, opMult] of [
    [r + 8, 1.0],
    [r + 18, 0.5],
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
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function _drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.fillStyle = _withAlpha(color, FILL_OPACITY);
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
  color: string
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
  ctx.fillStyle = _withAlpha(color, FILL_OPACITY);
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
  color: string
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
  ctx.fillStyle = _withAlpha(color, FILL_OPACITY);
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
  color: string
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = _withAlpha(color, FILL_OPACITY);
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
  color: string
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
  ctx.fillStyle = _withAlpha(color, FILL_OPACITY);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}
