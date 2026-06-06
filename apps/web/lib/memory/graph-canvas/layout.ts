// packages/mnemosyne/src/graph/layout.ts
// Default d3-force physics configuration for the Memory Graph.

export interface ForceConfig {
  chargeStrength: number;
  linkDistance: number;
  centerStrength: number;
  alphaDecay: number;
}

export function defaultForceConfig(): ForceConfig {
  return {
    chargeStrength: -180,
    linkDistance: 100,
    centerStrength: 0.05,
    alphaDecay: 0.02,
  };
}
