import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import { continuarFlowPausado, withFlowTx } from "../flow-engine";
import type { Decision } from "./pause";

/**
 * Retoma un run que estaba esperando a una persona.
 *
 * El token es el único permiso: viaja en el enlace de aprobación y no se
 * guarda en ningún lado del lado del aprobador. Se busca por token y no por
 * runId **a propósito** — un runId se puede adivinar, y del otro lado de esta
 * decisión puede haber un merge a producción.
 */
/**
 * Qué se está por aprobar, sin tocar nada.
 *
 * Existe separada de `retomarPorToken` a propósito: una función que decide no
 * puede servir también para mirar. La primera versión de la ruta hacía el GET
 * llamando a retomar con "aprobado" — un GET que aprobaba.
 */
export async function mirarPorToken(
  token: string
): Promise<
  | { ok: true; runId: string; flowId: string; mensaje: string; pausadoEn: Date | null }
  | { ok: false }
> {
  const db = getDb();
  const filas = await db
    .select()
    .from(schema.flowRuns)
    .where(eq(schema.flowRuns.approvalToken, token))
    .limit(1);
  const run = filas[0];
  if (!run || run.status !== "paused") return { ok: false };
  const vars = (run.pausedVariables ?? {}) as Record<string, unknown>;
  const pend = vars["_pendingApproval"] as { message?: string } | undefined;
  return {
    ok: true,
    runId: run.id,
    flowId: run.flowId,
    mensaje: pend?.message ?? "Se necesita una aprobación",
    pausadoEn: run.pausedAt ?? null,
  };
}

export async function retomarPorToken(
  token: string,
  decision: Decision,
  quien: string
): Promise<
  { ok: true; runId: string; status: string } | { ok: false; motivo: "no-existe" | "ya-resuelto" }
> {
  const db = getDb();
  const filas = await db
    .select()
    .from(schema.flowRuns)
    .where(eq(schema.flowRuns.approvalToken, token))
    .limit(1);
  const run = filas[0];
  if (!run) return { ok: false, motivo: "no-existe" };

  // Un enlace reenviado por mail no debe servir dos veces. Si el run ya no
  // está pausado, alguien decidió antes: no es un error del aprobador, pero
  // tampoco se vuelve a ejecutar.
  if (run.status !== "paused") return { ok: false, motivo: "ya-resuelto" };

  // El token se borra en el mismo movimiento en que se marca la decisión. Dos
  // clics simultáneos: el segundo encuentra `status !== paused` y rebota.
  const actualizadas = await withFlowTx(run.workspaceId, (tx) =>
    tx
      .update(schema.flowRuns)
      .set({
        status: "running",
        approvalToken: null,
        resolvedBy: quien,
        resolvedDecision: decision,
      })
      .where(and(eq(schema.flowRuns.id, run.id), eq(schema.flowRuns.status, "paused")))
      .returning({ id: schema.flowRuns.id })
  );
  if (actualizadas.length === 0) return { ok: false, motivo: "ya-resuelto" };

  const r = await continuarFlowPausado({
    runId: run.id,
    workspaceId: run.workspaceId,
    flowId: run.flowId,
    desdeNodo: run.pausedNodeId ?? "",
    variables: (run.pausedVariables ?? {}) as Record<string, unknown>,
    decision,
  });
  return { ok: true, runId: run.id, status: r.status };
}
