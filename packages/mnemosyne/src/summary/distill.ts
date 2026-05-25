// packages/mnemosyne/src/summary/distill.ts
//
// LLM-driven distillation of a fact bag into a compact UserProfileSummary.
// The prompt is provider-agnostic — the host injects an `LlmCallFn`
// (Charter §25). On any failure (LLM throws, malformed JSON, schema
// mismatch) we fall back to a heuristic derived from the top facts so
// the caller never has to handle "what if distillation failed?".
//
// §0.1: package-clean — no `server-only`, no path aliases to the host.
import { z } from "zod";
import type { LlmCallFn } from "../recall/query-prep";
import type { MnemoFact } from "../primitives/fact";

/**
 * Structured form of the distilled profile. Matches the JSON the LLM is
 * asked to produce. All fields except `identity` are optional — the
 * model is encouraged to omit anything it can't infer rather than
 * inventing details.
 */
export interface UserProfileSummaryStruct {
  identity: string;
  role?: string;
  context?: string;
  techStack?: string;
  communication?: string;
  openDecisions?: string[];
}

/**
 * The schema we validate the LLM's JSON output against. Loose on length
 * caps (we trim downstream) but strict on shape so a malformed payload
 * trips the fallback.
 */
const SummaryStructSchema = z.object({
  identity: z.string().min(1).max(120),
  role: z.string().max(120).optional(),
  context: z.string().max(240).optional(),
  techStack: z.string().max(120).optional(),
  communication: z.string().max(120).optional(),
  openDecisions: z.array(z.string().max(80)).max(8).optional(),
});

export const DISTILL_SYSTEM_PROMPT = `You distill a user's memory into a compact profile.
Output STRICT JSON ONLY (no markdown). Schema:
{
  "identity": "string (name | location, brief)",
  "role": "string optional (role + company)",
  "context": "string optional (1-sentence situation)",
  "techStack": "string optional (comma-separated)",
  "communication": "string optional (style preferences)",
  "openDecisions": ["array of topic_keys with unresolved decisions"]
}
Rules:
- Keep total length under 200 tokens.
- Omit fields you can't infer.
- Don't invent details.`;

const MAX_FACTS_FOR_PROMPT = 30;

export interface DistillInput {
  facts: MnemoFact[];
  llm: LlmCallFn;
  model: string;
  /**
   * Forwarded for trace/log context only — distill doesn't touch
   * Postgres itself, but downstream callers want it threaded for
   * spend-cap attribution.
   */
  workspaceId: string;
}

/**
 * Best-effort heuristic when no LLM is available OR the LLM output is
 * unusable. Picks the strongest signals from the fact bag using kind
 * (trait → identity, preference → techStack) and falls back to a flat
 * concatenation. Never throws.
 */
export function heuristicSummary(facts: MnemoFact[]): UserProfileSummaryStruct {
  if (facts.length === 0) {
    return { identity: "user" };
  }

  // Pick a trait fact as identity hint. If none, fall back to the
  // subject of the first fact (usually "user").
  const traitFacts = facts.filter((f) => f.kind === "trait");
  const traitFact = traitFacts[0];
  const identitySource = traitFact?.statement ?? facts[0]!.subject;
  const identity =
    identitySource.length > 100 ? `${identitySource.slice(0, 97)}...` : identitySource;

  const preferences = facts
    .filter((f) => f.kind === "preference")
    .slice(0, 5)
    .map((f) => f.statement);
  const techStack = preferences.length > 0 ? preferences.join("; ").slice(0, 120) : undefined;

  const skills = facts
    .filter((f) => f.kind === "skill")
    .slice(0, 5)
    .map((f) => f.statement);
  const role = skills.length > 0 ? skills.join("; ").slice(0, 120) : undefined;

  const concerns = facts
    .filter((f) => f.kind === "concern")
    .slice(0, 4)
    .map((f) => f.subject.slice(0, 60));
  const openDecisions = concerns.length > 0 ? concerns : undefined;

  // exactOptionalPropertyTypes: build the object incrementally to avoid
  // emitting keys whose values would be undefined.
  const out: UserProfileSummaryStruct = { identity };
  if (role !== undefined) out.role = role;
  if (techStack !== undefined) out.techStack = techStack;
  if (openDecisions !== undefined) out.openDecisions = openDecisions;
  return out;
}

