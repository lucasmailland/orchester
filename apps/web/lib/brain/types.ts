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

export interface FactExtractionInput {
  kind: FactKind;
  subject: string;
  statement: string;
  confidence: number;
}
