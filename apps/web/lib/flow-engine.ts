import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and, inArray, lt, count, sql } from "drizzle-orm";
import { llmCall, type ChatMessage } from "./llm-call";
import { enqueue, JOB_FLOW_RUN } from "./queue";
import { assertPublicUrl } from "./net-guard";
import { logWithContext, recordMetric } from "./observability";
import { evaluateExpression } from "./flows/filters";
import { parseRetryConfig, runWithRetry, StepFailure } from "./flows/retry";
import { createApprovalToken, PauseRequested } from "./flows/pause";
import { isDryRunSource, markDryRun, simulated } from "./flows/dry-run";

/**
 * R2-C: Flow execution writes to tenant tables (flow_runs,
 * flow_run_steps) and reads from many others (agents, knowledge bases,
 * integrations). Every query MUST run inside a transaction with
 * `app.workspace_id` SET LOCAL or FORCE RLS rejects it.
 *
 * We deliberately do NOT wrap the entire `executeFlow` body in one big
 * transaction — flow runs can take minutes (delay nodes, long HTTP
 * calls, model polling) and a multi-minute open txn holds a pool
 * connection + locks the entire time. Instead we open SHORT
 * workspace-scoped transactions per phase (lifecycle write, node
 * helper call) via `withFlowTx`.
 */
