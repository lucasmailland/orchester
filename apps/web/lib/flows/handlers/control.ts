import "server-only";
import type { NodeHandler } from "@/lib/flow-engine";
import { WaitHumanSignal } from "@/lib/flow-engine";
import {
  evaluateCondition,
  interpolate,
  resolveValue,
  parseDuration,
  mapWithConcurrency,
  FLOW_MAX_FANOUT,
} from "@/lib/flows/runtime-helpers";
import type { Condition } from "@/lib/flows/runtime-helpers";

export const condition: NodeHandler = async ({ cfg, ctx, helpers }) => {
  const flat = cfg.condition
    ? (cfg.condition as Condition)
    : ({ left: cfg.left, op: cfg.op, right: cfg.right } as Condition);
  if (!flat.op) throw new Error("Falta elegir la comparación en este paso.");
  const passed = evaluateCondition(flat, ctx.variables);
  helpers.setHandle(passed ? "true" : "false");
  helpers.setOutput({ passed });
};

export const switch_node: NodeHandler = async ({ cfg, ctx, helpers, edges, node }) => {
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
};

export const loop_for_each: NodeHandler = async ({ cfg, ctx, edges, node, helpers, runChild }) => {
  const itemVar = (cfg.itemVar as string) ?? "item";
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
      await runChild(ed.target);
    }
    results.push(ctx.variables[(cfg.collectVar as string) ?? itemVar]);
  }
  ctx.variables[(cfg.outputVar as string) ?? "loopResults"] = results;
  helpers.setOutput({ count: results.length });
  helpers.setHandle("done");
};

export const parallel: NodeHandler = async ({ edges, node, helpers, runChild }) => {
  const branchEdges = edges.filter((e) => e.source === node.id);
  await mapWithConcurrency(branchEdges, FLOW_MAX_FANOUT, (ed) => runChild(ed.target));
  helpers.setOutput({ branches: branchEdges.length });
  helpers.skipChildren();
};

export const try_catch: NodeHandler = async ({ cfg, ctx, edges, node, helpers, runChild }) => {
  const tryEdge = edges.find((e) => e.source === node.id && e.sourceHandle === "try");
  const catchEdge = edges.find((e) => e.source === node.id && e.sourceHandle === "catch");
  if (!tryEdge) throw new Error("try_catch: missing try branch");
  try {
    await runChild(tryEdge.target);
    helpers.setOutput({ caught: false });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    ctx.variables[(cfg.errorVar as string) ?? "error"] = err;
    if (catchEdge) {
      await runChild(catchEdge.target);
    }
    helpers.setOutput({ caught: true, error: err });
  }
  helpers.skipChildren();
};

export const subflow: NodeHandler = async ({
  cfg,
  ctx,
  workspaceId,
  runId,
  db,
  helpers,
  runSubflow,
}) => {
  const subId = cfg.flowId as string | undefined;
  if (!subId) throw new Error("subflow: missing flowId");
  const result = await runSubflow({
    flowId: subId,
    workspaceId,
    triggerSource: `parent_run:${runId}`,
    input: ctx.variables,
    ancestorFlowIds: ctx.ancestorFlowIds ?? [],
  });
  if (result.status === "failed") throw new Error(`subflow failed: ${result.error}`);
  const { schema } = await import("@orchester/db");
  const { eq } = await import("drizzle-orm");
  const subRuns = await db
    .select()
    .from(schema.flowRuns)
    .where(eq(schema.flowRuns.id, result.runId))
    .limit(1);
  const subOut = (subRuns[0]?.output as Record<string, unknown>) ?? {};
  Object.assign(ctx.variables, subOut);
  helpers.setOutput({ subRunId: result.runId, mergedKeys: Object.keys(subOut) });
};

export const wait_human: NodeHandler = async ({ node, cfg, ctx }) => {
  const msg =
    (cfg.instructions as string) ?? (cfg.message as string) ?? "Se necesita una aprobación";
  ctx.variables["_pendingApproval"] = {
    message: interpolate(msg, ctx.variables),
    assignee: cfg.assignee,
  };
  throw new WaitHumanSignal(node.id);
};

export const delay: NodeHandler = async ({ cfg, helpers }) => {
  const ms = Math.min(
    60_000,
    cfg.duration !== undefined ? parseDuration(cfg.duration) : Number(cfg.ms ?? 1000)
  );
  await new Promise((res) => setTimeout(res, ms));
  helpers.setOutput({ ms });
};

export const end: NodeHandler = async () => {
  // No-op: end nodes are filtered before handler dispatch.
};
