import "server-only";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "./encryption";
import { fetchWithTimeout } from "./http-util";

/**
 * Optional `tx?: WsDb` follows the project-wide pattern (see
 * `lib/billing/quotas.ts`). When a caller is already inside a
 * transaction with `app.workspace_id` SET LOCAL, passing the same
 * handle keeps the `ai_provider` lookup on the same connection so
 * FORCE RLS sees the GUC.
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

const EMBED_TIMEOUT_MS = 60_000;

export type EmbeddingProvider = "openai" | "google" | "voyage";

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dims: number;
  tokensUsed: number;
}

const MODEL_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 1536, // we truncate to 1536 to keep schema simple
  "text-embedding-004": 768, // pad to 1536 with zeros below
  "voyage-3": 1024,
};

/**
 * Embeds a list of texts using the configured provider for the workspace.
 * All vectors are normalized to dimension 1536 (truncate or zero-pad).
 */
export async function embed(
  workspaceId: string,
  provider: EmbeddingProvider,
  model: string,
  texts: string[],
  tx?: WsDb
): Promise<EmbeddingResult> {
  if (texts.length === 0) return { vectors: [], model, dims: 1536, tokensUsed: 0 };

  // Locate provider key (reuse ai_provider rows configured in Settings)
  const db = tx ?? getDb();
  // Map embedding provider → ai_provider.provider enum
  const aiProviderKind: "openai" | "google" = provider === "openai" ? "openai" : "google";
  const rows = await db
    .select()
    .from(schema.aiProviders)
    .where(
      and(
        eq(schema.aiProviders.workspaceId, workspaceId),
        eq(schema.aiProviders.provider, aiProviderKind)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.enabled) {
    throw new Error(
      `Embedding requires ${aiProviderKind} provider configured. Add the API key in Settings.`
    );
  }
  const apiKey = decrypt(row.apiKey);

  if (provider === "openai") return embedOpenAI(apiKey, model, texts);
  if (provider === "google") return embedGoogle(apiKey, model, texts);
  throw new Error(`Provider ${provider} not implemented`);
}

async function embedOpenAI(
  apiKey: string,
  model: string,
  texts: string[]
): Promise<EmbeddingResult> {
  const wantDims = 1536;
  const r = await fetchWithTimeout(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      // KNOW-3: request server-side dimensions so the API returns a normalized
      // 1536-d vector (text-embedding-3-* support `dimensions`). Client-side
      // .slice() de-normalized the vector and broke cosine ranking.
      body: JSON.stringify({ model, input: texts, dimensions: wantDims }),
    },
    EMBED_TIMEOUT_MS
  );
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const vectors = (j.data ?? []).map((d: { embedding: number[] }) => normalizeTo1536(d.embedding));
  return { vectors, model, dims: wantDims, tokensUsed: j.usage?.total_tokens ?? 0 };
}

async function embedGoogle(
  apiKey: string,
  model: string,
  texts: string[]
): Promise<EmbeddingResult> {
  // Google embeds one at a time via batchEmbedContents
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
  const r = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((t) => ({
          model: `models/${model}`,
          content: { parts: [{ text: t }] },
        })),
      }),
    },
    EMBED_TIMEOUT_MS
  );
  if (!r.ok) throw new Error(`Google embeddings ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const vectors = (j.embeddings ?? []).map((e: { values: number[] }) => normalizeTo1536(e.values));
  return { vectors, model, dims: 1536, tokensUsed: 0 };
}

/** Truncate to 1536 or zero-pad. Keeps schema vector(1536) consistent. */
function normalizeTo1536(v: number[]): number[] {
  if (v.length === 1536) return v;
  if (v.length > 1536) return v.slice(0, 1536);
  const padded = [...v];
  while (padded.length < 1536) padded.push(0);
  return padded;
}

/**
 * Default embedding model & provider per ai-provider availability.
 */
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
