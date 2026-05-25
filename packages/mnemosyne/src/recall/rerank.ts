// packages/mnemosyne/src/recall/rerank.ts
//
// Cross-encoder reranking pass over an initial hybrid-recall top-K.
// First-stage hybrid scoring (FTS + vector) is fast but coarse: it
// ranks by independent embedding similarity, which can rank a vaguely-
// related fact above a precisely-related one. Cross-encoders look at
// (query, document) jointly and re-order with much higher fidelity.
//
// Per Charter §25 (provider agnosticism) this module exposes a small
// `RerankFn` interface so callers can:
//   • pass `noopRerank` when no reranker is configured (identity order,
//     just hard-caps to topK — the safe default),
//   • pass `makeCohereRerank(apiKey)` if they have a Cohere key,
//   • pass any host-built RerankFn (Voyage, Jina, on-prem, mock, …).
//
// Default behaviour stays graceful: if a host wires Cohere but the
// network call fails, `makeCohereRerank` falls back to the noop result
// rather than throwing — recall must never crash because of a missing
// 3rd-party reranker.
//
// §0.1: package-clean — no `server-only`. The HTTP call uses the
// standard `fetch` global (Node 22+ has it built in, which is the
// runtime mnemosyne ships on).

export interface RerankInput {
  query: string;
  documents: string[];
  topK: number;
}

/**
 * Returns the indices into `documents` in best-first order. Length is
 * at most `topK`. Order MUST be deterministic for a given input.
 *
 * Implementations are async because cross-encoders typically run
 * server-side (HTTP). The noop / mock variants resolve synchronously.
 */
export type RerankFn = (input: RerankInput) => Promise<number[]>;

/**
 * Identity reranker — returns the first `topK` documents in their
 * input order. Used when no reranker is configured, or as the fallback
 * inside `makeCohereRerank` when the upstream call fails.
 */
export const noopRerank: RerankFn = async ({ documents, topK }) => {
  const n = Math.min(documents.length, Math.max(topK, 0));
  return Array.from({ length: n }, (_, i) => i);
};

export interface CohereRerankOptions {
  /**
   * Cohere model id. Defaults to `rerank-3.5` (the v3.5 multilingual
   * model as of 2026). Callers SHOULD override for cost/latency tuning
   * — Charter §25 forbids treating any single model literal as the
   * only option, so the default is just a default, never a hard-code.
   */
  model?: string;
  /** Optional override of the Cohere endpoint (e.g. for staging). */
  endpoint?: string;
  /** Per-request timeout in ms. Default 4000 — reranking is hot-path. */
  timeoutMs?: number;
  /**
   * Optional error hook. Called with the upstream error if the Cohere
   * request fails. We always fall back to the noop order regardless.
   */
  onError?: (err: unknown) => void;
}

interface CohereRerankResult {
  results: Array<{ index: number; relevance_score: number }>;
}

const COHERE_DEFAULT_ENDPOINT = "https://api.cohere.com/v2/rerank";

/**
 * Build a `RerankFn` that calls Cohere's Rerank API. On any failure
 * path (network, non-2xx, malformed payload, timeout) it falls back to
 * `noopRerank` so the recall pipeline keeps working.
 */
export function makeCohereRerank(apiKey: string, opts: CohereRerankOptions = {}): RerankFn {
  const model = opts.model ?? "rerank-3.5";
  const endpoint = opts.endpoint ?? COHERE_DEFAULT_ENDPOINT;
  const timeoutMs = opts.timeoutMs ?? 4_000;

  return async (input) => {
    if (input.documents.length === 0 || input.topK <= 0) return [];

    // Cohere's `top_n` must be ≤ documents.length; if the caller asks
    // for more we cap silently — the consumer will further trim anyway.
    const topN = Math.min(input.topK, input.documents.length);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          query: input.query,
          documents: input.documents,
          top_n: topN,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`Cohere rerank ${res.status}: ${text.slice(0, 200)}`);
        opts.onError?.(err);
        return noopRerank(input);
      }

      const payload = (await res.json()) as CohereRerankResult;
      if (!payload?.results || !Array.isArray(payload.results)) {
        opts.onError?.(new Error("Cohere rerank: malformed response"));
        return noopRerank(input);
      }

      // Defensive: filter out-of-range indices (shouldn't happen, but
      // we never trust upstream contracts blindly).
      const out: number[] = [];
      for (const r of payload.results) {
        const i = Number(r?.index);
        if (Number.isInteger(i) && i >= 0 && i < input.documents.length) out.push(i);
        if (out.length >= input.topK) break;
      }
      return out.length > 0 ? out : noopRerank(input);
    } catch (err) {
      opts.onError?.(err);
      return noopRerank(input);
    } finally {
      clearTimeout(timer);
    }
  };
}
