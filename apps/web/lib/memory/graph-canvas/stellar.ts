// apps/web/lib/memory/graph-canvas/stellar.ts
//
// Stellar color ramp for centrality-coloured graph nodes, adapted from the
// Hertzsprung-Russell-inspired scheme in DeusData/codebase-memory-mcp's
// graph-ui (colors.ts). A node's PageRank centrality (0..1, from
// graph-analytics) maps to a star's spectral class: structurally peripheral
// leaves render as cool red dwarfs (M), central hubs as hot blue giants (O).
// Hot stops are near-white/blue and high-luminance on purpose — they are what
// the UnrealBloom pass picks up as a glowing corona.
//
// Pure module: no React, no Three.js. Unit-tested in stellar.test.ts.

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Spectral stops, coolest (peripheral) → hottest (central). */
export const STELLAR_STOPS = [
  "#ff6050", // M — red dwarf
  "#ffa060", // K — orange
  "#ffe080", // G — yellow (sun-like)
  "#fff0c0", // F — yellow-white
  "#e8e8ff", // A — white
  "#c0d0ff", // B — blue-white
  "#80a0ff", // O — blue giant
] as const;

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Map a normalized centrality (0..1) to a stellar hex color, linearly
 * interpolating between the spectral stops.
 */
export function stellarColor(centrality: number): string {
  const t = clamp01(centrality);
  const last = STELLAR_STOPS.length - 1;
  const scaled = t * last;
  const i = Math.min(last - 1, Math.floor(scaled));
  const frac = scaled - i;
  const a = hexToRgb(STELLAR_STOPS[i]!);
  const b = hexToRgb(STELLAR_STOPS[i + 1]!);
  return rgbToHex({
    r: a.r + (b.r - a.r) * frac,
    g: a.g + (b.g - a.g) * frac,
    b: a.b + (b.b - a.b) * frac,
  });
}

/**
 * Edge alpha by community membership: edges inside a single Louvain community
 * read as bright structural ties; edges bridging communities fade back so the
 * cluster structure pops. Undefined community (node not in the analytics map)
 * is treated as cross-community.
 */
export const EDGE_INTRA_INTENSITY = 0.55;
export const EDGE_INTER_INTENSITY = 0.12;

export function edgeIntensity(
  sourceCommunity: number | undefined,
  targetCommunity: number | undefined
): number {
  if (sourceCommunity === undefined || targetCommunity === undefined) {
    return EDGE_INTER_INTENSITY;
  }
  return sourceCommunity === targetCommunity ? EDGE_INTRA_INTENSITY : EDGE_INTER_INTENSITY;
}
