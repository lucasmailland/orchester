import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { previewCells, type Cells } from "@/lib/flows/spreadsheet-core";

/**
 * POST /api/flows/spreadsheet-preview
 * Body: { cells: Record<cellRef, string> }
 * Devuelve el valor calculado de cada celda (best-effort) para previsualizar en
 * el editor. Usa el MISMO evaluador (node:vm + formulajs) que la ejecución real,
 * así el preview coincide con el resultado. Sin datos del flujo (input vacío).
 */
export async function POST(req: Request) {
  const ws = await getCurrentWorkspace();
  if (!ws) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const cells = (body?.cells ?? {}) as Cells;

  const vm = await import("node:vm");
  const formulajs = await import("@formulajs/formulajs");
  const ctx = vm.createContext({ ...formulajs, input: {} });
  const evalExpr = (expr: string) => vm.runInContext(`(${expr})`, ctx, { timeout: 500 });

  return NextResponse.json({ previews: previewCells(cells, evalExpr) });
}