type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export async function withFlowTx<T>(workspaceId: string, fn: (tx: WsDb) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Phase F.2 fix (post-2026-05-26): match `withTenantContext` and
    // `withWorkspaceTx` in `tenant/context.ts` by downgrading the tx
    // to `app_user` BEFORE setting the GUC. Without this, when the
    // connection role is `rolbypassrls=t` (the deployed `orchester`
    // role per 2026-05-24 audit P0), FORCE RLS is bypassed entirely
    // and the GUC is decorative. The inline `executeFlow` path is the
    // only place a flow run is reached without going through
    // `withWorkspaceTx`/`withTenantContext` first, so it's the only
    // surface that was still exposed to this gap.
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

export { FLOW_NODE_TYPES, type FlowNodeType } from "./flows/node-types";
import type { FlowNodeType } from "./flows/node-types";
import { assertCodeExecutionAllowed } from "@/lib/flows/code-execution";

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
  // `paused` closes the stream like a final state, but the run has not ended:
  // someone must decide. Listeners — the UI or an SSE consumer — must
  // distinguish it from `succeeded`, or show pending work as completed.
  | { type: "run_finish"; status: "succeeded" | "failed" | "paused"; error?: string };

export type FlowEmit = (ev: FlowRunEvent) => void;

export interface RunContext {
  variables: Record<string, unknown>;
  output: Record<string, unknown>;
  /** Hook opcional para emitir eventos en vivo. */
  emit?: FlowEmit;
  /** Signal de cancelación (F-1/F-B1). Si abort, el motor para entre pasos. */
  signal?: AbortSignal;
  /**
   * Dry run: steps that read still execute (real context is the point), steps
   * that write are reported as `wouldCall` and skipped. See `lib/flows/dry-run`.
   */
  dryRun?: boolean;
}

/**
 * The user message an Agent step sends to its model.
 *
 * `prompt` (registry) goes before the incoming message; `message` is the
 * legacy field and defaults to `{{message}}`. When both come out empty the
 * step fails here instead of calling the provider: Bedrock answers
 * "user messages must have non-empty content", which says nothing about which
 * step or which input is missing.
 */
export function buildAgentUserMessage(
  cfg: Record<string, unknown>,
  variables: Record<string, unknown>
): string {
  const extra = cfg.prompt ? interpolate(cfg.prompt as string, variables) : "";
  const incoming = interpolate((cfg.message as string) ?? "{{message}}", variables);
  const message = [extra, incoming].filter((part) => part && part.trim()).join("\n\n");
  if (!message.trim()) {
    throw new Error(
      "El paso Agent no recibió ningún mensaje: `message` está vacío. Si el flujo arranca a mano, completá `message` al ejecutarlo, o escribí un Prompt en el paso."
    );
  }
  return message;
}

export function interpolate(template: string, ctx: Record<string, unknown>): string {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const v = evaluateExpression(expr.trim(), ctx);
    if (v == null) return "";
    // Objects and arrays as JSON: an http step parses JSON responses and
    // kb_search leaves an array of results, and String() turned both into the
    // literal "[object Object]" inside prompts and request bodies.
    return typeof v === "object" ? JSON.stringify(v) : String(v);
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
  if (m) return evaluateExpression(m[1]!.trim(), ctx);
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
  signal,
  dryRun: dryRunOpt,
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
  /**
   * F-1/F-B1: signal de cancelación. Si se aborta, el motor para entre pasos,
   * marca el run como `cancelled` y retorna. Usado por (a) SSE `/run-stream`
   * para cortar al desconectarse el cliente, (b) agente `kind=flow` y channels
   * para acotar el tiempo de respuesta inline.
   */
  signal?: AbortSignal;
  /**
   * Run without side effects (see `RunContext.dryRun`). When omitted it is
   * read from `triggerSource`, so a run queued as a dry run stays one when the
   * worker picks it up.
   */
  dryRun?: boolean;
}): Promise<{
  runId: string;
  /** `paused` is not final: the run is waiting for a person and will continue. */
  status: "succeeded" | "failed" | "cancelled" | "paused";
  error?: string;
  /** Only with `paused`: the secret that permits approval or rejection. */
  approvalToken?: string;
}> {
  // R2-C: re-verify flow ownership + create/transition flow_run all under
  // the workspace GUC (FORCE RLS).
  const flow = await withFlowTx(workspaceId, async (tx) => {
    const flowRows = await tx
      .select()
      .from(schema.flows)
      .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
      .limit(1);
    return flowRows[0];
  });
  if (!flow) throw new Error("Flow not found");

  const dryRun = dryRunOpt ?? isDryRunSource(triggerSource);
  const runId = existingRunId ?? createId();
  const runStartedAt = Date.now(); // sólo para la métrica de duración (D2)
  await withFlowTx(workspaceId, async (tx) => {
    if (existingRunId) {
      await tx
        .update(schema.flowRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(schema.flowRuns.id, runId));
    } else {
      await tx.insert(schema.flowRuns).values({
        id: runId,
        flowId,
        workspaceId,
        status: "running",
        triggerSource: dryRun ? markDryRun(triggerSource) : triggerSource,
        input,
      });
    }
  });
  const db = getDb(); // used as the cross-step fallback for legacy node handlers

  onEvent?.({ type: "run_start", runId });

  const ctx: RunContext = {
    variables: { ...(flow.variables ?? {}), ...input },
    output: {},
    ...(onEvent ? { emit: onEvent } : {}),
    ...(signal ? { signal } : {}),
    ...(dryRun ? { dryRun: true } : {}),
  };

  const nodes = (flow.nodes ?? []) as FlowNode[];
  const edges = (flow.edges ?? []) as FlowEdge[];
  const start = nodes.find((n) => n.type === "trigger");
  if (!start) {
    const err =
      "Este flujo no tiene un paso de inicio (disparador). Agregá uno para poder ejecutarlo.";
    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRuns)
        .set({ status: "failed", error: err, completedAt: new Date() })
        .where(eq(schema.flowRuns.id, runId))
    );
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
    await withFlowTx(workspaceId, async (tx) => {
      await tx
        .update(schema.flowRuns)
        .set({ status: "succeeded", output: ctx.variables, completedAt: new Date() })
        .where(eq(schema.flowRuns.id, runId));
      // A dry run is not a run of the flow: it must not move `lastRunAt`.
      if (!dryRun) {
        await tx
          .update(schema.flows)
          .set({ lastRunAt: new Date() })
          .where(eq(schema.flows.id, flowId));
      }
    });
    onEvent?.({ type: "run_finish", status: "succeeded" });
    recordMetric("flow.run.duration_ms", Date.now() - runStartedAt, {
      flowId,
      status: "succeeded",
    });
    return { runId, status: "succeeded" };
  } catch (e) {
    // The run reached a `wait_human`. It has not finished: it is waiting for
    // a person, perhaps for days. Save where to resume — the node and ALL
    // context, because the position lived on the stack and cannot survive
    // the process — and release the job. When someone decides, the run
    // continues in another process.
    if (e instanceof PauseRequested) {
      const token = createApprovalToken(workspaceId);
      await withFlowTx(workspaceId, (tx) =>
        tx
          .update(schema.flowRuns)
          .set({
            status: "paused",
            pausedNodeId: e.nodeId,
            pausedVariables: ctx.variables,
            pausedAt: new Date(),
            approvalToken: token,
          })
          .where(eq(schema.flowRuns.id, runId))
      );
      onEvent?.({ type: "run_finish", status: "paused" });
      recordMetric("flow.run.duration_ms", Date.now() - runStartedAt, {
        flowId,
        status: "paused",
      });
      logWithContext("info", "flow run paused", {
        correlationId: runId,
        runId,
        nodeId: e.nodeId,
      });
      // Notify AFTER persisting, and never throw. If the channel is down,
      // the pause is already saved and the message can be resent; reversing
      // this would let an intermittent Telegram connection fail healthy runs.
      // A dry run never notifies: that is a message to a real person.
      if (e.notification && !dryRun) {
        const { notifyPause } = await import("./flows/notify-pause");
        await notifyPause(workspaceId, runId, token, e.approvalMessage, e.notification);
      }
      return { runId, status: "paused", approvalToken: token };
    }
    // F-B1/F-1: si la causa fue un abort (cliente desconectado o timeout
    // inline), marcamos `cancelled` (no `failed`) para que las métricas no
    // cuenten esto como un error del flujo en sí.
    const cancelled = signal?.aborted === true || (e instanceof Error && e.name === "AbortError");
    const msg = e instanceof Error ? e.message : String(e);
    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRuns)
        .set({
          status: cancelled ? "cancelled" : "failed",
          error: msg,
          completedAt: new Date(),
        })
        .where(eq(schema.flowRuns.id, runId))
    );
    onEvent?.({ type: "run_finish", status: "failed", error: msg });
    recordMetric("flow.run.duration_ms", Date.now() - runStartedAt, {
      flowId,
      status: cancelled ? "cancelled" : "failed",
    });
    return { runId, status: cancelled ? "cancelled" : "failed", error: msg };
  }
}

