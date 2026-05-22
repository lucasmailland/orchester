import "server-only";
import { assertPublicUrl } from "./net-guard";
import { fetchWithTimeout } from "./http-util";

const HTTP_REQUEST_TIMEOUT_MS = 30_000;

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
}

export interface ToolContext {
  workspaceId: string;
  variables: Record<string, string>;
  /** Required for memory_* tools. Identifies the agent calling the tool. */
  agentId?: string;
  /** Optional context: lets memory tools scope to conversation. */
  conversationId?: string;
  /** Optional context: lets memory tools scope to employee/customer. */
  employeeId?: string;
}

const BUILTINS: Record<string, ToolDefinition> = {
  run_integration: {
    name: "run_integration",
    description:
      "Ejecuta una acción de una integración conectada del workspace (Stripe, Notion, Postgres, Resend, Slack, HTTP, etc.). Pasá el integrationId (de la lista de integraciones), el nombre de la acción y su input. Las credenciales se resuelven server-side.",
    inputSchema: {
      type: "object",
      properties: {
        integrationId: { type: "string", description: "ID de la integración configurada." },
        action: { type: "string", description: "Acción a ejecutar (ej. list_customers, query, send_email)." },
        input: { type: "object", description: "Parámetros de la acción." },
      },
      required: ["integrationId", "action"],
    },
  },
  current_time: {
    name: "current_time",
    description:
      "Returns the current date and time in ISO 8601 format. Optional `timezone` (IANA, e.g. 'America/Argentina/Buenos_Aires').",
    inputSchema: {
      type: "object",
      properties: {
        timezone: { type: "string" },
      },
    },
  },
  calculator: {
    name: "calculator",
    description:
      "Evaluates a basic math expression. Supports +, -, *, /, %, parentheses, integers, decimals.",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "e.g. '(15 + 3) * 2'" },
      },
      required: ["expression"],
    },
  },
  http_request: {
    name: "http_request",
    description:
      "Makes an HTTP request to a public URL. Use ONLY for safe public APIs; private IPs are blocked.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string" },
      },
      required: ["url"],
    },
  },
  flow_call: {
    name: "flow_call",
    description: "Triggers another flow in this workspace and returns its output.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string" },
        input: { type: "object" },
      },
      required: ["flowId"],
    },
  },
  agent_handoff: {
    name: "agent_handoff",
    description:
      "Hand off the current conversation to another agent. Use this when the user's request is OUTSIDE your specialty and a teammate is better suited. The other agent receives the conversation history + your handoff note and continues the dialog. From the next turn forward, the other agent is the one responding.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description:
            "ID of the teammate that should take over. Use `agent_team_list` first to see who's available.",
        },
        note: {
          type: "string",
          description:
            "Short note for the receiving agent explaining the case (e.g. 'User asks about leave > 5 days, beyond my approval limit'). Becomes part of the next agent's system context.",
        },
      },
      required: ["agentId", "note"],
    },
  },
  agent_team_list: {
    name: "agent_team_list",
    description:
      "Lists the teammates available in your workspace that you can hand off to (via `agent_handoff`). Returns id + name + role + short description for each.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  knowledge_search: {
    name: "knowledge_search",
    description:
      "Searches a knowledge base for relevant chunks of text using semantic search. Returns the top matches with their source document title and a relevance score (0-1).",
    inputSchema: {
      type: "object",
      properties: {
        kbId: {
          type: "string",
          description: "ID of the knowledge base to search.",
        },
        query: {
          type: "string",
          description: "Natural language query to search for.",
        },
        topK: {
          type: "number",
          description: "Number of results to return (default 5, max 20).",
        },
      },
      required: ["kbId", "query"],
    },
  },
  memory_set: {
    name: "memory_set",
    description:
      "Save a fact you want to remember. Choose scope: 'global' (always known), 'employee' (about the current user), or 'conversation' (only this thread). Use this whenever the user shares a preference, a name, or a stable fact.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "employee", "conversation", "team"] },
        key: { type: "string", description: "Short snake_case identifier, e.g. 'preferred_language'" },
        value: { description: "Any JSON-serializable value." },
      },
      required: ["scope", "key", "value"],
    },
  },
  memory_get: {
    name: "memory_get",
    description:
      "Retrieve previously saved facts. Returns the data bag for a given scope. Use to recall what you know before answering.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "employee", "conversation", "team"] },
      },
      required: ["scope"],
    },
  },
  memory_remove: {
    name: "memory_remove",
    description:
      "Forget a previously saved fact. Pass `key` to remove a single key, or omit `key` to clear the entire scope's bag.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "employee", "conversation", "team"] },
        key: { type: "string" },
      },
      required: ["scope"],
    },
  },
};

