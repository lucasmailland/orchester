import "server-only";
import type { NodeHandler } from "@/lib/flow-engine";
import {
  interpolate,
  deepInterpolate,
  runUserJs,
  runUserCode,
  runFormula,
} from "@/lib/flows/runtime-helpers";
import { schema } from "@orchester/db";
import { eq } from "drizzle-orm";

export const trigger: NodeHandler = async () => {
  // No-op: el nodo trigger sólo marca el punto de entrada del flow.
};

export const agent: NodeHandler = async ({ cfg, ctx, workspaceId, helpers }) => {
  const agentId = cfg.agentId as string | undefined;
  if (!agentId) throw new Error("Falta elegir el agente en este paso.");
  const extra = cfg.prompt ? interpolate(cfg.prompt as string, ctx.variables) : "";
  const incoming = interpolate((cfg.message as string) ?? "{{message}}", ctx.variables);
  const userMessage = [extra, incoming].filter((s) => s && s.trim()).join("\n\n") || incoming;
  const result = await (async () => {
    const { getDb } = await import("@orchester/db");
    const db = getDb();
    return db.transaction(async (tx) => {
      const { sql } = await import("drizzle-orm");
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
      const aRows = await tx
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);
      const agentRow = aRows[0];
      if (!agentRow) throw new Error(`agent not found: ${agentId}`);
      const { runAgent } = await import("@/lib/agent-runtime");
      return runAgent({
        workspaceId,
        agent: agentRow,
        messages: [{ role: "user", content: userMessage }],
        tx,
      });
    });
  })();
  const outputVar = (cfg.outputVar as string) ?? "agentResult";
  ctx.variables[outputVar] = result.content;
  helpers.setOutput({ content: result.content, tokensUsed: result.tokensUsed });
};

export const transform: NodeHandler = async ({ cfg, ctx, helpers }) => {
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
};

export const code: NodeHandler = async ({ cfg, ctx, helpers }) => {
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
};

export const spreadsheet: NodeHandler = async ({ cfg, ctx, helpers }) => {
  const outputVar = (cfg.outputVar as string) ?? "result";
  const grid = cfg.grid as { cells?: Record<string, string>; outputCell?: string } | undefined;
  if (grid && grid.cells && Object.keys(grid.cells).length > 0) {
    const { evaluateSheet } = await import("@/lib/flows/spreadsheet");
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
};

export const note: NodeHandler = async ({ helpers }) => {
  helpers.setOutput({});
};
