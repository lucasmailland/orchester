import "server-only";
import { getDb, schema } from "@orchester/db";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, sql } from "drizzle-orm";
import { withMnemoTx, searchMnemo, saveFactWithCandidates } from "@mnemosyne/core";

/**
 * Orchester MCP server core.
 *
 * Expone las capacidades del workspace como tools MCP (Model Context Protocol)
 * para que cualquier cliente — Claude Desktop, Gemini, Cursor, etc. — se
 * conecte vía HTTP (Streamable HTTP transport) o stdio (bridge) usando una API
 * key del workspace.
 *
 * Este módulo es transport-agnóstico: define el catálogo de tools y un
 * ejecutor. El route handler (/api/mcp) y el bridge stdio sólo manejan el
 * framing JSON-RPC.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = { name: "orchester", version: "1.0.0" };

export interface McpAuth {
  workspaceId: string;
  keyId: string;
  scopes: string[];
}

interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

interface McpToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** "read" siempre permitido; "write" requiere que la key NO sea readonly. */
  access: "read" | "write";
  handler: (input: Record<string, unknown>, auth: McpAuth) => Promise<unknown>;
}

/**
 * Allowlist para escritura: una key puede escribir sólo si NO es readonly Y
 * (no tiene scopes — caso legacy/full — O tiene algún scope de escritura).
 * Evita el bug de blocklist donde `["agents:read"]` pasaba por no contener
 * literalmente "readonly".
 */
function canWrite(auth: McpAuth): boolean {
  if (auth.scopes.includes("readonly")) return false;
  if (auth.scopes.length === 0) return true; // sin scopes = full (compat)
  return auth.scopes.some((s) => s === "write" || s.endsWith(":write"));
}

// ─────────────────────────────────────────────────────────────────────────
// Tool catalog
// ─────────────────────────────────────────────────────────────────────────

