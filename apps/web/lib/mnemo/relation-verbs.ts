// apps/web/lib/mnemo/relation-verbs.ts
//
// The 9 LOCKED relation verbs (Mnemosyne v1.0 vocabulary). Mirrors
// `RelationVerb` in @mnemo-ai/client-ts (types.ts:810-819) and the keys
// of EDGE_STYLES (lib/memory/graph-canvas/edge-canvas.ts:14-25). Kept as
// a local const tuple so we can drive a zod enum AND a UI picker from one
// source of truth without importing `server-only` code into the client.
import { z } from "zod";

export const RELATION_VERBS = [
  "related",
  "compatible",
  "scoped",
  "conflicts_with",
  "supersedes",
  "not_conflict",
  "derived_from",
  "part_of",
  "member_of",
] as const;

export type RelationVerbLiteral = (typeof RELATION_VERBS)[number];

/** zod enum reused by every relation-mutating API route. */
export const relationVerbEnum = z.enum(RELATION_VERBS);

/** The 4 primitives a relation can connect (types.ts:825). */
export const RELATION_KINDS = ["fact", "decision", "entity", "episode"] as const;
export type RelationKindLiteral = (typeof RELATION_KINDS)[number];
export const relationKindEnum = z.enum(RELATION_KINDS);

/**
 * Map a graph node's `kind` to a RelationKind. Graph nodes are only ever
 * entity | episode | decision (graph-canvas/types.ts:7) — there is no
 * `fact` node — so this is total over GraphNodeKind.
 */
export function graphKindToRelationKind(
  kind: "entity" | "episode" | "decision"
): RelationKindLiteral {
  return kind;
}
