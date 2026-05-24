import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  getDb,
  schema,
  type DbClient,
  type Conversation,
  type Agent,
  type Channel,
} from "@orchester/db";
import { llmCall, llmStream, type ChatMessage } from "@/lib/llm-call";
import { getToolDefinitions, executeTool } from "@/lib/tools";
import { executeFlow } from "@/lib/flow-engine";
import { assertWithinSpend } from "@/lib/cost-alerts";
import { UNTRUSTED_CONTENT_GUARDRAIL, wrapUntrusted } from "@/lib/agent-runtime";

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
 * Transaction handle structurally compatible con `getDb()`. Lo threadea el router
 * desde `handleInbound` para que cada query corra en la conexión que tiene
 * `app.workspace_id` SET LOCAL (post-FORCE RLS). Sin esto, los helpers que
 * llaman a `getDb()` toman conexiones del pool sin el GUC y los writes /
 * reads fallan silenciosamente.
 */
type WsTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * Helper: corre `fn` dentro de una transacción del workspace con el GUC
 * `app.workspace_id` SET LOCAL — todo lo que se escriba/lea adentro pasa
 * por FORCE RLS con el contexto correcto. Mismo patrón que
 * `withTenantContext` y `withCrossTenantAdmin`, pero acá no validamos
 * membership (lo hace el caller — el webhook ya autenticó el canal).
 */