const TOOLS: McpToolDef[] = [
  {
    name: "list_agents",
    title: "List agents",
    description:
      "Lista los agentes de IA del workspace con su rol, modelo y estado. Usá esto primero para descubrir con qué agentes podés chatear.",
    access: "read",
    inputSchema: { type: "object", properties: {} },
    async handler(_input, auth) {
      const db = getDb();
      const rows = await db
        .select({
          id: schema.agents.id,
          name: schema.agents.name,
          role: schema.agents.role,
          kind: schema.agents.kind,
          model: schema.agents.model,
          status: schema.agents.status,
        })
        .from(schema.agents)
        .where(eq(schema.agents.workspaceId, auth.workspaceId));
      return { agents: rows };
    },
  },
  {
    name: "chat_with_agent",
    title: "Chat with an agent",
    description:
      "Envía un mensaje a un agente de Orchester y devuelve su respuesta. El agente usa su system prompt, modelo, tools y knowledge configurados. Consume tokens del proveedor del workspace.",
    access: "write",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "ID del agente (de list_agents)." },
        message: { type: "string", description: "Mensaje del usuario para el agente." },
        history: {
          type: "array",
          description: "Historial opcional [{role:'user'|'assistant', content}].",
          items: { type: "object" },
        },
      },
      required: ["agentId", "message"],
    },
    async handler(input, auth) {
      const agentId = String(input.agentId ?? "");
      const message = String(input.message ?? "");
      if (!agentId || !message) throw new Error("agentId y message son requeridos");
      const { loadAgent, runAgent } = await import("@/lib/agent-runtime");
      const agent = await loadAgent(auth.workspaceId, agentId);
      if (!agent) throw new Error("Agente no encontrado");
      const history = Array.isArray(input.history)
        ? (input.history as Array<{ role: "user" | "assistant"; content: string }>)
        : [];
      const result = await runAgent({
        workspaceId: auth.workspaceId,
        agent,
        messages: [...history, { role: "user", content: message }],
      });
      return {
        reply: result.content,
        tokensUsed: result.tokensUsed,
        model: result.model,
        ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
      };
    },
  },
  {
    name: "list_conversations",
    title: "List conversations",
    description:
      "Lista conversaciones recientes del workspace (cliente, agente, canal, estado, conteo de mensajes).",
    access: "read",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Máximo a devolver (default 20, máx 100)." },
        status: { type: "string", description: "Filtrar: open | closed | escalated." },
      },
    },
    async handler(input, auth) {
      const db = getDb();
      const limit = Math.min(100, Math.max(1, Number(input.limit ?? 20)));
      const conds = [eq(schema.conversations.workspaceId, auth.workspaceId)];
      if (input.status)
        conds.push(
          eq(schema.conversations.status, String(input.status) as "open" | "closed" | "escalated")
        );
      const rows = await db
        .select({
          id: schema.conversations.id,
          status: schema.conversations.status,
          customerName: schema.conversations.customerName,
          agentId: schema.conversations.agentId,
          messageCount: schema.conversations.messageCount,
          totalCostUsd: schema.conversations.totalCostUsd,
          startedAt: schema.conversations.startedAt,
        })
        .from(schema.conversations)
        .where(and(...conds))
        .orderBy(desc(schema.conversations.startedAt))
        .limit(limit);
      return { conversations: rows };
    },
  },
  {
    name: "get_conversation",
    title: "Get a conversation transcript",
    description: "Devuelve el transcript completo (todos los mensajes) de una conversación.",
    access: "read",
    inputSchema: {
      type: "object",
      properties: { conversationId: { type: "string", description: "ID de la conversación." } },
      required: ["conversationId"],
    },
    async handler(input, auth) {
      const db = getDb();
      const id = String(input.conversationId ?? "");
      const conv = (
        await db
          .select()
          .from(schema.conversations)
          .where(
            and(
              eq(schema.conversations.id, id),
              eq(schema.conversations.workspaceId, auth.workspaceId)
            )
          )
          .limit(1)
      )[0];
      if (!conv) throw new Error("Conversación no encontrada");
      const messages = await db
        .select({
          role: schema.messages.role,
          content: schema.messages.content,
          tokensUsed: schema.messages.tokensUsed,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, id))
        .orderBy(schema.messages.createdAt);
      return { conversation: conv, messages };
    },
  },
  {
    name: "search_knowledge",
    title: "Search a knowledge base",
    description:
      "Búsqueda semántica (RAG) sobre una knowledge base del workspace. Devuelve los chunks más relevantes con su score.",
    access: "read",
    inputSchema: {
      type: "object",
      properties: {
        kbId: { type: "string", description: "ID de la knowledge base." },
        query: { type: "string", description: "Consulta en lenguaje natural." },
        topK: { type: "number", description: "Cantidad de resultados (default 5, máx 20)." },
      },
      required: ["kbId", "query"],
    },
    async handler(input, auth) {
      const { executeTool } = await import("@/lib/tools");
      return executeTool("knowledge_search", input, {
        workspaceId: auth.workspaceId,
        variables: {},
        agentId: "mcp",
      });
    },
  },
  {
    name: "list_knowledge_bases",
    title: "List knowledge bases",
    description: "Lista las knowledge bases del workspace (id, nombre, conteo de documentos).",
    access: "read",
    inputSchema: { type: "object", properties: {} },
    async handler(_input, auth) {
      const db = getDb();
      const rows = await db
        .select({
          id: schema.knowledgeBases.id,
          name: schema.knowledgeBases.name,
          description: schema.knowledgeBases.description,
        })
        .from(schema.knowledgeBases)
        .where(eq(schema.knowledgeBases.workspaceId, auth.workspaceId));
      return { knowledgeBases: rows };
    },
  },
  {
    name: "list_flows",
    title: "List flows",
    description: "Lista los flujos (workflows) del workspace que se pueden ejecutar.",
    access: "read",
    inputSchema: { type: "object", properties: {} },
    async handler(_input, auth) {
      const db = getDb();
      const rows = await db
        .select({
          id: schema.flows.id,
          name: schema.flows.name,
          status: schema.flows.status,
        })
        .from(schema.flows)
        .where(eq(schema.flows.workspaceId, auth.workspaceId));
      return { flows: rows };
    },
  },
  {
    name: "run_flow",
    title: "Run a flow",
    description:
      "Ejecuta un flujo del workspace con un input opcional y devuelve el resultado de la corrida.",
    access: "write",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string", description: "ID del flujo (de list_flows)." },
        input: { type: "object", description: "Input arbitrario para el flujo." },
      },
      required: ["flowId"],
    },
    async handler(input, auth) {
      // F-B1: async — encolamos y devolvemos runId. El caller MCP hace polling
      // de /api/flow-runs/:runId. Antes bloqueaba el request por minutos en
      // flows largos (polling de video/avatar) y moría por serverless timeout.
      const { enqueueFlowRun } = await import("@/lib/flow-engine");
      const result = await enqueueFlowRun({
        flowId: String(input.flowId ?? ""),
        workspaceId: auth.workspaceId,
        triggerSource: "mcp",
        input: (input.input as Record<string, unknown>) ?? {},
      });
      return result;
    },
  },
  {
    name: "list_employees",
    title: "List employees",
    description: "Lista los empleados del workspace (nombre, email, área, budget mensual).",
    access: "read",
    inputSchema: { type: "object", properties: {} },
    async handler(_input, auth) {
      const db = getDb();
      const rows = await db
        .select({
          id: schema.employees.id,
          name: schema.employees.name,
          email: schema.employees.email,
          area: schema.employees.area,
          monthlyBudgetUsd: schema.employees.monthlyBudgetUsd,
        })
        .from(schema.employees)
        .where(eq(schema.employees.workspaceId, auth.workspaceId));
      return { employees: rows };
    },
  },
  {
    name: "create_agent",
    title: "Create an agent",
    description:
      "Crea un nuevo agente conversacional en el workspace con nombre, rol, system prompt y modelo.",
    access: "write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del agente." },
        role: { type: "string", description: "Rol/cargo del agente." },
        systemPrompt: { type: "string", description: "System prompt." },
        model: { type: "string", description: "Modelo (default claude-sonnet-4-6)." },
      },
      required: ["name", "role", "systemPrompt"],
    },
    async handler(input, auth) {
      const db = getDb();
      const id = createId();
      await db.insert(schema.agents).values({
        id,
        workspaceId: auth.workspaceId,
        name: String(input.name),
        role: String(input.role),
        systemPrompt: String(input.systemPrompt),
        model: input.model ? String(input.model) : "claude-sonnet-4-6",
        status: "draft",
        kind: "conversational",
      });
      return { id, status: "draft", message: "Agente creado en estado draft." };
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // Mnemosyne — memory tools
  //
  // Exposes the Mnemosyne memory layer over MCP so any client (Claude
  // Desktop, Cursor, Gemini, custom agents, third-party products) can:
  //   - recall durable facts about a workspace's users, projects,
  //     decisions
  //   - explicitly remember a new fact (e.g. agent learns something
  //     mid-conversation that didn't come from a chat turn)
  //   - audit / curate the memory: pin important ones, forget the rest
  //
  // Every tool runs through `withMnemoTx` so the workspace_id GUC is
  // set and RLS+FORCE Pattern A enforces tenant isolation — a client
  // with an API key for workspace A can NEVER read or mutate memory
  // in workspace B even if they craft a request that names a fact id
  // belonging to the other tenant.
  //
  // Tool naming follows the MCP convention `<domain>_<verb>` and the
  // Mnemosyne protocol's verbs (recall / remember / pin / forget) so
  // existing client tooling that knows the protocol "just works."
  // ─────────────────────────────────────────────────────────────────
  {
    name: "memory_recall",
    title: "Recall memory",
    description:
      "Trae los hechos más relevantes que la memoria del workspace tiene sobre la query. Usá esto para recordar preferencias del usuario, decisiones pasadas, contexto histórico o cualquier conocimiento durable extraído de conversaciones anteriores. Devuelve top-K facts con score, subject, kind y statement.",
    access: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Texto libre — qué querés recordar (ej. 'preferencias de email del cliente')",
        },
        limit: {
          type: "number",
          description: "Cantidad máxima de hits a devolver. Default 5, max 25.",
        },
        agentId: {
          type: "string",
          description:
            "Opcional. Limita el recall al pool del agente — útil cuando un agente tiene memory policy custom.",
        },
      },
      required: ["query"],
    },
    async handler(input, auth) {
      const query = String(input.query ?? "").trim();
      if (query.length === 0) {
        throw new Error("query no puede estar vacío");
      }
      const limit = Math.min(25, Math.max(1, Number(input.limit ?? 5) || 5));
      const agentId = input.agentId ? String(input.agentId) : undefined;

      return withMnemoTx(auth.workspaceId, async (tx) => {
        // searchMnemo returns `RecallHit[]` where each hit wraps the
        // underlying `MnemoFact` row + score + provenance reasons. We
        // flatten to a client-friendly shape and drop internal columns
        // (embedding bytes, tsvector, …) the MCP caller doesn't need.
        const hits = await searchMnemo({
          workspaceId: auth.workspaceId,
          query,
          ...(agentId !== undefined ? { agentId } : {}),
          topK: limit,
          tx,
        });
        return {
          query,
          hits: hits.map((h) => ({
            id: h.fact.id,
            score: Number(h.score.toFixed(4)),
            kind: h.fact.kind,
            subject: h.fact.subject,
            statement: h.fact.statement,
            confidence: h.fact.confidence,
            pinned: h.fact.pinned,
            createdAt:
              h.fact.createdAt instanceof Date
                ? h.fact.createdAt.toISOString()
                : String(h.fact.createdAt),
            reasons: h.reasons,
          })),
          count: hits.length,
        };
      });
    },
  },
  {
    name: "memory_remember",
    title: "Remember a fact",
    description:
      "Persiste un hecho durable nuevo en la memoria del workspace. Usalo cuando descubras información que valga la pena recordar a futuro (preferencias, decisiones, configuraciones aprendidas en la conversación). El fact entra al review queue con confidence='llm' y se vuelve buscable inmediatamente. Idempotente vía content-hash: re-enviar el mismo statement no duplica.",
    access: "write",
    inputSchema: {
      type: "object",
      properties: {
        statement: {
          type: "string",
          description:
            "El hecho en una oración corta y precisa. Ej. 'El cliente Acme prefiere comunicación en español.'",
        },
        subject: {
          type: "string",
          description:
            "Sobre quién / qué es el hecho. Ej. 'acme', 'user:lucas@example.com', 'org:billing'. Default 'workspace'.",
        },
        kind: {
          type: "string",
          description:
            "Categoría: 'preference' | 'decision' | 'fact' | 'config' | 'process'. Default 'fact'.",
        },
        confidence: {
          type: "number",
          description: "[0, 1]. Default 0.7. Usá <0.5 para hechos derivados/inferidos.",
        },
        agentId: {
          type: "string",
          description: "Opcional. Quién originó el hecho — agente o conversación.",
        },
        conversationId: {
          type: "string",
          description: "Opcional. Pegá la conversación para trazabilidad (cite-back).",
        },
      },
      required: ["statement"],
    },
    async handler(input, auth) {
      const statement = String(input.statement ?? "").trim();
      if (statement.length === 0 || statement.length > 1000) {
        throw new Error("statement debe estar entre 1 y 1000 caracteres");
      }
      const subject = String(input.subject ?? "workspace");
      const kind = String(input.kind ?? "fact");
      const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0.7)));

      return withMnemoTx(auth.workspaceId, async (tx) => {
        // saveFactWithCandidates inserts the row then surfaces
        // potential contradictions for human/LLM judgment. For the
        // MCP path we set `enqueueOnNoJudge: true` so any flagged
        // contradiction lands in the workspace review queue instead
        // of being silently saved — the operator sees it in
        // `/brain/review`.
        const result = await saveFactWithCandidates({
          workspaceId: auth.workspaceId,
          statement,
          subject,
          // Cast to the union the type wants. Callers send any string
          // because the kind set is open-ended product-side and we
          // don't want a typed enum to leak into the MCP boundary.
          kind: kind as never,
          scope: "global",
          confidence,
          metadata: { origin: "mcp", scopes: auth.scopes },
          agentId: input.agentId ? String(input.agentId) : null,
          enqueueOnNoJudge: true,
          tx,
        });
        return {
          id: result.newFact.id,
          statement: result.newFact.statement,
          subject: result.newFact.subject,
          kind: result.newFact.kind,
          confidence: result.newFact.confidence,
          /** True when the writer saw potential contradictions with
           *  existing facts — the caller may want to inspect
           *  `enqueuedReviewId` in `/brain/review`. */
          judgmentRequired: result.judgmentRequired,
          enqueuedReviewId: result.enqueuedReviewId,
        };
      });
    },
  },
  {
    name: "memory_pin",
    title: "Pin a fact",
    description:
      "Marca un hecho como 'pinned' — protege de prune/forget automáticos y le da prioridad en recall. Usalo para conocimiento crítico que NO querés que el sistema olvide jamás.",
    access: "write",
    inputSchema: {
      type: "object",
      properties: {
        factId: { type: "string", description: "ID del fact a pinear." },
      },
      required: ["factId"],
    },
    async handler(input, auth) {
      const factId = String(input.factId ?? "").trim();
      if (factId.length === 0) throw new Error("factId requerido");

      return withMnemoTx(auth.workspaceId, async (tx) => {
        const res = await tx.execute<{ id: string }>(sql`
          UPDATE mnemo_fact
          SET pinned = true, updated_at = now()
          WHERE id = ${factId} AND status = 'active'
          RETURNING id
        `);
        const rows = (res as unknown as { rows?: { id: string }[] }).rows ?? [];
        if (rows.length === 0) {
          throw new Error(`Fact ${factId} no encontrado o ya archivado`);
        }
        return { id: rows[0]!.id, pinned: true };
      });
    },
  },
  {
    name: "memory_forget",
    title: "Forget a fact",
    description:
      "Archiva un hecho — sale del recall pero queda en mnemo_fact_archive para auditoría y eventual restore. Usalo cuando descubras que un hecho aprendido era incorrecto, sensible o ya no aplica. NO destruye datos.",
    access: "write",
    inputSchema: {
      type: "object",
      properties: {
        factId: { type: "string", description: "ID del fact a archivar." },
        reason: { type: "string", description: "Motivo opcional (queda en audit log)." },
      },
      required: ["factId"],
    },
    async handler(input, auth) {
      const factId = String(input.factId ?? "").trim();
      if (factId.length === 0) throw new Error("factId requerido");
      const reason = input.reason ? String(input.reason).slice(0, 200) : "mcp_forget";

      return withMnemoTx(auth.workspaceId, async (tx) => {
        const res = await tx.execute<{ id: string }>(sql`
          UPDATE mnemo_fact
          SET status = 'archived',
              archive_reason = ${reason},
              archived_at = now(),
              updated_at = now()
          WHERE id = ${factId} AND status = 'active'
          RETURNING id
        `);
        const rows = (res as unknown as { rows?: { id: string }[] }).rows ?? [];
        if (rows.length === 0) {
          throw new Error(`Fact ${factId} no encontrado o ya archivado`);
        }
        return { id: rows[0]!.id, status: "archived", reason };
      });
    },
  },
  {
    name: "memory_timeline",
    title: "List recent memory events",
    description:
      "Devuelve los hechos más recientes (created/updated/archived) del workspace. Útil para diff: '¿qué aprendió mi IA esta semana?'. Default 20, max 100.",
    access: "read",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 20, max 100." },
        kind: {
          type: "string",
          description: "Filtrá por categoría (preference / decision / fact / ...).",
        },
        sinceIso: { type: "string", description: "Solo hechos cuyo updated_at >= esta fecha ISO." },
      },
    },
    async handler(input, auth) {
      const limit = Math.min(100, Math.max(1, Number(input.limit ?? 20) || 20));
      const kind = input.kind ? String(input.kind) : null;
      const sinceIso = input.sinceIso ? String(input.sinceIso) : null;

      return withMnemoTx(auth.workspaceId, async (tx) => {
        const rows = await tx.execute<{
          id: string;
          subject: string;
          kind: string;
          statement: string;
          confidence: number;
          pinned: boolean;
          status: string;
          updated_at: Date;
        }>(sql`
          SELECT id, subject, kind, statement, confidence, pinned, status, updated_at
          FROM mnemo_fact
          WHERE workspace_id = ${auth.workspaceId}
            ${kind ? sql`AND kind = ${kind}` : sql``}
            ${sinceIso ? sql`AND updated_at >= ${sinceIso}::timestamptz` : sql``}
          ORDER BY updated_at DESC
          LIMIT ${limit}
        `);
        type EventRow = {
          id: string;
          subject: string;
          kind: string;
          statement: string;
          confidence: number;
          pinned: boolean;
          status: string;
          updated_at: Date;
        };
        const r = (rows as unknown as { rows: EventRow[] }).rows;
        return {
          count: r.length,
          events: r.map((row) => ({
            id: row.id,
            subject: row.subject,
            kind: row.kind,
            statement: row.statement,
            confidence: row.confidence,
            pinned: row.pinned,
            status: row.status,
            updatedAt: row.updated_at.toISOString(),
          })),
        };
      });
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** Tools visibles para `tools/list` (sin handler, formato MCP). */
export function listMcpTools(): Array<{
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  return TOOLS.map(({ name, title, description, inputSchema }) => ({
    name,
    title,
    description,
    inputSchema,
  }));
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

/** Ejecuta una tool MCP. Devuelve el formato `tools/call` del protocolo. */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  auth: McpAuth
): Promise<McpToolResult> {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Tool desconocida: ${name}` }],
      isError: true,
    };
  }
  if (tool.access === "write" && !canWrite(auth)) {
    return {
      content: [
        { type: "text", text: `La tool "${name}" requiere una API key con permiso de escritura.` },
      ],
      isError: true,
    };
  }
  try {
    const out = await tool.handler(args ?? {}, auth);
    return {
      content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      structuredContent: out,
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
      isError: true,
    };
  }
}