/**
 * Continues a run paused at a `wait_human`, from that node's outgoing edges.
 *
 * The decision selects the path: `wait_human` branches like a `condition`,
 * with `aprobado` and `rechazado` outputs. That makes the pause useful — if
 * it always took the same path, rejection and approval would be identical.
 *
 * Context comes from `pausedVariables` and is not recalculated: rerunning
 * the flow from the start would repeat effects that already happened
 * (written notes, sent messages), exactly what a pause must prevent.
 */
export async function resumePausedFlow({
  runId,
  workspaceId,
  flowId,
  fromNodeId,
  variables,
  decision,
  dryRun = false,
}: {
  runId: string;
  workspaceId: string;
  flowId: string;
  fromNodeId: string;
  variables: Record<string, unknown>;
  decision: "aprobado" | "rechazado";
  /** A run paused as a dry run keeps being one after the decision. */
  dryRun?: boolean;
}): Promise<{ runId: string; status: "succeeded" | "failed" | "paused" }> {
  const flow = await withFlowTx(workspaceId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.flows)
      .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
      .limit(1);
    return rows[0];
  });
  if (!flow) throw new Error("Flow not found");

  const db = getDb();
  const nodes = (flow.nodes ?? []) as FlowNode[];
  const edges = (flow.edges ?? []) as FlowEdge[];
  const ctx: RunContext = {
    variables: { ...variables, _decision: decision },
    output: {},
    ...(dryRun ? { dryRun: true } : {}),
  };

  const outgoingEdges = edges.filter(
    (e) => e.source === fromNodeId && (e.sourceHandle ?? "aprobado") === decision
  );

  try {
    for (const ed of outgoingEdges) {
      await runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db);
    }
    await withFlowTx(workspaceId, async (tx) => {
      await tx
        .update(schema.flowRuns)
        .set({ status: "succeeded", output: ctx.variables, completedAt: new Date() })
        .where(eq(schema.flowRuns.id, runId));
      if (!dryRun) {
        await tx
          .update(schema.flows)
          .set({ lastRunAt: new Date() })
          .where(eq(schema.flows.id, flowId));
      }
    });
    return { runId, status: "succeeded" };
  } catch (e) {
    // A flow can have two consecutive approvals. Save the second pause just
    // like the first, with a new token.
    if (e instanceof PauseRequested) {
      const token = createApprovalToken(workspaceId);
      await withFlowTx(workspaceId, (tx) =>
        tx
          .update(schema.flowRuns)
          .set({
            status: "paused",
            pausedNodeId: e.nodeId,
            pausedVariables: ctx.variables,
            pausedAt: new Date(),
            approvalToken: token,
          })
          .where(eq(schema.flowRuns.id, runId))
      );
      return { runId, status: "paused" };
    }
    const msg = e instanceof Error ? e.message : String(e);
    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRuns)
        .set({ status: "failed", error: msg, completedAt: new Date() })
        .where(eq(schema.flowRuns.id, runId))
    );
    return { runId, status: "failed" };
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
  // F-1/F-B1: chequeamos el signal antes de cada paso. Si abortó, propagamos
  // un AbortError → executeFlow lo cataloga como `cancelled` (no `failed`).
  if (ctx.signal?.aborted) {
    const e = new Error("Flow execution cancelled");
    e.name = "AbortError";
    throw e;
  }
  const node = nodes.find((n) => n.id === nodeId);
  if (!node || node.type === "end") return;

  const stepId = createId();
  await withFlowTx(workspaceId, (tx) =>
    tx.insert(schema.flowRunSteps).values({
      id: stepId,
      runId,
      nodeId: node.id,
      nodeType: node.type,
      status: "running",
      input: { ...ctx.variables },
    })
  );
  ctx.emit?.({ type: "step_start", nodeId: node.id, nodeType: node.type });
  // Log correlacionado por `runId` para trazar pasos en logs (D1).
  logWithContext("info", "flow step start", {
    correlationId: runId,
    runId,
    nodeId: node.id,
    nodeType: node.type,
  });

  let nextHandle: string | undefined;
  let stepOutput: Record<string, unknown> = {};
  let stepTrace: StepTrace = {};
  // Drizzle's numeric maps to string; undefined fields are left out of the SET.
  const traceColumns = () => ({
    ...(stepTrace.agentId !== undefined && { agentId: stepTrace.agentId }),
    ...(stepTrace.agentName !== undefined && { agentName: stepTrace.agentName }),
    ...(stepTrace.model !== undefined && { model: stepTrace.model }),
    ...(stepTrace.tokensUsed !== undefined && { tokensUsed: stepTrace.tokensUsed }),
    ...(stepTrace.costUsd !== undefined && {
      costUsd: stepTrace.costUsd == null ? null : String(stepTrace.costUsd),
    }),
  });

  try {
    await executeNode(node, ctx, runId, workspaceId, nodes, edges, db, depth, {
      setHandle: (h) => {
        nextHandle = h;
      },
      setOutput: (o) => {
        stepOutput = o;
      },
      setTrace: (t) => {
        stepTrace = { ...stepTrace, ...t };
      },
    });

    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRunSteps)
        .set({
          status: "succeeded",
          output: stepOutput,
          completedAt: new Date(),
          ...traceColumns(),
        })
        .where(eq(schema.flowRunSteps.id, stepId))
    );
    ctx.emit?.({ type: "step_finish", nodeId: node.id, status: "succeeded" });
    logWithContext("info", "flow step finish", {
      correlationId: runId,
      runId,
      nodeId: node.id,
      status: "succeeded",
    });
  } catch (e) {
    // A pause is not a failure: `wait_human` did exactly what it should.
    // Marking it `failed` would pollute the history and make flows waiting
    // for a person look broken, even though that is the normal case.
    if (e instanceof PauseRequested) {
      await withFlowTx(workspaceId, (tx) =>
        tx
          .update(schema.flowRunSteps)
          .set({
            status: "succeeded",
            output: { paused: true, mensaje: e.approvalMessage },
            completedAt: new Date(),
          })
          .where(eq(schema.flowRunSteps.id, stepId))
      );
      ctx.emit?.({ type: "step_finish", nodeId: node.id, status: "succeeded" });
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRunSteps)
        .set({
          status: "failed",
          error: msg,
          ...(e instanceof StepFailure ? { output: e.output } : {}),
          completedAt: new Date(),
          // A failed AI step that already spent tokens must still show them.
          ...traceColumns(),
        })
        .where(eq(schema.flowRunSteps.id, stepId))
    );
    ctx.emit?.({ type: "step_finish", nodeId: node.id, status: "failed", error: msg });
    logWithContext("error", "flow step finish", {
      correlationId: runId,
      runId,
      nodeId: node.id,
      status: "failed",
      error: msg,
    });
    throw e;
  }

  const outgoing = edges.filter(
    (e) => e.source === node.id && (nextHandle == null || e.sourceHandle === nextHandle)
  );
  for (const ed of outgoing) {
    await runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
  }
}

