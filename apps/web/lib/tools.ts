import "server-only";

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
}

const BUILTINS: Record<string, ToolDefinition> = {
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
    if (!url || !/^https?:\/\//.test(url)) throw new Error("url must be http(s)");
    const u = new URL(url);
    if (
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) ||
      u.hostname === "localhost" ||
      u.hostname === "0.0.0.0"
    ) {
      throw new Error("Private IPs are not allowed");
    }
    const method = (input.method as string) ?? "GET";
    const init: RequestInit = {
      method,
      headers: (input.headers as Record<string, string>) ?? { Accept: "application/json" },
    };
    if (method !== "GET" && input.body !== undefined) init.body = String(input.body);
    const r = await fetch(url, init);
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

  if (name === "knowledge_search") {
    const kbId = String(input.kbId ?? "");
    const query = String(input.query ?? "");
    const topK = Math.min(20, Number(input.topK ?? 5));
    if (!kbId || !query) throw new Error("kbId and query required");

    const { getDb, schema } = await import("@orchester/db");
    const { eq, and, sql } = await import("drizzle-orm");
    const { embed } = await import("./embeddings");

    const db = getDb();
    const kbs = await db
      .select()
      .from(schema.knowledgeBases)
      .where(
        and(
          eq(schema.knowledgeBases.id, kbId),
          eq(schema.knowledgeBases.workspaceId, ctx.workspaceId)
        )
      )
      .limit(1);
    const kb = kbs[0];
    if (!kb) throw new Error(`Knowledge base ${kbId} not found`);

    const { vectors } = await embed(
      ctx.workspaceId,
      kb.embeddingProvider as "openai" | "google",
      kb.embeddingModel,
      [query]
    );
    const v = vectors[0];
    if (!v) return { results: [] };
    const vec = `[${v.join(",")}]`;
    const rows = await db.execute(sql`
      select c.id, c.doc_id as "docId", c.ordinal, c.text,
             d.title as "docTitle",
             1 - (c.embedding <=> ${vec}::vector) as score
      from knowledge_chunk c
      inner join knowledge_doc d on d.id = c.doc_id
      where c.workspace_id = ${ctx.workspaceId}
        and c.kb_id = ${kbId}
        and c.embedding is not null
      order by c.embedding <=> ${vec}::vector
      limit ${topK}
    `);
    return { results: rows };
  }

  throw new Error(`Unknown tool: ${name}`);
}
