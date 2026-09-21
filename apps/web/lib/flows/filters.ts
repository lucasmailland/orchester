import { nrqlEscape, htmlEscape } from "@/lib/text/escape";

/**
 * `{{ path | filter:arg:arg }}` — pure, deterministic value derivation for
 * flow templates, so integration flows do not need `code` steps.
 */

export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterError";
  }
}

interface FilterSpec {
  /** [min, max] number of arguments. */
  arity: [number, number];
  apply: (value: unknown, args: string[]) => unknown;
}

function toEpoch(value: unknown, filter: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    if (/^-?\d+$/.test(value.trim())) return Number(value.trim());
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  throw new FilterError(`${filter}: "${String(value)}" is not a timestamp`);
}

function toInt(arg: string | undefined, filter: string): number {
  const n = Number(arg);
  if (arg === undefined || arg.trim() === "" || !Number.isInteger(n)) {
    throw new FilterError(`${filter}: "${arg ?? ""}" is not an integer`);
  }
  return n;
}

/**
 * Cómo se ve la ruta de un archivo de prueba.
 *
 * Los bordes son a propósito: `\.spec\.` y no `spec` a secas, porque
 * `respec.ts` contiene "spec" y `contest.service.ts` contiene "test". Borrar
 * evidencia buena es peor que dejar pasar un mock — un mock se descarta
 * leyéndolo, un archivo que nunca llegó no se descarta de ninguna manera.
 */
const TEST_PATH = /(^|\/)(__tests__|tests?|testing)\//i;
const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?($|\.)/i;

/** La ruta de un elemento: un string suelto, o el campo `path`/`file`. */
function pathOf(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    for (const key of ["path", "file", "filename"]) {
      if (typeof o[key] === "string") return o[key];
    }
  }
  return "";
}

function looksLikeATest(item: unknown): boolean {
  const path = pathOf(item);
  return TEST_PATH.test(path) || TEST_FILE.test(path);
}

const asText = (value: unknown): string =>
  value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

// Scheme words that precede a secret value ("Bearer <token>", "api_key=...").
// A word here can itself sit right after another scheme word (e.g. a message
// literally containing "token Bearer abc.def-123") — the negative lookahead
// below stops the regex from treating the second scheme word as if it were
// the secret value, which would leave the real value unmasked.
const SECRET_SCHEMES = "Bearer|Basic|token|api[_-]?key";

const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]"],
  [
    new RegExp(`\\b(${SECRET_SCHEMES})\\b[:=]?\\s*(?!(?:${SECRET_SCHEMES})\\b)\\S{6,}`, "gi"),
    "$1 [secret]",
  ],
  [/\d{8,}/g, "[number]"],
];

/**
 * Estilos en línea, no clases.
 *
 * Esto termina embebido en HTML de otro (una nota de Odoo, un mail): no hay
 * hoja de estilos nuestra del otro lado, y una clase de Bootstrap sólo pinta
 * si el destino usa Bootstrap. Las propiedades elegidas son las que sobreviven
 * a un sanitizador estricto — Odoo filtra el valor de `style` contra una lista
 * blanca que incluye `border*`, `padding*` y `text-align`.
 */
const TABLE_STYLE = "border-collapse:collapse;font-size:13px";
const CELL = "border:1px solid #d9d9d9;padding:4px 8px";
const TH_STYLE = `${CELL};text-align:left;background:#f5f5f5`;
const TD_STYLE = CELL;

/** Columnas cuyo nombre dice que el número es un instante, no una cantidad. */
const TIME_COLUMN = /^(timestamp|time|date|fecha|hora)$|(_at|At)$/;
/** Milisegundos de época entre 2001 y 2035: un conteo ahí adentro no es creíble. */
const EPOCH_MS_RANGE = [1_000_000_000_000, 2_000_000_000_000] as const;

/**
 * Un epoch en milisegundos se muestra como fecha legible.
 *
 * `1789769424158` en una celda no le dice nada a nadie. Se convierte sólo
 * cuando el NOMBRE de la columna dice que es un instante y el número cae en un
 * rango creíble: así una cantidad grande nunca se disfraza de fecha.
 */
