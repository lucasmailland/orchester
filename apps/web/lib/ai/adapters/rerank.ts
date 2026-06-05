import "server-only";
import type { Cred, RerankParams, RerankResult, RerankHit } from "../capabilities";
import { fetchWithTimeout } from "../../http-util";

const RERANK_TIMEOUT_MS = 60_000;

/**
 * Rerank: ordena documentos por relevancia a una consulta. Cohere, Voyage y Jina
 * comparten una forma muy parecida ({model, query, documents} → results[]).
 */
export async function rerankWith(
  providerId: string,
  p: RerankParams,
  cred: Cred
): Promise<RerankResult> {
  const endpoint =
    providerId === "cohere"
      ? "https://api.cohere.com/v2/rerank"
      : providerId === "voyage"
        ? "https://api.voyageai.com/v1/rerank"
        : providerId === "jina"
          ? "https://api.jina.ai/v1/rerank"
          : null;
  if (!endpoint) throw new Error(`Rerank con ${providerId} todavía no está implementado.`);

  const body: Record<string, unknown> = { model: p.model, query: p.query, documents: p.documents };
  if (p.topN) body.top_n = p.topN;
  const r = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    RERANK_TIMEOUT_MS
  );
  if (!r.ok) throw new Error(`Rerank ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const results: RerankHit[] = (j.results ?? []).map(
    (x: { index: number; relevance_score?: number }) => ({
      index: x.index,
      document: p.documents[x.index] ?? "",
      score: x.relevance_score ?? 0,
    })
  );
  return { results, model: p.model };
}
