import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { llmCall } from "./llm-call";

export type FlowNodeType =
  | "trigger"
  | "agent"
  | "condition"
  | "switch"
  | "http"
  | "transform"
  | "delay"
  | "notify"
  | "code"
  | "loop_for_each"
  | "parallel"
  | "try_catch"
  | "subflow"
  | "wait_human"
  | "end";

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export interface RunContext {
  variables: Record<string, unknown>;
  output: Record<string, unknown>;
}

export function interpolate(template: string, ctx: Record<string, unknown>): string {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const parts = path.trim().split(".");
    let v: unknown = ctx;
    for (const p of parts) {
      if (v && typeof v === "object" && p in (v as Record<string, unknown>)) {
        v = (v as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return v == null ? "" : String(v);
  });
}

export interface Condition {
  left: string;
  op: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains";
  right: string;
}

export function evaluateCondition(c: Condition, ctx: Record<string, unknown>): boolean {
  const l = interpolate(c.left, ctx);
  const r = interpolate(c.right, ctx);
  switch (c.op) {
    case "==":
      return l === r;
    case "!=":
      return l !== r;
    case "contains":
      return l.includes(r);
    case ">":
      return Number(l) > Number(r);
    case "<":
      return Number(l) < Number(r);
    case ">=":
      return Number(l) >= Number(r);
    case "<=":
      return Number(l) <= Number(r);
  }
}

/**
 * Mini DSL for the `code` node — kept intentionally limited.
 * Syntax (one statement per line):
 *   set <var> = <expr-with-{{interpolation}}>
 * Strings, numbers, JSON arrays/objects can be parsed if `<expr>` is valid JSON
 * after interpolation; otherwise it's stored as a string.
 */
async function runUserCode(source: string, ctx: RunContext): Promise<Record<string, unknown>> {
  const lines = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("#"));
  const out: Record<string, unknown> = {};
  for (const line of lines) {
    const m = /^set\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!m) throw new Error(`Code node: unsupported syntax: ${line}`);
    const varName = m[1]!;
    const expr = interpolate(m[2]!, ctx.variables);
    let value: unknown = expr;
    try {
      value = JSON.parse(expr);
    } catch {}
    out[varName] = value;
    ctx.variables[varName] = value;
  }
  return out;
}