function readable(column: string, value: unknown): unknown {
  if (typeof value !== "number" || !TIME_COLUMN.test(column)) return value;
  if (value < EPOCH_MS_RANGE[0] || value > EPOCH_MS_RANGE[1]) return value;
  return new Date(value)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
}

const FILTERS: Record<string, FilterSpec> = {
  addMinutes: {
    arity: [1, 1],
    apply: (v, [n]) => toEpoch(v, "addMinutes") + toInt(n, "addMinutes") * 60_000,
  },
  toEpochMs: { arity: [0, 0], apply: (v) => toEpoch(v, "toEpochMs") },
  toIso: { arity: [0, 0], apply: (v) => new Date(toEpoch(v, "toIso")).toISOString() },
  slice: {
    arity: [1, 2],
    apply: (v, [s, e]) =>
      asText(v).slice(toInt(s, "slice"), e === undefined ? undefined : toInt(e, "slice")),
  },
  lower: { arity: [0, 0], apply: (v) => asText(v).toLowerCase() },
  upper: { arity: [0, 0], apply: (v) => asText(v).toUpperCase() },
  trim: { arity: [0, 0], apply: (v) => asText(v).trim() },
  // `default` takes the rest of the expression, colons included.
  default: {
    arity: [1, Infinity],
    apply: (v, args) => (v == null || v === "" ? args.join(":") : v),
  },
  // `json:2` indenta. Sin argumento sigue compacto, como siempre.
  json: {
    arity: [0, 1],
    apply: (v, [indent]) =>
      JSON.stringify(v ?? null, null, indent === undefined ? undefined : toInt(indent, "json")),
  },
  /**
   * Un arreglo de objetos planos como tabla HTML.
   *
   * Existe porque volcar `| json` en una nota deja a la persona que abre la
   * tarea leyendo llaves y corchetes para sacar tres datos. Los mismos datos
   * en una tabla se leen de un vistazo, y son exactamente los mismos datos.
   *
   * Todo valor pasa por el escape de HTML: esto termina dentro de un campo
   * HTML, y una comilla o un `<` en un mensaje de error partiría el markup.
   */
  table: {
    arity: [0, 2],
    apply: (v, [maxRows, maxCell]) => {
      const rows = Array.isArray(v) ? v : [];
      if (rows.length === 0) return "";
      const limit = maxRows === undefined ? 20 : toInt(maxRows, "table");
      const cellLimit = maxCell === undefined ? 200 : toInt(maxCell, "table");
      const shown = rows.slice(0, limit);
      // Las columnas son la unión de las claves, en el orden en que aparecen:
      // una fila a la que le falta un campo no debe hacer desaparecer la columna.
      const columns: string[] = [];
      for (const row of shown) {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
        }
      }
      // Sin objetos que inspeccionar no hay tabla que armar; una lista simple
      // dice más que una tabla de una sola columna sin nombre.
      if (columns.length === 0) {
        return `<ul>${shown.map((r) => `<li>${htmlEscape(asText(r))}</li>`).join("")}</ul>`;
      }
      const cell = (column: string, value: unknown) => {
        const text = asText(readable(column, value));
        return htmlEscape(text.length > cellLimit ? `${text.slice(0, cellLimit)}…` : text);
      };
      const head = columns.map((c) => `<th style="${TH_STYLE}">${htmlEscape(c)}</th>`).join("");
      const body = shown
        .map((row) => {
          const record = (row ?? {}) as Record<string, unknown>;
          return `<tr>${columns
            .map((c) => `<td style="${TD_STYLE}">${cell(c, record[c])}</td>`)
            .join("")}</tr>`;
        })
        .join("");
      // Decir cuántas quedaron afuera evita que alguien lea 20 filas y crea
      // que ésas son todas.
      const rest =
        rows.length > shown.length ? `<p>… y ${rows.length - shown.length} fila(s) más.</p>` : "";
      return `<table style="${TABLE_STYLE}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${rest}`;
    },
  },
  /**
   * Saca de una lista los archivos de prueba.
   *
   * Nace de una medición: buscando el mensaje "Timeout has occurred" en el
   * código, las cinco coincidencias que devolvió GitLab eran mocks. Los seis
   * modelos que probamos leyeron uno y dictaminaron un bug de producción.
   * Pedírselo en el prompt no alcanzó — falló 18 de 18 veces. Un mock no es el
   * lugar donde nace un error: eso es un hecho, y un hecho va en el flujo, no
   * en una instrucción que el modelo puede ignorar.
   *
   * Que la lista quede vacía es información, no un fallo: significa que no hay
   * evidencia, y el flujo puede contestar eso en vez de inventar una causa.
   *
   * Lo que no es una lista pasa intacto, como el resto de los filtros.
   */
  withoutTests: {
    arity: [0, 0],
    apply: (v) => (Array.isArray(v) ? v.filter((item) => !looksLikeATest(item)) : v),
  },
  /**
   * Partir un texto por un separador.
   *
   * Sin esto no había forma de sacar el sha de un `service.version` como
   * `0.2.67+da206454` dentro de una plantilla. Cortan en la PRIMERA aparición,
   * y si el separador no está devuelven el texto entero: devolver vacío
   * convertiría una versión sin sha en una consulta con la punta en blanco, y
   * eso falla lejos de donde está la causa.
   *
   * El separador toma el resto de la expresión, dos puntos incluidos, igual que
   * `default` — así `after:::` parte por `::`.
   */
  after: {
    arity: [1, Infinity],
    apply: (v, args) => {
      const texto = asText(v);
      const sep = args.join(":");
      const i = texto.indexOf(sep);
      return i === -1 || sep === "" ? texto : texto.slice(i + sep.length);
    },
  },
  before: {
    arity: [1, Infinity],
    apply: (v, args) => {
      const texto = asText(v);
      const sep = args.join(":");
      const i = texto.indexOf(sep);
      return i === -1 || sep === "" ? texto : texto.slice(0, i);
    },
  },
  nrql: { arity: [0, 0], apply: (v) => nrqlEscape(asText(v)) },
  html: { arity: [0, 0], apply: (v) => htmlEscape(asText(v)) },
  redact: {
    arity: [1, 1],
    apply: (v, [max]) => {
      const limit = toInt(max, "redact");
      let text = asText(v);
      for (const [re, repl] of REDACTIONS) text = text.replace(re, repl);
      return text.length > limit ? `${text.slice(0, limit)}…` : text;
    },
  },
};