export function getToolDefinitions(enabledIds: string[]): ToolDefinition[] {
  return enabledIds.map((id) => BUILTINS[id]).filter(Boolean) as ToolDefinition[];
}

export function listAllTools(): ToolDefinition[] {
  return Object.values(BUILTINS);
}

/** Safe shunting-yard arithmetic evaluator (no JS eval). Supports + - * / % ( ). */
function safeEvalArithmetic(expr: string): number {
  // Tokenize
  const tokens: Array<string | number> = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j]!)) j++;
      tokens.push(Number(expr.slice(i, j)));
      i = j;
      continue;
    }
    if ("+-*/%()".includes(c)) {
      tokens.push(c);
      i++;
      continue;
    }
    throw new Error(`Invalid character: ${c}`);
  }
  // Shunting-yard
  const out: Array<string | number> = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };
  for (const t of tokens) {
    if (typeof t === "number") {
      out.push(t);
    } else if (t === "(") {
      ops.push(t);
    } else if (t === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()!);
      if (!ops.length) throw new Error("Mismatched parentheses");
      ops.pop();
    } else {
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        (prec[ops[ops.length - 1]!] ?? 0) >= (prec[t] ?? 0)
      ) {
        out.push(ops.pop()!);
      }
      ops.push(t);
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") throw new Error("Mismatched parentheses");
    out.push(op);
  }
  // Evaluate RPN
  const stack: number[] = [];
  for (const t of out) {
    if (typeof t === "number") {
      stack.push(t);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid expression");
      let r: number;
      if (t === "+") r = a + b;
      else if (t === "-") r = a - b;
      else if (t === "*") r = a * b;
      else if (t === "/") {
        if (b === 0) throw new Error("Division by zero");
        r = a / b;
      } else if (t === "%") r = a % b;
      else throw new Error(`Unknown op: ${t}`);
      stack.push(r);
    }
  }
  if (stack.length !== 1) throw new Error("Invalid expression");
  const result = stack[0]!;
  if (!isFinite(result)) throw new Error("Result is not finite");
  return result;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  if (name === "current_time") {
    const tz = (input.timezone as string) ?? "UTC";
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      return { iso: now.toISOString(), formatted: formatter.format(now), timezone: tz };
    } catch {
      return { iso: new Date().toISOString(), timezone: "UTC" };
    }
  }

  if (name === "calculator") {
    const expr = String(input.expression ?? "");
    if (!expr) throw new Error("expression required");
    const result = safeEvalArithmetic(expr);
    return { expression: expr, result };
  }

  if (name === "http_request") {
    const url = String(input.url ?? "");
    // Hardened SSRF guard: bloquea loopback, RFC1918, link-local (incl. cloud
    // metadata 169.254.169.254), IPv6 ULA/link-local, *.local/*.internal y
    // esquemas no http(s). Lanza si la URL no es pública.
    assertPublicUrl(url);
    const method = (input.method as string) ?? "GET";
    const init: RequestInit = {
      method,
      headers: (input.headers as Record<string, string>) ?? { Accept: "application/json" },
    };
    if (method !== "GET" && input.body !== undefined) init.body = String(input.body);
    const r = await fetchWithTimeout(url, init, HTTP_REQUEST_TIMEOUT_MS);
    const text = await r.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: r.status, body };
  }

  if (name === "flow_call") {
    const flowId = String(input.flowId ?? "");
    if (!flowId) throw new Error("flowId required");
    const { executeFlow } = await import("./flow-engine");
    const result = await executeFlow({
      flowId,
      workspaceId: ctx.workspaceId,
      triggerSource: `tool_call`,
      input: (input.input as Record<string, unknown>) ?? {},
    });
    return result;
  }

  if (name === "agent_team_list") {
    const { getDb, schema } = await import("@orchester/db");
    const { eq, and, ne } = await import("drizzle-orm");
    const db = getDb();
    const conds = [eq(schema.agents.workspaceId, ctx.workspaceId), eq(schema.agents.status, "active")];
    if (ctx.agentId) conds.push(ne(schema.agents.id, ctx.agentId));
    const teammates = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        role: schema.agents.role,
        teamId: schema.agents.teamId,
      })
      .from(schema.agents)
      .where(and(...conds));
    return { teammates };
  }

  if (name === "agent_handoff") {
    if (!ctx.agentId) throw new Error("agent_handoff requires the calling agent context");
    if (!ctx.conversationId) {
      throw new Error("agent_handoff requires conversationId — only available in conversational runs");
    }
    const targetAgentId = String(input.agentId ?? "");
    const note = String(input.note ?? "").slice(0, 1000);
    if (!targetAgentId) throw new Error("agentId required");
    if (targetAgentId === ctx.agentId) throw new Error("cannot hand off to yourself");

    const { getDb, schema } = await import("@orchester/db");
    const { eq, and } = await import("drizzle-orm");
    const { createId } = await import("@paralleldrive/cuid2");
    const { logAudit } = await import("./audit");
    const db = getDb();

    // Validate target agent exists in same workspace and is active
    const targetRows = await db
      .select()
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.id, targetAgentId),
          eq(schema.agents.workspaceId, ctx.workspaceId)
        )
      )
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new Error(`target agent ${targetAgentId} not found in workspace`);
    if (target.status !== "active") {
      throw new Error(`target agent ${target.name} is not active (status=${target.status})`);
    }

    // Pivot the conversation to the new agent
    await db
      .update(schema.conversations)
      .set({ agentId: targetAgentId })
      .where(eq(schema.conversations.id, ctx.conversationId));

    // Persist a system message with the handoff note for auditability and so
    // the next agent's history-compaction sees it as context.
    await db.insert(schema.messages).values({
      id: createId(),
      conversationId: ctx.conversationId,
      role: "system",
      content: `[handoff] from agentId=${ctx.agentId} to agentId=${targetAgentId} — ${note}`,
      metadata: {
        kind: "agent_handoff",
        fromAgentId: ctx.agentId,
        toAgentId: targetAgentId,
        note,
      },
    });

    await logAudit({
      workspaceId: ctx.workspaceId,
      action: "agent.handoff",
      resource: "conversation",
      resourceId: ctx.conversationId,
      after: { fromAgentId: ctx.agentId, toAgentId: targetAgentId, note },
    });

    return {
      ok: true,
      handedOffTo: { id: target.id, name: target.name, role: target.role },
      note,
    };
  }

  if (name === "memory_set" || name === "memory_get" || name === "memory_remove") {
    if (!ctx.agentId) throw new Error("memory_* tools require ctx.agentId");
    const { setMemory, getRelevantMemories, removeMemory } = await import("./memory");
    const scope = String(input.scope ?? "global") as "global" | "conversation" | "employee" | "team";
    const baseQ = {
      agentId: ctx.agentId,
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      employeeId: ctx.employeeId,
    };
    if (name === "memory_set") {
      const key = String(input.key ?? "");
      if (!key) throw new Error("key required");
      const value = input.value;
      const out = await setMemory({ ...baseQ, scope, key, value });
      return { ok: true, scope, data: out.data };
    }
    if (name === "memory_get") {
      const matches = await getRelevantMemories(baseQ);
      const filtered = matches.filter((m) => m.scope === scope);
      return {
        scope,
        data: filtered[0]?.data ?? {},
      };
    }
    if (name === "memory_remove") {
      const key = input.key != null ? String(input.key) : null;
      await removeMemory({ ...baseQ, scope, key });
      return { ok: true, scope, removed: key ?? "all" };
    }
  }

  if (name === "knowledge_search") {
    const kbId = String(input.kbId ?? "");
    const query = String(input.query ?? "");
    if (!kbId || !query) throw new Error("kbId and query required");
    const { searchKnowledgeBase } = await import("./knowledge-search");
    const results = await searchKnowledgeBase(ctx.workspaceId, kbId, query, Number(input.topK ?? 5));
    return { results };
  }

  if (name === "run_integration") {
    const integrationId = String(input.integrationId ?? "");
    const action = String(input.action ?? "");
    if (!integrationId || !action) throw new Error("integrationId y action son requeridos");
    const { runIntegrationAction } = await import("@/lib/integrations/store");
    return runIntegrationAction(
      ctx.workspaceId,
      integrationId,
      action,
      (input.input as Record<string, unknown>) ?? {}
    );
  }

  throw new Error(`Unknown tool: ${name}`);
}
