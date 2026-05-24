// packages/mnemosyne/src/graph/verbs.ts
//
// LOCKED vocabulary of 9 relation verbs (spec §3). Changing this list
// invalidates all stored judgments because the LLM-judge prompt is locked
// to these verbs. Bump RELATION_VERB_VERSION when extending — and provide
// a migration plan in the bump commit (re-judge all pending edges, or
// freeze the old version's edges with status='dismissed' and re-extract).
//
// The order of the array is part of the public contract: index positions
// surface in judge UI dropdowns and trace logs. Do NOT reorder.

export const RELATION_VERB_VERSION = "v1.0.0" as const;

export const RELATION_VERBS = [
  "related", // soft semantic link
  "compatible", // coexists, no conflict
  "scoped", // one is a subset of the other
  "conflicts_with", // direct contradiction
  "supersedes", // replaces target (target should be marked superseded)
  "not_conflict", // explicit non-conflict after LLM/human evaluation
  "derived_from", // source produced by / inferred from target
  "part_of", // source is part of (composes) target
  "member_of", // source belongs to collection target
] as const;

export type RelationVerb = (typeof RELATION_VERBS)[number];

/** Type guard: narrows `s: string` to `RelationVerb`. */
export function isRelationVerb(s: string): s is RelationVerb {
  return (RELATION_VERBS as readonly string[]).includes(s);
}