async function withWorkspaceTx<T>(workspaceId: string, fn: (tx: WsTx) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

/**
 * Contexto resuelto para una conversación conversacional lista para invocar LLM.
 *
 * Phase E follow-up #1: NO contiene el `db`/`tx` handle a propósito. El
 * streaming (`handleInboundStream`) abre y cierra transacciones distintas
 * para el resolve y el persist (la txn no puede vivir entre yields del
 * async generator), así que el handle se pasa explícitamente a cada helper.
 */
interface ConvCtx {
  workspaceId: string;
  channel: Channel;
  agent: Agent;
  conversation: Conversation;
  /** messageCount tal como se leyó al ubicar la conversación (pre +1 del user msg). */
  baseMessageCount: number;
}

/**
 * Resultado de `resolveInbound`: o ya terminó (takeover / budget / flow) y
 * tenemos la respuesta final, o es conversacional y hay que correr el LLM.
 */
type Resolution =
  | { kind: "terminal"; conversationId: string; reply: string; tokensUsed: number }
  | { kind: "conversational"; ctx: ConvCtx };

/**
 * Prelude compartido por el path bloqueante y el streaming:
 *   1. Ubica channel + agent
 *   2. Busca o crea la conversation por externalId
 *   3. Persiste el mensaje del usuario
 *   3.5 Take-over humano → terminal con reply=""
 *   3.6 Budget por empleado → terminal con fallback
 *   4. Agente flow → ejecuta el flow → terminal
 *
 * Cualquier otra cosa → `conversational` con el ctx para invocar el LLM.
 * El comportamiento (writes a DB, valores de retorno) es idéntico al que
 * tenía `handleInbound` inline — sólo está extraído para reusarlo.
 */
async function resolveInbound(
  workspaceId: string,
  msg: InboundMessage,
  tx: WsTx
): Promise<Resolution> {
  // El caller (`handleInbound` / `handleInboundStream`) ya abrió la txn con
  // `app.workspace_id` SET LOCAL — usamos ese handle así FORCE RLS reconoce
  // el contexto. NO llamar a `getDb()` acá: tomaría otra conexión sin GUC.
  const db = tx;

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

  const baseMessageCount = conversation.messageCount ?? 0;

  // 2.5 Plan quota check (conversations + tokens monthly limits). Si el
  // workspace ya agotó su cuota mensual del plan, devolvemos un fallback
  // amable sin consumir el LLM. Mismo estilo de short-circuit que el budget.
  const { checkQuota } = await import("@/lib/billing/quotas");
  const convQuota = await checkQuota(workspaceId, "conversations", tx);
  const tokenQuota = convQuota.allowed ? await checkQuota(workspaceId, "tokens", tx) : convQuota;
  if (!convQuota.allowed || !tokenQuota.allowed) {
    const blocked = !convQuota.allowed ? convQuota : tokenQuota;
    const reply =
      agent.fallback ??
      `Lo siento, este espacio de trabajo alcanzó su límite mensual del plan. ${
        blocked.reason ?? ""
      } Contactá a tu admin para ampliarlo.`.trim();
    await db.insert(schema.messages).values({
      id: createId(),
      conversationId: conversation.id,
      role: "assistant",
      content: reply,
      tokensUsed: 0,
      costUsd: "0",
      metadata: {
        reason: "quota_exceeded",
        limit: blocked.limit,
        current: blocked.current,
      },
    });
    return { kind: "terminal", conversationId: conversation.id, reply, tokensUsed: 0 };
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
    .set({ messageCount: baseMessageCount + 1 })
    .where(eq(schema.conversations.id, conversation.id));

  // 3.5 If conversation is taken-over by a human, do NOT auto-reply.
  if (conversation.takenOverAt) {
    return { kind: "terminal", conversationId: conversation.id, reply: "", tokensUsed: 0 };
  }

  // 3.6 Per-employee budget check (cost-control). Si el employee tiene
  // monthlyBudgetUsd seteado y ya lo agotó este mes, devolvemos el fallback
  // del agente sin consumir tokens. Audit log para que el operador sepa.
  const { checkEmployeeBudget } = await import("@/lib/employee-budget");
  const budget = await checkEmployeeBudget(workspaceId, conversation.employeeId ?? undefined, tx);
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
    return { kind: "terminal", conversationId: conversation.id, reply, tokensUsed: 0 };
  }

  // 4. Branch by agent kind
  if (agent.kind === "flow") {
    if (!agent.flowId) throw new Error("Flow-driven agent has no flowId");
    // F-B1/F-1: el canal espera la respuesta del flow para contestar, bounded
    // por timeout (default 60s) para no colgar el inbound webhook por minutos.
    // Si excede, el run queda `cancelled` y respondemos el fallback.
    const FLOW_AGENT_INLINE_TIMEOUT_MS = Number(process.env.FLOW_AGENT_INLINE_TIMEOUT_MS ?? 60_000);
    const abort = new AbortController();
    const t = setTimeout(() => abort.abort(), FLOW_AGENT_INLINE_TIMEOUT_MS);
    let result;
    try {
      result = await executeFlow({
        flowId: agent.flowId,
        workspaceId,
        triggerSource: `channel:${channel.id}`,
        input: {
          message: msg.text,
          customerName: msg.customerName ?? "",
          customerEmail: msg.customerEmail ?? "",
          externalId: msg.externalId,
        },
        signal: abort.signal,
      });
    } finally {
      clearTimeout(t);
    }
    const reply =
      result.status === "succeeded"
        ? ""
        : result.status === "cancelled"
          ? (agent.fallback ?? "Estamos procesando tu mensaje. Te respondemos en un momento.")
          : (agent.fallback ?? "Lo siento, hubo un error.");
    await db.insert(schema.messages).values({
      id: createId(),
      conversationId: conversation.id,
      role: "assistant",
      content: reply,
      metadata: { flowRunId: result.runId, status: result.status },
    });
    return { kind: "terminal", conversationId: conversation.id, reply, tokensUsed: 0 };
  }

  return {
    kind: "conversational",
    ctx: { workspaceId, channel, agent, conversation, baseMessageCount },
  };
}

/**
 * Persiste el mensaje del agente + agregados de cost/tokens + usage event.
 * Compartido por el turno bloqueante y el streaming para no divergir.
 *
 * `activeAgent` puede diferir de `ctx.agent` si hubo handoff (define modelo +
 * costo). El usage event usa el agente ORIGINAL (`ctx.agent.id`) a propósito,
 * igual que el código histórico.
 */
async function persistAssistantTurn(
  ctx: ConvCtx,
  activeAgent: Agent,
  conversation: Conversation,
  reply: string,
  tokens: number,
  /** Tx con `app.workspace_id` SET LOCAL — todos los writes corren acá. */
  tx: WsTx
): Promise<void> {
  const { workspaceId, baseMessageCount } = ctx;
  const db = tx;
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
  await recordMessageCost(
    {
      messageId,
      conversationId: conversation.id,
      model: activeAgent.model,
      tokensUsed: tokens,
      costUsd,
    },
    db
  );
  await db
    .update(schema.conversations)
    .set({ messageCount: baseMessageCount + 2 })
    .where(eq(schema.conversations.id, conversation.id));

  // Usage event (Phase 7 metering) — incluye `costUsd` para que el spend cap
  // (cost-alerts.assertWithinSpend) cuente el chat entrante. Sin este campo el
  // tope mensual lee 0 USD acumulado y nunca dispara (meta-audit finding 4.2).
  await db.insert(schema.usageEvents).values({
    id: createId(),
    workspaceId,
    kind: "agent_message",
    amount: 1,
    costUsd: String(costUsd),
    agentId: ctx.agent.id,
    metadata: { tokens, model: activeAgent.model },
  });
}

/**
 * Construye history compactada + inyecta memoria. Devuelve los mensajes de
 * chat y el system prompt final para el agente activo.
 */
async function buildConversationContext(
  ctx: ConvCtx,
  /** Tx con `app.workspace_id` SET LOCAL — usado para leer la conversación. */
  tx: WsTx
): Promise<{
  chatMsgs: ChatMessage[];
  systemPrompt: string;
}> {
  const { workspaceId, agent, conversation } = ctx;
  const db = tx;
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

  const { getRelevantMemories, formatMemoriesAsPromptBlock } = await import("@/lib/memory");
  const memories = await getRelevantMemories({
    agentId: agent.id,
    workspaceId,
    conversationId: conversation.id,
    employeeId: conversation.employeeId ?? undefined,
  });
  return {
    chatMsgs,
    // L1: la memoria es contenido recuperado no confiable → la delimitamos en un
    // bloque etiquetado y agregamos la línea de guardrail al system prompt.
    systemPrompt:
      agent.systemPrompt +
      wrapMemoryBlock(formatMemoriesAsPromptBlock(memories)) +
      UNTRUSTED_CONTENT_GUARDRAIL,
  };
}

/**
 * Envuelve el bloque de memoria (si lo hay) en un `<untrusted_context>` para
 * que el modelo lo trate como datos (L1). Si no hay memoria, devuelve "".
 */
function wrapMemoryBlock(memoryBlock: string): string {
  if (!memoryBlock.trim()) return "";
  return "\n\n" + wrapUntrusted(memoryBlock.trim(), "memory");
}

/**
 * Turno conversacional bloqueante: loop LLM + tools + handoff, luego persiste.
 * Comportamiento idéntico al `handleInbound` histórico.
 */
async function runConversationalTurn(
  ctx: ConvCtx,
  /** Tx con `app.workspace_id` SET LOCAL — usado por todas las queries del turno. */
  tx: WsTx
): Promise<OutboundResponse> {
  const { workspaceId, agent } = ctx;
  const db = tx;
  let conversation = ctx.conversation;

  const { chatMsgs, systemPrompt } = await buildConversationContext(ctx, tx);
  const { getRelevantMemories, formatMemoriesAsPromptBlock } = await import("@/lib/memory");

  // El agente puede mutar dentro del loop si llama a `agent_handoff`. Esa tool
  // pivotea `conversation.agentId` → en la próxima iteración tenemos que
  // recargar el agente y reconstruir prompt/tools/temperature acordes.
  let activeAgent = agent;
  let activeTools = getToolDefinitions(activeAgent.tools ?? []);
  let activeSystemPrompt = systemPrompt;
  let reply = "";
  let tokens = 0;
  let safetyCounter = 0;
  let handoffCount = 0; // protege contra ping-pong infinito entre agentes
  while (safetyCounter < 5) {
    safetyCounter++;
    // Spend cap / kill-switch (E1-1/E3-1): aplica también al chat entrante.
    // El bypass de este check fue el principal hallazgo de la meta-auditoría.
    await assertWithinSpend(workspaceId, db);
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
          // L1/F2: el output de la tool es contenido no confiable → delimitado
          // (y con PII redactada si el operador hizo opt-in) antes de mandarlo
          // al modelo.
          const wrapped = wrapUntrusted(
            typeof out === "string" ? out : JSON.stringify(out ?? null),
            `tool_${tc.name}`
          );
          toolResults.push({ id: tc.id, name: tc.name, input: tc.input, output: wrapped });
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
              activeAgent.systemPrompt +
              wrapMemoryBlock(formatMemoriesAsPromptBlock(newMems)) +
              UNTRUSTED_CONTENT_GUARDRAIL;
          }
        }
      }

      continue;
    }
    reply = r.content;
    break;
  }

  if (!reply && activeAgent.fallback) reply = activeAgent.fallback;

  await persistAssistantTurn(ctx, activeAgent, conversation, reply, tokens, tx);
  return { conversationId: conversation.id, reply, tokensUsed: tokens };
}

