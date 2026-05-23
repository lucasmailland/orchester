import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, inArray, lt, count } from "drizzle-orm";
import { llmCall } from "./llm-call";
import { enqueue, JOB_FLOW_RUN } from "./queue";
import { assertPublicUrl } from "./net-guard";
import { logWithContext, recordMetric } from "./observability";

/**
 * Única fuente de verdad de los tipos de nodo (A7): la unión se deriva de este
 * const, así no se duplica el listado. (El pgEnum `flow_node_type` del schema es
 * intencionalmente independiente para no acoplar una migración a este archivo;
 * mantenerlos en sync sigue siendo manual — ver el follow-up del executeNode
 * handler-map en docs/superpowers/audits.)
 */
export const FLOW_NODE_TYPES = [
  "trigger",
  "agent",
  "kb_search",
  "generate_image",
  "embed_text",
  "llm_prompt",
  "generate_video",
  "text_to_speech",
  "transcribe",
  "rerank",
  "generate_avatar",
  "generate_music",
  "ocr_extract",
  "condition",
  "switch",
  "http",
  "integration",
  "transform",
  "spreadsheet",
  "delay",
  "notify",
  "code",
  "loop_for_each",
  "parallel",
  "try_catch",
  "subflow",
  "wait_human",
  "note",
  "end",
] as const;

export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

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
 * Gate de seguridad para la ejecución de código/fórmulas arbitrarias.
 *
 * `node:vm` NO es una frontera de seguridad: desde adentro, `({}).constructor.
 * constructor("return process")()` escapa a Node completo (process.env con todos
 * los secretos, fs, red). Por eso la ejecución de código de usuario está
 * **deshabilitada por defecto** (fail-closed) y sólo se habilita explícitamente
 * en entornos que corren los flujos en un aislamiento real (proceso/worker
 * separado sin secretos en el env). Ver docs/superpowers/audits para el
 * follow-up de aislamiento out-of-process (atado a la cola de jobs).
 *
 * El chequeo vive acá (en la ejecución) y no sólo en la ruta API, para cubrir
 * TODOS los disparadores: manual, webhook y schedule.
 */
const CODE_EXECUTION_ENABLED = process.env.FLOW_CODE_EXECUTION === "1";

/**
 * B3 — Cap de concurrencia por flow. Antes de encolar un run nuevo contamos los
 * runs activos (`pending`/`running`) de ese flow; si llega al cap, rechazamos.
 * Evita que un trigger ruidoso (webhook en loop, schedule muy seguido) dispare
 * copias ilimitadas del mismo flow saturando providers/DB.
 * `0` o sin setear = sin límite. Default 25.
 */
const FLOW_MAX_CONCURRENT_RUNS_PER_FLOW = (() => {
  const raw = Number(process.env.FLOW_MAX_CONCURRENT_RUNS_PER_FLOW ?? 25);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
})();

/**
 * B7 — Tope de fan-out para nodos `parallel` y `loop_for_each`. Sin esto,
 * `Promise.all` sobre todas las ramas/items dispara N llamadas simultáneas a
 * providers/DB sin límite. Default 10.
 */
const FLOW_MAX_FANOUT = (() => {
  const raw = Number(process.env.FLOW_MAX_FANOUT ?? 10);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 10;
})();

/**
 * Corre `fn` sobre `items` con un límite de concurrencia, preservando el orden
 * de los resultados. Semántica de error idéntica a `Promise.all`: el primer
 * rechazo se propaga (y no se lanzan items nuevos después de un fallo).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}

function assertCodeExecutionAllowed(kind: "código JavaScript" | "fórmulas"): void {
  if (!CODE_EXECUTION_ENABLED) {
    throw new Error(
      `La ejecución de ${kind} está deshabilitada en este entorno por seguridad. ` +
        `Un administrador debe habilitar FLOW_CODE_EXECUTION=1, y sólo en un entorno ` +
        `con aislamiento de procesos (sin secretos en el environment).`
    );
  }
}

/**
 * Corre JavaScript de usuario en un sandbox `node:vm`. Recibe `input` (copia de
 * las variables del flujo) y devuelve lo que retorne el código. Con timeout.
 *
 * ADVERTENCIA: `node:vm` no aísla código malicioso (ver `assertCodeExecutionAllowed`).
 * Sólo se ejecuta si el operador habilitó explícitamente FLOW_CODE_EXECUTION.
 */
