import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and, inArray, lt, count, sql } from "drizzle-orm";
import { enqueue, JOB_FLOW_RUN } from "./queue";
import { logWithContext, recordMetric } from "./observability";

// ---------------------------------------------------------------------------
// Re-export pure helpers so existing callers of flow-engine keep working.
// ---------------------------------------------------------------------------
export {
  interpolate,
  resolveValue,
  deepInterpolate,
  parseDuration,
  evaluateCondition,
} from "./flows/runtime-helpers";
export type { Condition } from "./flows/runtime-helpers";

/** ORCH-3: sentinel thrown by wait_human handler; caught by executeFlow to
 *  persist a resume token and return status="waiting" instead of "failed". */
export class WaitHumanSignal extends Error {
  constructor(public nodeId: string) {
    super("wait_human");
    this.name = "WaitHumanSignal";
  }
}

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

async function withFlowTx<T>(workspaceId: string, fn: (tx: WsDb) => Promise<T>): Promise<T> {
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

// ORCH-9: bidirectional compile-time assertion — if FLOW_NODE_TYPES and the DB
// pgEnum tuple drift apart, one of these assignments fails to type-check (tsc
// / next build catches it; no runtime cost).
type _EngineType = (typeof FLOW_NODE_TYPES)[number];
type _DbType = (typeof schema.flowNodeTypeEnum.enumValues)[number];
const _assertEngineSubsetOfDb: _EngineType extends _DbType ? true : never = true;
const _assertDbSubsetOfEngine: _DbType extends _EngineType ? true : never = true;
void _assertEngineSubsetOfDb;
void _assertDbSubsetOfEngine;

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
  /** Signal de cancelación (F-1/F-B1). Si abort, el motor para entre pasos. */
  signal?: AbortSignal;
  /** ORCH-7: flow ids already on the call stack — used for subflow cycle detection. */
  ancestorFlowIds?: string[];
}

