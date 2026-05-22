import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { llmCall } from "./llm-call";

export type FlowNodeType =
  | "trigger"
  | "agent"
  | "kb_search"
  | "generate_image"
  | "embed_text"
  | "condition"
  | "switch"
  | "http"
  | "integration"
  | "transform"
  | "spreadsheet"
  | "delay"
  | "notify"
  | "code"
  | "loop_for_each"
  | "parallel"
  | "try_catch"
  | "subflow"
  | "wait_human"
  | "note"
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

/** Evento de ejecución en vivo (para visualizar el run en el lienzo). */
export type FlowRunEvent =
  | { type: "run_start"; runId: string }
  | { type: "step_start"; nodeId: string; nodeType: string }
  | { type: "step_finish"; nodeId: string; status: "succeeded" | "failed"; error?: string }
  | { type: "run_finish"; status: "succeeded" | "failed"; error?: string };

export type FlowEmit = (ev: FlowRunEvent) => void;

export interface RunContext {
  variables: Record<string, unknown>;
  output: Record<string, unknown>;
  /** Hook opcional para emitir eventos en vivo. */
  emit?: FlowEmit;
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

/**
 * Resuelve un valor manteniendo el tipo. Si el template es exactamente un único
 * `{{ruta}}` devuelve el valor real (array/objeto/número), no su string. Si no,
 * cae a `interpolate` (string).
 */
export function resolveValue(template: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof template !== "string") return template;
  const m = /^\s*\{\{([^}]+)\}\}\s*$/.exec(template);
  if (m) {
    const parts = m[1]!.trim().split(".");
    let v: unknown = ctx;
    for (const p of parts) {
      if (v && typeof v === "object" && p in (v as Record<string, unknown>)) {
        v = (v as Record<string, unknown>)[p];
      } else {
        return undefined;
      }
    }
    return v;
  }
  return interpolate(template, ctx);
}

/** Interpola strings dentro de un objeto/array de forma recursiva. */
export function deepInterpolate(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") return resolveValue(value, ctx);
  if (Array.isArray(value)) return value.map((v) => deepInterpolate(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepInterpolate(v, ctx);
    }
    return out;
  }
  return value;
}

/** Convierte "30s" | "5m" | "1h" | "1d" (o un número en ms) a milisegundos. */
export function parseDuration(input: unknown): number {
  if (typeof input === "number") return input;
  const s = String(input ?? "").trim();
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] ?? "ms";
  const mult: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[unit] ?? 1);
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

/**
 * Corre JavaScript de usuario en un sandbox `node:vm`. Recibe `input` (copia de
 * las variables del flujo) y devuelve lo que retorne el código. Sin `require`,
 * sin acceso a globals peligrosos, con timeout. No es una frontera de seguridad
 * fuerte, pero el código lo escribe el dueño del workspace para su propio flujo.
 */
