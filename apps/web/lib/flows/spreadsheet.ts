/**
 * Evaluador de la "Planilla": una grilla de celdas (A1, B2…) donde cada celda
 * puede ser un valor o una fórmula (=SUM(A1:A3)). Resuelve referencias entre
 * celdas (y rangos), expone `input` (las variables del flujo) y corre las
 * fórmulas con @formulajs/formulajs en un sandbox node:vm.
 */

export type Cells = Record<string, string>;

const COL = /^[A-Z]+$/;

function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function indexToCol(idx: number): string {
  let s = "";
  let n = idx + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)([0-9]+)$/.exec(ref);
  if (!m) return null;
  return { col: colToIndex(m[1]!), row: parseInt(m[2]!, 10) };
}

/** Expande "A1:B3" a la lista de refs que cubre (orden por filas). */
function expandRange(from: string, to: string): string[] {
  const a = parseRef(from);
  const b = parseRef(to);
  if (!a || !b) return [];
  const refs: string[] = [];
  const c0 = Math.min(a.col, b.col);
  const c1 = Math.max(a.col, b.col);
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) refs.push(`${indexToCol(c)}${r}`);
  }
  return refs;
}

function toLiteral(v: unknown): string {
  if (v == null || v === "") return "0";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map(toLiteral).join(",")}]`;
  return JSON.stringify(String(v));
}

/** Convierte el texto crudo de una celda no-fórmula en número o string. */
function literalValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true" || t === "false") return t === "true";
  return t;
}

/**
 * Evalúa una grilla. Si se da `outputCell`, devuelve su valor; si no, devuelve
 * un objeto con todas las celdas evaluadas. Detecta referencias circulares.
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

  const cache = new Map<string, unknown>();

  function evalRef(ref: string, seen: Set<string>): unknown {
    if (cache.has(ref)) return cache.get(ref);
    if (seen.has(ref)) throw new Error(`Referencia circular en ${ref}.`);
    const raw = cells[ref];
    if (raw == null || raw.trim() === "") {
      cache.set(ref, "");
      return "";
    }
    if (!raw.trim().startsWith("=")) {
      const v = literalValue(raw);
      cache.set(ref, v);
      return v;
    }
    const nextSeen = new Set(seen).add(ref);
    let expr = raw.trim().slice(1);
    // 1) rangos A1:B3
    expr = expr.replace(/([A-Z]+[0-9]+):([A-Z]+[0-9]+)/g, (_m, a: string, b: string) => {
      const values = expandRange(a, b).map((r) => evalRef(r, nextSeen));
      return toLiteral(values);
    });
    // 2) referencias sueltas A1
    expr = expr.replace(/\b([A-Z]+[0-9]+)\b/g, (m: string) => {
      if (!COL.test(m.replace(/[0-9]+$/, ""))) return m;
      const v = evalRef(m, nextSeen);
      return toLiteral(v);
    });
    let result: unknown;
    try {
      result = vm.runInContext(`(${expr})`, sheetContext, { timeout: 1000 });
    } catch (e) {
      throw new Error(`Error en la celda ${ref}: ${e instanceof Error ? e.message : String(e)}`);
    }
    cache.set(ref, result);
    return result;
  }

  if (outputCell && outputCell.trim()) {
    return evalRef(outputCell.trim().toUpperCase(), new Set());
  }
  // Sin celda de salida: devolvemos todas las celdas con contenido, evaluadas.
  const out: Record<string, unknown> = {};
  for (const ref of Object.keys(cells)) {
    if (cells[ref] != null && cells[ref]!.trim() !== "") out[ref] = evalRef(ref, new Set());
  }
  return out;
}