/**
 * Routes an inbound message to the right agent and persists the conversation.
 * Handles both conversational (LLM with tools) and flow-driven agents.
 *
 * Phase E follow-up #1: usa dos transacciones SEPARADAS con
 * `app.workspace_id` SET LOCAL en cada una. Una sola txn alrededor de todo
 * el turno haría rollback en falla del LLM y perderíamos el mensaje del
 * cliente — pre-refactor cada insert era su propio statement autocommit y
 * el mensaje del usuario quedaba guardado aunque el asistente fallara.
 * Replicamos esa semántica:
 *
 *   - Txn 1: `resolveInbound` (channel/agent lookup + user msg insert +
 *            quota/budget/takeover/flow checks). Commit antes del LLM.
 *   - Txn 2: `runConversationalTurn` (LLM loop + persistAssistantTurn).
 *
 * Mismo patrón que `handleInboundStream` (forzado a partir por limitación
 * del async generator). El GUC garantiza que cada txn pase FORCE RLS.
 */
export async function handleInbound(
  workspaceId: string,
  msg: InboundMessage
): Promise<OutboundResponse> {
  const res = await withWorkspaceTx(workspaceId, (tx) => resolveInbound(workspaceId, msg, tx));
  if (res.kind === "terminal") {
    return {
      conversationId: res.conversationId,
      reply: res.reply,
      tokensUsed: res.tokensUsed,
    };
  }
  return withWorkspaceTx(workspaceId, (tx) => runConversationalTurn(res.ctx, tx));
}

