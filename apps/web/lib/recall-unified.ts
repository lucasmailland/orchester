// apps/web/lib/recall-unified.ts
//
// Host adapter for `recallUnified` from `@orchester/mnemosyne`.
//
// Mnemosyne is KB-agnostic by design — it accepts a `KbChunkProvider`
// callback that returns scored chunks. This file is where the host
// wires that callback against the existing `knowledge_chunk` table
// (see `apps/web/lib/knowledge-search.ts` for the canonical query
// path).
//
// Two scenarios:
//   1. Caller knows which KB to search → pass `kbId` and we delegate
//      directly to `searchKnowledgeBase`.
//   2. Caller doesn't know → we currently degrade to "memory-only" by
//      returning an empty KbChunk[]. A future v1.5 polish could
//      auto-resolve "the workspace's primary KB" but today that
//      mapping is ambiguous (workspaces can have many KBs).

import "server-only";
import type { KbChunkProvider, KbChunk } from "@orchester/mnemosyne";
import { searchKnowledgeBase } from "./knowledge-search";

/**
 * Build a KbChunkProvider that delegates to `searchKnowledgeBase`
 * scoped to a specific KB. Returns `null` when `kbId` is empty so the
 * caller can pass the resulting value straight into `recallUnified`'s
 * optional `kbProvider` field.
 */
export function makeKbChunkProvider(kbId: string | null | undefined): KbChunkProvider | null {
  if (!kbId || !kbId.trim()) return null;
  const resolvedKbId = kbId.trim();
  return {
    async search({ workspaceId, query, topK }) {
      // `searchKnowledgeBase` returns `KnowledgeHit[]` — re-shape to
      // mnemosyne's `KbChunk` contract. We truncate `text` defensively
      // (the recall pipeline doesn't, and a 50KB chunk can blow the
      // host LLM's context budget). 800 chars is a generous prompt-
      // budget value; the agent runtime decides final rendering.
      const hits = await searchKnowledgeBase(workspaceId, resolvedKbId, query, topK);
      const out: KbChunk[] = hits.map((h) => ({
        id: h.id,
        content: h.text.length > 800 ? h.text.slice(0, 800) + "…" : h.text,
        score: h.score,
        source: {
          docId: h.docId,
          docTitle: h.docTitle,
          // KB chunks don't currently carry `page` metadata at the
          // schema level (it's inside `knowledge_chunk.metadata`). We
          // leave it undefined here; a future enhancement can lift it
          // out of metadata when the column lands.
        },
      }));
      return out;
    },
  };
}
