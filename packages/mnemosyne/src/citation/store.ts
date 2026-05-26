// packages/mnemosyne/src/citation/store.ts
//
// CRUD for mnemo_citation. Provenance trail: every memory (fact / decision /
// entity / episode) traces back to source messages + extractor model +
// prompt version + judge relation. The (workspace_id, memory_kind, memory_id)
// composite index supports the recursive proof-tree walk in
// citation/provenance.ts (added in a later Phase 3 task).
//
// §0.1: package-clean — no `server-only`, no path aliases.
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { Tx } from "../tx";

export type CitationSourceKind =
  | "message"
  | "document"
  | "tool_call"
  | "llm_extraction"
  | "user_edit"
  | "agent_save"
  | "imported";
export type CitationMemoryKind = "fact" | "decision" | "entity" | "episode";

export interface Citation {
  id: string;
  workspaceId: string;
  memoryKind: CitationMemoryKind;
  memoryId: string;
  sourceKind: CitationSourceKind;
  sourceId: string | null;
  extractorModel: string | null;
  extractorPromptVersion: string | null;
  judgeModel: string | null;
  judgeRelationId: string | null;
  evidenceExcerpt: string | null;
  createdAt: Date;
}

export interface CreateCitationInput {
  workspaceId: string;
  memoryKind: CitationMemoryKind;
  memoryId: string;
  sourceKind: CitationSourceKind;
  sourceId?: string | null;
  extractorModel?: string | null;
  extractorPromptVersion?: string | null;
  judgeModel?: string | null;
  judgeRelationId?: string | null;
  evidenceExcerpt?: string | null;
  tx: Tx;
}

/**
 * @public
 * @sinceVersion 1.0 — public API surface, not yet consumed by host code as of v1.4.
 *
 * Persists a citation row linking a memory primitive (fact/decision) to
 * its source span. Tested end-to-end but no production caller invokes
 * it yet — the extraction pipeline today stamps source metadata onto
 * facts inline rather than going through this dedicated row. The
 * v1.5 Inspector + judge-trace UI will surface it. Surfaced by
 * 2026-05-25-mnemosyne-v1.4-final-audit.md §P2 — intentionally retained.
 */
export async function createCitation(input: CreateCitationInput): Promise<Citation> {
  const id = `mcit_${createId()}`;
  const rows = await input.tx
    .insert(schema.mnemoCitations)
    .values({
      id,
      workspaceId: input.workspaceId,
      memoryKind: input.memoryKind,
      memoryId: input.memoryId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId ?? null,
      extractorModel: input.extractorModel ?? null,
      extractorPromptVersion: input.extractorPromptVersion ?? null,
      judgeModel: input.judgeModel ?? null,
      judgeRelationId: input.judgeRelationId ?? null,
      evidenceExcerpt: input.evidenceExcerpt ?? null,
    })
    .returning();
  return rows[0] as unknown as Citation;
}

export async function listCitationsForMemory(
  workspaceId: string,
  memoryKind: CitationMemoryKind,
  memoryId: string,
  tx: Tx
): Promise<Citation[]> {
  const rows = await tx
    .select()
    .from(schema.mnemoCitations)
    .where(
      and(
        eq(schema.mnemoCitations.workspaceId, workspaceId),
        eq(schema.mnemoCitations.memoryKind, memoryKind),
        eq(schema.mnemoCitations.memoryId, memoryId)
      )
    )
    .orderBy(desc(schema.mnemoCitations.createdAt));
  return rows as unknown as Citation[];
}
