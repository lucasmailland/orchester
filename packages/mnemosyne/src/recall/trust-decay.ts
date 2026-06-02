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

/** Generic hit shape required by `runRerank`. The recall pipeline's
 *  full `UnifiedRecallHit` is a superset; this minimal interface keeps
 *  the helper testable without coupling to schema types. */
export interface RerankableHit {
  factId: string;
  score: number;
  statement: string;
  memoryStrength?: number;
  lastRecalledAt?: Date | null;
}

export interface RunRerankInput<H extends RerankableHit> {
  hits: H[];
  applyTrustDecay: boolean;
  /** Inject `now` for deterministic tests — defaults to `new Date()`. */
  now?: Date;
}

/** Pure score-transform + stable sort. When `applyTrustDecay` is true,
 *  each hit's score is multiplied by `effectiveTrust(memoryStrength,
 *  lastRecalledAt, now)`. With `false`, this is a stable score-desc
 *  resort (no transformation). Returns a new array; input unchanged. */
export function runRerank<H extends RerankableHit>(input: RunRerankInput<H>): H[] {
  const now = input.now ?? new Date();
  const adjusted = input.hits.map((h) => {
    if (!input.applyTrustDecay) return h;
    const strength = h.memoryStrength ?? 1.0;
    const factor = effectiveTrust({
      memoryStrength: strength,
      lastRecalledAt: h.lastRecalledAt ?? null,
      now,
    });
    return { ...h, score: h.score * factor };
  });
  // Stable descending sort: keep insertion order on ties so the
  // unrelated `applyTrustDecay=false` path is a pure passthrough.
  return adjusted
    .map((h, idx) => ({ h, idx }))
    .sort((a, b) => b.h.score - a.h.score || a.idx - b.idx)
    .map((x) => x.h);
}
