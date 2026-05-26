// apps/web/lib/brain/types.ts
//
// Public types for Brain Core (sub-spec 2). See
// docs/specs/2026-05-24-brain-core-design.md §2.4 for the contract.

export type FactKind =
  | "preference"
  | "trait"
  | "event"
  | "relationship"
  | "skill"
  | "concern"
  | "other";

export type FactScope = "global" | "conversation" | "employee" | "team";

export type FactStatus = "active" | "merged" | "forgotten";

export interface BrainFact {
  id: string;
  workspaceId: string;
  agentId: string | null;
  scope: FactScope;
  scopeRef: string | null;
  kind: FactKind;
  subject: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  relevance: number;
  hitCount: number;
  lastRecalledAt: Date | null;
  sourceMessageIds: string[];
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  status: FactStatus;
  mergedIntoId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecallHit {
  fact: BrainFact;
  score: number;
  reasons: {
    semantic: number;
    recency: number;
    frequency: number;
    relevance: number;
    pin: number;
  };
}

/**
 * Mnemosyne v1.5 (F1) — the cognitive classification surfaced by the
 * extractor. Mirrors `MemoryType` in `@orchester/mnemosyne/episode`
 * (kept local here so the brain/extract.ts layer doesn't have to pull
 * the package barrel for a four-string enum). Defaults to 'semantic'
 * when the LLM omits it.
 */
export type FactMemoryType = "semantic" | "episodic" | "procedural" | "working";

/**
 * Mnemosyne v1.5 (F1) — theory-of-mind classification surfaced by the
 * extractor. Mirrors `Attribution` in `@orchester/mnemosyne`. Defaults
 * to 'inferred' when the LLM omits it.
 */
export type FactAttribution = "user_stated" | "user_belief" | "objective_fact" | "inferred";

export interface FactExtractionInput {
  kind: FactKind;
  subject: string;
  statement: string;
  confidence: number;
  /**
   * v1.5 — cognitive classification from the LLM. Defaults to 'semantic'
   * on parse failure / omission so legacy callers (and Mode A workspaces
   * that produce facts without the LLM classification field) keep the
   * same row shape.
   */
  memoryType?: FactMemoryType;
  /**
   * v1.5 — theory-of-mind attribution from the LLM. Defaults to
   * 'inferred' on parse failure / omission.
   */
  attribution?: FactAttribution;
  /**
   * v1.6 (G2) — optional entity name the LLM thinks this fact is
   * primarily about. The caller resolves this string to a
   * `mnemo_entity.id` via `findOrCreate` and sets the resulting id on
   * `mnemo_fact.entity_id`. `null` is an explicit signal that the LLM
   * disowned an entity link (the fact is workspace-wide); `undefined`
   * means the LLM did not classify (heuristic candidates pick up the
   * slack downstream).
   */
  entityName?: string | null;
}