async function runUserJs(code: string, variables: Record<string, unknown>): Promise<unknown> {
  const vm = await import("node:vm");
  const input = structuredClone(variables);
  const sandbox = Object.create(null) as Record<string, unknown>;
  const context = vm.createContext(sandbox);
  const script = new vm.Script(`(function(input){"use strict";\n${code}\n})`);
  let fn: unknown;
  try {
    fn = script.runInContext(context, { timeout: 1000 });
  } catch (e) {
    throw new Error(`No pudimos leer el código: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof fn !== "function") throw new Error("El código no es válido.");
  try {
    return (fn as (i: unknown) => unknown)(input);
  } catch (e) {
    throw new Error(`El código falló al ejecutarse: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Evalúa una fórmula tipo Excel (`=SUM(input.ventas)`) exponiendo toda la
 * batería de funciones de @formulajs/formulajs + `input` (las variables del
 * flujo) en un sandbox `node:vm`.
 */
async function runFormula(formula: string, variables: Record<string, unknown>): Promise<unknown> {
  const vm = await import("node:vm");
  const formulajs = await import("@formulajs/formulajs");
  const expr = formula.startsWith("=") ? formula.slice(1) : formula;
  const input = structuredClone(variables);
  const sandbox: Record<string, unknown> = { ...formulajs, input };
  const context = vm.createContext(sandbox);
  try {
    return vm.runInContext(`(${expr})`, context, { timeout: 1000 });
  } catch (e) {
    throw new Error(`La fórmula tiene un error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function executeFlow({
  flowId,
  workspaceId,
  triggerSource,
  input,
  onEvent,
}: {
  flowId: string;
  workspaceId: string;
  triggerSource: string;
  input: Record<string, unknown>;
  onEvent?: FlowEmit;
}): Promise<{ runId: string; status: "succeeded" | "failed"; error?: string }> {
  const db = getDb();
  const flowRows = await db
    .select()
    .from(schema.flows)
    .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
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

  onEvent?.({ type: "run_start", runId });

  const ctx: RunContext = {
    variables: { ...(flow.variables ?? {}), ...input },
    output: {},
    ...(onEvent ? { emit: onEvent } : {}),
  };

  const nodes = (flow.nodes ?? []) as FlowNode[];
  const edges = (flow.edges ?? []) as FlowEdge[];
  const start = nodes.find((n) => n.type === "trigger");
  if (!start) {
    const err = "Este flujo no tiene un paso de inicio (disparador). Agregá uno para poder ejecutarlo.";
    await db
      .update(schema.flowRuns)
      .set({ status: "failed", error: err, completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    onEvent?.({ type: "run_finish", status: "failed", error: err });
    return { runId, status: "failed", error: err };
  }

  try {
    await runFromNode(start.id, nodes, edges, ctx, runId, workspaceId, db);
    await db
      .update(schema.flowRuns)
      .set({ status: "succeeded", output: ctx.variables, completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    await db.update(schema.flows).set({ lastRunAt: new Date() }).where(eq(schema.flows.id, flowId));
    onEvent?.({ type: "run_finish", status: "succeeded" });
    return { runId, status: "succeeded" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.flowRuns)
      .set({ status: "failed", error: msg, completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    onEvent?.({ type: "run_finish", status: "failed", error: msg });
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
  ctx.emit?.({ type: "step_start", nodeId: node.id, nodeType: node.type });

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
    ctx.emit?.({ type: "step_finish", nodeId: node.id, status: "succeeded" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.flowRunSteps)
      .set({ status: "failed", error: msg, completedAt: new Date() })
      .where(eq(schema.flowRunSteps.id, stepId));
    ctx.emit?.({ type: "step_finish", nodeId: node.id, status: "failed", error: msg });
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
    if (!agentId) throw new Error("Falta elegir el agente en este paso.");
    // `prompt` (registry) se antepone al mensaje entrante; `message` es el legado.
    const extra = cfg.prompt ? interpolate(cfg.prompt as string, ctx.variables) : "";
    const incoming = interpolate((cfg.message as string) ?? "{{message}}", ctx.variables);
    const userMessage = [extra, incoming].filter((s) => s && s.trim()).join("\n\n") || incoming;
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
    // Acepta el formato nuevo del registry (left/op/right planos) o el legado
    // ({ condition: { left, op, right } }).
    const flat = cfg.condition
      ? (cfg.condition as Condition)
      : ({ left: cfg.left, op: cfg.op, right: cfg.right } as Condition);
    if (!flat.op) throw new Error("Falta elegir la comparación en este paso.");
    const passed = evaluateCondition(flat, ctx.variables);
    helpers.setHandle(passed ? "true" : "false");
    helpers.setOutput({ passed });
    return;
  }

  if (node.type === "switch") {
    // El valor evaluado se usa como nombre del camino (sourceHandle del edge).
    // Si ningún camino coincide con el valor, seguimos por "default" (Siguiente).
    const value = interpolate((cfg.value as string) ?? (cfg.expression as string) ?? "", ctx.variables);
    const cases = (cfg.cases as Array<{ value: string; handle: string }>) ?? [];
    const matched = cases.find((c) => c.value === value);
    let handle = matched?.handle ?? (value || "default");
    const hasEdge = edges.some((e) => e.source === node.id && e.sourceHandle === handle);
    if (!hasEdge) handle = "default";
    helpers.setHandle(handle);
    helpers.setOutput({ value, matched: handle });
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
    // Formato nuevo: `template` es un objeto/JSON con {{variables}} adentro, que
    // se fusiona en las variables del flujo. Legado: target + value.
    if (cfg.template !== undefined) {
      let tpl: unknown = cfg.template;
      if (typeof tpl === "string") {
        try {
          tpl = JSON.parse(tpl);
        } catch {
          throw new Error("El campo 'Resultado' tiene que ser un objeto JSON válido.");
        }
      }
      const result = deepInterpolate(tpl, ctx.variables);
      if (result && typeof result === "object" && !Array.isArray(result)) {
        Object.assign(ctx.variables, result as Record<string, unknown>);
      }
      helpers.setOutput({ result });
      return;
    }
    const target = (cfg.target as string) ?? "result";
    const value = interpolate((cfg.value as string) ?? "", ctx.variables);
    ctx.variables[target] = value;
    helpers.setOutput({ [target]: value });
    return;
  }

  if (node.type === "delay") {
    // `duration` ("30s"/"5m"…) en el registry; `ms` numérico legado.
    const ms = Math.min(60_000, cfg.duration !== undefined ? parseDuration(cfg.duration) : Number(cfg.ms ?? 1000));
    await new Promise((res) => setTimeout(res, ms));
    helpers.setOutput({ ms });
    return;
  }

  if (node.type === "notify") {
    helpers.setOutput({
      to: cfg.to ? interpolate(cfg.to as string, ctx.variables) : undefined,
      channel: cfg.channel,
      message: interpolate((cfg.message as string) ?? "", ctx.variables),
    });
    return;
  }

  if (node.type === "code") {
    // Formato nuevo: JavaScript real (campo `code`) corrido en sandbox vm con
    // `input` (copia de las variables). Legado: mini-DSL `source`.
    if (typeof cfg.code === "string" && cfg.code.trim()) {
      const result = await runUserJs(cfg.code, ctx.variables);
      if (result && typeof result === "object" && !Array.isArray(result)) {
        Object.assign(ctx.variables, result as Record<string, unknown>);
      }
      helpers.setOutput({ result });
      return;
    }
    const source = (cfg.source as string) ?? "";
    const result = await runUserCode(source, ctx);
    helpers.setOutput({ result });
    return;
  }

  if (node.type === "kb_search") {
    const kbId = cfg.kbId as string | undefined;
    if (!kbId) throw new Error("Falta elegir la base de conocimiento.");
    const query = interpolate((cfg.query as string) ?? "{{message}}", ctx.variables);
    const topK = cfg.topK != null ? Number(cfg.topK) : 5;
    const { searchKnowledgeBase } = await import("./knowledge-search");
    const results = await searchKnowledgeBase(workspaceId, kbId, query, topK);
    const outputVar = (cfg.outputVar as string) ?? "knowledge";
    ctx.variables[outputVar] = results;
    helpers.setOutput({ count: results.length, topResult: results[0]?.text?.slice(0, 200) });
    return;
  }

  if (node.type === "generate_image") {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de imagen.");
    const prompt = interpolate(String(cfg.prompt ?? ""), ctx.variables);
    if (!prompt.trim()) throw new Error("Falta la descripción de la imagen.");
    const { generateImage } = await import("./ai/run");
    const res = await generateImage(workspaceId, model, {
      prompt,
      ...(cfg.size ? { size: String(cfg.size) } : {}),
    });
    const url = res.images[0]?.url ?? "";
    const outputVar = (cfg.outputVar as string) || "image";
    ctx.variables[outputVar] = url;
    // No metemos data URLs gigantes en el trace del paso.
    helpers.setOutput({ count: res.images.length, mime: res.images[0]?.mime });
    return;
  }

  if (node.type === "embed_text") {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de embeddings.");
    const text = interpolate(String(cfg.input ?? "{{message}}"), ctx.variables);
    const { embed } = await import("./ai/run");
    const res = await embed(workspaceId, model, [text]);
    const outputVar = (cfg.outputVar as string) || "vector";
    ctx.variables[outputVar] = res.vectors[0] ?? [];
    helpers.setOutput({ dims: res.vectors[0]?.length ?? 0 });
    return;
  }

  if (node.type === "integration") {
    // `integrationId` viene como "integrationId::action".
    const raw = String(cfg.integrationId ?? "");
    const [integrationId, action] = raw.split("::");
    if (!integrationId || !action) throw new Error("Falta elegir la app y la acción.");
    const input = (deepInterpolate(cfg.input ?? {}, ctx.variables) as Record<string, unknown>) ?? {};
    const { runIntegrationAction } = await import("./integrations/store");
    const result = await runIntegrationAction(workspaceId, integrationId, action, input);
    const outputVar = (cfg.outputVar as string) ?? "appResult";
    ctx.variables[outputVar] = result;
    helpers.setOutput({ result });
    return;
  }

  if (node.type === "spreadsheet") {
    const outputVar = (cfg.outputVar as string) ?? "result";
    // Formato nuevo: grilla de celdas. Legado: una sola fórmula.
    const grid = cfg.grid as { cells?: Record<string, string>; outputCell?: string } | undefined;
    if (grid && grid.cells && Object.keys(grid.cells).length > 0) {
      const { evaluateSheet } = await import("./flows/spreadsheet");
      const result = await evaluateSheet(grid.cells, ctx.variables, grid.outputCell);
      ctx.variables[outputVar] = result;
      helpers.setOutput({ [outputVar]: result });
      return;
    }
    const formula = String(cfg.formula ?? "").trim();
    if (!formula) throw new Error("Falta completar la planilla o escribir una fórmula.");
    const result = await runFormula(formula, ctx.variables);
    ctx.variables[outputVar] = result;
    helpers.setOutput({ [outputVar]: result });
    return;
  }

  if (node.type === "note") {
    // No hace nada: es un comentario visual.
    helpers.setOutput({});
    return;
  }

  if (node.type === "loop_for_each") {
    const itemVar = (cfg.itemVar as string) ?? "item";
    // `items` (registry) es un template tipo {{lista}} que resolvemos al array
    // real; `arrayVar` es el nombre de variable legado.
    const items =
      cfg.items !== undefined
        ? resolveValue(cfg.items, ctx.variables)
        : ctx.variables[(cfg.arrayVar as string) ?? "items"];
    if (!Array.isArray(items)) {
      throw new Error("La 'Lista' a repetir no es una lista. Revisá que apunte a un array.");
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
    const msg = (cfg.instructions as string) ?? (cfg.message as string) ?? "Se necesita una aprobación";
    ctx.variables["_pendingApproval"] = {
      message: interpolate(msg, ctx.variables),
      assignee: cfg.assignee,
    };
    helpers.setOutput({ paused: true });
    return;
  }

  throw new Error(`Unknown node type: ${node.type}`);
}