/**
 * Chunk emitido por `handleInboundStream`. El cliente concatena los `text`
 * en orden y al recibir `done` ya tiene la respuesta completa persistida.
 */
export type InboundStreamChunk =
  | { type: "text"; delta: string }
  | { type: "done"; conversationId: string; reply: string; tokensUsed: number }
  | { type: "error"; error: string };

/**
 * Variante streaming de `handleInbound` para el widget público.
 *
 * Reusa exactamente el mismo prelude (resolveInbound) y la misma persistencia
 * (persistAssistantTurn) que el path bloqueante, así no hay divergencia de
 * datos. Política de streaming (igual que el test-chat del studio):
 *
 *   - terminal (takeover/budget/flow) → un único `done` con el reply final
 *   - conversacional CON tools → no se puede streamear el loop de tools de
 *     forma segura, así que corremos el turno bloqueante y emitimos el
 *     resultado completo como un solo chunk + `done`
 *   - conversacional SIN tools → streaming real token-por-token vía llmStream,
 *     acumulando para persistir igual que el blocking
 *
 * Phase E follow-up #1: las transacciones NO pueden vivir entre yields del
 * async generator (drizzle/postgres-js no soporta tx que crucen await en un
 * generator), así que partimos en fases:
 *   - Phase 1 (txn 1): `resolveInbound` (channel/agent lookup + user msg insert)
 *   - Phase 2 (sin txn): stream LLM (acumulamos `reply` + `tokens`)
 *   - Phase 3 (txn 2): `persistAssistantTurn` (assistant msg + usage event)
 *
 * Si el agente tiene tools (handoff posible), caemos al path bloqueante que
 * sí mantiene una sola txn (single connection durante el loop completo).
 */