/**
 * Render the structured profile into a compact text block ready to be
 * injected at the top of the system prompt. Format is line-oriented and
 * lossless w.r.t. the struct — keeps the prompt parseable by the user
 * (or another LLM) if they want to debug what was injected.
 */
export function renderSummaryText(struct: UserProfileSummaryStruct): string {
  const lines: string[] = [`Identity: ${struct.identity}`];
  if (struct.role) lines.push(`Role: ${struct.role}`);
  if (struct.context) lines.push(`Context: ${struct.context}`);
  if (struct.techStack) lines.push(`Tech: ${struct.techStack}`);
  if (struct.communication) lines.push(`Style: ${struct.communication}`);
  if (struct.openDecisions && struct.openDecisions.length > 0) {
    lines.push(`Open decisions: ${struct.openDecisions.join(", ")}`);
  }
  return lines.join("\n");
}

/** Approximate token count from chars (4 chars/token for English). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build the user-side prompt: a compact fact bag with kind/subject/
 * statement and a confidence weight so the model can prefer high-
 * confidence signals.
 */
function buildFactsBlock(facts: MnemoFact[]): string {
  const top = facts.slice(0, MAX_FACTS_FOR_PROMPT);
  return top
    .map((f) => `- [${f.kind}|${f.confidence.toFixed(2)}] ${f.subject}: ${f.statement}`)
    .join("\n");
}

/**
 * Strip wrapping code fences / `Output:` prefixes that small models
 * love to emit even when explicitly told to output JSON only.
 */
function cleanJsonOutput(s: string): string {
  let out = s.trim();
  out = out.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  out = out.replace(/^(output|response|json|profile)\s*:\s*/i, "");
  return out.trim();
}

export interface DistillResult {
  struct: UserProfileSummaryStruct;
  /** True when the result came from the heuristic fallback. */
  usedHeuristic: boolean;
  /** Tokens reported by the LLM, when available (0 for heuristic). */
  llmTokensOut: number;
}

/**
 * Distill a fact bag into a UserProfileSummaryStruct. Always returns a
 * usable result — never throws, never returns null. On any LLM /
 * parsing failure we transparently degrade to the heuristic.
 */
export async function distillFacts(input: DistillInput): Promise<DistillResult> {
  if (input.facts.length === 0) {
    return { struct: { identity: "user" }, usedHeuristic: true, llmTokensOut: 0 };
  }

  const userPrompt = [
    "Distill these facts into the JSON profile described in the system prompt.",
    "",
    "FACTS:",
    buildFactsBlock(input.facts),
    "",
    "Return JSON only.",
  ].join("\n");

  // Concatenate system + user with a clear separator. We don't assume
  // the host's LLM caller supports a system/user split — the
  // `LlmCallFn` is single-prompt by contract (see recall/query-prep.ts).
  const fullPrompt = `${DISTILL_SYSTEM_PROMPT}\n\n${userPrompt}`;

  let raw: string;
  try {
    raw = await input.llm({ prompt: fullPrompt, maxTokens: 400 });
  } catch {
    return {
      struct: heuristicSummary(input.facts),
      usedHeuristic: true,
      llmTokensOut: 0,
    };
  }

  if (!raw || raw.trim().length === 0) {
    return {
      struct: heuristicSummary(input.facts),
      usedHeuristic: true,
      llmTokensOut: 0,
    };
  }

  const cleaned = cleanJsonOutput(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      struct: heuristicSummary(input.facts),
      usedHeuristic: true,
      llmTokensOut: 0,
    };
  }

  const validated = SummaryStructSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      struct: heuristicSummary(input.facts),
      usedHeuristic: true,
      llmTokensOut: 0,
    };
  }

  // zod's parser returns `{ key: undefined }` for optional fields the
  // model omitted. Drop those so `exactOptionalPropertyTypes` callers
  // see clean objects.
  const v = validated.data;
  const struct: UserProfileSummaryStruct = { identity: v.identity };
  if (v.role !== undefined) struct.role = v.role;
  if (v.context !== undefined) struct.context = v.context;
  if (v.techStack !== undefined) struct.techStack = v.techStack;
  if (v.communication !== undefined) struct.communication = v.communication;
  if (v.openDecisions !== undefined) struct.openDecisions = v.openDecisions;

  return {
    struct,
    usedHeuristic: false,
    // We don't have a token report from the LLM contract — caller
    // approximates via estimateTokens(rendered).
    llmTokensOut: estimateTokens(cleaned),
  };
}