/**
 * What an AI step reports about itself, persisted on the step row. Recorded
 * there (not derived from the flow graph) because the graph can be edited after
 * the run. `agentName` is a snapshot so the trail survives renames/deletions.
 */
export type StepTrace = {
  agentId?: string | null;
  agentName?: string | null;
  model?: string | null;
  tokensUsed?: number | null;
  costUsd?: number | null;
};

interface ExecHelpers {
  setHandle: (h: string) => void;
  setOutput: (o: Record<string, unknown>) => void;
  setTrace: (t: StepTrace) => void;
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

/**
 * La firma de una respuesta del modelo: quién la escribió, con qué y a qué costo.
 *
 * Se expone como `{{<salida>Meta}}` para que un paso pueda estamparla en lo que
 * escribe. `model` es el modelo que EFECTIVAMENTE contestó, no el configurado:
 * si hubo fallback, registrar el elegido sería mentir justo cuando más importa
 * saberlo.
 */
function firma(
  res: { model: string; tokensUsed: number },
  cargo: { tokensIn: number; tokensOut: number; costUsd: number },
  agentName?: string
): Record<string, unknown> {
  return {
    ...(agentName ? { agent: agentName } : {}),
    model: res.model,
    tokensIn: cargo.tokensIn,
    tokensOut: cargo.tokensOut,
    tokensUsed: res.tokensUsed,
    costUsd: cargo.costUsd,
    at: new Date().toISOString(),
  };
}

const NODE_HANDLERS: Record<Exclude<FlowNodeType, "end">, NodeHandler> = {
  trigger: async () => {
    // No-op: el nodo trigger sólo marca el punto de entrada del flow.
  },

  agent: async ({ cfg, ctx, workspaceId, helpers }) => {
    const agentId = cfg.agentId as string | undefined;
    if (!agentId) throw new Error("Falta elegir el agente en este paso.");
    // `prompt` (registry) se antepone al mensaje entrante; `message` es el legado.
    const userMessage = buildAgentUserMessage(cfg, ctx.variables);
    // R2-C: agent lookup needs the workspace GUC (FORCE RLS).
    const agent = await withFlowTx(workspaceId, async (tx) => {
      const aRows = await tx
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);
      return aRows[0];
    });
    if (!agent) throw new Error(`agent not found: ${agentId}`);
    const { getToolDefinitions, executeTool } = await import("./tools");
    const { wrapUntrusted, UNTRUSTED_CONTENT_GUARDRAIL } = await import("./agent-runtime");
    // Handoff mutates a conversation and throws without conversationId.
    // Memory tools accept optional conversation scope and still work with agentId.
    const tools = getToolDefinitions(agent.tools ?? []).filter((t) => t.name !== "agent_handoff");
    const systemPrompt = agent.systemPrompt + (tools.length > 0 ? UNTRUSTED_CONTENT_GUARDRAIL : "");
    const messages: ChatMessage[] = [{ role: "user", content: userMessage }];
    // Mirror channels/router.ts runConversationalTurn's safetyCounter < 5.
    const maxSteps = tools.length > 0 ? 5 : 1;
    const { assertWithinSpend } = await import("./cost-alerts");
    const { recordAiUsage, chargeFor } = await import("./ai/run");
    let content = "";
    let model = agent.model;
    let tokensUsed = 0;
    const cargo = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    const toolsUsed: string[] = [];

    for (let step = 0; step < maxSteps; step++) {
      // Guard and meter every call, including intermediate tool turns.
      await withFlowTx(workspaceId, (tx) => assertWithinSpend(workspaceId, tx));
      const result = await withFlowTx(workspaceId, (tx) =>
        llmCall({
          workspaceId,
          model: agent.model,
          systemPrompt,
          messages,
          temperature: agent.temperature ? Number(agent.temperature) : 0.7,
          ...(agent.maxTokens != null && { maxTokens: agent.maxTokens }),
          ...(tools.length > 0 && { tools }),
          tx,
        })
      );
      const charge = chargeFor(result);
      await recordAiUsage({ workspaceId, capability: "chat", model: result.model, ...charge });
      model = result.model;
      tokensUsed += result.tokensUsed;
      cargo.tokensIn += charge.tokensIn;
      cargo.tokensOut += charge.tokensOut;
      cargo.costUsd += charge.costUsd;
      // Cumulative, after every call: if a later call fails, the failed step
      // still records the tokens already spent.
      helpers.setTrace({
        agentId,
        agentName: agent.name,
        model,
        tokensUsed,
        costUsd: cargo.costUsd,
      });

      if (tools.length === 0 || !result.toolCalls?.length) {
        content = result.content;
        break;
      }
      messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
      const toolResults = [];
      for (const tc of result.toolCalls) {
        toolsUsed.push(tc.name);
        try {
          const out = await withFlowTx(workspaceId, (tx) =>
            executeTool(tc.name, tc.input as Record<string, unknown>, {
              workspaceId,
              tx,
              variables: agent.variables ?? {},
              agentId: agent.id,
            })
          );
          toolResults.push({
            id: tc.id,
            name: tc.name,
            input: tc.input,
            output: wrapUntrusted(
              typeof out === "string" ? out : JSON.stringify(out ?? null),
              `tool_${tc.name}`
            ),
          });
        } catch (e) {
          // As in the router, tool failures are feedback for the model.
          toolResults.push({
            id: tc.id,
            name: tc.name,
            input: tc.input,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      messages.push({ role: "tool", content: "", toolResults });
    }
    // Match the router's empty-reply/cap fallback; preserve plain-call behavior.
    if (tools.length > 0 && !content && agent.fallback) content = agent.fallback;
    const outputVar = (cfg.outputVar as string) ?? "agentResult";
    ctx.variables[outputVar] = content;
    ctx.variables[`${outputVar}Meta`] = {
      ...firma({ model, tokensUsed }, cargo, agent.name),
      toolsUsed,
    };
    helpers.setOutput({
      content,
      tokensUsed,
      agentId: agent.id,
      agentName: agent.name,
      model,
      toolsUsed,
    });
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
    const value = interpolate(
      (cfg.value as string) ?? (cfg.expression as string) ?? "",
      ctx.variables
    );
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
      | {
          kind?: string;
          token?: string;
          user?: string;
          pass?: string;
          key?: string;
          header?: string;
        }
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

    // Dry run: only GET/HEAD leave the server. Headers and auth are left out of
    // the report on purpose — they are where the secrets live.
    if (ctx.dryRun && method !== "GET" && method !== "HEAD") {
      const sim = simulated({
        method,
        url,
        ...(init.body ? { body: String(init.body) } : {}),
      });
      ctx.variables[(cfg.outputVar as string) ?? "httpResult"] = sim;
      helpers.setOutput({ ...sim });
      return;
    }

    const timeoutMs = Math.min(60000, Number(cfg.timeoutMs ?? 30000));
    const failOnStatus = cfg.failOnStatus === true;
    const outputVar = (cfg.outputVar as string) ?? "httpResult";
    const send = async (signal?: AbortSignal) => {
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const r = await fetch(url, { ...init, signal: ac.signal });
        clearTimeout(t);
        const text = await r.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {}
        return { status: r.status, ok: r.ok, body };
      } finally {
        clearTimeout(t);
        signal?.removeEventListener("abort", onAbort);
      }
    };
    const finish = (
      res: { status: number; ok: boolean; body: unknown },
      extra: Record<string, unknown>
    ) => {
      if (failOnStatus && !res.ok) {
        throw new StepFailure(`HTTP ${res.status}`, {
          status: res.status,
          body: res.body,
          ...extra,
        });
      }
      ctx.variables[outputVar] = res.body;
      helpers.setOutput({ status: res.status, body: res.body, ...extra });
    };

    const retry = parseRetryConfig(cfg.retry);
    if (retry) {
      const r = await runWithRetry(
        retry,
        async () => {
          try {
            const res = await send(ctx.signal);
            const retryable = res.status === 429 || res.status >= 500;
            return retryable
              ? {
                  kind: "retry",
                  error: new Error(`HTTP ${res.status}`),
                  status: res.status,
                  value: res,
                }
              : { kind: "done", value: res, status: res.status };
          } catch (e) {
            return { kind: "retry", error: e instanceof Error ? e : new Error(String(e)) };
          }
        },
        ctx.signal ? { signal: ctx.signal } : {}
      );
      if (r.ok) return finish(r.value, { attempts: r.attempts });
      if (r.value) return finish(r.value, { attempts: r.attempts });
      throw new StepFailure(r.error.message, { attempts: r.attempts });
    }

    // Legacy behaviour (no `retry` block): retry any non-2xx up to maxAttempts.
    const maxAttempts = Math.min(5, Number(cfg.maxAttempts ?? 1));
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await send();
        if (!res.ok && attempt < maxAttempts) {
          await new Promise((done) => setTimeout(done, 200 * Math.pow(2, attempt - 1)));
          continue;
        }
        return finish(res, { attempt });
      } catch (e) {
        if (e instanceof StepFailure) throw e;
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < maxAttempts) {
          await new Promise((done) => setTimeout(done, 200 * Math.pow(2, attempt - 1)));
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
    const ms = Math.min(
      60_000,
      cfg.duration !== undefined ? parseDuration(cfg.duration) : Number(cfg.ms ?? 1000)
    );
    await new Promise((res) => setTimeout(res, ms));
    helpers.setOutput({ ms });
  },

  notify: async ({ cfg, ctx, helpers }) => {
    const out = {
      to: cfg.to ? interpolate(cfg.to as string, ctx.variables) : undefined,
      channel: cfg.channel,
      message: interpolate((cfg.message as string) ?? "", ctx.variables),
    };
    // Today this step only records what it would send; in a dry run it says so
    // in the same shape as every other simulated step.
    helpers.setOutput(ctx.dryRun ? { ...out, ...simulated({ ...out }) } : out);
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
    // Sin temperatura declarada NO se manda ninguna: los flows que ya existen
    // se escribieron y probaron con el valor por defecto del proveedor, y
    // fijarles uno nuevo les cambiaría el comportamiento sin que nadie tocara
    // nada. El chequeo es por número válido, no por verdad: `0` es falsy y es
    // justo el valor que este campo existe para permitir.
    const temperatura = Number(cfg.temperature);
    const mandarTemp =
      cfg.temperature !== undefined && cfg.temperature !== "" && !isNaN(temperatura);
    const { runChat } = await import("./ai/run");
    const res = await runChat({
      workspaceId,
      model,
      systemPrompt: system,
      messages: [{ role: "user", content: prompt }],
      ...(mandarTemp ? { temperature: temperatura } : {}),
    });
    // Recorded before anything that can still throw: the tokens are spent.
    const { chargeFor } = await import("./ai/run");
    const cargo = chargeFor(res);
    helpers.setTrace({ model: res.model, tokensUsed: res.tokensUsed, costUsd: cargo.costUsd });
    const outputVar = (cfg.outputVar as string) || "texto";
    ctx.variables[outputVar] = res.content;
    // Quién contestó, con qué y a qué costo, disponible para la plantilla. Sin
    // esto el dato existe en la corrida pero no llega a lo que el flujo
    // escribe, que es lo único que una persona termina leyendo.
    ctx.variables[`${outputVar}Meta`] = firma(res, cargo);
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
    const res = await textToSpeech(
      workspaceId,
      model,
      text,
      cfg.voice ? String(cfg.voice) : undefined
    );
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
    if (documents.length === 0)
      throw new Error("La 'Lista de textos' tiene que ser una lista con elementos.");
    const { rerank } = await import("./ai/run");
    const res = await rerank(
      workspaceId,
      model,
      query,
      documents,
      cfg.topN ? Number(cfg.topN) : undefined
    );
    ctx.variables[(cfg.outputVar as string) || "ranked"] = res.results;
    helpers.setOutput({ count: res.results.length });
  },

  integration: async ({ cfg, ctx, workspaceId, helpers }) => {
    // `integrationId` viene como "integrationId::action".
    const raw = String(cfg.integrationId ?? "");
    const [integrationId, action] = raw.split("::");
    if (!integrationId || !action) throw new Error("Falta elegir la app y la acción.");
    const input =
      (deepInterpolate(cfg.input ?? {}, ctx.variables) as Record<string, unknown>) ?? {};
    const { runIntegrationAction } = await import("./integrations/store");
    const retry = parseRetryConfig(cfg.retry);
    const outputVar = (cfg.outputVar as string) ?? "appResult";
    if (ctx.dryRun) {
      // Anything that is not provably a read is simulated, including when the
      // effect cannot be resolved (unknown integration, lookup failure): in a
      // dry run, doubt means "do not execute".
      let effect: "read" | "write" = "write";
      try {
        const { getIntegrationActionEffect } = await import("./integrations/store");
        effect = await getIntegrationActionEffect(workspaceId, integrationId, action, input);
      } catch {
        effect = "write";
      }
      if (effect !== "read") {
        const sim = simulated({ integrationId, action, input });
        ctx.variables[outputVar] = sim;
        helpers.setOutput({ ...sim });
        return;
      }
    }
    if (!retry) {
      const result = await runIntegrationAction(workspaceId, integrationId, action, input);
      ctx.variables[outputVar] = result;
      helpers.setOutput({ result });
      return;
    }
    const r = await runWithRetry(
      retry,
      async () => {
        try {
          return {
            kind: "done",
            value: await runIntegrationAction(workspaceId, integrationId, action, input),
          };
        } catch (e) {
          return { kind: "retry", error: e instanceof Error ? e : new Error(String(e)) };
        }
      },
      ctx.signal ? { signal: ctx.signal } : {}
    );
    if (!r.ok) throw new StepFailure(r.error.message, { attempts: r.attempts });
    ctx.variables[outputVar] = r.value;
    helpers.setOutput({ result: r.value, attempts: r.attempts });
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

  loop_for_each: async ({
    cfg,
    ctx,
    edges,
    node,
    nodes,
    runId,
    workspaceId,
    db,
    depth,
    helpers,
  }) => {
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
    // Every outgoing edge except `done` is a branch. `done` runs once, after
    // all branches, through runFromNode's normal handle routing.
    const branchEdges = edges.filter((e) => e.source === node.id && e.sourceHandle !== "done");
    // B7: fan-out acotado. Mismo orden de resultados y misma semántica de error
    // (el primer fallo se propaga, y `done` no corre).
    await mapWithConcurrency(branchEdges, FLOW_MAX_FANOUT, (ed) =>
      runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1)
    );
    helpers.setOutput({ branches: branchEdges.length });
    helpers.setHandle("done");
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
        // A throwing catch branch propagates, and `done` does not run.
        await runFromNode(catchEdge.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
      }
      helpers.setOutput({ caught: true, error: err });
    }
    // Only `done` edges continue; `try`/`catch` edges were handled above and
    // edges without a handle stay ignored, as before.
    helpers.setHandle("done");
  },

  subflow: async ({ cfg, ctx, workspaceId, runId, db, helpers }) => {
    const subId = cfg.flowId as string | undefined;
    if (!subId) throw new Error("subflow: missing flowId");
    const result = await executeFlow({
      flowId: subId,
      workspaceId,
      triggerSource: `parent_run:${runId}`,
      input: ctx.variables,
      // The child inherits the parent's mode, and the mark lands on its row.
      ...(ctx.dryRun ? { dryRun: true } : {}),
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

  wait_human: async ({ node, cfg, ctx, helpers }) => {
    const msg =
      (cfg.instructions as string) ?? (cfg.message as string) ?? "Se necesita una aprobación";
    const message = interpolate(msg, ctx.variables);
    ctx.variables["_pendingApproval"] = { message, assignee: cfg.assignee };
    helpers.setOutput({ paused: true, mensaje: message });

    // Previously this returned and the engine followed the outgoing edge:
    // a flow saying "wait for approval" approved itself. Throwing
    // `PauseRequested` unwinds recursion and lets `executeFlow` persist
    // where to resume.
    const notificationConfig = cfg.notify as
      | { integrationId?: string; input?: Record<string, unknown> }
      | undefined;
    const notification =
      notificationConfig?.integrationId && notificationConfig.input
        ? {
            integrationId: notificationConfig.integrationId,
            input: deepInterpolate(notificationConfig.input, ctx.variables) as Record<
              string,
              unknown
            >,
          }
        : undefined;
    throw new PauseRequested(node.id, message, notification);
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
  triggerSource: rawTriggerSource,
  input,
  dryRun = false,
}: {
  flowId: string;
  workspaceId: string;
  triggerSource: string;
  input: Record<string, unknown>;
  /** Marks the run in `triggerSource`; the worker reads the mark back. */
  dryRun?: boolean;
}): Promise<{
  runId: string;
  /**
   * `paused` only appears with FLOW_RUN_INLINE=1, where this function executes
   * instead of enqueueing. Through the normal queue, the run starts `pending`
   * and the pause happens later, in the worker.
   */
  status: "pending" | "succeeded" | "failed" | "cancelled" | "paused";
  error?: string;
  approvalToken?: string;
}> {
  const triggerSource = dryRun ? markDryRun(rawTriggerSource) : rawTriggerSource;
  const db = getDb();
  const flowRows = await db
    .select({ id: schema.flows.id })
    .from(schema.flows)
    .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
    .limit(1);
  if (!flowRows[0]) throw new Error("Flow not found");

  // B3: cap de concurrencia por flow.
  //
  // Fix F-B3 (v2 audit): el chequeo `count → if < cap → insert` tenía un TOCTOU
  // race — un burst de webhooks podía pasar varios runs juntos. Lo serializamos
  // con un advisory lock per-flowId: el lock dura sólo la transacción
  // (`pg_try_advisory_xact_lock`) y se libera automáticamente al commit/rollback.
  // Si otra request lo tiene, esperamos en el lock; la ventana entre count e
  // insert deja de existir.
  //
  // El key del lock es el hash 64-bit del flowId (Postgres `hashtextextended`)
  // truncado a int8 — colisiones son irrelevantes (peor caso: dos flows distintos
  // serializan sobre el mismo lock; es benigno, no rompe correctitud).
  const runId = createId();
  await db.transaction(async (tx) => {
    if (FLOW_MAX_CONCURRENT_RUNS_PER_FLOW > 0) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${flowId}, 0))`);
      const activeRows = await tx
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
    await tx.insert(schema.flowRuns).values({
      id: runId,
      flowId,
      workspaceId,
      status: "pending",
      triggerSource,
      input,
    });
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
      .set({
        status: "failed",
        error: `No se pudo encolar la ejecución: ${msg}`,
        completedAt: new Date(),
      })
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
 *
 * Cross-tenant by design: scans every workspace. When invoked from a
 * `withCrossTenantAdmin` wrapper (the cron path), pass the `tx` so all
 * queries run on the same connection that has the bypass GUC set — otherwise
 * FORCE RLS rejects them.
 */
type DbOrTx =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export async function reapStaleRuns(maxAgeMs = 15 * 60_000, db?: DbOrTx): Promise<number> {
  const exec = db ?? getDb();
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await exec
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
  const err =
    "La ejecución se interrumpió (timeout o reinicio del worker) y fue marcada como fallida.";
  await exec
    .update(schema.flowRuns)
    .set({ status: "failed", error: err, completedAt: new Date() })
    .where(inArray(schema.flowRuns.id, ids));
  await exec
    .update(schema.flowRunSteps)
    .set({ status: "failed", error: err, completedAt: new Date() })
    .where(and(inArray(schema.flowRunSteps.runId, ids), eq(schema.flowRunSteps.status, "running")));
  return ids.length;
}
