// Pure trust-decay helper for v2 rerank. AGT's TrustManager applies an
// exponential decayFactor per hour to a per-peer Bayesian score.
// Mnemo's analogue is per-fact: a fact never referenced in months
// should weigh less than one recalled yesterday. Half-life formulation
// (more intuitive than a multiplicative factor) keyed on
// `last_recalled_at`.
//
// Pure & side-effect-free; rerank.ts wires it opt-in via MNEMO_TRUST_DECAY.

/** Half-life in days. 7d ≈ 0.71, 14d = 0.50, 30d ≈ 0.23, 90d ≈ 0.012. */
export const DECAY_HALF_LIFE_DAYS = 14;

export interface EffectiveTrustInput {
  memoryStrength: number;
  lastRecalledAt: Date | null;
  now: Date;
}

export function effectiveTrust(input: EffectiveTrustInput): number {
  const { memoryStrength, lastRecalledAt, now } = input;
  if (!lastRecalledAt) return memoryStrength;
  const elapsedMs = Math.max(0, now.getTime() - lastRecalledAt.getTime());
  const halfLifeMs = DECAY_HALF_LIFE_DAYS * 86_400_000;
  const decay = Math.pow(0.5, elapsedMs / halfLifeMs);
  return memoryStrength * decay;
}
