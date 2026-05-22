"use client";

import { useEffect, useRef, useState } from "react";
import { Table2, X, FunctionSquare, ChevronDown } from "lucide-react";
import { FORMULA_LIBRARY } from "@/lib/flows/formula-library";

type CellPreview = Record<string, { value?: unknown; error?: boolean }>;

function fmtPreview(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "boolean") return v ? "VERDADERO" : "FALSO";
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  return String(v);
}

interface GridValue {
  cells: Record<string, string>;
  rows: number;
  cols: number;
  outputCell?: string;
}

function colName(i: number): string {
  return String.fromCharCode(65 + i);
}
function normalize(value: unknown): GridValue {
  const v = (value && typeof value === "object" ? value : {}) as Partial<GridValue>;
  return {
    cells: v.cells ?? {},
    rows: v.rows ?? 6,
    cols: v.cols ?? 5,
    outputCell: v.outputCell ?? "",
  };
}

/**
 * Editor de planilla tipo Excel: grilla de celdas + barra de fórmulas + librería
 * de fórmulas categorizada. Se abre en un modal amplio (el panel es angosto).
 */
export function SpreadsheetField({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  label: React.ReactNode;
}) {
  const grid = normalize(value);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState("A1");
  const [openCat, setOpenCat] = useState<string | null>("math");
  const [previews, setPreviews] = useState<CellPreview>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Preview en vivo: pedimos al server (mismo evaluador que la ejecución) los
  // valores calculados, con un pequeño debounce mientras se escribe.
  const cellsKey = JSON.stringify(grid.cells);
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch("/api/flows/spreadsheet-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cells: grid.cells }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setPreviews(j.previews ?? {}))
        .catch(() => {});
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cellsKey]);

  /** Qué mostrar en una celda: cruda si está seleccionada/no es fórmula; si no, el resultado. */
  function cellDisplay(ref: string): string {
    const raw = grid.cells[ref] ?? "";
    if (sel === ref || !raw.trim().startsWith("=")) return raw;
    const p = previews[ref];
    if (!p) return raw;
    return p.error ? "#ERROR" : fmtPreview(p.value);
  }
  function isComputed(ref: string): boolean {
    const raw = grid.cells[ref] ?? "";
    return sel !== ref && raw.trim().startsWith("=") && !!previews[ref];
  }

  const filled = Object.values(grid.cells).filter((c) => c && c.trim()).length;

  function setCell(ref: string, raw: string) {
    onChange({ ...grid, cells: { ...grid.cells, [ref]: raw } });
  }
  function insertFormula(syntax: string) {
    setCell(sel, `=${syntax}`);
  }

  // Mostramos una grilla generosa (que llena el alto) aunque tenga pocos datos.
  const displayCols = Math.max(grid.cols, 6);
  const displayRows = Math.max(grid.rows, 16);
  const refs = Array.from({ length: displayRows }, (_, r) =>
    Array.from({ length: displayCols }, (_, c) => `${colName(c)}${r + 1}`)
  );
  const usedRefs = Object.keys(grid.cells).filter((k) => grid.cells[k]?.trim());

  return (
    <div>
      {label}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg border border-line bg-card px-3 py-2 text-xs text-body hover:bg-elevated"
      >
        <span className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-emerald-500" />
          {filled > 0 ? `${filled} celda${filled === 1 ? "" : "s"} con datos` : "Abrir editor de planilla"}
        </span>
        <span className="text-[10px] text-faint">
          {grid.outputCell ? `resultado: ${grid.outputCell}` : "resultado: toda la planilla"}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-app/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-2xl border border-line bg-surface shadow-2xl">
            {/* header */}
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold text-strong">
                <Table2 className="h-4 w-4 text-emerald-500" /> Planilla
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="text-muted hover:text-body">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* formula bar */}
            <div className="flex items-center gap-2 border-b border-line px-4 py-2">
              <span className="rounded bg-elevated px-2 py-1 text-[11px] font-mono font-medium text-muted">{sel}</span>
              <FunctionSquare className="h-3.5 w-3.5 text-faint" />
              <input
                value={grid.cells[sel] ?? ""}
                onChange={(e) => setCell(sel, e.target.value)}
                placeholder="Escribí un valor o una fórmula (=SUM(A1:A3))"
                className="flex-1 rounded-lg border border-line bg-elevated px-2.5 py-1.5 font-mono text-xs text-strong outline-none focus:border-violet-500/60"
              />
            </div>

            <div className="flex min-h-0 flex-1">
              {/* grid */}
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line">
                  <table className="w-full table-fixed border-collapse">
                    <thead className="sticky top-0 z-20">
                      <tr>
                        <th className="sticky left-0 z-30 w-9 border-b border-r border-line bg-elevated" />
                        {Array.from({ length: displayCols }, (_, c) => (
                          <th key={c} className="border-b border-r border-line bg-elevated px-2 py-1.5 text-[10px] font-medium text-muted">
                            {colName(c)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {refs.map((row, r) => (
                        <tr key={r}>
                          <td className="sticky left-0 z-10 w-9 border-b border-r border-line bg-elevated px-1 py-1 text-center text-[10px] font-medium text-muted">
                            {r + 1}
                          </td>
                          {row.map((ref) => (
                            <td key={ref} className="border-b border-r border-line p-0">
                              <input
                                value={cellDisplay(ref)}
                                onFocus={() => setSel(ref)}
                                onChange={(e) => setCell(ref, e.target.value)}
                                title={isComputed(ref) ? grid.cells[ref] : undefined}
                                className={`h-8 w-full bg-transparent px-2 text-[11px] outline-none focus:bg-violet-500/10 ${
                                  isComputed(ref) ? "italic text-emerald-600 dark:text-emerald-400" : "text-strong"
                                } ${
                                  sel === ref ? "bg-violet-500/10 ring-1 ring-inset ring-violet-500/60" : ""
                                } ${grid.outputCell === ref ? "bg-emerald-500/10" : ""}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 shrink-0 text-[10px] text-faint">
                  Tip: los datos del paso anterior están en <code className="font-mono">input</code> (ej. <code className="font-mono">=SUM(input.ventas)</code>). La celda marcada en verde es el resultado.
                </p>
              </div>

              {/* formula library */}
              <div className="flex w-72 shrink-0 flex-col border-l border-line">
                <p className="border-b border-line px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                  Fórmulas
                </p>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {FORMULA_LIBRARY.map((cat) => (
                    <div key={cat.id} className="mb-1">
                      <button
                        type="button"
                        onClick={() => setOpenCat((o) => (o === cat.id ? null : cat.id))}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-medium text-body hover:bg-hover"
                      >
                        <span>{cat.emoji} {cat.label}</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${openCat === cat.id ? "rotate-180" : ""}`} />
                      </button>
                      {openCat === cat.id && (
                        <div className="grid grid-cols-2 gap-1 pb-1.5 pt-0.5">
                          {cat.formulas.map((f) => (
                            <button
                              key={f.name}
                              type="button"
                              onClick={() => insertFormula(f.syntax)}
                              title={`${f.syntax}\n${f.desc}`}
                              className="flex flex-col gap-0.5 rounded-md border border-line bg-card px-2 py-1.5 text-left transition-colors hover:border-violet-500/40 hover:bg-violet-500/10"
                            >
                              <span className="font-mono text-[11px] font-medium text-violet-600 dark:text-violet-400">{f.name}</span>
                              <span className="line-clamp-2 text-[10px] leading-tight text-faint">{f.desc}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* footer: output cell */}
            <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
              <label className="flex items-center gap-2 text-[11px] text-muted">
                Celda de resultado:
                <select
                  value={grid.outputCell ?? ""}
                  onChange={(e) => onChange({ ...grid, outputCell: e.target.value })}
                  className="rounded-md border border-line bg-elevated px-2 py-1 text-[11px] text-strong outline-none"
                >
                  <option value="">Toda la planilla</option>
                  {usedRefs.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