export async function executeFlow({
  flowId,
  workspaceId,
  triggerSource,
  input,
}: {
  flowId: string;
  workspaceId: string;
  triggerSource: string;
  input: Record<string, unknown>;
}): Promise<{ runId: string; status: "succeeded" | "failed"; error?: string }> {
  const db = getDb();
  const flowRows = await db
    .select()
    .from(schema.flows)
    .where(eq(schema.flows.id, flowId))
    .limit(1);
  const flow = flowRows[0];
  if (!flow) throw new Error("Flow not found");

  const runId = createId();
  await db.insert(schema.flowRuns).values({
    id: runId,
    flowId,
    workspaceId,
    status: "running",
    triggerSource,
    input,
  });

  const ctx: RunContext = {
    variables: { ...(flow.variables ?? {}), ...input },
    output: {},
  };

  const nodes = (flow.nodes ?? []) as FlowNode[];
  const edges = (flow.edges ?? []) as FlowEdge[];
  const start = nodes.find((n) => n.type === "trigger");
  if (!start) {
    await db
      .update(schema.flowRuns)
      .set({ status: "failed", error: "No trigger node", completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    return { runId, status: "failed", error: "No trigger node" };
  }

  try {
    await runFromNode(start.id, nodes, edges, ctx, runId, workspaceId, db);
    await db
      .update(schema.flowRuns)
      .set({ status: "succeeded", output: ctx.variables, completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    await db.update(schema.flows).set({ lastRunAt: new Date() }).where(eq(schema.flows.id, flowId));
    return { runId, status: "succeeded" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.flowRuns)
      .set({ status: "failed", error: msg, completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    return { runId, status: "failed", error: msg };
  }
}

async function runFromNode(
  nodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  ctx: RunContext,
  runId: string,
  workspaceId: string,
  db: ReturnType<typeof getDb>,
  depth = 0
): Promise<void> {
  if (depth > 100) throw new Error("Flow exceeded max depth (100)");
  const node = nodes.find((n) => n.id === nodeId);
  if (!node || node.type === "end") return;

  const stepId = createId();
  await db.insert(schema.flowRunSteps).values({
    id: stepId,
    runId,
    nodeId: node.id,
    nodeType: node.type,
    status: "running",
    input: { ...ctx.variables },
  });

  let nextHandle: string | undefined;
  let stepOutput: Record<string, unknown> = {};
  let skipChildren = false;

  try {
    await executeNode(node, ctx, runId, workspaceId, nodes, edges, db, depth, {
      setHandle: (h) => {
        nextHandle = h;
      },
      setOutput: (o) => {
        stepOutput = o;
      },
      skipChildren: () => {
        skipChildren = true;
      },
    });

    await db
      .update(schema.flowRunSteps)
      .set({ status: "succeeded", output: stepOutput, completedAt: new Date() })
      .where(eq(schema.flowRunSteps.id, stepId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.flowRunSteps)
      .set({ status: "failed", error: msg, completedAt: new Date() })
      .where(eq(schema.flowRunSteps.id, stepId));
    throw e;
  }

  if (skipChildren) return;

  const outgoing = edges.filter(
    (e) => e.source === node.id && (nextHandle == null || e.sourceHandle === nextHandle)
  );
  for (const ed of outgoing) {
    await runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
  }
}

interface ExecHelpers {
  setHandle: (h: string) => void;
  setOutput: (o: Record<string, unknown>) => void;
  skipChildren: () => void;
}

async function executeNode(
  node: FlowNode,
  ctx: RunContext,
  runId: string,
  workspaceId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  db: ReturnType<typeof getDb>,
  depth: number,
  helpers: ExecHelpers
): Promise<void> {
  const cfg = node.config;

  if (node.type === "trigger") return;

  if (node.type === "agent") {
    const agentId = cfg.agentId as string | undefined;
    if (!agentId) throw new Error("agent node missing agentId");
    const userMessage = interpolate((cfg.message as string) ?? "{{input}}", ctx.variables);
    const aRows = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
    const agent = aRows[0];
    if (!agent) throw new Error(`agent not found: ${agentId}`);
    const result = await llmCall({
      workspaceId,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      temperature: agent.temperature ? Number(agent.temperature) : 0.7,
      ...(agent.maxTokens != null && { maxTokens: agent.maxTokens }),
    });
    const outputVar = (cfg.outputVar as string) ?? "agentResult";
    ctx.variables[outputVar] = result.content;
    helpers.setOutput({ content: result.content, tokensUsed: result.tokensUsed });
    return;
  }

  if (node.type === "condition") {
    const cond = cfg.condition as Condition;
    const passed = evaluateCondition(cond, ctx.variables);
    helpers.setHandle(passed ? "true" : "false");
    helpers.setOutput({ passed });
    return;
  }

  if (node.type === "switch") {
    const value = interpolate((cfg.expression as string) ?? "", ctx.variables);
    const cases = (cfg.cases as Array<{ value: string; handle: string }>) ?? [];
    const matched = cases.find((c) => c.value === value);
    helpers.setHandle(matched?.handle ?? "default");
    helpers.setOutput({ value, matched: matched?.handle ?? "default" });
    return;
  }

  if (node.type === "http") {
    const method = ((cfg.method as string) ?? "GET").toUpperCase();
    const url = interpolate(cfg.url as string, ctx.variables);
    const headers: Record<string, string> = { ...((cfg.headers as Record<string, string>) ?? {}) };
    const auth = cfg.auth as
      | { kind?: string; token?: string; user?: string; pass?: string; key?: string; header?: string }
      | undefined;
    if (auth?.kind === "bearer" && auth.token) {
      headers["Authorization"] = `Bearer ${interpolate(auth.token, ctx.variables)}`;
    } else if (auth?.kind === "basic" && auth.user && auth.pass) {
      const encoded = Buffer.from(
        `${interpolate(auth.user, ctx.variables)}:${interpolate(auth.pass, ctx.variables)}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    } else if (auth?.kind === "api_key" && auth.key) {
      const headerName = auth.header || "X-API-Key";
      headers[headerName] = interpolate(auth.key, ctx.variables);
    }

    const init: RequestInit = { method, headers };
    if (method !== "GET") {
      init.body = interpolate((cfg.body as string) ?? "", ctx.variables);
    }

    const maxAttempts = Math.min(5, Number(cfg.maxAttempts ?? 1));
    const timeoutMs = Math.min(60000, Number(cfg.timeoutMs ?? 30000));
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), timeoutMs);
        const r = await fetch(url, { ...init, signal: ac.signal });
        clearTimeout(t);
        const text = await r.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {}
        if (!r.ok && attempt < maxAttempts) {
          await new Promise((res) => setTimeout(res, 200 * Math.pow(2, attempt - 1)));
          continue;
        }
        const outputVar = (cfg.outputVar as string) ?? "httpResult";
        ctx.variables[outputVar] = body;
        helpers.setOutput({ status: r.status, body, attempt });
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < maxAttempts) {
          await new Promise((res) => setTimeout(res, 200 * Math.pow(2, attempt - 1)));
        }
      }
    }
    throw lastError ?? new Error("HTTP request failed after retries");
  }

  if (node.type === "transform") {
    const target = (cfg.target as string) ?? "result";
    const value = interpolate((cfg.value as string) ?? "", ctx.variables);
    ctx.variables[target] = value;
    helpers.setOutput({ [target]: value });
    return;
  }

  if (node.type === "delay") {
    const ms = Math.min(60_000, Number(cfg.ms ?? 1000));
    await new Promise((res) => setTimeout(res, ms));
    helpers.setOutput({ ms });
    return;
  }

  if (node.type === "notify") {
    helpers.setOutput({
      channel: cfg.channel,
      message: interpolate((cfg.message as string) ?? "", ctx.variables),
    });
    return;
  }

  if (node.type === "code") {
    const source = (cfg.source as string) ?? "";
    const result = await runUserCode(source, ctx);
    helpers.setOutput({ result });
    return;
  }

  if (node.type === "loop_for_each") {
    const arrayVar = (cfg.arrayVar as string) ?? "items";
    const itemVar = (cfg.itemVar as string) ?? "item";
    const items = ctx.variables[arrayVar];
    if (!Array.isArray(items)) {
      throw new Error(`loop_for_each: ${arrayVar} is not an array`);
    }
    const bodyEdges = edges.filter((e) => e.source === node.id && e.sourceHandle === "body");
    const results: unknown[] = [];
    for (const item of items) {
      ctx.variables[itemVar] = item;
      for (const ed of bodyEdges) {
        await runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
      }
      results.push(ctx.variables[(cfg.collectVar as string) ?? itemVar]);
    }
    ctx.variables[(cfg.outputVar as string) ?? "loopResults"] = results;
    helpers.setOutput({ count: results.length });
    helpers.setHandle("done");
    return;
  }

  if (node.type === "parallel") {
    const branchEdges = edges.filter((e) => e.source === node.id);
    await Promise.all(
      branchEdges.map((ed) =>
        runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1)
      )
    );
    helpers.setOutput({ branches: branchEdges.length });
    helpers.skipChildren();
    return;
  }

  if (node.type === "try_catch") {
    const tryEdge = edges.find((e) => e.source === node.id && e.sourceHandle === "try");
    const catchEdge = edges.find((e) => e.source === node.id && e.sourceHandle === "catch");
    if (!tryEdge) throw new Error("try_catch: missing try branch");
    try {
      await runFromNode(tryEdge.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
      helpers.setOutput({ caught: false });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      ctx.variables[(cfg.errorVar as string) ?? "error"] = err;
      if (catchEdge) {
        await runFromNode(catchEdge.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
      }
      helpers.setOutput({ caught: true, error: err });
    }
    helpers.skipChildren();
    return;
  }

  if (node.type === "subflow") {
    const subId = cfg.flowId as string | undefined;
    if (!subId) throw new Error("subflow: missing flowId");
    const result = await executeFlow({
      flowId: subId,
      workspaceId,
      triggerSource: `parent_run:${runId}`,
      input: ctx.variables,
    });
    if (result.status === "failed") throw new Error(`subflow failed: ${result.error}`);
    const subRuns = await db
      .select()
      .from(schema.flowRuns)
      .where(eq(schema.flowRuns.id, result.runId))
      .limit(1);
    const subOut = (subRuns[0]?.output as Record<string, unknown>) ?? {};
    Object.assign(ctx.variables, subOut);
    helpers.setOutput({ subRunId: result.runId, mergedKeys: Object.keys(subOut) });
    return;
  }

  if (node.type === "wait_human") {
    ctx.variables["_pendingApproval"] = {
      message: interpolate((cfg.message as string) ?? "Approval required", ctx.variables),
      assignee: cfg.assignee,
    };
    helpers.setOutput({ paused: true });
    return;
  }

  throw new Error(`Unknown node type: ${node.type}`);
}
