import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { llmCall, type ChatMessage } from "./llm-call";

/**
 * Rolling-window history compaction.
 *
 * Strategy:
 *   - Keep the last `keepLastN` (user|assistant) messages verbatim.
 *   - Older messages get replaced with a single LLM-generated SUMMARY
 *     prepended as an `assistant` message labeled "[Conversation summary so far]".
 *   - The summary is cached in `conversation.summary` and incrementally
 *     extended (cheap re-runs).
 *
 * Why this matters:
 *   - Transcripts grow unbounded → token explosion.
 *   - Truncating loses context. Summarizing keeps semantics.
 *   - Done lazily inside the inbound router so most turns pay zero cost.
 *
 * Trade-offs:
 *   - Summary quality depends on the cheap model. We use the AGENT's own
 *     provider/model with a low temperature.
 *   - When the summary is regenerated, the previous summary is folded in
 *     (the LLM sees: prev_summary + N old turns → new_summary).
 */

interface MessageRow {
  id: string;
  role: string;
  content: string;
  fromOperator: boolean;
  createdAt: Date;
}

interface ConversationRow {
  id: string;
  summary: string | null;
  messageCount: number;
}

interface CompactArgs {
  workspaceId: string;
  conversation: ConversationRow;
  messages: MessageRow[];
  /** Keep the last N user|assistant turns verbatim. Default 10. */
  keepLastN?: number;
  /** Provider/model used to summarize. Same as the agent. */
  model: string;
}

const SYSTEM_PROMPT_FOR_SUMMARY = `You are a conversation summarizer. Compress the following turns into a concise, factual recap from the assistant's perspective.

Rules:
- Preserve names, dates, numbers, requests, decisions, commitments, and unresolved items VERBATIM.
- Drop chit-chat and pleasantries.
- Output 4-10 bullet points, no preamble. Output ONLY the bullets.`;

/**
 * Returns the chat history to send to the LLM, with old turns replaced by a
 * summary message when there are too many.
 */
export async function compactHistory(args: CompactArgs): Promise<ChatMessage[]> {
  const keep = Math.max(4, args.keepLastN ?? 10);
  const conv = args.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ ...m, role: m.role as "user" | "assistant" }));

  // Below the threshold: replay verbatim + any cached summary.
  if (conv.length <= keep) {
    const out: ChatMessage[] = [];
    if (args.conversation.summary) {
      out.push({
        role: "assistant",
        content: `[Conversation summary so far]\n${args.conversation.summary}`,
      });
    }
    for (const m of conv) out.push({ role: m.role, content: m.content });
    return out;
  }

  // Need to compact. Take everything except the last `keep` turns.
  const toSummarize = conv.slice(0, conv.length - keep);
  const recent = conv.slice(conv.length - keep);

  // Run summarizer (LLM call against the agent's own provider).
  let nextSummary = args.conversation.summary ?? "";
  try {
    const transcript = toSummarize
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");
    const userMsg = nextSummary
      ? `Existing summary:\n${nextSummary}\n\nNew turns to fold in:\n${transcript}`
      : `Turns to summarize:\n${transcript}`;
    const r = await llmCall({
      workspaceId: args.workspaceId,
      model: args.model,
      systemPrompt: SYSTEM_PROMPT_FOR_SUMMARY,
      messages: [{ role: "user", content: userMsg }],
      temperature: 0.2,
      maxTokens: 600,
    });
    nextSummary = r.content.trim();

    // Persist the new summary so we don't pay this cost twice for the same turns.
    const db = getDb();
    await db
      .update(schema.conversations)
      .set({ summary: nextSummary })
      .where(eq(schema.conversations.id, args.conversation.id));
  } catch (e) {
    // Summarization failure is non-fatal — fall back to truncate.
    console.error("[compaction] summarizer failed, falling back to truncation:", e);
  }

  const out: ChatMessage[] = [];
  if (nextSummary) {
    out.push({
      role: "assistant",
      content: `[Conversation summary so far]\n${nextSummary}`,
    });
  }
  for (const m of recent) out.push({ role: m.role, content: m.content });
  return out;
}
