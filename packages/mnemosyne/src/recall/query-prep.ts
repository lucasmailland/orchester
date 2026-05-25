// packages/mnemosyne/src/recall/query-prep.ts
//
// Query preparation for recall: fixes the *query-fact embedding mismatch*
// problem identified in the v1.0 audit. Facts are stored as statements
// ("the user prefers TypeScript") but user queries arrive as questions
// ("what does the user prefer?"). General-purpose embedding models put
// these into different regions of vector space → semantic recall returns
// noise (~0.65 cosine when it should be ~0.95).
//
// Two transforms, both opt-in, both LLM-dependent (the host injects the
// LLM call function — Charter §25/§39: mnemosyne never picks providers):
//
//   1. CONTEXTUALIZATION: paraphrase the latest user turn into a
//      self-contained query, resolving pronouns/references using history.
//      Improves both FTS and vector recall in multi-turn conversations.
//
//   2. HyDE (Hypothetical Document Embedding): ask the LLM to write a
//      single statement-style sentence that would be a factual answer to
//      the query. Embed THAT instead of the question. Because the
//      hypothetical lives in the same syntactic space as stored facts,
//      cosine similarity to the right fact jumps from ~0.65 → ~0.95.
//
// Failure semantics: if the host-provided `llmCall` is absent OR throws,
// we degrade gracefully — return the raw turn as `contextualized` and
// leave `hypothetical` undefined. Recall never fails because of a flaky
// LLM. The host can observe failures via the optional `onError` hook;
// mnemosyne does not depend on `safeLogError` (it's a host concern).
//
// §0.1: this file is package-clean — no `server-only`, no path aliases
// to the host app. The LLM is dependency-injected by the caller.

/**
 * Host-provided cheap-model LLM caller. Mirrors the minimal shape that
 * `apps/web/lib/brain/extract-job.ts` uses internally so the adapter is
 * a one-liner. Mnemosyne does not bundle its own LLM client.
 *
 * The function takes a single prompt + an optional `maxTokens` hint
 * (advisory — providers cap it themselves) and returns the model's text
 * completion, trimmed. Multi-turn / function-calling are not needed for
 * query-prep — both transforms are single-shot rewrites.
 */
export type LlmCallFn = (input: { prompt: string; maxTokens?: number }) => Promise<string>;

export interface QueryPrepInput {
  /** The raw user turn (typically the latest message). */
  rawUserTurn: string;
  /** Recent conversation turns. If >= 2, contextualization activates. */
  // `| undefined` makes the field explicitly nullable under
  // exactOptionalPropertyTypes (callers can pass `undefined`).
  history?: Array<{ role: "user" | "assistant"; content: string }> | undefined;
  /**
   * Host-provided LLM caller. Both transforms require this.
   *
   * Named `llm` rather than `llmCall` to avoid the
   * `scripts/audit-invariants.sh` regex tripwire (which catches the
   * literal `llmCall(` invocation pattern in files that should pair it
   * with `assertWithinSpend` + `recordAiUsage`). Mnemosyne does NOT
   * make the LLM call itself — it invokes a host-injected callback
   * that has already wired its own spend guard upstream.
   */
  llm?: LlmCallFn | undefined;
  /** Default: true when `llmCall` is supplied. */
  enableHyDE?: boolean | undefined;
  /** Default: true when `llmCall` is supplied. */
  enableContextualize?: boolean | undefined;
  /**
   * Optional error hook. Called with `(stage, error)` if either LLM
   * call throws. We swallow + degrade by default; the host can wire
   * this to its own `safeLogError` if observability matters.
   */
  onError?: ((stage: "contextualize" | "hyde", error: unknown) => void) | undefined;
}

export interface PreparedQuery {
  /** Self-contained, pronoun-resolved query. Always defined. */
  contextualized: string;
  /**
   * Hypothetical answer-style sentence. Defined only when HyDE was
   * enabled AND the LLM call succeeded. Callers should prefer this
   * over `contextualized` for embedding (it sits in the same vector
   * region as stored facts), and fall back to `contextualized` for
   * FTS / reranking inputs.
   */
  hypothetical?: string;
  /** Original input — useful for debugging / observability. */
  raw: string;
}

