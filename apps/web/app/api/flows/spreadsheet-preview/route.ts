import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { parseBody } from "@/lib/validation";
import { previewCells, type Cells } from "@/lib/flows/spreadsheet-core";

// `cells` es un mapa cellRef → fórmula/valor, dinámico por su naturaleza.
const previewSchema = z.object({
  cells: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/flows/spreadsheet-preview
 * Body: { cells: Record<cellRef, string> }
 * Devuelve el valor calculado de cada celda (best-effort) para previsualizar en
 * el editor. Usa el MISMO evaluador (node:vm + formulajs) que la ejecución real,
 * así el preview coincide con el resultado. Sin datos del flujo (input vacío).
 */
export async function POST(req: Request) {
  const authCtx = await requireAuth({ minRole: "editor" });
  if (!isAuthContext(authCtx)) return authCtx;
  const parsed = await parseBody(req, previewSchema);
  if (!parsed.ok) return parsed.response;
  const cells = (parsed.data.cells ?? {}) as Cells;

  const vm = await import("node:vm");
  const formulajs = await import("@formulajs/formulajs");
  const ctx = vm.createContext({ ...formulajs, input: {} });
  const evalExpr = (expr: string) => vm.runInContext(`(${expr})`, ctx, { timeout: 500 });

  return NextResponse.json({ previews: previewCells(cells, evalExpr) });
}
