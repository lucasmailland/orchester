import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { llmCall, type ChatMessage } from "@/lib/llm-call";
import { getToolDefinitions, executeTool } from "@/lib/tools";
import { executeFlow } from "@/lib/flow-engine";

export interface InboundMessage {
  channelId: string;
  externalId: string; // chat id from telegram, visitor id from widget, etc.
  text: string;
  customerName?: string;
  customerEmail?: string;
  metadata?: Record<string, unknown>;
}

export interface OutboundResponse {
  conversationId: string;
  reply: string;
  tokensUsed: number;
}

/**
 * Routes an inbound message to the right agent and persists the conversation.
 * Handles both conversational (LLM with tools) and flow-driven agents.
 */
export async function handleInbound(
  workspaceId: string,
  msg: InboundMessage
): Promise<OutboundResponse> {
  const db = getDb();

  // 1. Locate channel + agent
  const chRows = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.id, msg.channelId), eq(schema.channels.workspaceId, workspaceId)))
    .limit(1);
  const channel = chRows[0];
  if (!channel) throw new Error("Channel not found");
  if (channel.status !== "active") throw new Error("Channel is inactive");
  if (!channel.agentId) throw new Error("Channel has no agent assigned");

  const agentRows = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, channel.agentId), eq(schema.agents.workspaceId, workspaceId)))
    .limit(1);
  const agent = agentRows[0];
  if (!agent) throw new Error("Agent not found");

  // 2. Find or create conversation by externalId
  let conversation = (
    await db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.workspaceId, workspaceId),
          eq(schema.conversations.channelId, channel.id),
          eq(schema.conversations.externalId, msg.externalId)
        )
      )
      .orderBy(desc(schema.conversations.createdAt))
      .limit(1)
  )[0];

  if (!conversation || conversation.status === "closed") {
    const inserted = await db
      .insert(schema.conversations)
      .values({
        id: createId(),
        workspaceId,
        channelId: channel.id,
        agentId: agent.id,
        status: "open",
        externalId: msg.externalId,
        customerName: msg.customerName ?? null,
        customerEmail: msg.customerEmail ?? null,
      })
      .returning();
    conversation = inserted[0]!;
  }

  // 3. Persist user message
  await db.insert(schema.messages).values({
    id: createId(),
    conversationId: conversation.id,
    role: "user",
    content: msg.text,
    metadata: msg.metadata ?? {},
  });
  await db
    .update(schema.conversations)
    .set({ messageCount: (conversation.messageCount ?? 0) + 1 })
    .where(eq(schema.conversations.id, conversation.id));

  // 3.5 If conversation is taken-over by a human, do NOT auto-reply.
  if (conversation.takenOverAt) {
    return { conversationId: conversation.id, reply: "", tokensUsed: 0 };
  }

  // 4. Branch by agent kind
  if (agent.kind === "flow") {
    if (!agent.flowId) throw new Error("Flow-driven agent has no flowId");
    const result = await executeFlow({
      flowId: agent.flowId,
      workspaceId,
      triggerSource: `channel:${channel.id}`,
      input: {
        message: msg.text,
        customerName: msg.customerName ?? "",
        customerEmail: msg.customerEmail ?? "",
        externalId: msg.externalId,
      },
    });
    const reply = result.status === "succeeded" ? "" : agent.fallback ?? "Lo siento, hubo un error.";
    await db.insert(schema.messages).values({
      id: createId(),
      conversationId: conversation.id,
      role: "assistant",
      content: reply,
      metadata: { flowRunId: result.runId, status: result.status },
    });
    return { conversationId: conversation.id, reply, tokensUsed: 0 };
  }

  // Conversational: build full message history for LLM, then call with tools
  const history = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversation.id))
    .orderBy(schema.messages.createdAt);

  const chatMsgs: ChatMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const tools = getToolDefinitions(agent.tools ?? []);
  let reply = "";
  let tokens = 0;
  let safetyCounter = 0;
  while (safetyCounter < 5) {
    safetyCounter++;
    const r = await llmCall({
      workspaceId,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      messages: chatMsgs,
      temperature: agent.temperature ? Number(agent.temperature) : 0.7,
      ...(agent.maxTokens != null && { maxTokens: agent.maxTokens }),
      ...(tools.length > 0 && { tools }),
    });
    tokens += r.tokensUsed;
    if (r.toolCalls && r.toolCalls.length > 0) {
      // Execute tool calls and feed results back
      chatMsgs.push({
        role: "assistant",
        content: r.content,
        toolCalls: r.toolCalls,
      });
      const toolResults = [];
      for (const tc of r.toolCalls) {
        try {
          const out = await executeTool(tc.name, tc.input as Record<string, unknown>, {
            workspaceId,
            variables: (agent.variables as Record<string, string>) ?? {},
          });
          toolResults.push({ id: tc.id, name: tc.name, input: tc.input, output: out });
        } catch (e) {
          toolResults.push({
            id: tc.id,
            name: tc.name,
            input: tc.input,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      chatMsgs.push({ role: "tool", content: "", toolResults });
      continue;
    }
    reply = r.content;
    break;
  }

  if (!reply && agent.fallback) reply = agent.fallback;

  // 5. Persist assistant message
  await db.insert(schema.messages).values({
    id: createId(),
    conversationId: conversation.id,
    role: "assistant",
    content: reply,
    tokensUsed: tokens,
  });
  await db
    .update(schema.conversations)
    .set({ messageCount: (conversation.messageCount ?? 0) + 2 })
    .where(eq(schema.conversations.id, conversation.id));

  // 6. Usage event (Phase 7 metering)
  await db.insert(schema.usageEvents).values({
    id: createId(),
    workspaceId,
    kind: "agent_message",
    amount: 1,
    agentId: agent.id,
    metadata: { tokens },
  });

  return { conversationId: conversation.id, reply, tokensUsed: tokens };
}
