// apps/web/lib/mnemo/recall.ts
//
// Recall helper that embeds the query host-side with the workspace's
// configured AI provider and forwards the precomputed `vector` to
// Mnemosyne. The mnemosyne service therefore never needs its own LLM
// credentials — every embedding uses the workspace's encrypted
// `ai_provider` row (set via the Orchester Settings UI), and cost
// attribution lands on the workspace that ran the recall.
//
// Pattern:
//   - Orchester reads `ai_provider` for the workspace, decrypts the key,
//     calls OpenAI / Google embeddings, normalizes to 1536 dims.
//   - The vector ships with the SDK `client.recall({ query, vector })`
//     call. The server skips its embedding pass (RecallInput.vector
//     short-circuits the LLM round-trip).
//   - When the workspace has no embedding provider configured we
//     gracefully fall back to lexical-only recall by omitting the
//     vector. Mnemosyne returns BM25 hits when it has no embedder
//     of its own, or a structured 501 when neither side can embed.
//
// This is the canonical single entry point — agent-runtime, MCP,
// channels router, and the agent `brain_recall` tool all dispatch
// through it so the embedding contract stays uniform.
import "server-only";
import { embed } from "@/lib/embeddings";
import { safeLogError } from "@/lib/safe-log";
import type { RecallInput, RecallResponse } from "@mnemosyne/client-ts";
import { getMnemoClient } from "@/lib/mnemo/client";

/** Default embedding model — matches Mnemosyne's `halfvec(1536)` schema. */
const DEFAULT_EMBED_MODEL = "text-embedding-3-small";

interface RecallParams extends Omit<RecallInput, "vector"> {
  /** Workspace whose `ai_provider` row supplies the embedding credentials. */
  workspaceId: string;
}

/**
 * Run a recall round-trip, embedding the query host-side with the
 * workspace's configured provider when one exists. Never throws on
 * embedding failure — falls back to lexical-only recall.
 */
export async function recallForWorkspace(params: RecallParams): Promise<RecallResponse> {
  const { workspaceId, query, ...rest } = params;
  const client = getMnemoClient();

  let vector: number[] | undefined;
  try {
    const { vectors } = await embed(workspaceId, "openai", DEFAULT_EMBED_MODEL, [query]);
    vector = vectors[0];
  } catch (e) {
    // No provider configured / decrypt failed / network error.
    // Recall is best-effort: degrade to lexical-only by omitting `vector`.
    safeLogError("[mnemo/recall] embedding skipped:", e);
  }

  return client.recall({
    query,
    ...(vector ? { vector } : {}),
    ...rest,
  });
}
