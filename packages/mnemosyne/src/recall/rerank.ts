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

// ── v2 — Local lexical reranker (zero-dep, default rerank) ────────────────────
//
// Pure-TS BM25-ish lexical scorer. Used as the **default** reranker
// in v2 (`searchMnemo` falls back to this when no `rerank` is supplied
// AND no early-exit fires). Migrated from `apps/web/lib/agent-runtime.ts`
// where it was previously gated behind `!process.env.COHERE_API_KEY`.
//
// Properties:
//   - Pure / deterministic — no network, no provider calls, < 1ms for
//     typical fact counts (~15-25 docs over-fetched per pipeline call).
//   - Strictly better than identity for short fact statements — keyword
//     overlap surfaces strong lexical matches above weaker ones.
//   - Strictly worse than Cohere — the local scorer can't capture
//     semantic similarity. Hosts with a Cohere key should still wire
//     `makeCohereRerank` explicitly.
//
// Why default-on:
//   - v1.x had `noopRerank` as the implicit default. Every caller that
//     didn't explicitly wire a reranker (Inspector API, MCP tool,
//     /api/mnemo/facts) got worse ordering than the agent-runtime
//     path. The local lexical scorer eliminates the disparity at
//     zero risk and zero cost.

const LOCAL_LEXICAL_STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "as",
  "by",
  "and",
  "or",
  "but",
  "not",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "they",
  "them",
  "i",
  "you",
  "we",
  "he",
  "she",
  "his",
  "her",
  "their",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "what",
  "when",
  "where",
  "why",
  "how",
]);

function localTokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !LOCAL_LEXICAL_STOPWORDS.has(t));
}

/**
 * Build a zero-dependency lexical reranker. Returns a `RerankFn` that
 * scores documents by stopword-filtered keyword overlap with the query,
 * length-normalized to discourage long-statement bias.
 */
export function makeLocalLexicalRerank(): RerankFn {
  return async ({ query, documents, topK }) => {
    if (documents.length === 0 || topK <= 0) return [];
    const qTokens = localTokenize(query);
    if (qTokens.length === 0) {
      // Degenerate query — return input order capped to topK.
      return Array.from({ length: Math.min(documents.length, topK) }, (_, i) => i);
    }
    const qSet = new Set(qTokens);
    const scored = documents.map((d, i) => {
      const tokens = localTokenize(d);
      if (tokens.length === 0) return { i, s: 0 };
      let hits = 0;
      for (const t of tokens) if (qSet.has(t)) hits++;
      // Normalize by sqrt of length — long facts shouldn't dominate
      // just because they have more words.
      const s = hits / Math.sqrt(tokens.length);
      return { i, s };
    });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, topK).map((x) => x.i);
  };
}
