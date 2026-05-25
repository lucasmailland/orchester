// packages/mnemosyne/src/extraction/prefilter.ts
//
// A1 — Heuristic pre-filter. Saves ~80% of extraction LLM calls by
// rejecting turns with no signal worth extracting. Pure code, provider-
// agnostic, zero cost.

export interface PrefilterMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface PrefilterResult {
  yes: boolean;
  reason: string;
}

const POSITIVE_INDICATORS = [
  /\b(prefer|like|love|hate|need|want|always|never|usually)\b/i,
  /\b(decided|will|going to|plan to|chose|adopted)\b/i,
  /\b(at|in|from|works for|lives in|located)\b/i,
  /\b(my (name|email|phone|address|company|team|role))\b/i,
  /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/,
];

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
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
  "by",
  "and",
  "or",
  "but",
  "if",
  "then",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",
  "my",
  "your",
  "our",
  "their",
  "his",
  "her",
  "its",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "can",
  "could",
  "would",
  "should",
  "hi",
  "hello",
  "hey",
  "ok",
  "okay",
  "yes",
  "no",
  "sure",
  "thanks",
  "thank",
  "please",
  "yeah",
  "yep",
  "nope",
]);

function extractContentTokens(messages: PrefilterMessage[]): string[] {
  const tokens: string[] = [];
  for (const m of messages) {
    const words = m.content.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const w of words) {
      if (!STOPWORDS.has(w) && w.length >= 3) tokens.push(w);
    }
  }
  return tokens;
}

export function shouldExtract(messages: PrefilterMessage[]): PrefilterResult {
  const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
  // Floor tuned so a single signal-rich sentence (≈ 50–80 chars) still
  // makes it past this guard into the token + indicator checks. The
  // all_short_messages guard below catches multi-message chitchat.
  if (totalChars < 40) return { yes: false, reason: "too_short" };

  const allShort = messages.every((m) => m.content.length < 30);
  if (allShort) return { yes: false, reason: "all_short_messages" };

  const tokens = extractContentTokens(messages);
  // Threshold tuned so short-but-signal-rich turns (e.g. a single
  // preference / decision sentence) still pass through to the indicator
  // checks. The all_short_messages guard above already rejects pure
  // chitchat, so a low floor here is safe.
  if (tokens.length < 5) return { yes: false, reason: "no_content_tokens" };

  const hasDialogue = messages.some((m) => m.role === "user" || m.role === "assistant");
  if (!hasDialogue) return { yes: false, reason: "no_dialogue" };

  const positive = POSITIVE_INDICATORS.some((re) => messages.some((m) => re.test(m.content)));
  return {
    yes: positive,
    reason: positive ? "indicator_match" : "no_indicator",
  };
}