export const FILTER_NAMES: readonly string[] = Object.keys(FILTERS);

interface ParsedFilter {
  name: string;
  args: string[];
}

function parse(expr: string): { path: string; filters: ParsedFilter[] } {
  const [path = "", ...rest] = expr.split("|").map((s) => s.trim());
  const filters = rest.map((part) => {
    const [name = "", ...args] = part.split(":");
    return { name: name.trim(), args };
  });
  return { path, filters };
}

function checkFilter(f: ParsedFilter): string | null {
  const spec = FILTERS[f.name];
  if (!spec) return `unknown filter "${f.name}"`;
  const [min, max] = spec.arity;
  if (f.args.length < min || f.args.length > max) {
    return `filter "${f.name}" takes ${min === max ? min : `${min}+`} argument(s), got ${f.args.length}`;
  }
  return null;
}

function walk(path: string, ctx: Record<string, unknown>): unknown {
  let v: unknown = ctx;
  for (const p of path.split(".")) {
    if (v && typeof v === "object" && p in (v as Record<string, unknown>)) {
      v = (v as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return v;
}

export function evaluateExpression(expr: string, ctx: Record<string, unknown>): unknown {
  const { path, filters } = parse(expr);
  let value = walk(path, ctx);
  for (const f of filters) {
    const problem = checkFilter(f);
    if (problem) throw new FilterError(problem);
    value = FILTERS[f.name]!.apply(value, f.args);
  }
  return value;
}

export function findTemplateErrors(template: string): string[] {
  const errors: string[] = [];
  for (const m of template.matchAll(/\{\{([^}]+)\}\}/g)) {
    for (const f of parse(m[1]!).filters) {
      const problem = checkFilter(f);
      if (problem) errors.push(`{{${m[1]!.trim()}}}: ${problem}`);
    }
  }
  return errors;
}
