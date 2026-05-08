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

  // 3.6 Per-employee budget check (cost-control). Si el employee tiene
  // monthlyBudgetUsd seteado y ya lo agotó este mes, devolvemos el fallback
  // del agente sin consumir tokens. Audit log para que el operador sepa.
  const { checkEmployeeBudget } = await import("@/lib/employee-budget");
  const budget = await checkEmployeeBudget(
    workspaceId,
    conversation.employeeId ?? undefined
  );
  if (!budget.allowed) {
    const reply =
      agent.fallback ??
      `Lo siento, alcanzaste tu límite mensual de uso ($${budget.budgetUsd}). Contactá a tu admin para extenderlo.`;
    await db.insert(schema.messages).values({
      id: createId(),
      conversationId: conversation.id,
      role: "assistant",
      content: reply,
      tokensUsed: 0,
      costUsd: "0",
      metadata: { reason: "budget_exceeded", spent: budget.spentUsd, budget: budget.budgetUsd },
    });
    return { conversationId: conversation.id, reply, tokensUsed: 0 };
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

  // Conversational: build (compacted) history + inject memory into the system prompt
  const fullHistory = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversation.id))
    .orderBy(schema.messages.createdAt);

  const { compactHistory } = await import("@/lib/memory-compaction");
  const chatMsgs: ChatMessage[] = await compactHistory({
    workspaceId,
    conversation,
    messages: fullHistory,
    model: agent.model,
    keepLastN: agent.maxTurns ?? 10,
  });

  // Inject relevant memory into the system prompt
  const { getRelevantMemories, formatMemoriesAsPromptBlock } = await import("@/lib/memory");
  const memories = await getRelevantMemories({
    agentId: agent.id,
    workspaceId,
    conversationId: conversation.id,
    employeeId: conversation.employeeId ?? undefined,
  });
  const memoryBlock = formatMemoriesAsPromptBlock(memories);
  const finalSystemPrompt = agent.systemPrompt + memoryBlock;

  // El agente puede mutar dentro del loop si llama a `agent_handoff`. Esa tool
  // pivotea `conversation.agentId` → en la próxima iteración tenemos que
  // recargar el agente y reconstruir prompt/tools/temperature acordes.
  let activeAgent = agent;
  let activeTools = getToolDefinitions(activeAgent.tools ?? []);
  let activeSystemPrompt = finalSystemPrompt;
  let reply = "";
  let tokens = 0;
  let safetyCounter = 0;
  let handoffCount = 0; // protege contra ping-pong infinito entre agentes
  while (safetyCounter < 5) {
    safetyCounter++;
    const r = await llmCall({
      workspaceId,
      model: activeAgent.model,
      systemPrompt: activeSystemPrompt,
      messages: chatMsgs,
      temperature: activeAgent.temperature ? Number(activeAgent.temperature) : 0.7,
      ...(activeAgent.maxTokens != null && { maxTokens: activeAgent.maxTokens }),
      ...(activeTools.length > 0 && { tools: activeTools }),
    });
    tokens += r.tokensUsed;
    if (r.toolCalls && r.toolCalls.length > 0) {
      // Execute tool calls and feed results back
      chatMsgs.push({
        role: "assistant",
        content: r.content,
        toolCalls: r.toolCalls,
      });
      let didHandoff = false;
      const toolResults = [];
      for (const tc of r.toolCalls) {
        try {
          const out = await executeTool(tc.name, tc.input as Record<string, unknown>, {
            workspaceId,
            variables: (activeAgent.variables as Record<string, string>) ?? {},
            agentId: activeAgent.id,
            conversationId: conversation.id,
            ...(conversation.employeeId ? { employeeId: conversation.employeeId } : {}),
          });
          toolResults.push({ id: tc.id, name: tc.name, input: tc.input, output: out });
          if (tc.name === "agent_handoff" && (out as { ok?: boolean })?.ok) {
            didHandoff = true;
          }
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

      if (didHandoff) {
        if (++handoffCount > 2) {
          // Anti ping-pong: 2 handoffs en una misma run del router se cortan.
          break;
        }
        // La tool ya pivotó `conversation.agentId`. Re-leemos para saber a quién.
        const updatedConv = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversation.id))
          .limit(1);
        if (updatedConv[0]) conversation = updatedConv[0];
        const newAgentId = conversation.agentId;
        if (newAgentId) {
          const newAgentRows = await db
            .select()
            .from(schema.agents)
            .where(eq(schema.agents.id, newAgentId))
            .limit(1);
          if (newAgentRows[0]) {
            activeAgent = newAgentRows[0];
            activeTools = getToolDefinitions(activeAgent.tools ?? []);
            // Re-inyectá memorias del nuevo agente (cambia el contexto).
            const newMems = await getRelevantMemories({
              agentId: activeAgent.id,
              workspaceId,
              conversationId: conversation.id,
              employeeId: conversation.employeeId ?? undefined,
            });
            activeSystemPrompt =
              activeAgent.systemPrompt + formatMemoriesAsPromptBlock(newMems);
          }
        }
      }

      continue;
    }
    reply = r.content;
    break;
  }

  if (!reply && activeAgent.fallback) reply = activeAgent.fallback;

  // 5. Persist assistant message + actualizar agregados de cost/tokens.
  const { calculateCostUsd } = await import("@/lib/pricing");
  const { recordMessageCost } = await import("@/lib/employee-budget");
  const messageId = createId();
  const costUsd = calculateCostUsd(activeAgent.model, tokens);
  await db.insert(schema.messages).values({
    id: messageId,
    conversationId: conversation.id,
    role: "assistant",
    content: reply,
    tokensUsed: tokens,
    costUsd: String(costUsd),
    model: activeAgent.model,
  });
  await recordMessageCost({
    messageId,
    conversationId: conversation.id,
    model: activeAgent.model,
    tokensUsed: tokens,
    costUsd,
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
