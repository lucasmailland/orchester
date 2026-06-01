// packages/mnemosyne/src/recall/trust-ladder.ts
//
// v2 — Trust ladder for `mnemo_relation.provenance`.
//
// v1.1 #11 shipped provenance as free text with two effective values:
//   - NULL        → LLM-derived (default, treated as trusted)
//   - "heuristic" → system-synthesized via alias merge / coref / dedup
//
// v2 extends the ladder with new strings WITHOUT a schema migration —
// the column was deliberately `text DEFAULT NULL` exactly so the
// taxonomy could grow without downtime. The expanded ladder:
//
//   verified   > llm  > heuristic > pending > unverified
//      1.0     > 0.9  >    0.7    >   0.5   >    0.3
//
// Semantics:
//   - verified   — human-confirmed via the review queue. Edge survives
//                  auto-pin and contradicts-as-truth.
//   - llm        — LLM-extracted, no human review. Default for current
//                  extractions. NULL maps to this for back-compat.
//   - heuristic  — system-synthesized (alias merge, coref, dedup).
//                  Current v1.1 semantics.
//   - pending    — extracted but blocked on a missing entity / mention
//                  in `mnemo_unresolved_mention`. Edge exists but is
//                  flagged as low-trust until the mention resolves.
//   - unverified — surfaced by an external integration without a
//                  trust signal (webhook import, third-party sync).
//
// Pure module — no DB calls, no schema dependencies. Wired into
// `decayForEdge` in `search.ts` so graph-expansion respects the trust
// ladder when computing neighbour scores.

/**
 * Canonical trust-ladder rungs. Order matters — higher index = higher
 * trust. Use `TRUST_LADDER_DECAY[rung]` to map a rung to its decay
 * cap for graph expansion.
 */
export type TrustLadderRung = "unverified" | "pending" | "heuristic" | "llm" | "verified";

/**
 * Per-rung decay cap applied during graph expansion. Multiplied with
 * `expandDecay` and the per-verb priority so the final edge weight is
 * `base × verbPriority × trustCap`. Tighter caps for lower-trust rungs
 * mean their neighbours compete from a weaker score floor against
 * direct first-stage hits.
 *
 * Frozen — callers MUST NOT mutate this map.
 */
export const TRUST_LADDER_DECAY: Readonly<Record<TrustLadderRung, number>> = Object.freeze({
  verified: 1.0,
  // "llm" is the back-compat default for NULL provenance. v1.1
  // applied no cap at this rung (the base decay was used verbatim);
  // 1.0 here preserves that — `min(base, 1.0) === base`.
  llm: 1.0,
  // v1.1 capped heuristic at 0.5. Preserved verbatim to keep recall
  // scores byte-identical for workspaces with heuristic-only edges.
  heuristic: 0.5,
  // New v2 rungs (no v1.1 edges exist with these values yet).
  pending: 0.4,
  unverified: 0.25,
});

/**
 * Map a raw `mnemo_relation.provenance` value (free text or NULL) to
 * a canonical TrustLadderRung. NULL ⇒ "llm" (back-compat with the
 * v1.1 #11 default semantics where missing provenance was assumed to
 * be LLM-derived).
 *
 * Unknown strings ⇒ "unverified" (defensive — an external integration
 * that wrote a custom string should be treated as low-trust until
 * someone explicitly classifies it).
 */
export function classifyTrustRung(raw: string | null | undefined): TrustLadderRung {
  if (raw == null) return "llm"; // v1.1 default
  switch (raw) {
    case "verified":
    case "llm":
    case "heuristic":
    case "pending":
    case "unverified":
      return raw;
    default:
      return "unverified";
  }
}

/**
 * Decay cap for a raw provenance value. Equivalent to
 * `TRUST_LADDER_DECAY[classifyTrustRung(raw)]`; provided as a single
 * call so hot paths don't allocate the intermediate rung string.
 */
export function trustDecay(raw: string | null | undefined): number {
  return TRUST_LADDER_DECAY[classifyTrustRung(raw)];
}