export interface ExecHelpers {
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
export interface NodeHandlerArgs {
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
  /** Recurse into a child node (wraps runFromNode with incremented depth). */
  runChild: (target: string) => Promise<void>;
  /** Execute a subflow (wraps executeFlow — passed to break the import cycle). */
  runSubflow: (opts: {
    flowId: string;
    workspaceId: string;
    triggerSource: string;
    input: Record<string, unknown>;
    ancestorFlowIds?: string[];
  }) => Promise<{ runId: string; status: string; error?: string }>;
}
export type NodeHandler = (args: NodeHandlerArgs) => Promise<void>;

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

export async function executeFlow({
  flowId,
  workspaceId,
  triggerSource,
  input,
  onEvent,
  runId: existingRunId,
  signal,
  ancestorFlowIds,
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
  /** ORCH-7: ancestor flow ids for cycle detection. Provided by subflow handler. */
  ancestorFlowIds?: string[];
}): Promise<{
  runId: string;
  status: "succeeded" | "failed" | "cancelled" | "waiting";
  error?: string;
}> {
  // ORCH-7: detect subflow cycles before doing any DB work.
  if ((ancestorFlowIds ?? []).includes(flowId)) {
    throw new Error(`Subflow cycle detected: flow ${flowId} is already in the subflow chain.`);
  }

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
        triggerSource,
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
    ancestorFlowIds: [...(ancestorFlowIds ?? []), flowId],
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
      await tx
        .update(schema.flows)
        .set({ lastRunAt: new Date() })
        .where(eq(schema.flows.id, flowId));
    });
    onEvent?.({ type: "run_finish", status: "succeeded" });
    recordMetric("flow.run.duration_ms", Date.now() - runStartedAt, {
      flowId,
      status: "succeeded",
    });
    return { runId, status: "succeeded" };
  } catch (e) {
    // ORCH-3: wait_human throws a sentinel — not an error, just a pause.
    if (e instanceof WaitHumanSignal) {
      const resumeToken = createId();
      await withFlowTx(workspaceId, (tx) =>
        tx
          .update(schema.flowRuns)
          .set({ status: "waiting", output: ctx.variables, resumeToken, pendingNodeId: e.nodeId })
          .where(eq(schema.flowRuns.id, runId))
      );
      onEvent?.({ type: "run_finish", status: "succeeded" });
      return { runId, status: "waiting" };
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

    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRunSteps)
        .set({ status: "succeeded", output: stepOutput, completedAt: new Date() })
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
    // ORCH-3: WaitHumanSignal is a controlled pause, not a step failure.
    if (e instanceof WaitHumanSignal) {
      await withFlowTx(workspaceId, (tx) =>
        tx
          .update(schema.flowRunSteps)
          .set({ status: "waiting" as never, completedAt: new Date() })
          .where(eq(schema.flowRunSteps.id, stepId))
      );
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRunSteps)
        .set({ status: "failed", error: msg, completedAt: new Date() })
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

  if (skipChildren) return;

  const outgoing = edges.filter(
    (e) => e.source === node.id && (nextHandle == null || e.sourceHandle === nextHandle)
  );
  for (const ed of outgoing) {
    await runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
  }
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
  // Lazy import to avoid circular dep at module load time.
  const { NODE_HANDLERS } = await import("./flows/handlers");
  const cfg = (node.config ?? {}) as Record<string, unknown>;
  const handler = NODE_HANDLERS[node.type as Exclude<FlowNodeType, "end">];
  if (!handler) throw new Error(`Unknown node type: ${node.type}`);
  await handler({
    node,
    ctx,
    runId,
    workspaceId,
    nodes,
    edges,
    db,
    depth,
    helpers,
    cfg,
    runChild: (target) => runFromNode(target, nodes, edges, ctx, runId, workspaceId, db, depth + 1),
    runSubflow: executeFlow,
  });
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
}): Promise<{
  runId: string;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "waiting";
  error?: string;
}> {
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

/**
 * ORCH-3: Resume a paused (waiting) flow run after human approve/reject.
 * - approve: re-enters the graph at the pending node's children, then closes
 *   the run as succeeded (or failed if a child node throws).
 * - reject: marks the run cancelled immediately without running any children.
 */
export async function resumeFlow(
  runId: string,
  token: string,
  decision: "approve" | "reject",
  workspaceId: string
): Promise<{
  runId: string;
  status: "succeeded" | "failed" | "cancelled" | "waiting";
  error?: string;
}> {
  const run = await withFlowTx(workspaceId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.flowRuns)
      .where(and(eq(schema.flowRuns.id, runId), eq(schema.flowRuns.workspaceId, workspaceId)))
      .limit(1);
    return rows[0];
  });
  if (!run) throw new Error("Run not found");
  if (run.status !== "waiting") throw new Error(`Run is not waiting (status=${run.status})`);
  if (!run.resumeToken || run.resumeToken !== token) throw new Error("Invalid resume token");

  if (decision === "reject") {
    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRuns)
        .set({
          status: "cancelled",
          error: "Rejected by approver",
          completedAt: new Date(),
          resumeToken: null,
        })
        .where(eq(schema.flowRuns.id, runId))
    );
    return { runId, status: "cancelled" };
  }

  // approve: reload flow, rebuild ctx from saved output, re-enter at pending node's children.
  const flow = await withFlowTx(
    workspaceId,
    async (tx) =>
      (await tx.select().from(schema.flows).where(eq(schema.flows.id, run.flowId)).limit(1))[0]
  );
  if (!flow) throw new Error("Flow not found");
  const nodes = (flow.nodes ?? []) as FlowNode[];
  const edges = (flow.edges ?? []) as FlowEdge[];
  const ctx: RunContext = {
    variables: { ...((run.output as Record<string, unknown>) ?? {}) },
    output: {},
  };
  const db = getDb();
  await withFlowTx(workspaceId, (tx) =>
    tx
      .update(schema.flowRuns)
      .set({ status: "running", resumeToken: null })
      .where(eq(schema.flowRuns.id, runId))
  );
  try {
    const outgoing = edges.filter((ed) => ed.source === run.pendingNodeId);
    for (const ed of outgoing) {
      await runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, 0);
    }
    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRuns)
        .set({ status: "succeeded", output: ctx.variables, completedAt: new Date() })
        .where(eq(schema.flowRuns.id, runId))
    );
    return { runId, status: "succeeded" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRuns)
        .set({ status: "failed", error: msg, completedAt: new Date() })
        .where(eq(schema.flowRuns.id, runId))
    );
    return { runId, status: "failed", error: msg };
  }
}