export async function* handleInboundStream(
  workspaceId: string,
  msg: InboundMessage,
  /**
   * Signal de cancelación (L5). Cuando el cliente del endpoint SSE se
   * desconecta, se aborta → se thread hacia `llmStream` para cortar el consumo
   * del upstream LLM y dejar de facturar tokens.
   */
  signal?: AbortSignal
): AsyncGenerator<InboundStreamChunk> {
  // Phase 1 — abrir txn corta para resolveInbound. Devolvemos el resultado y
  // cerramos la txn antes de empezar a yield-ear (los generators no pueden
  // mantener una txn abierta mientras suspenden en yield).
  let res: Resolution;
  try {
    res = await withWorkspaceTx(workspaceId, (tx) => resolveInbound(workspaceId, msg, tx));
  } catch (e) {
    yield { type: "error", error: e instanceof Error ? e.message : String(e) };
    return;
  }

  if (res.kind === "terminal") {
    if (res.reply) yield { type: "text", delta: res.reply };
    yield {
      type: "done",
      conversationId: res.conversationId,
      reply: res.reply,
      tokensUsed: res.tokensUsed,
    };
    return;
  }

  const ctx = res.ctx;
  const { workspaceId: wsId, agent, conversation } = ctx;
  const hasTools = (agent.tools?.length ?? 0) > 0;

  // Con tools: fallback al turno bloqueante (loop de tools + handoff) en su
  // propia txn (single connection durante el loop completo). Emitimos el
  // resultado como un solo bloque. Persistencia idéntica.
  if (hasTools) {
    try {
      const out = await withWorkspaceTx(wsId, (tx) => runConversationalTurn(ctx, tx));
      if (out.reply) yield { type: "text", delta: out.reply };
      yield {
        type: "done",
        conversationId: out.conversationId,
        reply: out.reply,
        tokensUsed: out.tokensUsed,
      };
    } catch (e) {
      yield { type: "error", error: e instanceof Error ? e.message : String(e) };
    }
    return;
  }

  // Sin tools: streaming real. Sin tools no hay handoff → activeAgent = agent
  // y la conversation no se reasigna, así que la persistencia es directa.
  try {
    // Phase 2a — leer historia + memoria en otra txn corta (FORCE RLS necesita
    // GUC). Cerramos la txn antes del stream del LLM.
    const { chatMsgs, systemPrompt } = await withWorkspaceTx(wsId, (tx) =>
      buildConversationContext(ctx, tx)
    );
    let reply = "";
    let tokens = 0;
    // Spend cap también para el path de streaming (sin tools) — gap detectado
    // por la 2ª pasada de meta-auditoría. Sin txn: el spend cap fail-opens en
    // error de lectura, así que no necesita el GUC para el path crítico.
    await assertWithinSpend(wsId);
    for await (const chunk of llmStream({
      workspaceId: wsId,
      model: agent.model,
      systemPrompt,
      messages: chatMsgs,
      temperature: agent.temperature ? Number(agent.temperature) : 0.7,
      ...(agent.maxTokens != null && { maxTokens: agent.maxTokens }),
      ...(signal ? { signal } : {}),
    })) {
      // Si el cliente se desconectó, dejamos de emitir/persistir.
      if (signal?.aborted) return;
      if (chunk.type === "text") {
        reply += chunk.delta;
        yield { type: "text", delta: chunk.delta };
      } else if (chunk.type === "done") {
        tokens += chunk.tokensUsed;
      } else if (chunk.type === "error") {
        yield { type: "error", error: chunk.error };
        return;
      }
    }

    if (!reply && agent.fallback) {
      reply = agent.fallback;
      yield { type: "text", delta: reply };
    }

    // Phase 3 — persist en otra txn corta.
    await withWorkspaceTx(wsId, (tx) =>
      persistAssistantTurn(ctx, agent, conversation, reply, tokens, tx)
    );
    yield { type: "done", conversationId: conversation.id, reply, tokensUsed: tokens };
  } catch (e) {
    yield { type: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
