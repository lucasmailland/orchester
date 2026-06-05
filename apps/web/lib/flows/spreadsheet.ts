import { evaluateCells, type Cells } from "./spreadsheet-core";

/**
 * Evaluador server-side de la "Planilla". Usa el núcleo puro (`spreadsheet-core`)
 * para resolver referencias y delega la evaluación de cada expresión a un
 * sandbox `node:vm` con @formulajs/formulajs + `input` (las variables del flujo).
 */
export async function evaluateSheet(
  cells: Cells,
  input: Record<string, unknown>,
  outputCell?: string
): Promise<unknown> {
  const vm = await import("node:vm");
  const formulajs = await import("@formulajs/formulajs");
  const sandbox: Record<string, unknown> = { ...formulajs, input: structuredClone(input) };
  const sheetContext = vm.createContext(sandbox);
  const evalExpr = (expr: string) => vm.runInContext(`(${expr})`, sheetContext, { timeout: 1000 });
  return evaluateCells(cells, evalExpr, outputCell);
}