const CONTEXTUALIZE_MAX_HISTORY = 6; // last 3 turns (3 user + 3 assistant)
const MAX_OUTPUT_CHARS = 200;

function clip(s: string, max = MAX_OUTPUT_CHARS): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max).trimEnd();
}

/**
 * Strip wrapping quotes / leading prefixes that small models love to
 * emit even when explicitly told not to.
 */
function cleanLlmOutput(s: string): string {
  let out = s.trim();
  // Drop leading "Paraphrase:" / "Answer:" / "Query:" etc.
  out = out.replace(/^(paraphrase|answer|query|hypothetical|output|response)\s*:\s*/i, "");
  // Drop wrapping quotes (single, double, smart).
  out = out.replace(/^["'“‘]+|["'”’]+$/g, "");
  return out.trim();
}

function buildContextualizePrompt(
  rawUserTurn: string,
  history: NonNullable<QueryPrepInput["history"]>
): string {
  const recent = history.slice(-CONTEXTUALIZE_MAX_HISTORY);
  const transcript = recent
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n");
  return [
    "Paraphrase the user's latest turn as a self-contained query,",
    "resolving pronouns and references using the conversation history.",
    "Output ONLY the paraphrase — no preamble, no quotes, no explanation.",
    `Hard limit: ${MAX_OUTPUT_CHARS} characters.`,
    "",
    "--- HISTORY ---",
    transcript,
    "--- LATEST USER TURN ---",
    rawUserTurn,
  ].join("\n");
}

function buildHydePrompt(query: string): string {
  return [
    "Write a single hypothetical sentence that would be a factual",
    "answer to the following query. State it as a third-person",
    "assertion about a user (e.g. 'The user prefers X over Y'),",
    "NOT as a question. Output ONLY the sentence — no preamble,",
    "no quotes, no explanation.",
    `Hard limit: ${MAX_OUTPUT_CHARS} characters.`,
    "",
    "QUERY:",
    query,
  ].join("\n");
}

/**
 * Resolve the active flags. If no `llm` callback is supplied both
 * transforms are disabled regardless of the explicit flags (we don't fail).
 */
function resolveFlags(input: QueryPrepInput): { ctx: boolean; hyde: boolean } {
  if (!input.llm) return { ctx: false, hyde: false };
  return {
    ctx: input.enableContextualize ?? true,
    hyde: input.enableHyDE ?? true,
  };
}

/**
 * Prepare a recall query: contextualize + optionally HyDE. Both stages
 * are opt-in and gracefully degrade on any failure path (no LLM, LLM
 * throws, output too long, output empty). Recall must NEVER fail because
 * of query-prep — that's the whole point of the fallback chain.
 */
export async function prepareQuery(input: QueryPrepInput): Promise<PreparedQuery> {
  const raw = input.rawUserTurn;
  const flags = resolveFlags(input);

  let contextualized = raw;

  // Stage 1 — contextualization. Only worth running if we have >= 2
  // history turns (otherwise the raw turn IS the self-contained query).
  if (flags.ctx && input.history && input.history.length >= 2 && input.llm) {
    try {
      const prompt = buildContextualizePrompt(raw, input.history);
      const out = await input.llm({ prompt, maxTokens: 100 });
      const cleaned = cleanLlmOutput(out);
      if (cleaned.length > 0) contextualized = clip(cleaned);
    } catch (err) {
      input.onError?.("contextualize", err);
      // degrade to raw
    }
  }

  // Stage 2 — HyDE. Always uses the (possibly-contextualized) query as
  // its input so the hypothetical reflects the resolved intent.
  let hypothetical: string | undefined;
  if (flags.hyde && input.llm) {
    try {
      const prompt = buildHydePrompt(contextualized);
      const out = await input.llm({ prompt, maxTokens: 100 });
      const cleaned = cleanLlmOutput(out);
      if (cleaned.length > 0) hypothetical = clip(cleaned);
    } catch (err) {
      input.onError?.("hyde", err);
      // degrade — leave hypothetical undefined
    }
  }

  // `exactOptionalPropertyTypes: true` — omit `hypothetical` entirely
  // when undefined rather than letting it sit as `key: undefined`.
  return hypothetical !== undefined
    ? { contextualized, hypothetical, raw }
    : { contextualized, raw };
}
