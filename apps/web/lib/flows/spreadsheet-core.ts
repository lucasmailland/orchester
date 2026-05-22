/**
 * Núcleo PURO del evaluador de planillas: resuelve referencias entre celdas
 * (A1, rangos A1:B3) y arma la expresión final, delegando la evaluación real a
 * un `evalExpr` inyectable. Así el server usa node:vm y el cliente usa una
 * versión browser-safe — sin duplicar la lógica de resolución.
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

/** Convierte el texto crudo de una celda no-fórmula en número/booleano/string. */
function literalValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true" || t === "false") return t === "true";
  return t;
}

export type EvalExpr = (expr: string) => unknown;

/** Crea un resolvedor de celdas con memoización y detección de ciclos. */
function makeResolver(cells: Cells, evalExpr: EvalExpr) {
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
    expr = expr.replace(/([A-Z]+[0-9]+):([A-Z]+[0-9]+)/g, (_m, a: string, b: string) =>
      toLiteral(expandRange(a, b).map((r) => evalRef(r, nextSeen)))
    );
    expr = expr.replace(/\b([A-Z]+[0-9]+)\b/g, (m: string) => {
      if (!COL.test(m.replace(/[0-9]+$/, ""))) return m;
      return toLiteral(evalRef(m, nextSeen));
    });
    let result: unknown;
    try {
      result = evalExpr(expr);
    } catch (e) {
      throw new Error(`Error en la celda ${ref}: ${e instanceof Error ? e.message : String(e)}`);
    }
    cache.set(ref, result);
    return result;
  }
  return evalRef;
}

/**
 * Evaluación estricta (para ejecutar el flujo): devuelve el valor de
 * `outputCell` o, si no se da, un objeto con todas las celdas con contenido.
 * Lanza si hay error o ciclo.
 */
export function evaluateCells(cells: Cells, evalExpr: EvalExpr, outputCell?: string): unknown {
  const evalRef = makeResolver(cells, evalExpr);
  if (outputCell && outputCell.trim()) {
    return evalRef(outputCell.trim().toUpperCase(), new Set());
  }
  const out: Record<string, unknown> = {};
  for (const ref of Object.keys(cells)) {
    if (cells[ref] != null && cells[ref]!.trim() !== "") out[ref] = evalRef(ref, new Set());
  }
  return out;
}

/**
 * Evaluación best-effort (para previsualizar en la UI): nunca lanza; por cada
 * celda devuelve su valor o una marca de error.
 */
export function previewCells(
  cells: Cells,
  evalExpr: EvalExpr
): Record<string, { value?: unknown; error?: boolean }> {
  const evalRef = makeResolver(cells, evalExpr);
  const out: Record<string, { value?: unknown; error?: boolean }> = {};
  for (const ref of Object.keys(cells)) {
    if (cells[ref] == null || cells[ref]!.trim() === "") continue;
    try {
      out[ref] = { value: evalRef(ref, new Set()) };
    } catch {
      out[ref] = { error: true };
    }
  }
  return out;
}
