/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Phase 3: tools' recall path stubbed; rest still active.
import "server-only";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { assertPublicUrl } from "./net-guard";
import { fetchWithTimeout } from "./http-util";
import { logAudit } from "./audit";
import { decrypt } from "./encryption";

/**
 * Optional `tx?: WsDb` follows the project-wide pattern (see
 * `lib/billing/quotas.ts`). When the caller is already inside a
 * workspace transaction, threading tx through `ToolContext` keeps
 * every tool's DB operation on the same connection so FORCE RLS
 * sees `app.workspace_id` SET LOCAL.
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

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
  /**
   * Workspace transaction handle (R2-C). When the caller (agent
   * runtime, channels router) is inside `withWorkspaceTx`, threading
   * tx keeps every DB op done by a tool on the same connection.
   */
  tx?: WsDb;
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
        action: {
          type: "string",
          description: "Acción a ejecutar (ej. list_customers, query, send_email).",
        },
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
  web_search: {
    name: "web_search",
    description:
      "Search the public web and return the top results (title, URL, snippet). Use when the user asks about current events, facts you don't know, or anything that needs fresh information. For fetching a known URL, use http_request instead.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query in natural language." },
        count: { type: "number", description: "Number of results (default 5, max 10)." },
      },
      required: ["query"],
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
  agent_call: {
    name: "agent_call",
    description:
      "Delegate a self-contained sub-task to a specialist teammate and GET ITS ANSWER BACK (request/response). The specialist runs with its own system prompt, tools, memory and response format, then returns text to you — you stay in control of the conversation. Use this to compose a team (orchestrator → specialists). Use `agent_team_list` first to see who you can call. For permanently transferring the conversation, use `agent_handoff` instead.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "ID of the specialist to delegate to (from agent_team_list).",
        },
        task: {
          type: "string",
          description:
            "Self-contained instruction/question for the specialist. Include all context it needs — it does NOT see your conversation history.",
        },
      },
      required: ["agentId", "task"],
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
      "SCRATCHPAD storage — save a short key→value note scoped to global/employee/conversation/team. Use for QUICK, KEY-BASED lookups ('preferred_language' → 'es'). For free-form durable facts, knowledge-graph entities, or anything you want to RECALL by similarity later, use `mnemosyne_remember` instead.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "employee", "conversation", "team"] },
        key: {
          type: "string",
          description: "Short snake_case identifier, e.g. 'preferred_language'",
        },
        value: { description: "Any JSON-serializable value." },
      },
      required: ["scope", "key", "value"],
    },
  },
  memory_get: {
    name: "memory_get",
    description:
      "SCRATCHPAD lookup — return the full key→value bag for a given scope. Use when you saved with `memory_set` and need to read it back. For semantic retrieval over durable facts, use `brain_recall`.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "employee", "conversation", "team"] },
      },
      required: ["scope"],
    },
  },
  brain_recall: {
    name: "brain_recall",
    description:
      "Semantic search over DURABLE facts in the workspace brain (stored via `mnemosyne_remember`). Returns the top-K facts ranked by vector similarity + recency + recall frequency. Call this BEFORE answering to surface preferences, traits, prior commitments. For scratchpad key-value retrieval, use `memory_get` instead.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query, e.g. 'user preferences about meetings'",
        },
        topK: { type: "number", description: "How many facts to return (1-20)", default: 5 },
      },
      required: ["query"],
    },
  },
  memory_remove: {
    name: "memory_remove",
    description:
      "SCRATCHPAD eviction — delete a single key or the entire bag for a scope. Use only for entries written with `memory_set`. Durable facts saved through `mnemosyne_remember` are closed via the brain's bitemporal model and shouldn't be reached from this tool.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "employee", "conversation", "team"] },
        key: { type: "string" },
      },
      required: ["scope"],
    },
  },
  // v1.5 — Mnemosyne durable-fact tool. The handler lives in
  // lib/agent-tools/mnemosyne-remember.ts (not in the executeTool
  // switch below) so the policy + PII pipeline stays isolated. The
  // definition is registered here so `getToolDefinitions` surfaces it
  // when the agent's `tools` config opts in.
  mnemosyne_remember: {
    name: "mnemosyne_remember",
    description:
      "BRAIN write — persist a durable, free-form fact about the user, their company, or the conversation. The fact is embedded for semantic search via `brain_recall` and surfaced on future turns. Use for preferences, traits, decisions, events, learned facts — anything you'd want recalled by meaning rather than a key. For ephemeral key→value scratchpad notes, use `memory_set` instead.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["preference", "trait", "event", "relationship", "skill", "concern", "other"],
          description: "Discriminator for the fact type.",
        },
        subject: {
          type: "string",
          description: "Who/what the statement is about ('user', employee name, 'workspace').",
        },
        statement: {
          type: "string",
          description: "Natural-language body of the fact.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Caller confidence in the fact (0..1). Defaults to 0.7.",
        },
        scope: {
          type: "string",
          enum: ["global", "conversation", "employee", "team"],
          description:
            "Storage scope. Omit to use the agent's policy default. Sensitive PII may force a downgrade regardless.",
        },
      },
      required: ["kind", "subject", "statement"],
    },
  },
};

