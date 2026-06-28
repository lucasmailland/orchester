import "server-only";
import type { DbClient } from "@orchester/db";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export type EmbeddingProvider = "openai" | "google" | "voyage";

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dims: number;
  tokensUsed: number;
}

const MODEL_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 1536,
  "text-embedding-004": 768,
  "voyage-3": 1024,
};

/**
 * KNOW-10: Embeds texts via the catalog adapter path (single implementation).
 * Delegates to lib/ai/run.embed which handles credential loading, provider
 * dispatch (openai-compatible/gemini/voyage), metering, and normalization.
 * All vectors are normalized to 1536 dimensions.
 */
export async function embed(
  workspaceId: string,
  provider: EmbeddingProvider,
  model: string,
  texts: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _tx?: WsDb
): Promise<EmbeddingResult> {
  if (texts.length === 0) return { vectors: [], model, dims: embeddingDims(model), tokensUsed: 0 };
  const { embed: catalogEmbed } = await import("./ai/run");
  const modelId = model.includes(":") ? model : `${provider}:${model}`;
  const res = await catalogEmbed(workspaceId, modelId, texts);
  const vectors = res.vectors.map((v) => normalizeTo1536(v));
  return {
    vectors,
    model,
    dims: vectors[0]?.length ?? embeddingDims(model),
    tokensUsed: res.tokensUsed,
  };
}

/** Truncate to 1536 or zero-pad. Keeps schema vector(1536) consistent. */
export function normalizeTo1536(v: number[]): number[] {
  if (v.length === 1536) return v;
  if (v.length > 1536) return v.slice(0, 1536);
  const padded = [...v];
  while (padded.length < 1536) padded.push(0);
  return padded;
}

export function defaultEmbeddingModel(provider: EmbeddingProvider): string {
  switch (provider) {
    case "openai":
      return "text-embedding-3-small";
    case "google":
      return "text-embedding-004";
    case "voyage":
      return "voyage-3";
  }
}

export function embeddingDims(model: string): number {
  return MODEL_DIMS[model] ?? 1536;
}
