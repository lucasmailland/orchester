import "server-only";
import type { Cred, EmbeddingParams, EmbeddingResult } from "../capabilities";
import { fetchWithTimeout } from "../../http-util";

const EMBED_TIMEOUT_MS = 60_000;

/**
 * Adaptadores de embeddings. La mayoría de proveedores exponen el endpoint
 * OpenAI-compatible POST {baseURL}/embeddings; Google usa batchEmbedContents.
 */
export async function embedWith(
  providerId: string,
  family: string,
  p: EmbeddingParams,
  cred: Cred,
  baseURL?: string
): Promise<EmbeddingResult> {
  if (providerId === "google") return googleEmbed(p, cred);
  const url = baseURL ?? cred.endpoint;
  if (family === "openai-compatible" && url) return openaiEmbed(p, cred, url);
  throw new Error(`Embeddings con ${providerId} todavía no implementado.`);
}

async function openaiEmbed(
  p: EmbeddingParams,
  cred: Cred,
  baseURL: string
): Promise<EmbeddingResult> {
  const r = await fetchWithTimeout(
    `${baseURL.replace(/\/$/, "")}/embeddings`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: p.model, input: p.input }),
    },
    EMBED_TIMEOUT_MS
  );
  if (!r.ok) throw new Error(`Embeddings ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const vectors = (j.data ?? []).map((d: { embedding: number[] }) => d.embedding);
  return { vectors, model: p.model, tokensUsed: j.usage?.total_tokens ?? 0 };
}

async function googleEmbed(p: EmbeddingParams, cred: Cred): Promise<EmbeddingResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:batchEmbedContents?key=${encodeURIComponent(cred.apiKey)}`;
  const r = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: p.input.map((t) => ({
          model: `models/${p.model}`,
          content: { parts: [{ text: t }] },
        })),
      }),
    },
    EMBED_TIMEOUT_MS
  );
  if (!r.ok) throw new Error(`Google embeddings ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const vectors = (j.embeddings ?? []).map((e: { values: number[] }) => e.values);
  return { vectors, model: p.model, tokensUsed: 0 };
}
