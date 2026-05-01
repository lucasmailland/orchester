import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq } from "drizzle-orm";
import { llmCall } from "./llm-call";

export interface FlowNode {
  id: string;
  type: "trigger" | "agent" | "condition" | "http" | "transform" | "delay" | "notify" | "end";
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
      .set({ status: "succeeded", output: ctx.output, completedAt: new Date() })
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
  if (depth > 50) throw new Error("Flow exceeded max depth (50)");
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

  try {
    if (node.type === "trigger") {
      // pass-through
    } else if (node.type === "agent") {
      const agentId = node.config.agentId as string | undefined;
      const userMessage = interpolate(
        (node.config.message as string) ?? "{{input}}",
        ctx.variables
      );
      if (!agentId) throw new Error("agent node missing agentId");
      const aRows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);
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
      const outputVar = (node.config.outputVar as string) ?? "agentResult";
      ctx.variables[outputVar] = result.content;
      stepOutput = { content: result.content, tokensUsed: result.tokensUsed };
    } else if (node.type === "condition") {
      const cond = node.config.condition as Condition;
      const passed = evaluateCondition(cond, ctx.variables);
      nextHandle = passed ? "true" : "false";
      stepOutput = { passed };
    } else if (node.type === "http") {
      const method = (node.config.method as string) ?? "GET";
      const url = interpolate(node.config.url as string, ctx.variables);
      const init: RequestInit = {
        method,
        headers: (node.config.headers as Record<string, string>) ?? {},
      };
      if (method !== "GET") {
        init.body = interpolate((node.config.body as string) ?? "", ctx.variables);
      }
      const r = await fetch(url, init);
      const text = await r.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {}
      const outputVar = (node.config.outputVar as string) ?? "httpResult";
      ctx.variables[outputVar] = body;
      stepOutput = { status: r.status, body };
    } else if (node.type === "transform") {
      const target = node.config.target as string;
      const value = interpolate((node.config.value as string) ?? "", ctx.variables);
      ctx.variables[target] = value;
      stepOutput = { [target]: value };
    } else if (node.type === "delay") {
      const ms = Math.min(30000, Number(node.config.ms ?? 1000));
      await new Promise((res) => setTimeout(res, ms));
      stepOutput = { ms };
    } else if (node.type === "notify") {
      stepOutput = {
        channel: node.config.channel,
        message: interpolate((node.config.message as string) ?? "", ctx.variables),
      };
    }

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

  const outgoing = edges.filter(
    (e) => e.source === node.id && (nextHandle == null || e.sourceHandle === nextHandle)
  );
  for (const ed of outgoing) {
    await runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
  }
}