async function runUserJs(code: string, variables: Record<string, unknown>): Promise<unknown> {
  assertCodeExecutionAllowed("código JavaScript");
  const vm = await import("node:vm");
  const input = structuredClone(variables);
  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox.__input__ = input;
  const context = vm.createContext(sandbox);
  // El timeout de vm aplica al runInContext que invoca el script. Antes
  // ejecutábamos sólo la COMPILACIÓN de la función bajo timeout y la invocación
  // (`fn(input)`) corría fuera — un `while(true)` en el cuerpo del usuario
  // colgaba el worker. Ahora la IIFE se ejecuta dentro del mismo runInContext,
  // así el timeout cubre la ejecución del body.
  const script = new vm.Script(`(function(input){"use strict";\n${code}\n})(__input__)`);
  try {
    return script.runInContext(context, { timeout: 1000 });
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
  assertCodeExecutionAllowed("fórmulas");
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
  runId: existingRunId,
}: {
  flowId: string;
  workspaceId: string;
  triggerSource: string;
  input: Record<string, unknown>;
  onEvent?: FlowEmit;
  /**
   * Si se provee, la fila `flow_run` ya existe (creada por `enqueueFlowRun` con
   * estado `pending`) y sólo la transicionamos a `running`. Si no, la creamos
   * acá (ejecución inline, p.ej. dry-run interactivo). Reutilizar el runId hace
   * que un reintento del mismo job sea idempotente a nivel de pasos.
   */
  runId?: string;
}): Promise<{ runId: string; status: "succeeded" | "failed"; error?: string }> {
  const db = getDb();
  // Siempre re-verificamos que el flow pertenezca al workspace (defensa IDOR
  // incluso si el job fue encolado).
  const flowRows = await db
    .select()
    .from(schema.flows)
    .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
    .limit(1);
  const flow = flowRows[0];
  if (!flow) throw new Error("Flow not found");

  const runId = existingRunId ?? createId();
  const runStartedAt = Date.now(); // sólo para la métrica de duración (D2)
  if (existingRunId) {
    await db
      .update(schema.flowRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
  } else {
    await db.insert(schema.flowRuns).values({
      id: runId,
      flowId,
      workspaceId,
      status: "running",
      triggerSource,
      input,
    });
  }

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
    // C3: el cierre del run son dos escrituras relacionadas (status del run +
    // lastRunAt del flow). Las hacemos en una sola transacción para que un crash
    // no deje el run en `succeeded` con el `lastRunAt` del flow desincronizado.
    // Es atómico y barato (sin llamadas externas adentro). El reaper cubre el
    // caso en que el proceso muera ANTES de llegar acá (run queda en `running`).
    await db.transaction(async (tx) => {
      await tx
        .update(schema.flowRuns)
        .set({ status: "succeeded", output: ctx.variables, completedAt: new Date() })
        .where(eq(schema.flowRuns.id, runId));
      await tx.update(schema.flows).set({ lastRunAt: new Date() }).where(eq(schema.flows.id, flowId));
    });
    onEvent?.({ type: "run_finish", status: "succeeded" });
    recordMetric("flow.run.duration_ms", Date.now() - runStartedAt, { flowId, status: "succeeded" });
    return { runId, status: "succeeded" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.flowRuns)
      .set({ status: "failed", error: msg, completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    onEvent?.({ type: "run_finish", status: "failed", error: msg });
    recordMetric("flow.run.duration_ms", Date.now() - runStartedAt, { flowId, status: "failed" });
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
  // Log correlacionado por `runId` para trazar pasos en logs (D1).
  logWithContext("info", "flow step start", { correlationId: runId, runId, nodeId: node.id, nodeType: node.type });

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
    logWithContext("info", "flow step finish", { correlationId: runId, runId, nodeId: node.id, status: "succeeded" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.flowRunSteps)
      .set({ status: "failed", error: msg, completedAt: new Date() })
      .where(eq(schema.flowRunSteps.id, stepId));
    ctx.emit?.({ type: "step_finish", nodeId: node.id, status: "failed", error: msg });
    logWithContext("error", "flow step finish", { correlationId: runId, runId, nodeId: node.id, status: "failed", error: msg });
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

/**
 * A7: el ejecutor por nodo es un mapa `Record<FlowNodeType, NodeHandler>` en vez
 * de una if-chain. Beneficios:
 *   - Si se agrega un FlowNodeType nuevo y se olvida el handler, falla en
 *     compile-time (Record exhaustivo sobre `Exclude<FlowNodeType, "end">`).
 *   - Cada nodo es una función nombrada y aislada, fácil de leer/extender/testear.
 *
 * "end" se filtra antes (en `runFromNode`), por eso queda excluido del Record.
 */
interface NodeHandlerArgs {
  node: FlowNode;
  ctx: RunContext;
  runId: string;
  workspaceId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  db: ReturnType<typeof getDb>;
  depth: number;
  helpers: ExecHelpers;
  cfg: Record<string, unknown>;
}
type NodeHandler = (args: NodeHandlerArgs) => Promise<void>;

const NODE_HANDLERS: Record<Exclude<FlowNodeType, "end">, NodeHandler> = {
  trigger: async () => {
    // No-op: el nodo trigger sólo marca el punto de entrada del flow.
  },

  agent: async ({ cfg, ctx, workspaceId, db, helpers }) => {
    const agentId = cfg.agentId as string | undefined;
    if (!agentId) throw new Error("Falta elegir el agente en este paso.");
    // `prompt` (registry) se antepone al mensaje entrante; `message` es el legado.
    const extra = cfg.prompt ? interpolate(cfg.prompt as string, ctx.variables) : "";
    const incoming = interpolate((cfg.message as string) ?? "{{message}}", ctx.variables);
    const userMessage = [extra, incoming].filter((s) => s && s.trim()).join("\n\n") || incoming;
    const aRows = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
    const agent = aRows[0];
    if (!agent) throw new Error(`agent not found: ${agentId}`);
    // Este nodo usa `llmCall` directo (no runChat), así que el guard y el
    // metering se hacen acá explícitamente (D4-1 / E3-1).
    const { assertWithinSpend } = await import("./cost-alerts");
    await assertWithinSpend(workspaceId);
    const result = await llmCall({
      workspaceId,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      temperature: agent.temperature ? Number(agent.temperature) : 0.7,
      ...(agent.maxTokens != null && { maxTokens: agent.maxTokens }),
    });
    const { recordAiUsage } = await import("./ai/run");
    const { calculateChatCostUsd } = await import("./pricing");
    await recordAiUsage({
      workspaceId,
      capability: "chat",
      model: result.model,
      tokensOut: result.tokensUsed,
      tokensTotal: result.tokensUsed,
      costUsd: calculateChatCostUsd(result.model, 0, result.tokensUsed),
    });
    const outputVar = (cfg.outputVar as string) ?? "agentResult";
    ctx.variables[outputVar] = result.content;
    helpers.setOutput({ content: result.content, tokensUsed: result.tokensUsed });
  },

  condition: async ({ cfg, ctx, helpers }) => {
    // Acepta el formato nuevo del registry (left/op/right planos) o el legado
    // ({ condition: { left, op, right } }).
    const flat = cfg.condition
      ? (cfg.condition as Condition)
      : ({ left: cfg.left, op: cfg.op, right: cfg.right } as Condition);
    if (!flat.op) throw new Error("Falta elegir la comparación en este paso.");
    const passed = evaluateCondition(flat, ctx.variables);
    helpers.setHandle(passed ? "true" : "false");
    helpers.setOutput({ passed });
  },

  switch: async ({ cfg, ctx, helpers, edges, node }) => {
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
  },

  http: async ({ cfg, ctx, helpers }) => {
    const method = ((cfg.method as string) ?? "GET").toUpperCase();
    const url = interpolate(cfg.url as string, ctx.variables);
    // Guard SSRF: bloquea IPs privadas, loopback, link-local y el endpoint de
    // metadata cloud (169.254.169.254). Opt-out explícito para self-hosters que
    // necesiten llamar servicios internos.
    if (process.env.ALLOW_PRIVATE_HTTP !== "1") {
      try {
        assertPublicUrl(url);
      } catch (e) {
        throw new Error(
          `La URL no está permitida por seguridad: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
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
  },

  transform: async ({ cfg, ctx, helpers }) => {
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
  },

  delay: async ({ cfg, helpers }) => {
    // `duration` ("30s"/"5m"…) en el registry; `ms` numérico legado.
    const ms = Math.min(60_000, cfg.duration !== undefined ? parseDuration(cfg.duration) : Number(cfg.ms ?? 1000));
    await new Promise((res) => setTimeout(res, ms));
    helpers.setOutput({ ms });
  },

  notify: async ({ cfg, ctx, helpers }) => {
    helpers.setOutput({
      to: cfg.to ? interpolate(cfg.to as string, ctx.variables) : undefined,
      channel: cfg.channel,
      message: interpolate((cfg.message as string) ?? "", ctx.variables),
    });
  },

  code: async ({ cfg, ctx, helpers }) => {
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
  },

  kb_search: async ({ cfg, ctx, workspaceId, helpers }) => {
    const kbId = cfg.kbId as string | undefined;
    if (!kbId) throw new Error("Falta elegir la base de conocimiento.");
    const query = interpolate((cfg.query as string) ?? "{{message}}", ctx.variables);
    const topK = cfg.topK != null ? Number(cfg.topK) : 5;
    const { searchKnowledgeBase } = await import("./knowledge-search");
    const results = await searchKnowledgeBase(workspaceId, kbId, query, topK);
    const outputVar = (cfg.outputVar as string) ?? "knowledge";
    ctx.variables[outputVar] = results;
    helpers.setOutput({ count: results.length, topResult: results[0]?.text?.slice(0, 200) });
  },

  generate_image: async ({ cfg, ctx, workspaceId, helpers }) => {
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
  },

  embed_text: async ({ cfg, ctx, workspaceId, helpers }) => {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de embeddings.");
    const text = interpolate(String(cfg.input ?? "{{message}}"), ctx.variables);
    const { embed } = await import("./ai/run");
    const res = await embed(workspaceId, model, [text]);
    const outputVar = (cfg.outputVar as string) || "vector";
    ctx.variables[outputVar] = res.vectors[0] ?? [];
    helpers.setOutput({ dims: res.vectors[0]?.length ?? 0 });
  },

  llm_prompt: async ({ cfg, ctx, workspaceId, helpers }) => {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo.");
    const prompt = interpolate(String(cfg.prompt ?? ""), ctx.variables);
    if (!prompt.trim()) throw new Error("Falta la instrucción.");
    const system = cfg.system ? interpolate(String(cfg.system), ctx.variables) : "";
    const { runChat } = await import("./ai/run");
    const res = await runChat({ workspaceId, model, systemPrompt: system, messages: [{ role: "user", content: prompt }] });
    const outputVar = (cfg.outputVar as string) || "texto";
    ctx.variables[outputVar] = res.content;
    helpers.setOutput({ tokensUsed: res.tokensUsed });
  },

  generate_video: async ({ cfg, ctx, workspaceId, helpers }) => {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de video.");
    const prompt = interpolate(String(cfg.prompt ?? ""), ctx.variables);
    const { generateVideo } = await import("./ai/run");
    const res = await generateVideo(workspaceId, model, prompt);
    ctx.variables[(cfg.outputVar as string) || "video"] = res.url;
    helpers.setOutput({ url: res.url });
  },

  text_to_speech: async ({ cfg, ctx, workspaceId, helpers }) => {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de voz.");
    const text = interpolate(String(cfg.text ?? ""), ctx.variables);
    if (!text.trim()) throw new Error("Falta el texto a decir.");
    const { textToSpeech } = await import("./ai/run");
    const res = await textToSpeech(workspaceId, model, text, cfg.voice ? String(cfg.voice) : undefined);
    ctx.variables[(cfg.outputVar as string) || "audio"] = res.url;
    helpers.setOutput({ url: res.url });
  },

  transcribe: async ({ cfg, ctx, workspaceId, helpers }) => {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de transcripción.");
    const audioUrl = interpolate(String(cfg.audioUrl ?? ""), ctx.variables);
    if (!audioUrl.trim()) throw new Error("Falta la URL del audio.");
    const { transcribe } = await import("./ai/run");
    const res = await transcribe(workspaceId, model, audioUrl);
    ctx.variables[(cfg.outputVar as string) || "texto"] = res.text;
    helpers.setOutput({ chars: res.text.length });
  },

  generate_avatar: async ({ cfg, ctx, workspaceId, helpers }) => {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de avatar.");
    const text = interpolate(String(cfg.text ?? ""), ctx.variables);
    if (!text.trim()) throw new Error("Falta el texto que dirá el avatar.");
    const { generateAvatar } = await import("./ai/run");
    const res = await generateAvatar(workspaceId, model, {
      text,
      ...(cfg.avatarId ? { avatarId: String(cfg.avatarId) } : {}),
      ...(cfg.voiceId ? { voiceId: String(cfg.voiceId) } : {}),
      ...(cfg.imageUrl ? { imageUrl: interpolate(String(cfg.imageUrl), ctx.variables) } : {}),
    });
    ctx.variables[(cfg.outputVar as string) || "video"] = res.url;
    helpers.setOutput({ url: res.url });
  },

  generate_music: async ({ cfg, ctx, workspaceId, helpers }) => {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de música.");
    const prompt = interpolate(String(cfg.prompt ?? ""), ctx.variables);
    const { generateMusic } = await import("./ai/run");
    const res = await generateMusic(workspaceId, model, prompt);
    ctx.variables[(cfg.outputVar as string) || "musica"] = res.url;
    helpers.setOutput({ url: res.url });
  },

  ocr_extract: async ({ cfg, ctx, workspaceId, helpers }) => {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de OCR.");
    const documentUrl = interpolate(String(cfg.documentUrl ?? ""), ctx.variables);
    if (!documentUrl.trim()) throw new Error("Falta la URL del documento.");
    const { ocr } = await import("./ai/run");
    const res = await ocr(workspaceId, model, documentUrl);
    ctx.variables[(cfg.outputVar as string) || "texto"] = res.text;
    helpers.setOutput({ chars: res.text.length });
  },

  rerank: async ({ cfg, ctx, workspaceId, helpers }) => {
    const model = String(cfg.model ?? "");
    if (!model) throw new Error("Falta elegir el modelo de rerank.");
    const query = interpolate(String(cfg.query ?? ""), ctx.variables);
    const docsRaw = resolveValue(cfg.documents, ctx.variables);
    const documents = Array.isArray(docsRaw) ? docsRaw.map((d) => String(d)) : [];
    if (documents.length === 0) throw new Error("La 'Lista de textos' tiene que ser una lista con elementos.");
    const { rerank } = await import("./ai/run");
    const res = await rerank(workspaceId, model, query, documents, cfg.topN ? Number(cfg.topN) : undefined);
    ctx.variables[(cfg.outputVar as string) || "ranked"] = res.results;
    helpers.setOutput({ count: res.results.length });
  },

  integration: async ({ cfg, ctx, workspaceId, helpers }) => {
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
  },

  spreadsheet: async ({ cfg, ctx, helpers }) => {
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
  },

  note: async ({ helpers }) => {
    // No hace nada: es un comentario visual.
    helpers.setOutput({});
  },

  loop_for_each: async ({ cfg, ctx, edges, node, nodes, runId, workspaceId, db, depth, helpers }) => {
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
  },

  parallel: async ({ edges, node, nodes, ctx, runId, workspaceId, db, depth, helpers }) => {
    const branchEdges = edges.filter((e) => e.source === node.id);
    // B7: fan-out acotado. Antes era `Promise.all` sobre TODAS las ramas a la
    // vez (concurrencia ilimitada hacia providers/DB). Mismo orden de resultados
    // y misma semántica de error (el primer fallo se propaga).
    await mapWithConcurrency(branchEdges, FLOW_MAX_FANOUT, (ed) =>
      runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1)
    );
    helpers.setOutput({ branches: branchEdges.length });
    helpers.skipChildren();
  },

  try_catch: async ({ cfg, edges, node, nodes, ctx, runId, workspaceId, db, depth, helpers }) => {
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
  },

  subflow: async ({ cfg, ctx, workspaceId, runId, db, helpers }) => {
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
  },

  wait_human: async ({ cfg, ctx, helpers }) => {
    const msg = (cfg.instructions as string) ?? (cfg.message as string) ?? "Se necesita una aprobación";
    ctx.variables["_pendingApproval"] = {
      message: interpolate(msg, ctx.variables),
      assignee: cfg.assignee,
    };
    helpers.setOutput({ paused: true });
  },
};

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
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const handler = NODE_HANDLERS[node.type as Exclude<FlowNodeType, "end">];
  if (!handler) throw new Error(`Unknown node type: ${node.type}`);
  await handler({ node, ctx, runId, workspaceId, nodes, edges, db, depth, helpers, cfg });
}

/**
 * Encola un flow para ejecución asíncrona en el worker (pg-boss). Crea la fila
 * `flow_run` en estado `pending` y devuelve el `runId` para que el cliente haga
 * polling de `/api/flow-runs/:id`. Re-verifica ownership del flow (defensa IDOR).
 *
 * Por qué async: ejecutar flows inline en el request bloquea un slot HTTP por
 * minutos (polling de video/avatar) y muere por timeout de serverless dejando
 * runs colgados. La cola lo saca del request loop y escala horizontalmente.
 *
 * En dev sin worker, poné FLOW_RUN_INLINE=1 para ejecutar inline.
 */
export async function enqueueFlowRun({
  flowId,
  workspaceId,
  triggerSource,
  input,
}: {
  flowId: string;
  workspaceId: string;
  triggerSource: string;
  input: Record<string, unknown>;
}): Promise<{ runId: string; status: "pending" | "succeeded" | "failed"; error?: string }> {
  const db = getDb();
  const flowRows = await db
    .select({ id: schema.flows.id })
    .from(schema.flows)
    .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
    .limit(1);
  if (!flowRows[0]) throw new Error("Flow not found");

  // B3: cap de concurrencia por flow. Una sola query de count de runs activos.
  if (FLOW_MAX_CONCURRENT_RUNS_PER_FLOW > 0) {
    const activeRows = await db
      .select({ value: count() })
      .from(schema.flowRuns)
      .where(
        and(
          eq(schema.flowRuns.flowId, flowId),
          inArray(schema.flowRuns.status, ["running", "pending"])
        )
      );
    const active = activeRows[0]?.value ?? 0;
    if (active >= FLOW_MAX_CONCURRENT_RUNS_PER_FLOW) {
      throw new Error(
        `Este flujo ya tiene ${active} ejecuciones activas (máximo ${FLOW_MAX_CONCURRENT_RUNS_PER_FLOW}). ` +
          `Esperá a que terminen algunas antes de lanzar otra.`
      );
    }
  }

  const runId = createId();
  await db.insert(schema.flowRuns).values({
    id: runId,
    flowId,
    workspaceId,
    status: "pending",
    triggerSource,
    input,
  });

  // Fallback inline opcional para dev/test sin worker corriendo.
  if (process.env.FLOW_RUN_INLINE === "1") {
    return executeFlow({ runId, flowId, workspaceId, triggerSource, input });
  }

  try {
    await enqueue(
      JOB_FLOW_RUN,
      { runId, flowId, workspaceId, triggerSource, input },
      // retryLimit 0: NO reintentamos el flow completo automáticamente, para no
      // re-disparar side-effects (http POST, notify, integraciones, IA paga).
      // Los fallos transitorios se reintentan a nivel de llamada externa.
      { retryLimit: 0, singletonKey: runId }
    );
  } catch (e) {
    // Si la cola no está disponible, marcamos el run como failed con un mensaje
    // claro en vez de dejarlo colgado en `pending` para siempre.
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.flowRuns)
      .set({ status: "failed", error: `No se pudo encolar la ejecución: ${msg}`, completedAt: new Date() })
      .where(eq(schema.flowRuns.id, runId));
    throw e;
  }

  return { runId, status: "pending" };
}

/**
 * Reaper de runs huérfanos: marca como `failed` los runs (y sus pasos) que
 * quedaron en `running`/`pending` más allá de `maxAgeMs` (crash del worker,
 * timeout de serverless, OOM, deploy). Lo corre el worker periódicamente.
 * Sin esto, un run interrumpido queda en `running` para siempre.
 */
export async function reapStaleRuns(maxAgeMs = 15 * 60_000): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await db
    .select({ id: schema.flowRuns.id })
    .from(schema.flowRuns)
    .where(
      and(
        inArray(schema.flowRuns.status, ["running", "pending"]),
        lt(schema.flowRuns.startedAt, cutoff)
      )
    );
  if (stale.length === 0) return 0;
  const ids = stale.map((r) => r.id);
  const err = "La ejecución se interrumpió (timeout o reinicio del worker) y fue marcada como fallida.";
  await db
    .update(schema.flowRuns)
    .set({ status: "failed", error: err, completedAt: new Date() })
    .where(inArray(schema.flowRuns.id, ids));
  await db
    .update(schema.flowRunSteps)
    .set({ status: "failed", error: err, completedAt: new Date() })
    .where(and(inArray(schema.flowRunSteps.runId, ids), eq(schema.flowRunSteps.status, "running")));
  return ids.length;
}