export function getToolDefinitions(enabledIds: string[]): ToolDefinition[] {
  return enabledIds.map((id) => BUILTINS[id]).filter(Boolean) as ToolDefinition[];
}

export function listAllTools(): ToolDefinition[] {
  return Object.values(BUILTINS);
}

function customToolDefinition(row: {
  name: string;
  description: string | null;
  config: Record<string, unknown>;
}): ToolDefinition {
  const params = (row.config?.parameters as Record<string, unknown> | undefined) ?? {
    type: "object",
    properties: {},
  };
  return {
    name: row.name,
    description: row.description ?? `Custom tool ${row.name}`,
    inputSchema: params,
  };
}

/** Workspace-aware tool resolution (KNOW-1). Merges builtin definitions with
 *  registered agent_tool rows whose id or name is in enabledIds. Builtins win on name collision. */
export async function getToolDefinitionsForWorkspace(
  workspaceId: string,
  enabledIds: string[],
  tx?: WsDb
): Promise<ToolDefinition[]> {
  const builtins = getToolDefinitions(enabledIds);
  const builtinNames = new Set(builtins.map((b) => b.name));
  const db = tx ?? getDb();
  const rows = await db
    .select()
    .from(schema.agentTools)
    .where(eq(schema.agentTools.workspaceId, workspaceId));
  const custom = rows
    .filter((r) => enabledIds.includes(r.id) || enabledIds.includes(r.name))
    .filter((r) => !builtinNames.has(r.name))
    .map((r) => customToolDefinition(r));

  // KNOW-7: merge namespaced tools from connected MCP servers.
  // enabledIds that match "mcp__<serverId>__<tool>" trigger a tools/list call.
  const mcpEnabledIds = enabledIds.filter((id) => id.startsWith("mcp__"));
  if (mcpEnabledIds.length > 0) {
    const serverToolMap = new Map<string, Set<string>>();
    for (const id of mcpEnabledIds) {
      const sep = id.indexOf("__", 5); // skip "mcp__" (5 chars), find next __
      if (sep === -1) continue;
      const serverId = id.slice(5, sep);
      const toolName = id.slice(sep + 2);
      if (!serverToolMap.has(serverId)) serverToolMap.set(serverId, new Set());
      serverToolMap.get(serverId)!.add(toolName);
    }
    const serverIds = [...serverToolMap.keys()];
    const serverRows = await db
      .select()
      .from(schema.mcpServers)
      .where(
        and(
          eq(schema.mcpServers.workspaceId, workspaceId),
          inArray(schema.mcpServers.id, serverIds)
        )
      );
    const { listRemoteTools } = await import("./mcp/client");
    for (const server of serverRows) {
      if (!server.enabled) continue;
      const authHeader = server.authHeaderEncrypted ? decrypt(server.authHeaderEncrypted) : null;
      const remoteTools = await listRemoteTools({ url: server.url, authHeader });
      const requested = serverToolMap.get(server.id)!;
      for (const t of remoteTools) {
        if (requested.has(t.name)) {
          custom.push({
            name: `mcp__${server.id}__${t.name}`,
            description: t.description,
            inputSchema: t.inputSchema,
          });
        }
      }
    }
  }

  return [...builtins, ...custom];
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
    // esquemas no http(s). Opt-out `ALLOW_PRIVATE_HTTP=1` consistente con el
    // nodo `http` del flow-engine, para self-hosters con servicios internos.
    if (process.env.ALLOW_PRIVATE_HTTP !== "1") {
      assertPublicUrl(url);
    }
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
    // F-B1: async — el agente puede correr flows largos (video/avatar) sin
    // bloquear el turno conversacional. Devolvemos runId y el agente puede
    // chequear /api/flow-runs/:runId después.
    const { enqueueFlowRun } = await import("./flow-engine");
    const result = await enqueueFlowRun({
      flowId,
      workspaceId: ctx.workspaceId,
      triggerSource: `tool_call`,
      input: (input.input as Record<string, unknown>) ?? {},
    });
    return result;
  }

  if (name === "agent_team_list") {
    const db = ctx.tx ?? getDb();
    const conds = [
      eq(schema.agents.workspaceId, ctx.workspaceId),
      eq(schema.agents.status, "active"),
    ];
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
      throw new Error(
        "agent_handoff requires conversationId — only available in conversational runs"
      );
    }
    const targetAgentId = String(input.agentId ?? "");
    const note = String(input.note ?? "").slice(0, 1000);
    if (!targetAgentId) throw new Error("agentId required");
    if (targetAgentId === ctx.agentId) throw new Error("cannot hand off to yourself");

    const db = ctx.tx ?? getDb();

    // Validate target agent exists in same workspace and is active
    const targetRows = await db
      .select()
      .from(schema.agents)
      .where(
        and(eq(schema.agents.id, targetAgentId), eq(schema.agents.workspaceId, ctx.workspaceId))
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
    const scope = String(input.scope ?? "global") as
      | "global"
      | "conversation"
      | "employee"
      | "team";
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
      const out = await setMemory({ ...baseQ, scope, key, value }, ctx.tx);
      return { ok: true, scope, data: out.data };
    }
    if (name === "memory_get") {
      const matches = await getRelevantMemories(baseQ, ctx.tx);
      const filtered = matches.filter((m) => m.scope === scope);
      return {
        scope,
        data: filtered[0]?.data ?? {},
      };
    }
    if (name === "memory_remove") {
      const key = input.key != null ? String(input.key) : null;
      await removeMemory({ ...baseQ, scope, key }, ctx.tx);
      return { ok: true, scope, removed: key ?? "all" };
    }
  }

  if (name === "brain_recall") {
    const query = String(input.query ?? "");
    if (!query) throw new Error("query required");
    // Recall dispatches via `recallForWorkspace`, which embeds the
    // query host-side with the workspace's encrypted `ai_provider`
    // row and forwards the precomputed vector to the mnemosyne SDK.
    // `RecallHit.content` is the fact statement, `score` blends memory
    // + KB similarity, and `attribution` carries the kind/subject.
    const { recallForWorkspace } = await import("@/lib/mnemo/recall");
    const { hits } = await recallForWorkspace({
      workspaceId: ctx.workspaceId,
      query,
      topK: Math.min(Number(input.topK ?? 5), 20),
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    });
    return {
      hits: hits.map((h) => {
        const attr = (h.attribution ?? {}) as { kind?: string; subject?: string };
        return {
          kind: attr.kind ?? "fact",
          subject: attr.subject ?? "",
          statement: h.content,
          score: Number(h.score.toFixed(3)),
        };
      }),
    };
  }

  if (name === "knowledge_search") {
    const kbId = String(input.kbId ?? "");
    const query = String(input.query ?? "");
    if (!kbId || !query) throw new Error("kbId and query required");
    const { searchKnowledgeBase } = await import("./knowledge-search");
    const results = await searchKnowledgeBase(
      ctx.workspaceId,
      kbId,
      query,
      Number(input.topK ?? 5),
      ctx.tx
    );
    // KNOW-8: surface heading from chunk metadata so the LLM can cite sections.
    return {
      results: results.map((h) => ({
        text: h.text,
        docTitle: h.docTitle,
        score: h.score,
        ...(h.heading ? { heading: h.heading } : {}),
        ...(h.page != null ? { page: h.page } : {}),
      })),
    };
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
      (input.input as Record<string, unknown>) ?? {},
      ctx.tx
    );
  }

  if (name === "web_search") {
    const query = String(input.query ?? "").trim();
    if (!query) throw new Error("query required");
    const endpoint = process.env.WEB_SEARCH_ENDPOINT;
    const apiKey = process.env.WEB_SEARCH_API_KEY;
    if (!endpoint || !apiKey) {
      throw new Error(
        "La búsqueda web no está configurada (WEB_SEARCH_ENDPOINT/WEB_SEARCH_API_KEY). web search is not configured."
      );
    }
    const count = Math.min(10, Math.max(1, Number(input.count ?? 5)));
    const url = `${endpoint}?q=${encodeURIComponent(query)}&count=${count}`;
    const r = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } },
      HTTP_REQUEST_TIMEOUT_MS
    );
    if (!r.ok) throw new Error(`web_search ${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = (await r.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      results?: Array<{ title?: string; url?: string; description?: string; snippet?: string }>;
    };
    const raw = j.web?.results ?? j.results ?? [];
    return {
      results: raw.slice(0, count).map((x) => ({
        title: x.title ?? "",
        url: x.url ?? "",
        snippet:
          (x as { description?: string }).description ?? (x as { snippet?: string }).snippet ?? "",
      })),
    };
  }

  // KNOW-1: custom workspace tool (agent_tool row). Resolved by name within the workspace.
  {
    const db = ctx.tx ?? getDb();
    const rows = await db
      .select()
      .from(schema.agentTools)
      .where(
        and(eq(schema.agentTools.workspaceId, ctx.workspaceId), eq(schema.agentTools.name, name))
      )
      .limit(1);
    const row = rows[0];
    if (row && (row.kind === "http_request" || row.kind === "custom")) {
      const cfg = row.config as {
        urlTemplate?: string;
        method?: string;
        headers?: Record<string, string>;
        bodyTemplate?: string;
      };
      const tmpl = String(cfg.urlTemplate ?? "");
      if (!tmpl) throw new Error(`Custom tool ${name} has no urlTemplate`);
      const url = tmpl.replace(/\{\{([^}]+)\}\}/g, (_, k: string) =>
        encodeURIComponent(String(input[k.trim()] ?? ""))
      );
      assertPublicUrl(url);
      const method = (cfg.method ?? "GET").toUpperCase();
      const init: RequestInit = {
        method,
        headers: cfg.headers ?? { Accept: "application/json" },
      };
      if (method !== "GET" && cfg.bodyTemplate) {
        init.body = cfg.bodyTemplate.replace(/\{\{([^}]+)\}\}/g, (_, k: string) =>
          String(input[k.trim()] ?? "")
        );
      }
      const r = await fetchWithTimeout(url, init, HTTP_REQUEST_TIMEOUT_MS);
      const text = await r.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {}
      return { status: r.status, body };
    }
  }

  // KNOW-7: proxy MCP tool calls. Name format: mcp__<serverId>__<toolName>
  if (name.startsWith("mcp__")) {
    const sep = name.indexOf("__", 5); // skip "mcp__" (5 chars), find next __
    if (sep !== -1) {
      const serverId = name.slice(5, sep);
      const toolName = name.slice(sep + 2);
      const db = ctx.tx ?? getDb();
      const serverRows = await db
        .select()
        .from(schema.mcpServers)
        .where(
          and(
            eq(schema.mcpServers.workspaceId, ctx.workspaceId),
            eq(schema.mcpServers.id, serverId)
          )
        )
        .limit(1);
      const server = serverRows[0];
      if (!server || !server.enabled)
        throw new Error(`MCP server ${serverId} not found or disabled`);
      const authHeader = server.authHeaderEncrypted ? decrypt(server.authHeaderEncrypted) : null;
      const { callRemoteTool } = await import("./mcp/client");
      return callRemoteTool({ url: server.url, authHeader }, toolName, input);
    }
  }

  if (name === "agent_call") {
    if (!ctx.agentId) throw new Error("agent_call requires the calling agent context");
    const targetAgentId = String(input.agentId ?? "");
    const task = String(input.task ?? "").trim();
    if (!targetAgentId) throw new Error("agentId required");
    if (!task) throw new Error("task required");
    if (targetAgentId === ctx.agentId) throw new Error("cannot delegate to yourself");

    const db = ctx.tx ?? getDb();
    const rows = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        teamId: schema.agents.teamId,
        status: schema.agents.status,
      })
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.workspaceId, ctx.workspaceId),
          inArray(schema.agents.id, [ctx.agentId, targetAgentId])
        )
      );
    const caller = rows.find((r) => r.id === ctx.agentId);
    const target = rows.find((r) => r.id === targetAgentId);
    if (!target) throw new Error(`target agent ${targetAgentId} not found in workspace`);
    if (target.status !== "active") throw new Error(`target agent ${target.name} is not active`);
    if (caller?.teamId && caller.teamId !== target.teamId) {
      throw new Error(`agent ${target.name} is not in your team — delegation not allowed`);
    }

    const { loadAgent, runAgent } = await import("./agent-runtime");
    const full = await loadAgent(ctx.workspaceId, targetAgentId, ctx.tx);
    if (!full) throw new Error(`target agent ${targetAgentId} not found`);
    const result = await runAgent({
      workspaceId: ctx.workspaceId,
      agent: full,
      messages: [{ role: "user", content: task }],
      ...(ctx.tx ? { tx: ctx.tx } : {}),
    });
    return {
      output: result.content,
      agentId: targetAgentId,
      tokensUsed: result.tokensUsed,
      model: result.model,
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}
