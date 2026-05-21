import "server-only";
import { getDb, schema } from "@orchester/db";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq } from "drizzle-orm";

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
      const { executeFlow } = await import("@/lib/flow-engine");
      const result = await executeFlow({
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
